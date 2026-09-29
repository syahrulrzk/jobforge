import { db } from "@/lib/db";
import { COMPANY_TEMPLATES, SOURCE_PROFILES, chance, pick, randInt, type SourceProfile } from "./data";
import { scrapeSource, type RawJobRecord } from "./adapters";
import {
  companyFingerprint,
  jobFingerprint,
  normalizeTitle,
  validateEmail,
  validateJob,
} from "./pipeline";
import { processBulkImport, generateRequestId } from "./portal";
import { bulkImportSchema, DELIVERY_ENDPOINT, SETTING_KEYS, type CanonicalJob } from "./types";
import { extractDomain, resolveLogoUrl, portalSafeLogoUrl } from "./logo";
import { enrichCompanyProfile, deriveProfileFromJobs } from "./company-enrich";
import { ENGINES, engineJitter, parseEngineList, parseEnginePool, rotateEngine, type EngineKey } from "./engines";
import { REAL_BOARDS, realBoardError, fetchDeallsCompanyProfile } from "./sources-real";
import { allocateJobCode } from "./job-code";
import { findCompanyHrEmail } from "./company-email";
import { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Worker Engine (PRD §22, §36, §41)
// Tick-based worker simulation:
//   scrape → normalize/dedup → enrich → validate → deliver
// Runs as a process singleton, survives HMR via globalThis.
// ─────────────────────────────────────────────────────────────

interface EngineState {
  instance: string;
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  tickStartedAt: number; // watchdog: deteksi tick yang menggantung
  scrapeMutex: Promise<void>; // serialize scrape: auto-tick & manual run tidak boleh overlap
  scrapeBusy: boolean; // true selama scrape di dalam mutex (dipakai tick untuk skip)
  tickCount: number;
  settings: Map<string, string>;
  settingsLoadedAt: number;
  sourceCursor: number;
  engineCursor: number;
  mailtoScanned: Set<string>; // jobIds already scanned for a real mailto contact
  profileEnriched: Set<string>; // companyIds yang sudah di-enrich profil website-nya
}

const g = globalThis as unknown as { __jobforgeEngine?: EngineState };

// Unique per module evaluation — lets the engine restart cleanly after HMR
const MODULE_INSTANCE = Math.random().toString(36).slice(2);

function state(): EngineState {
  if (!g.__jobforgeEngine || g.__jobforgeEngine.instance !== MODULE_INSTANCE) {
    if (g.__jobforgeEngine?.timer) clearInterval(g.__jobforgeEngine.timer);
    g.__jobforgeEngine = {
      instance: MODULE_INSTANCE,
      timer: null,
      ticking: false,
      tickStartedAt: 0,
      scrapeMutex: Promise.resolve(),
      scrapeBusy: false,
      tickCount: 0,
      settings: new Map(),
      settingsLoadedAt: 0,
      sourceCursor: 0,
      engineCursor: 0,
      mailtoScanned: new Set(),
      profileEnriched: new Set(),
    };
    // Self-heal setelah HMR: module baru dievaluasi → timer lama sudah
    // diclear di atas, tapi ensureBootstrap (cached global) tidak akan
    // dipanggil lagi → tick mati diam-diam. Re-arm otomatis di sini.
    setTimeout(() => startEngine(), 0);
  }
  return g.__jobforgeEngine;
}

async function getSettings(): Promise<Map<string, string>> {
  const s = state();
  if (Date.now() - s.settingsLoadedAt > 15_000 || s.settings.size === 0) {
    const rows = await db.setting.findMany();
    s.settings = new Map(rows.map((r) => [r.key, r.value]));
    s.settingsLoadedAt = Date.now();
  }
  return s.settings;
}

export async function log(
  action: string,
  status: string,
  message: string,
  opts: { source?: string | null; jobId?: string | null; durationMs?: number } = {}
) {
  try {
    await db.activityLog.create({
      data: {
        action,
        status,
        message,
        source: opts.source ?? null,
        jobId: opts.jobId ?? null,
        durationMs: opts.durationMs ?? null,
      },
    });
  } catch {
    // logging must never break the pipeline
  }
}

async function recordError(
  errorType: string,
  message: string,
  opts: { sourceId?: string | null; jobId?: string | null } = {}
) {
  const existing = await db.scrapeError.findFirst({
    where: { errorType, message, sourceId: opts.sourceId ?? null, status: "OPEN" },
  });
  if (existing) {
    await db.scrapeError.update({
      where: { id: existing.id },
      data: { lastSeen: new Date(), retryCount: { increment: 1 } },
    });
  } else {
    await db.scrapeError.create({
      data: {
        errorType,
        message,
        sourceId: opts.sourceId ?? null,
        jobId: opts.jobId ?? null,
        stack: `at Engine.tick (jobforge/engine.ts)`,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 1 — Scraping (§10, §23, §24)
// ─────────────────────────────────────────────────────────────

function profileFor(slug: string): SourceProfile {
  return SOURCE_PROFILES.find((p) => p.slug === slug) ?? SOURCE_PROFILES[0];
}

async function canonicalFor(jobId: string): Promise<CanonicalJob | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { company: true, jobLinks: { include: { source: true } }, contact: true },
  });
  if (!job || !job.company || job.jobLinks.length === 0 || !job.contact) return null;
  const link = job.jobLinks[0];
  return {
    source: { platform: link.source.slug, job_id: link.sourceJobId, url: link.sourceUrl },
    company: {
      name: job.company.name,
      // Portal validasi logo_url dgn URL strict — data URI badge SVG internal
      // ditolak 422. Konversi ke URL publik valid; DB tidak diubah.
      logo_url: portalSafeLogoUrl(job.company.logoUrl, job.company.website, job.company.name),
      // "" diperlakukan null — z.string().url() menolak string kosong
      website: job.company.website || null,
      profile: job.company.profile,
    },
    job: {
      title: job.title,
      description: job.description,
      salary:
        job.salaryMin && job.salaryMax
          ? { min: job.salaryMin, max: job.salaryMax, currency: job.currency ?? "IDR" }
          : null,
      location: job.location ?? null,
      employment_type: job.employmentType ?? null,
      workplace_type: job.workplaceType ?? null,
      requirements: job.requirements ? JSON.parse(job.requirements) : null,
      skills: job.skills ? JSON.parse(job.skills) : null,
    },
    contact: {
      hr_email: job.contact.hrEmail,
      email_source: job.contact.emailSourceUrl ?? null,
      email_verified: job.contact.emailVerified,
    },
    metadata: { scraped_at: job.scrapedAt.toISOString() },
  };
}

type ScrapeAttempt = { records: RawJobRecord[]; pagesScraped: number; errors: { type: string; message: string }[] };

// Mutex sederhana (chained promise): scrape berikutnya nunggu scrape sebelumnya
// selesai. Mencegah auto-tick + manual run (atau dua manual run) scraping source
// yang sama secara paralel → run duplikat + race insert + ban IP dari board.
/**
 * Insert link provenance JobSource tahan-race: pada @@unique([sourceId, sourceJobId]),
 * dua run paralel (proses berbeda / race check-then-insert) bisa nyisipin link yang
 * sama — P2002 dianggap sukses karena data yang diminta memang sudah ada.
 */
async function insertJobSourceSafe(data: {
  jobId: string;
  sourceId: string;
  sourceJobId: string;
  sourceUrl: string;
}): Promise<void> {
  try {
    await db.jobSource.create({ data });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
  }
}

let insideScrapeMutex = false;

async function runScrapeForSource(sourceId: string, forced = false): Promise<void> {
  const s = state();
  // Re-entrant: dipanggil dari dalam mutex (tick loop) → jalan langsung.
  if (insideScrapeMutex) return runScrapeForSourceInner(sourceId, forced);
  // Tick gak perlu nunggu scrape panjang — cukup tahu bahwa ada scrape lagi jalan.
  if (s.scrapeBusy) {
    void log("scrape", "info", "Scrape masih berjalan — tick skip siklus ini");
    return;
  }
  const prev = s.scrapeMutex;
  let release!: () => void;
  s.scrapeMutex = new Promise<void>((resolve) => (release = resolve));
  s.scrapeBusy = true;
  await prev.catch(() => undefined); // tunggu scrape sebelumnya kelar
  insideScrapeMutex = true;
  try {
    await runScrapeForSourceInner(sourceId, forced);
  } finally {
    insideScrapeMutex = false;
    s.scrapeBusy = false;
    release();
  }
}

async function runScrapeForSourceInner(sourceId: string, forced = false): Promise<void> {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) return;
  if (!forced && source.status === "INACTIVE") return;

  const settings = await getSettings();
  const profile = profileFor(source.slug);
  const s = state();

  const realMode = (settings.get(SETTING_KEYS.dataMode) ?? "real") === "real";
  const realFetcher = REAL_BOARDS[source.slug];

  // §9.3 anti-spam — real mode TANPA integrasi nyata tidak boleh generate mock job.
  // Auto tick: skip diam-diam. Run manual: catat 1 run FAILED dengan pesan yang jujur.
  if (realMode && !realFetcher) {
    if (forced) {
      const primary = parseEngineList(source.engines, source.engine)[0];
      const run = await db.scrapeRun.create({ data: { sourceId: source.id, engine: primary, status: "RUNNING" } });
      await db.scrapeRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), pagesScraped: 0, jobsFound: 0, jobsCreated: 0, errorCount: 1, status: "FAILED" },
      });
      await recordError(
        "SOURCE_ERROR",
        `Real mode: ${source.name} belum punya integrasi scraper nyata — generator mock dinonaktifkan (anti-spam). Aktifkan board publik yang didukung atau tunggu integrasi board ini.`,
        { sourceId: source.id }
      );
      await log("scrape", "failed", `Real mode: ${source.name} belum terhubung ke scraper nyata — run dihentikan tanpa membuat data palsu`, { source: source.slug });
      await db.source.update({ where: { id: source.id }, data: { lastRunAt: new Date(), status: "ERROR" } });
    }
    return;
  }

  // REAL data mode — live public job APIs, throttled for auto runs (be nice to the boards)
  if (realMode && realFetcher && !forced) {
    const elapsed = source.lastRunAt ? Date.now() - source.lastRunAt.getTime() : Infinity;
    if (elapsed < 120_000) return;
  }

  // §9.3 engine chain — urutan prioritas engine milik source ∩ global Engine Pool.
  // Kosong (semua engine source di luar pool) → failover rotasi pool seperti §9.2.
  const pool = parseEnginePool(settings.get(SETTING_KEYS.enginePool));
  const pinned = parseEngineList(source.engines, source.engine);
  const candidates = pinned.filter((e) => pool.includes(e));
  const chain: EngineKey[] = candidates.length > 0 ? candidates : [rotateEngine(pool, s.engineCursor++).engine];

  // Coba engine satu per satu sesuai prioritas — engine pertama yang sukses dipakai.
  // Tiap attempt mendapat ScrapeRun sendiri supaya riwayat failover terlihat di Runs.
  let result: ScrapeAttempt | null = null;
  let winningEngine: EngineKey | null = null;
  let activeRunId: string | null = null;
  let attempts = 0;
  const t0 = Date.now();

  for (let i = 0; i < chain.length; i++) {
    const engine = chain[i];
    attempts += 1;
    const engineMeta = ENGINES[engine];
    const run = await db.scrapeRun.create({ data: { sourceId: source.id, engine, status: "RUNNING" } });
    const jitter = engineJitter(engine);
    // engine prep/teardown latency — browser engines boot a driver session (§10.4)
    await new Promise((resolve) => setTimeout(resolve, jitter.latencyMs));

    if (jitter.failed) {
      // engine-level failure roll (driver crash / renderer hang) — failover ke engine berikutnya
      await db.scrapeRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), pagesScraped: 1, jobsFound: 0, errorCount: 1, status: "FAILED" },
      });
      await recordError("NETWORK_ERROR", `${engineMeta.name} engine: session crashed mid-run`, { sourceId: source.id });
      const next = chain[i + 1] ? ENGINES[chain[i + 1]].name : null;
      await log("scrape", "warning", `${engineMeta.name} gagal (session crash) — failover ke ${next ?? "tidak ada engine lagi"}`, { source: source.slug });
      continue;
    }

    let attempt: ScrapeAttempt;
    if (realMode && realFetcher) {
      try {
        attempt = await realFetcher({ proxyUrl: source.proxyUrl, headersJson: source.headersJson });
      } catch (err) {
        attempt = { records: [], pagesScraped: 1, errors: [realBoardError(source.name, err)] };
      }
    } else {
      attempt = scrapeSource(profile, new Set());
    }

    const attemptFailed = attempt.errors.length > 0 && attempt.records.length === 0;
    if (attemptFailed && i < chain.length - 1) {
      // fetch gagal total — tandai attempt FAILED lalu coba engine prioritas berikutnya
      await db.scrapeRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), pagesScraped: attempt.pagesScraped, jobsFound: 0, errorCount: attempt.errors.length, status: "FAILED" },
      });
      for (const err of attempt.errors) await recordError(err.type, err.message, { sourceId: source.id });
      await log("scrape", "warning", `${engineMeta.name} gagal fetch ${source.name} (${attempt.errors[0]?.type ?? "UNKNOWN"}) — failover ke ${ENGINES[chain[i + 1]].name}`, { source: source.slug });
      continue;
    }

    result = attempt;
    winningEngine = engine;
    activeRunId = run.id;
    break;
  }

  if (!result || !winningEngine || !activeRunId) {
    // seluruh chain gagal
    await db.source.update({ where: { id: source.id }, data: { lastRunAt: new Date(), status: "ERROR" } });
    await log(
      "scrape",
      "failed",
      `Scrape run gagal total — ${attempts} engine dicoba (${chain.map((e) => ENGINES[e].name).join(" → ")}), semuanya gagal`,
      { source: source.slug }
    );
    return;
  }

  const engineMeta = ENGINES[winningEngine];

  let created = 0;
  let updated = 0;
  let duplicated = 0;
  let rejectedNoCompany = 0;

  for (const rec of result.records) {
    // DIREKTIF USER: record TANPA nama perusahaan TIDAK BOLEH masuk DB.
    // Tidak ada fingerprint "unknown" — langsung dibuang dan dihitung rejected.
    if (!rec.rawCompanyName || rec.rawCompanyName.trim().length < 2) {
      rejectedNoCompany += 1;
      await recordError("INVALID_DATA", `Record dibuang: nama perusahaan tidak tersedia — "${rec.rawTitle.slice(0, 60)}"`, { sourceId: source.id });
      continue;
    }
    const fp = jobFingerprint(rec.rawCompanyName ?? "", rec.rawTitle, rec.rawLocation);
    const existing = await db.job.findUnique({ where: { fingerprint: fp } });

    if (existing) {
      // §15.1 — duplicate detected: attach source identity, maybe refresh
      const linkExists = await db.jobSource.findFirst({
        where: { jobId: existing.id, sourceId: source.id },
      });
      if (!linkExists) {
        await insertJobSourceSafe({
          jobId: existing.id,
          sourceId: source.id,
          sourceJobId: rec.sourceJobId,
          sourceUrl: rec.sourceUrl,
        });
      }
      if (chance(0.55)) {
        await db.job.update({
          where: { id: existing.id },
          data: { scrapedAt: new Date(rec.scrapedAt) },
        });
        updated += 1;
      } else {
        duplicated += 1;
      }
      continue;
    }

    const newJob = await db.job.create({
      data: {
        code: await allocateJobCode(),
        fingerprint: fp,
        title: rec.rawTitle.replace(/\s*[-–]\s*PT\s+.*$/i, "").trim() || rec.rawTitle,
        normalizedTitle: normalizeTitle(rec.rawTitle),
        companyName: rec.rawCompanyName,
        companyLogoUrl: rec.rawCompanyLogoUrl,
        // Salary text TIDAK di-append ke deskripsi — bikin teks ganda jelek
        // (gaji udah ada di kolom sendiri). Kosong = honest, detail sheet
        // nampilin fallback + link sumber.
        description: rec.rawDescription ?? "",
        salaryMin: null, // set at normalize stage
        salaryMax: null,
        currency: null,
        location: rec.rawLocation,
        employmentType: rec.rawEmploymentType,
        workplaceType: rec.rawWorkplaceType,
        requirements: JSON.stringify(rec.rawRequirements),
        skills: JSON.stringify(rec.rawSkills),
        status: "SCRAPED",
        scrapedAt: new Date(rec.scrapedAt),
        companyId: null,
      },
    });
    // §15.2 — store source identity for provenance (P2002-safe: run paralel
    // dari proses lain boleh menyisipkan link yang sama lebih dulu)
    await insertJobSourceSafe({
      jobId: newJob.id,
      sourceId: source.id,
      sourceJobId: rec.sourceJobId,
      sourceUrl: rec.sourceUrl,
    });
    // §12 — boards that publish the recruiter email in the list payload
    // (Dealls / Sejutacita API author.email) get their contact stored
    // immediately, so validation can go straight to READY without a
    // posting-page mailto scan. Mirrors the live-search ingest path.
    if (rec.publishedEmail) {
      const v = validateEmail(rec.publishedEmail);
      if (v.status !== "INVALID") {
        await db.jobContact.create({
          data: {
            jobId: newJob.id,
            hrEmail: rec.publishedEmail,
            emailSourceUrl: rec.sourceUrl,
            emailVerified: v.verified,
            emailStatus: v.status,
          },
        });
      }
    }
    created += 1;
  }

  const failed = result.errors.length > 0 && result.records.length === 0;
  for (const err of result.errors) {
    await recordError(err.type, err.message, { sourceId: source.id });
    await log("error", "failed", `${err.type}: ${err.message}`, { source: source.slug });
  }

  await db.scrapeRun.update({
    where: { id: activeRunId },
    data: {
      finishedAt: new Date(),
      pagesScraped: result.pagesScraped,
      jobsFound: result.records.length,
      jobsCreated: created,
      jobsUpdated: updated,
      jobsDuplicate: duplicated,
      errorCount: result.errors.length,
      status: failed ? "FAILED" : "SUCCESS",
    },
  });

  await db.source.update({
    where: { id: source.id },
    data: {
      lastRunAt: new Date(),
      status: failed ? "ERROR" : "ACTIVE",
    },
  });

  const failoverNote = attempts > 1 ? ` (failover dari ${attempts - 1} engine sebelumnya)` : "";
  await log(
    "scrape",
    failed ? "failed" : "success",
    `Scrape run ${failed ? "failed" : "finished"} via ${engineMeta.name} engine${failoverNote} — found ${result.records.length}, created ${created}, updated ${updated}, duplicate ${duplicated}`,
    { source: source.slug, durationMs: Date.now() - t0 }
  );
}

// ─────────────────────────────────────────────────────────────
// Phase 2 — Pipeline stages (§14 normalizer, §11 enrichment,
// §12 email discovery, §17 validation)
// ─────────────────────────────────────────────────────────────


async function advanceStageBatches(): Promise<void> {
  const s = state();
  const t = Date.now();
  const st = state();

  // SCRAPED → PROCESSING (normalizer)
  const scraped = await db.job.findMany({
    where: { status: "SCRAPED" },
    take: 24,
    orderBy: { scrapedAt: "asc" },
    include: { jobLinks: { include: { source: true } } },
  });
  for (const job of scraped) {
    // §14 — normalize salary: structured USD/EUR text first, lalu range IDR
    // asli ("IDR 6.000.000 - 9.000.000 per bulan" — Dealls), terakhir angka
    // tunggal legacy (estimasi ×1.35 HANYA bila range tidak tersedia).
    const usd = parseSalaryUsd(job.description);
    let salaryMin: number | null = null;
    let salaryMax: number | null = null;
    let currency: string | null = null;
    if (usd) {
      salaryMin = usd.min;
      salaryMax = usd.max;
      currency = usd.currency;
    } else {
      const parseIdr = (v: string, unit?: string): number => {
        const n = parseFloat(v.replace(/\./g, "").replace(/,/g, "."));
        if (!Number.isFinite(n) || n <= 0) return 0;
        return unit ? Math.round(n * 1_000_000) : Math.round(n);
      };
      // range asli — "IDR 6.000.000 - 9.000.000" / "IDR 8jt - 12jt"
      const range = job.description.match(/IDR\s*([\d.,]+)\s*(jt|juta)?\s*[-–]\s*(?:IDR\s*)?([\d.,]+)\s*(jt|juta)?/i);
      if (range) {
        const lo = parseIdr(range[1], range[2]);
        const hi = parseIdr(range[3], range[4] ?? range[2]);
        if (lo > 0 && hi >= lo) {
          salaryMin = lo;
          salaryMax = hi;
          currency = "IDR";
        }
      }
      if (!salaryMin) {
        // fallback legacy — angka tunggal, max diestimasi
        const salaryMatch = job.description.match(/IDR\s*([\d.,]+\s*(?:jt|juta)?)/i);
        if (salaryMatch) {
          const n = parseFloat(salaryMatch[1].replace(/\./g, "").replace(/,/g, "."));
          const val = /jt|juta/i.test(salaryMatch[1]) ? Math.round(n * 1_000_000) : Math.round(n);
          if (val > 0) {
            salaryMin = val;
            salaryMax = Math.round(val * 1.35);
            currency = "IDR";
          }
        }
      }
    }
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        statusReason: null,
        ...(salaryMin ? { salaryMin, salaryMax, currency } : {}),
      },
    });
  }
  if (scraped.length > 0) {
    await log("normalize", "success", `Normalized ${scraped.length} job record(s) to canonical format`);
  }

  // PROCESSING → ENRICHING (company enrichment §11)
  const processing = await db.job.findMany({
    where: { status: "PROCESSING" },
    take: 18,
    orderBy: { scrapedAt: "asc" },
  });
  for (const job of processing) {
    const link = await db.jobSource.findFirst({ where: { jobId: job.id }, include: { source: true } });
    const rec = parseRawFromJob(job, link?.sourceUrl ?? "");
    // §11 — profil perusahaan ASLI dari API perusahaan Dealls (bukan karangan):
    // description/website/sector/size ter-publish oleh perusahaan. Slug diambil
    // dari URL company page Dealls pada link job. Cache in-process per slug.
    let deallsProfile: Awaited<ReturnType<typeof fetchDeallsCompanyProfile>> = null;
    // Slug company Dealls: URL company page (…/company/<slug>) ATAU detail job
    // (…/loker/<jobSlug>~<companySlug>) — keduanya selalu membawa slug asli.
    const deallsSlug =
      link?.sourceUrl?.match(/dealls\.com\/company\/([^/~?]+)/)?.[1] ??
      link?.sourceUrl?.match(/dealls\.com\/loker\/[^/~]+~([^/~?]+)/)?.[1] ??
      null;
    if (deallsSlug) {
      deallsProfile = await fetchDeallsCompanyProfile(decodeURIComponent(deallsSlug));
      if (deallsProfile) {
        if (deallsProfile.profile) rec.companyProfile = deallsProfile.profile;
        if (deallsProfile.website) rec.companyWebsite = deallsProfile.website;
        if (deallsProfile.sector) rec.companyIndustry = deallsProfile.sector;
        if (deallsProfile.logoUrl && !rec.companyLogoUrl) rec.companyLogoUrl = deallsProfile.logoUrl;
      }
    }
    // company upsert by normalized name (§15.3)
    let company = rec.companyName
      ? await db.company.findUnique({ where: { normalizedName: companyFingerprint(rec.companyName) } })
      : null;
    if (!company && rec.companyName) {
      // §11 enrichment — company BARU: profil ASLI dari API perusahaan Dealls
      // (bukan karangan): description/website/sector/size ter-publish perusahaan.
      // Logo: logo resmi sumber DULU (CDN Dealls = logo asli), baru
      // provider-resolved, badge SVG deterministik sebagai fallback terakhir.
      const resolvedLogo = rec.companyLogoUrl ?? (await resolveLogoUrl(rec.companyWebsite, rec.companyName)) ?? "";
      company = await db.company.create({
        data: {
          name: rec.companyName,
          normalizedName: companyFingerprint(rec.companyName),
          logoUrl: resolvedLogo,
          // "" → null: string kosong lolos `?? null` lalu ditolak zod
          // z.string().url() saat delivery ("Invalid URL") — simpan NULL saja
          website: rec.companyWebsite || null,
          profile: rec.companyProfile ?? "Profil perusahaan belum tersedia.",
          industry: rec.companyIndustry ?? null,
          size: deallsProfile?.size ?? null,
        },
      });
      await log(
        "enrich",
        "info",
        `New company registered: ${company.name}${deallsProfile?.profile ? " — profil asli dari Dealls" : ""}${resolvedLogo ? " — logo resolved" : ""}`,
      );
    }
    // §11 enrichment — attempt logo/profile recovery from company website
    if (company) {
      const resolvedLogo = await resolveLogoUrl(company.website ?? rec.companyWebsite, company.name);
      if ((!company.logoUrl || company.logoUrl.endsWith("/assets/logo.png")) && resolvedLogo) {
        await db.company.update({ where: { id: company.id }, data: { logoUrl: resolvedLogo, enrichedAt: new Date() } });
        company = { ...company, logoUrl: resolvedLogo };
        await log("enrich", "success", `Logo resolved via provider chain for ${company.name} (${extractDomain(company.website) ?? "?"})`);
      } else if (!company.logoUrl && rec.companyLogoUrl) {
        await db.company.update({ where: { id: company.id }, data: { logoUrl: rec.companyLogoUrl, enrichedAt: new Date() } });
        company = { ...company, logoUrl: rec.companyLogoUrl };
      }
      if (!company.profile && rec.companyProfile) {
        await db.company.update({ where: { id: company.id }, data: { profile: rec.companyProfile, enrichedAt: new Date() } });
      }
      // §11 profil — scrape homepage: description/industry/size (sekali per company per proses)
      const needsProfile =
        company.profile === "Profil perusahaan belum tersedia." ||
        !company.industry ||
        !company.size;
      if (needsProfile && !s.profileEnriched.has(company.id)) {
        s.profileEnriched.add(company.id);
        try {
          const prof = await enrichCompanyProfile(company.name, company.website);
          if (prof) {
            await db.company.update({
              where: { id: company.id },
              data: {
                website: company.website || prof.website,
                profile: prof.description ?? company.profile,
                industry: prof.industry ?? company.industry,
                size: prof.size ?? company.size,
                enrichedAt: new Date(),
              },
            });
            company = { ...company, website: company.website || prof.website, profile: prof.description ?? company.profile, industry: prof.industry ?? company.industry, size: prof.size ?? company.size };
            await log("enrich", "success", `Profil ${company.name} diperkaya dari ${prof.domain} (${prof.source}${prof.size ? `, size ${prof.size}` : ""})`, { jobId: job.id });
          }
        } catch {
          // situs mati/timeout — ditangani guard profil wajib di bawah
        }
        // profil WAJIB — bila situs tidak memberi deskripsi, isi dari fakta
        // lowongan perusahaan itu sendiri (posisi/lokasi/gaji/platform — bukan karangan)
        const cur = await db.company.findUnique({ where: { id: company.id }, select: { profile: true } });
        if (cur && cur.profile === "Profil perusahaan belum tersedia.") {
          const derived = deriveProfileFromJobs(company.name, {
            titles: [job.title],
            locations: [job.location ?? ""],
            salaryMin: job.salaryMin ?? null,
            salaryMax: job.salaryMax ?? null,
            sources: link?.source?.slug ? [link.source.slug] : [],
            totalJobs: 1,
          });
          await db.company.update({ where: { id: company.id }, data: { profile: derived, enrichedAt: new Date() } });
          company = { ...company, profile: derived };
          await log("enrich", "info", `Profil ${company.name} diisi dari data lowongan (situs tidak memberi deskripsi)`, { jobId: job.id });
        }
      }
    }
    await db.job.update({
      where: { id: job.id },
      data: { status: "ENRICHING", companyId: company?.id ?? null },
    });
  }

  // ENRICHING → VALIDATING (HR email discovery §12)
  const enriching = await db.job.findMany({
    where: { status: "ENRICHING" },
    take: 18,
    orderBy: { scrapedAt: "asc" },
    include: { company: true },
  });
  for (const job of enriching) {
    const link = await db.jobSource.findFirst({ where: { jobId: job.id } });
    const rec = parseRawFromJob(job, link?.sourceUrl ?? "");
    // §12 email discovery — payload email first, then scan the description text
    // (boards often publish a recruitment address inside the posting body)
    const publishedEmail = rec.publishedEmail ?? extractPublishedEmail(job.description ?? "");
    if (job.company && publishedEmail) {
      const hasContact = await db.jobContact.findUnique({ where: { jobId: job.id } });
      if (!hasContact) {
        const v = validateEmail(publishedEmail);
        await db.jobContact.create({
          data: {
            jobId: job.id,
            hrEmail: publishedEmail,
            emailSourceUrl: rec.careerPageUrl,
            emailVerified: v.verified,
            emailStatus: v.status,
          },
        });
        if (!v.verified) {
          await recordError(v.reason.split(":")[0] ?? "EMAIL_INVALID", v.reason, { jobId: job.id });
        }
      }
    } else if (job.company) {
      // §13 — email not found: needs enrichment, never guess (§12.4)
      await recordError("EMAIL_NOT_FOUND", `No published recruitment email found on ${rec.careerPageUrl ?? "career page"}`, { jobId: job.id });
    }
    await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING" } });
  }

  // VALIDATING → READY | NEEDS_ENRICHMENT | REJECTED (§17)
  const validating = await db.job.findMany({
    where: { status: "VALIDATING" },
    take: 18,
    orderBy: { scrapedAt: "asc" },
    include: { company: true, contact: true, jobLinks: { include: { source: true } } },
  });
  for (const job of validating) {
    const res = validateJob({
      companyName: job.company?.name ?? null,
      companyLogoUrl: job.company?.logoUrl || null,
      companyProfile: job.company?.profile || null,
      title: job.title,
      description: job.description,
      hrEmail: job.contact?.hrEmail ?? null,
      emailStatus: (job.contact?.emailStatus as "VALID" | "INVALID" | "UNKNOWN") ?? null,
      sourcePlatform: job.jobLinks[0]?.source.slug ?? null,
      sourceUrl: job.jobLinks[0]?.sourceUrl ?? null,
    });
    // Enrichment rule (direktif user) — job yang cuma kekurangan email HR
    // TIDAK di-purge: tetap disimpan ber-status NEEDS_ENRICHMENT dengan
    // statusReason dari validateJob, supaya kelihatan di Jobs view dan bisa
    // di-recovery (scan mailto ulang / payload baru) di loop enrichment §36.
    await db.job.update({
      where: { id: job.id },
      data: { status: res.outcome, statusReason: res.reason },
    });
    if (res.outcome === "REJECTED") {
      const lastRun = await db.scrapeRun.findFirst({
        where: { sourceId: job.jobLinks[0]?.sourceId ?? "", status: { in: ["SUCCESS", "FAILED"] } },
        orderBy: { startedAt: "desc" },
      });
      if (lastRun) {
        await db.scrapeRun.update({ where: { id: lastRun.id }, data: { jobsRejected: { increment: 1 } } });
      }
      await log("validate", "warning", res.reason, { jobId: job.id });
    } else if (res.outcome === "NEEDS_ENRICHMENT") {
      await log("validate", "warning", res.reason, { jobId: job.id });
    }
  }

  // NEEDS_ENRICHMENT recovery loop — enrichment worker retry (§36)
  // Real-source jobs get priority (they have genuine enrichment to attempt:
  // a live mailto scan of the posting page); mock jobs follow the simulated path.
  // Enrichment rule (direktif user): job NEEDS_ENRICHMENT TIDAK pernah di-purge.
  // Query terbaru dulu (desc) supaya job hasil live search terbaru diprioritaskan
  // dapat scan mailto; yang lama tetap tersimpan ber-status NEEDS_ENRICHMENT.
  const needyReal = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT", companyName: { not: null }, contact: null },
    take: 24,
    orderBy: { scrapedAt: "desc" },
    include: { company: true, jobLinks: true },
  });
  const needyMock = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT", companyName: null },
    take: 4,
    orderBy: { scrapedAt: "asc" },
    include: { company: true, contact: true },
  });
  const processNeedyRealJob = async (job: (typeof needyReal)[number]) => {
    const pageUrl = job.jobLinks[0]?.sourceUrl;
    const missingLogo = job.company && !job.company.logoUrl;
    if (missingLogo && job.company) {
      // logo recovery — real payload logo lands with the company at enrich time;
      // logo-less boards: resolve via nama→domain→favicon,
      // badge SVG deterministik sebagai fallback terakhir (logo = field wajib)
      const recovered = (await resolveLogoUrl(job.company.website, job.company.name)) ?? job.companyLogoUrl ?? null;
      if (recovered) {
        await db.company.update({
          where: { id: job.company.id },
          data: { logoUrl: recovered, enrichedAt: new Date() },
        });
        await log("enrich", "success", `Logo recovered for ${job.company.name} — re-validating job`, { jobId: job.id });
        await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING" } });
      }
    }
    if (pageUrl && !st.mailtoScanned.has(job.id)) {
      // §12 real enrichment — scan the actual posting page for a published mailto
      // (one attempt per job per process, rate-limited to respect the boards)
      st.mailtoScanned.add(job.id);
      let email = await discoverMailto(pageUrl);
      let scannedVia = "http";
      let emailSourceUrl = pageUrl;
      if (!email) {
        // Chain perusahaan (§12 lanjutan): board tidak expose email, tapi
        // perusahaan mempublish email HR di situs sendiri
        // (homepage/karir/kontak → Clearbit domain → scan ter-publish;
        // hit rate terukur 33% vs 0% board). Hanya email yang BENAR-benar
        // ter-publish — tanpa konstruksi name@domain (§12.4).
        const chain = await findCompanyHrEmail(job.companyName ?? "", job.company?.website ?? null);
        if (chain) {
          email = chain.email;
          scannedVia = `company-site:${chain.tier}/${chain.via}`;
          emailSourceUrl = chain.sourceUrl;
        }
      }
      if (email) {
        const v = validateEmail(email);
        if (v.status !== "INVALID") {
          await db.jobContact.create({
            data: { jobId: job.id, hrEmail: email, emailSourceUrl, emailVerified: v.verified, emailStatus: v.status },
          });
          // setiap email yang ditemukan pipeline → masuk gudang email juga
          const harvestDomain = extractDomain(emailSourceUrl) ?? email.split("@")[1] ?? "";
          if (harvestDomain.includes(".")) {
            const { saveHarvestToDb } = await import("./harvest-store");
            const src = emailSourceUrl ?? `https://${harvestDomain}`;
            await saveHarvestToDb(
              [{ email, kind: "role", category: "HR/Rekrutmen", sourceUrl: src, via: "pipeline", sources: [src] }],
              harvestDomain,
              job.company?.name ?? job.companyName ?? "",
            );
          }
          await log("enrich", "success", `HR email discovered on posting page (${scannedVia}): ${email}`, { jobId: job.id });
          await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING" } });
          return;
        }
      }
    }
    // Enrichment rule (direktif user) — percobaan scan email gagal / tidak
    // mungkin: job TETAP di DB ber-status NEEDS_ENRICHMENT (jangan dihapus),
    // mencoba lagi di batch berikutnya bila scan belum pernah jalan di proses ini.
  };
  // worker pool 6 concurrent — scan paralel supaya backlog enrichment cepat terdrain
  for (let i = 0; i < needyReal.length; i += 6) {
    await Promise.all(needyReal.slice(i, i + 6).map(processNeedyRealJob));
  }
  for (const job of needyMock) {
    const missingLogo = job.company && !job.company.logoUrl;
    const missingEmail = !job.contact;
    if (missingLogo && chance(0.4) && job.company) {
      // logo recovery via provider chain (website → nama→domain → badge) dari company
      const recovered = await resolveLogoUrl(job.company.website, job.company.name);
      if (recovered) {
        await db.company.update({
          where: { id: job.company.id },
          data: { logoUrl: recovered, enrichedAt: new Date() },
        });
        await log("enrich", "success", `Logo recovered via ${extractDomain(job.company.website) ?? "provider"} for ${job.company.name} — re-validating job`, { jobId: job.id });
        await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING" } });
      }
    }
    if (missingEmail && job.company && job.company.website) {
      // legacy mock sources — template-backed simulated career-page discovery
      if (chance(0.25)) {
        const email = `hr@${job.company.website.replace(/^https?:\/\/(www\.)?/, "")}`;
        const v = validateEmail(email);
        if (v.status === "VALID") {
          await db.jobContact.create({
            data: { jobId: job.id, hrEmail: email, emailSourceUrl: `${job.company.website}/career`, emailVerified: true, emailStatus: "VALID" },
          });
          await log("enrich", "success", `HR email discovered via career page: ${email}`, { jobId: job.id });
          await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING" } });
        }
      }
    }
  }

  // SENT → PUBLISHED (portal confirms publish async)
  const sentJobs = await db.job.findMany({
    where: { status: "SENT", scrapedAt: { lt: new Date(t - 4_000) } },
    take: 20,
  });
  for (const job of sentJobs) {
    await db.job.update({
      where: { id: job.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }
  if (sentJobs.length > 0) {
    await log("import", "success", `${sentJobs.length} job(s) published to Job Portal`);
  }
}

// Raw-record reconstruction from stored job (parser output replay §13/§11)
function parseRawFromJob(
  job: { title: string; description: string; employmentType: string | null; workplaceType: string | null; companyName?: string | null; companyLogoUrl?: string | null },
  sourceUrl: string
): {
  companyName: string | null;
  companyLogoUrl: string | null;
  companyWebsite: string | null;
  companyProfile: string | null;
  companyIndustry: string | null;
  publishedEmail: string | null;
  careerPageUrl: string | null;
} {
  // Real-source jobs carry the company name + logo straight from the source
  // payload (§15 provenance). No public template → no guessed email (§12.4);
  // the recovery worker scans the posting page for a real mailto: contact.
  if (job.companyName) {
    const tpl = getCompanyTemplate(job.companyName); // matches only legacy mock companies
    if (!tpl) {
      return {
        companyName: job.companyName,
        companyLogoUrl: job.companyLogoUrl ?? null,
        companyWebsite: null,
        companyProfile: null,
        companyIndustry: null,
        publishedEmail: null,
        careerPageUrl: sourceUrl || null,
      };
    }
    return {
      companyName: job.companyName,
      companyLogoUrl: job.companyLogoUrl ?? `${tpl.website}/assets/logo.png`,
      companyWebsite: tpl.website,
      companyProfile: tpl.profile,
      companyIndustry: null,
      publishedEmail: tpl.noPublicEmail ? null : `${tpl.emailLocal ?? "hr"}@${tpl.website.replace(/^https?:\/\/(www\.)?/, "")}`,
      careerPageUrl: `${tpl.website}/career`,
    };
  }
  // Legacy mock jobs — company denormalized into the description header line
  const header = job.description.split("\n")[0] ?? "";
  const m = header.match(/(.+?)\s+sedang mencari/);
  const companyName = m ? m[1] : null;
  const tpl = companyName ? getCompanyTemplate(companyName) : null;
  return {
    companyName,
    companyLogoUrl: tpl ? `${tpl.website}/assets/logo.png` : null,
    companyWebsite: tpl?.website ?? null,
    companyProfile: tpl?.profile ?? null,
    companyIndustry: null,
    publishedEmail:
      tpl && !tpl.noPublicEmail
        ? `${tpl.emailLocal ?? "hr"}@${tpl.website.replace(/^https?:\/\/(www\.)?/, "")}`
        : null,
    careerPageUrl: tpl ? `${tpl.website}/career` : null,
  };
}

/** §14 salary parser for international boards — "USD 180,000 - 190,000", "$25k - $35k", "€60k-80k". */
export function parseSalaryUsd(text: string): { min: number; max: number; currency: string } | null {
  const m = text.match(/(?:USD|[$€])\s?([\d.,]+)\s?([kKmM]?)\s?(?:-|–|—|to)\s?(?:USD\s?)?[$€]?\s?([\d.,]+)\s?([kKmM]?)/);
  if (!m) return null;
  const val = (v: string, u: string): number => {
    const n = parseFloat(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) return 0;
    if (u === "k" || u === "K") return Math.round(n * 1_000);
    if (u === "m" || u === "M") return Math.round(n * 1_000_000);
    return Math.round(n);
  };
  const min = val(m[1], m[2]);
  const max = val(m[3], m[4]);
  if (min > 0 && max >= min) return { min, max, currency: m[0].includes("€") ? "EUR" : "USD" };
  return null;
}

/** §12 real HR email discovery — fetch the posting page and look for a published contact. */
export async function discoverMailto(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(6_000),
      redirect: "follow",
      headers: { "User-Agent": "JobForgeBot/1.0 (+HR email discovery §12)", Accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    return extractPublishedEmail(html);
  } catch {
    return null; // page unreachable — stays NEEDS_ENRICHMENT, honest per §12.4
  }
}

/** §12 published-email pattern — a mailto: link or an obviously recruitment-prefixed
 *  address (hr@ / careers@ / recruitment@ / talent@ / jobs@ / karir@). Used both on
 *  fetched posting pages and on raw posting descriptions. */
export function extractPublishedEmail(text: string): string | null {
  const mailto = text.match(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
  if (mailto) return mailto[1].toLowerCase();
  const named = text.match(/\b((?:hr|careers?|recruitment|talent|jobs?|karir)[A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/i);
  return named ? named[1].toLowerCase() : null;
}

function getCompanyTemplate(name: string) {
  return COMPANY_TEMPLATES.find((c) => c.name === name) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Phase 3 — API Delivery (§19–§21: bulk import, tracking, retry)
// ─────────────────────────────────────────────────────────────

// Pre-flight check (direktif user: "yang boleh dikirim hanya data bersih &
// lengkap"): payload canonical wajib lolos validasi zod full — sama persis
// dengan schema §7/§19 yang dipakai portal. Job READY yang payload-nya tidak
// lolos ditahan (tanpa delivery), BUKAN dikirim lalu gagal+retry — jadi tabel
// delivery bersih dan portal tidak pernah menerima payload invalid.
// Tambahan aturan email-mandatory: contact.hr_email wajib ada (gate lama
// contact: { isNot: null } tetap berlaku).
export function preflightCanonical(job: {
  title: string;
  description: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  location: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  requirements: string | null;
  skills: string | null;
  scrapedAt: Date;
  company: { name: string; logoUrl: string | null; website: string | null; profile: string | null } | null;
  jobLinks: { source: { slug: string }; sourceJobId: string; sourceUrl: string }[];
  contact: { hrEmail: string; emailSourceUrl: string | null; emailVerified: boolean } | null;
}): { ok: true; canonical: CanonicalJob } | { ok: false; reason: string } {
  const missing: string[] = [];
  if (!job.company) missing.push("company record");
  if (job.jobLinks.length === 0) missing.push("source link");
  if (!job.contact) missing.push("HR email (contact)");
  if (missing.length > 0) return { ok: false, reason: `PREFLIGHT: missing ${missing.join(", ")}` };

  // Mirror canonicalFor(): salary hanya dikirim bila min+max ada
  const salary =
    job.salaryMin && job.salaryMax
      ? { min: job.salaryMin, max: job.salaryMax, currency: job.currency ?? "IDR" }
      : null;

  let requirements: string[] | null = null;
  let skills: string[] | null = null;
  try {
    requirements = job.requirements ? JSON.parse(job.requirements) : null;
    skills = job.skills ? JSON.parse(job.skills) : null;
  } catch {
    return { ok: false, reason: "PREFLIGHT: requirements/skills bukan JSON valid" };
  }

  const canonical: CanonicalJob = {
    source: { platform: job.jobLinks[0].source.slug, job_id: job.jobLinks[0].sourceJobId, url: job.jobLinks[0].sourceUrl },
    company: {
      name: job.company!.name,
      // Konsisten dgn canonicalFor(): data URI tidak lolos validasi URL portal
      // (422 "company.logo url harus berupa URL yang valid") → konversi.
      logo_url: portalSafeLogoUrl(job.company!.logoUrl, job.company!.website, job.company!.name),
      // "" diperlakukan null — konsisten dgn canonicalFor()
      website: job.company!.website || null,
      profile: job.company!.profile ?? "",
    },
    job: {
      title: job.title,
      description: job.description ?? "",
      salary,
      location: job.location ?? null,
      employment_type: job.employmentType ?? null,
      workplace_type: job.workplaceType ?? null,
      requirements,
      skills,
    },
    contact: {
      hr_email: job.contact!.hrEmail,
      email_source: job.contact!.emailSourceUrl ?? null,
      email_verified: job.contact!.emailVerified,
    },
    metadata: { scraped_at: job.scrapedAt.toISOString() },
  };

  const parsed = bulkImportSchema.safeParse({ source: canonical.source.platform, scraped_at: canonical.metadata.scraped_at, jobs: [canonical] });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "payload";
    return { ok: false, reason: `PREFLIGHT: zod validation failed at ${path} — ${issue?.message ?? "invalid payload"}` };
  }

  return { ok: true, canonical };
}

type PortalPostResult = {
  ok: boolean;
  code: number | null; // null = network error (fetch gagal/timeout)
  body: string;
  retryable: boolean;
};

// POST 1 canonical job ke portal tujuan (mis. Karivia). Format: CanonicalJob
// LANGSUNG tanpa envelope batch §19 — controller Karivia
// (ScrapedJobIngestionController) menerima satu job per POST dan dedup di
// sisinya via (source_platform, source_job_id), respons 201=created / 200=updated.
// Tanpa URL/key terisi → fallback ke simulasi in-process lama supaya pipeline
// demo tetap jalan tanpa kredensial portal.
async function postPortalImport(settings: Map<string, string>, canonical: CanonicalJob): Promise<PortalPostResult> {
  const url = settings.get(SETTING_KEYS.portalApiUrl)?.trim() ?? "";
  const apiKey = settings.get(SETTING_KEYS.portalApiKey)?.trim() ?? "";

  if (!url || !apiKey) {
    const payload = { source: canonical.source.platform, scraped_at: canonical.metadata.scraped_at, jobs: [canonical] };
    const result = await processBulkImport(payload);
    return {
      ok: result.success,
      code: result.success ? 200 : 422,
      body: JSON.stringify(result),
      retryable: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(canonical),
      signal: controller.signal,
    });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    // 201 = created, 200 = updated (kontrak ScrapedJobIngestionController).
    // 4xx selain 408/429 (auth/payload salah) tidak ada gunanya di-retry;
    // 408/429/5xx/network error → retryable sesuai §21.
    const ok = res.status === 200 || res.status === 201;
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    return { ok, code: res.status, body: text, retryable };
  } catch (err) {
    return {
      ok: false,
      code: null,
      body: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverReadyJobs(settings: Map<string, string>): Promise<void> {
  const autoDelivery = settings.get(SETTING_KEYS.autoDelivery) !== "false";
  if (!autoDelivery) return;
  const batchSize = Math.max(1, parseInt(settings.get(SETTING_KEYS.batchSize) ?? "25", 10) || 25);
  const maxAttempts = Math.max(1, parseInt(settings.get(SETTING_KEYS.maxAttempts) ?? "3", 10) || 3);

  // 1. advance existing SENDING/PENDING deliveries (incl. retries §21)
  const inFlight = await db.apiDelivery.findMany({
    where: { status: { in: ["PENDING", "SENDING"] } },
    take: 20,
    include: { job: true },
  });
  for (const d of inFlight) {
    if (d.nextRetryAt && d.nextRetryAt.getTime() > Date.now()) continue;
    await db.apiDelivery.update({ where: { id: d.id }, data: { status: "SENDING" } });
    const canonical = await canonicalFor(d.jobId);
    // Hardening produksi: simulasi gagal acak 7% (§21 retry demo) dihapus —
    // portal tidak pernah menerima error buatan. Delivery hanya gagal kalau
    // payload canonical-nya beneran tidak bisa disusun (canonicalFor → null);
    // payload valid selalu lolos pre-flight jadi tidak mungkin 422 di portal.
    if (!canonical) {
      const failedFinal = d.attempt >= maxAttempts;
      const backoffMs = [5_000, 15_000, 45_000][Math.min(d.attempt - 1, 2)];
      await db.apiDelivery.update({
        where: { id: d.id },
        data: {
          status: failedFinal ? "FAILED" : "PENDING",
          attempt: failedFinal ? d.attempt : d.attempt + 1,
          responseCode: null,
          responseBody: failedFinal ? JSON.stringify({ success: false, message: "Canonical payload unavailable — job data incomplete" }) : null,
          nextRetryAt: failedFinal ? null : new Date(Date.now() + backoffMs),
        },
      });
      if (failedFinal) {
        await recordError("API_ERROR", `Portal import failed after ${maxAttempts} attempts — canonical payload unavailable`, { jobId: d.jobId });
        await log("deliver", "failed", `Delivery ${d.requestId} failed permanently after ${maxAttempts} attempts (canonical payload unavailable)`, { jobId: d.jobId });
      } else {
        await log("deliver", "warning", `Delivery ${d.requestId} attempt ${d.attempt} failed (canonical payload unavailable) — retry in ${backoffMs / 1000}s`, { jobId: d.jobId });
      }
      continue;
    }

    // Real HTTP POST ke portal (Karivia) — lihat postPortalImport.
    const result = await postPortalImport(settings, canonical);
    const failedFinal = !result.ok && (!result.retryable || d.attempt >= maxAttempts);
    const backoffMs = [5_000, 15_000, 45_000][Math.min(d.attempt - 1, 2)];
    await db.apiDelivery.update({
      where: { id: d.id },
      data: {
        status: result.ok ? "SUCCESS" : failedFinal ? "FAILED" : "PENDING",
        attempt: result.ok || failedFinal ? d.attempt : d.attempt + 1,
        responseCode: result.code,
        responseBody: result.body || null,
        deliveredAt: result.ok ? new Date() : null,
        nextRetryAt: result.ok || failedFinal ? null : new Date(Date.now() + backoffMs),
      },
    });
    if (result.ok) {
      await db.job.update({ where: { id: d.jobId }, data: { status: "SENT", statusReason: null } });
      await log("deliver", "success", `Import accepted (HTTP ${result.code}) — ${result.body.slice(0, 200)}`, { jobId: d.jobId });
    } else if (failedFinal) {
      await recordError("API_ERROR", `Portal import failed after ${d.attempt} attempts — HTTP ${result.code ?? "network error"}: ${result.body.slice(0, 200)}`, { jobId: d.jobId });
      await log("deliver", "failed", `Delivery ${d.requestId} failed permanently (HTTP ${result.code ?? "network error"})`, { jobId: d.jobId });
    } else {
      await log("deliver", "warning", `Delivery ${d.requestId} attempt ${d.attempt} failed (HTTP ${result.code ?? "network error"}) — retry in ${backoffMs / 1000}s`, { jobId: d.jobId });
    }
  }

  // 2. create new deliveries for READY jobs without one — HANYA yang lolos
  // pre-flight (payload canonical valid penuh, §7/§19). Yang tidak lolos tetap
  // READY tapi ditahan tanpa delivery + statusReason alasan pre-flight.
  // §19b (lease/ack): job yang sudah FINAL di-pull consumer (pulledAt) TIDAK
  // dikirim lagi, dan job yang sedang DI-LEASE (lease aktif) juga ditahan —
  // bila lease kadaluarsa/tidak di-ack, job balik ke pool & portal delivery
  // lanjut seperti biasa.
  const now = new Date();
  // Syarat preflight (company + jobLinks + contact) disaring langsung di query:
  // tanpa ini, job rusak (mis. tanpa source link) ditahan preflight tiap tick,
  // tidak pernah keluar dari READY, dan permanen memblokir batch "paling tua
  // dulu" (head-of-line blocking) — job sehat di belakangnya tidak pernah
  // kebagian pengiriman.
  const readyJobs = await db.job.findMany({
    where: {
      status: "READY",
      contact: { isNot: null },
      company: { isNot: null },
      jobLinks: { some: {} },
      pulledAt: null,
      OR: [{ pullLeaseUntil: null }, { pullLeaseUntil: { lt: now } }],
      deliveries: { none: { status: { in: ["PENDING", "SENDING"] } } },
    },
    take: batchSize,
    orderBy: { scrapedAt: "asc" },
    include: {
      company: true,
      jobLinks: { include: { source: true } },
      contact: true,
      deliveries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  for (const job of readyJobs) {
    const last = job.deliveries[0];
    if (last && last.status === "FAILED" && last.attempt >= maxAttempts) continue; // needs manual retry

    const pre = preflightCanonical(job);
    if (!pre.ok) {
      await db.job.update({
        where: { id: job.id },
        data: { statusReason: pre.reason },
      });
      await log("deliver", "warning", `${pre.reason} — job ditahan, delivery tidak dibuat`, { jobId: job.id });
      continue;
    }

    await db.apiDelivery.create({
      data: {
        jobId: job.id,
        endpoint: DELIVERY_ENDPOINT,
        requestId: generateRequestId(),
        attempt: 1,
        maxAttempts,
        status: "PENDING",
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Tick orchestration
// ─────────────────────────────────────────────────────────────

// Interval schedule → ms (dipakai auto-tick; manual run selalu bisa lewat forced)
const SCHEDULE_MS: Record<string, number> = {
  hourly: 3_600_000,
  every_6_hours: 21_600_000,
  every_12_hours: 43_200_000,
  daily: 86_400_000,
  manual: Number.POSITIVE_INFINITY,
};

async function tick(): Promise<void> {
  const s = state();
  // Watchdog: tick sebelumnya menggantung >5 menit (fetch tanpa timeout,
  // db hang) → paksa buka kunci supaya pipeline tidak mati permanen.
  // 5 menit: satu siklus Dealls yang legit (30 detail page × 12s × 2 retry)
  // bisa 4-5 menit — watchdog 2 menit dulu bikin run duplikat numpuk.
  if (s.ticking) {
    if (s.tickStartedAt > 0 && Date.now() - s.tickStartedAt > 300_000) {
      s.ticking = false;
      // Run yang tertinggal RUNNING (proses mati/restart mid-scrape) ditandai
      // FAILED biar riwayat Runs jujur dan baris RUNNING tidak numpuk.
      const stale = await db.scrapeRun.updateMany({
        where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 600_000) } },
        data: { finishedAt: new Date(), status: "FAILED", errorCount: 1 },
      });
      void log(
        "scrape",
        "warning",
        `Engine watchdog: tick sebelumnya menggantung >5 menit — kunci dilepas${stale.count > 0 ? `, ${stale.count} run abandoned ditandai FAILED` : ""}`
      );
    } else {
      return;
    }
  }
  s.ticking = true;
  s.tickStartedAt = Date.now();
  try {
    const settings = await getSettings();
    s.tickCount += 1;

    // scrape phase — skip bila ada scrape di dalam mutex (manual run / siklus sebelumnya)
    const autoScrape = settings.get(SETTING_KEYS.autoScrape) !== "false";
    if (autoScrape && s.tickCount % 2 === 1 && !s.scrapeBusy) {
      const cap = parseInt(settings.get(SETTING_KEYS.demoJobCap) ?? "800", 10) || 800;
      const total = await db.job.count();
      if (total < cap) {
        // Hormati schedule per source — hanya source yang due (lastRunAt +
        // interval schedule terlewat) yang di-scrape, paling overdue dulu.
        // Manual "Run now" tetap lewat runSourceNow (forced, bypass schedule).
        const sources = await db.source.findMany({ where: { status: "ACTIVE" }, orderBy: { id: "asc" } });
        const now = Date.now();
        const due = sources
          .map((src) => ({
            id: src.id,
            interval: SCHEDULE_MS[src.schedule] ?? 3_600_000,
            last: src.lastRunAt ? src.lastRunAt.getTime() : 0,
          }))
          .filter((x) => now - x.last >= x.interval)
          .sort((a, b) => a.last - b.last);
        if (due.length > 0) await runScrapeForSource(due[0].id);
      }
    }

    await advanceStageBatches();
    await deliverReadyJobs(settings);

    // housekeeping: keep activity log bounded
    if (s.tickCount % 40 === 0) {
      const old = await db.activityLog.findMany({ orderBy: { ts: "desc" }, skip: 300, take: 1000, select: { id: true } });
      if (old.length > 0) {
        await db.activityLog.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      }
    }
  } catch (err) {
    await recordError("DATABASE_ERROR", `Engine tick error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    s.ticking = false;
    s.tickStartedAt = 0;
  }
}

export function startEngine(): void {
  const s = state();
  if (s.timer) return;
  getSettings()
    .then((settings) => {
      const interval = Math.max(2000, parseInt(settings.get(SETTING_KEYS.tickIntervalMs) ?? "5000", 10) || 5000);
      s.timer = setInterval(() => void tick(), interval);
      if (typeof s.timer === "object" && "unref" in s.timer) (s.timer as { unref: () => void }).unref();
      void log("scrape", "info", `Worker engine started — tick every ${interval / 1000}s`);
    })
    .catch(() => {
      // db not ready yet — retry shortly
      setTimeout(() => {
        s.timer = null;
        startEngine();
      }, 3000);
    });
}

export async function ensureEngine(): Promise<void> {
  startEngine();
}

// Manual triggers (§8 run manually, §31 dashboard actions)
export async function runSourceNow(sourceId: string): Promise<void> {
  await runScrapeForSource(sourceId, true);
  await advanceStageBatches();
}

export async function runPipelineNow(): Promise<number> {
  const sources = await db.source.findMany({ where: { status: "ACTIVE" } });
  for (const src of sources) {
    await runScrapeForSource(src.id, true);
  }
  await advanceStageBatches();
  const settings = await getSettings();
  await deliverReadyJobs(settings);
  return sources.length;
}

// Hitung job READY yang siap dikirim ke portal — kriteria identik dgn query
// di sendReadyJobsToPortal()/deliverReadyJobs(): ber-contact, ber-company,
// ber-source link, belum di-pull consumer, tidak sedang di-lease, dan belum
// ada delivery in-flight. FAILED-final tidak dihitung (butuh manual retry).
// Dipakai kartu "Kirim ke portal" di Portal Settings sbg preview sebelum kirim.
export async function countReadyJobsForPortal(): Promise<number> {
  const settings = await getSettings();
  const maxAttempts = Math.max(1, parseInt(settings.get(SETTING_KEYS.maxAttempts) ?? "3", 10) || 3);
  const now = new Date();
  const candidates = await db.job.count({
    where: {
      status: "READY",
      contact: { isNot: null },
      company: { isNot: null },
      jobLinks: { some: {} },
      pulledAt: null,
      OR: [{ pullLeaseUntil: null }, { pullLeaseUntil: { lt: now } }],
      deliveries: { none: { status: { in: ["PENDING", "SENDING"] } } },
    },
  });
  if (candidates === 0) return 0;
  // Kurangi yang gagal pre-flight / FAILED-final — preflightCanonical butuh
  // relasi lengkap, jadi ambil minimal field yang dipakai preflightCanonical.
  const rows = await db.job.findMany({
    where: {
      status: "READY",
      contact: { isNot: null },
      company: { isNot: null },
      jobLinks: { some: {} },
      pulledAt: null,
      OR: [{ pullLeaseUntil: null }, { pullLeaseUntil: { lt: now } }],
      deliveries: { none: { status: { in: ["PENDING", "SENDING"] } } },
    },
    select: {
      id: true,
      deliveries: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, attempt: true } },
    },
  });
  let ready = 0;
  for (const job of rows) {
    const last = job.deliveries[0];
    if (last && last.status === "FAILED" && last.attempt >= maxAttempts) continue;
    ready += 1;
  }
  return ready;
}

// Manual "send now" (§31 dashboard actions) — antrekan SEMUA job READY yang
// lolos pre-flight, lalu kirim keduanya (delivery in-flight dulu, antrean baru
// kemudian) dalam satu panggilan. Dipakai tombol "Kirim ke portal" di Portal
// Settings supaya user tidak nunggu tick otomatis. Return ringkasan utk UI.
export async function sendReadyJobsToPortal(): Promise<{
  queued: number;
  sent: number;
  failed: number;
  held: number;
  errors: string[];
}> {
  const settings = await getSettings();
  const maxAttempts = Math.max(1, parseInt(settings.get(SETTING_KEYS.maxAttempts) ?? "3", 10) || 3);
  const now = new Date();

  // 1. Antrekan job READY tanpa delivery aktif yang lolos pre-flight
  //    (query sama persis dgn deliverReadyJobs supaya perilaku konsisten).
  const readyJobs = await db.job.findMany({
    where: {
      status: "READY",
      contact: { isNot: null },
      company: { isNot: null },
      jobLinks: { some: {} },
      pulledAt: null,
      OR: [{ pullLeaseUntil: null }, { pullLeaseUntil: { lt: now } }],
      deliveries: { none: { status: { in: ["PENDING", "SENDING"] } } },
    },
    include: {
      company: true,
      jobLinks: { include: { source: true } },
      contact: true,
      deliveries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  let queued = 0;
  let held = 0;
  const errors: string[] = [];
  for (const job of readyJobs) {
    const last = job.deliveries[0];
    if (last && last.status === "FAILED" && last.attempt >= maxAttempts) {
      held += 1; // butuh manual retry dari tabel delivery
      continue;
    }
    const pre = preflightCanonical(job);
    if (!pre.ok) {
      await db.job.update({ where: { id: job.id }, data: { statusReason: pre.reason } });
      held += 1;
      errors.push(`${job.title}: ${pre.reason}`);
      continue;
    }
    await db.apiDelivery.create({
      data: {
        jobId: job.id,
        endpoint: DELIVERY_ENDPOINT,
        requestId: generateRequestId(),
        attempt: 1,
        maxAttempts,
        status: "PENDING",
      },
    });
    queued += 1;
  }

  // 2. Flush: proses delivery in-flight (termasuk yang baru diantrekan di atas)
  //    memakai jalur yang sama persis dgn tick otomatis.
  const before = {
    success: await db.apiDelivery.count({ where: { status: "SUCCESS" } }),
    failed: await db.apiDelivery.count({ where: { status: "FAILED" } }),
  };
  await deliverReadyJobs(settings);
  const after = {
    success: await db.apiDelivery.count({ where: { status: "SUCCESS" } }),
    failed: await db.apiDelivery.count({ where: { status: "FAILED" } }),
  };

  const sent = after.success - before.success;
  const failed = after.failed - before.failed;

  await log(
    "deliver",
    sent + failed > 0 ? "info" : "warning",
    `Manual send to portal: ${queued} antrean baru, ${sent} SUCCESS, ${failed} FAILED, ${held} ditahan pre-flight/FAILED-final`,
    { source: "manual-send-now", jobId: null }
  );

  // Errors dibatasi biar response nggak bengkak.
  return { queued, sent, failed, held, errors: errors.slice(0, 10) };
}

export async function retryDelivery(deliveryId: string): Promise<void> {
  await db.apiDelivery.update({
    where: { id: deliveryId },
    data: { status: "PENDING", attempt: 1, nextRetryAt: null, responseCode: null, responseBody: null },
  });
  await log("deliver", "info", `Manual retry queued for delivery ${deliveryId}`);
}

export async function resolveError(errorId: string): Promise<void> {
  await db.scrapeError.update({ where: { id: errorId }, data: { status: "RESOLVED" } });
  await log("error", "success", `Error ${errorId} marked as resolved`);
}
