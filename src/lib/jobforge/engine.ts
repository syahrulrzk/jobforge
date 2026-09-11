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
import { DELIVERY_ENDPOINT, SETTING_KEYS, type CanonicalJob } from "./types";
import { extractDomain, resolveLogoUrl } from "./logo";
import { ENGINES, engineJitter, parseEngineList, parseEnginePool, rotateEngine, type EngineKey } from "./engines";
import { REAL_BOARDS, realBoardError } from "./sources-real";

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
  tickCount: number;
  settings: Map<string, string>;
  settingsLoadedAt: number;
  sourceCursor: number;
  engineCursor: number;
  mailtoScanned: Set<string>; // jobIds already scanned for a real mailto contact
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
      tickCount: 0,
      settings: new Map(),
      settingsLoadedAt: 0,
      sourceCursor: 0,
      engineCursor: 0,
      mailtoScanned: new Set(),
    };
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
      logo_url: job.company.logoUrl,
      website: job.company.website ?? null,
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

async function runScrapeForSource(sourceId: string, forced = false): Promise<void> {
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

  for (const rec of result.records) {
    const fp = jobFingerprint(rec.rawCompanyName ?? "", rec.rawTitle, rec.rawLocation);
    const existing = await db.job.findUnique({ where: { fingerprint: fp } });

    if (existing) {
      // §15.1 — duplicate detected: attach source identity, maybe refresh
      const linkExists = await db.jobSource.findFirst({
        where: { jobId: existing.id, sourceId: source.id },
      });
      if (!linkExists) {
        await db.jobSource.create({
          data: {
            jobId: existing.id,
            sourceId: source.id,
            sourceJobId: rec.sourceJobId,
            sourceUrl: rec.sourceUrl,
          },
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
        fingerprint: fp,
        title: rec.rawTitle.replace(/\s*[-–]\s*PT\s+.*$/i, "").trim() || rec.rawTitle,
        normalizedTitle: normalizeTitle(rec.rawTitle),
        companyName: rec.rawCompanyName,
        companyLogoUrl: rec.rawCompanyLogoUrl,
        description: rec.rawDescription
          ? rec.rawSalaryText
            ? `${rec.rawDescription}\n\nSalary: ${rec.rawSalaryText}`
            : rec.rawDescription
          : "",
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
    // §15.2 — store source identity for provenance
    await db.jobSource.create({
      data: {
        jobId: newJob.id,
        sourceId: source.id,
        sourceJobId: rec.sourceJobId,
        sourceUrl: rec.sourceUrl,
      },
    });
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
    // §14 — normalize salary: structured USD/EUR text first, then legacy IDR pattern
    const usd = parseSalaryUsd(job.description);
    const salaryMatch = usd ? null : job.description.match(/IDR\s*([\d.,]+\s*(?:jt|juta)?)/i);
    let salaryMin: number | null = null;
    let salaryMax: number | null = null;
    let currency: string | null = null;
    if (usd) {
      salaryMin = usd.min;
      salaryMax = usd.max;
      currency = usd.currency;
    } else if (salaryMatch) {
      const n = parseFloat(salaryMatch[1].replace(/\./g, "").replace(/,/g, "."));
      const val = /jt|juta/i.test(salaryMatch[1]) ? Math.round(n * 1_000_000) : Math.round(n);
      if (val > 0) {
        salaryMin = val;
        salaryMax = Math.round(val * 1.35);
        currency = "IDR";
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
    // company upsert by normalized name (§15.3)
    let company = rec.companyName
      ? await db.company.findUnique({ where: { normalizedName: companyFingerprint(rec.companyName) } })
      : null;
    if (!company && rec.companyName) {
      // §11 enrichment — logo: provider-resolved PNG link first, raw source logo as backup
      const resolvedLogo = resolveLogoUrl(rec.companyWebsite) ?? rec.companyLogoUrl ?? "";
      company = await db.company.create({
        data: {
          name: rec.companyName,
          normalizedName: companyFingerprint(rec.companyName),
          logoUrl: resolvedLogo,
          website: rec.companyWebsite,
          profile: rec.companyProfile ?? "Profil perusahaan belum tersedia.",
          industry: null,
        },
      });
      await log("enrich", "info", `New company registered: ${company.name}${resolvedLogo ? " — logo resolved" : ""}`);
    }
    // §11 enrichment — attempt logo/profile recovery from company website
    if (company) {
      const resolvedLogo = resolveLogoUrl(company.website ?? rec.companyWebsite);
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
  let purgedNoEmail = 0;
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
    // Email-mandatory rule (§12/§17 spam guard) — a real job whose only blocker
    // is the HR email must not sit in the DB forever. If the single mailto
    // discovery attempt already ran (or is impossible), purge the row entirely.
    const emailMissing = res.missing.some((m) => m.startsWith("HR Email"));
    const pageUrl = job.jobLinks[0]?.sourceUrl ?? null;
    if (
      res.outcome === "NEEDS_ENRICHMENT" &&
      emailMissing &&
      job.companyName && // real-source jobs only — legacy mock jobs keep their retry loop
      (!pageUrl || st.mailtoScanned.has(job.id))
    ) {
      const srcId = job.jobLinks[0]?.sourceId ?? "";
      const lastRun = srcId
        ? await db.scrapeRun.findFirst({
            where: { sourceId: srcId, status: { in: ["SUCCESS", "FAILED"] } },
            orderBy: { startedAt: "desc" },
          })
        : null;
      if (lastRun) {
        await db.scrapeRun.update({ where: { id: lastRun.id }, data: { jobsRejected: { increment: 1 } } });
      }
      await db.job.deleteMany({ where: { id: job.id } }); // deleteMany: no throw bila job sudah terhapus (race antar batch)
      st.mailtoScanned.delete(job.id);
      purgedNoEmail += 1;
      continue;
    }
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
  if (purgedNoEmail > 0) {
    await log("validate", "info", `Email mandatory: ${purgedNoEmail} job tanpa email HR dihapus dari DB (spam guard)`);
  }

  // NEEDS_ENRICHMENT recovery loop — enrichment worker retry (§36)
  // Real-source jobs get priority (they have genuine enrichment to attempt:
  // a live mailto scan of the posting page); mock jobs follow the simulated path.
  const needyReal = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT", companyName: { not: null }, contact: null },
    take: 24,
    orderBy: { scrapedAt: "asc" },
    include: { company: true, jobLinks: true },
  });
  let purged = 0;
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
      // for logo-less boards fall back to the job's own payload logo
      const recovered = resolveLogoUrl(job.company.website) ?? job.companyLogoUrl ?? null;
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
      const email = await discoverMailto(pageUrl);
      if (email) {
        const v = validateEmail(email);
        if (v.status !== "INVALID") {
          await db.jobContact.create({
            data: { jobId: job.id, hrEmail: email, emailSourceUrl: pageUrl, emailVerified: v.verified, emailStatus: v.status },
          });
          await log("enrich", "success", `HR email discovered on posting page: ${email}`, { jobId: job.id });
          await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING" } });
          return;
        }
      }
    }
    // Email-mandatory rule — the discovery attempt failed (or was impossible):
    // a job without an HR email may not stay in the DB (spam guard). Purge it.
    await db.job.deleteMany({ where: { id: job.id } }); // deleteMany: no throw bila job sudah terhapus (race antar batch)
    st.mailtoScanned.delete(job.id);
    purged += 1;
  };
  // worker pool 6 concurrent — scan paralel supaya backlog spam-guard cepat terdrain
  for (let i = 0; i < needyReal.length; i += 6) {
    await Promise.all(needyReal.slice(i, i + 6).map(processNeedyRealJob));
  }
  if (purged > 0) {
    await log("validate", "info", `Email mandatory: ${purged} job tanpa email HR dihapus dari DB (spam guard §12)`);
  }
  for (const job of needyMock) {
    const missingLogo = job.company && !job.company.logoUrl;
    const missingEmail = !job.contact;
    if (missingLogo && chance(0.4) && job.company) {
      // logo recovery via provider chain (Google → DuckDuckGo) dari domain website
      const recovered = resolveLogoUrl(job.company.website);
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
        publishedEmail: null,
        careerPageUrl: sourceUrl || null,
      };
    }
    return {
      companyName: job.companyName,
      companyLogoUrl: job.companyLogoUrl ?? `${tpl.website}/assets/logo.png`,
      companyWebsite: tpl.website,
      companyProfile: tpl.profile,
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
    // simulate transient API failure (§21 retry strategy)
    const shouldFail = chance(0.07) && d.attempt < maxAttempts;
    if (!canonical || shouldFail) {
      const failedFinal = d.attempt >= maxAttempts;
      const backoffMs = [5_000, 15_000, 45_000][Math.min(d.attempt - 1, 2)];
      await db.apiDelivery.update({
        where: { id: d.id },
        data: {
          status: failedFinal ? "FAILED" : "PENDING",
          attempt: failedFinal ? d.attempt : d.attempt + 1,
          responseCode: shouldFail ? 500 : null,
          responseBody: shouldFail ? JSON.stringify({ success: false, message: "Internal Server Error" }) : null,
          nextRetryAt: failedFinal ? null : new Date(Date.now() + backoffMs),
        },
      });
      if (failedFinal) {
        await recordError("API_ERROR", `Portal import failed after ${maxAttempts} attempts`, { jobId: d.jobId });
        await log("deliver", "failed", `Delivery ${d.requestId} failed permanently after ${maxAttempts} attempts`, { jobId: d.jobId });
      } else {
        await log("deliver", "warning", `Delivery ${d.requestId} attempt ${d.attempt} failed (500) — retry in ${backoffMs / 1000}s`, { jobId: d.jobId });
      }
      continue;
    }

    const payload = { source: canonical.source.platform, scraped_at: canonical.metadata.scraped_at, jobs: [canonical] };
    const result = await processBulkImport(payload);
    await db.apiDelivery.update({
      where: { id: d.id },
      data: {
        status: result.success ? "SUCCESS" : "FAILED",
        responseCode: result.success ? 200 : 422,
        responseBody: JSON.stringify(result),
        deliveredAt: result.success ? new Date() : null,
        nextRetryAt: null,
      },
    });
    if (result.success) {
      await db.job.update({ where: { id: d.jobId }, data: { status: "SENT", statusReason: null } });
      await log("deliver", "success", `Import accepted — ${result.data.created} created, ${result.data.updated} updated`, { jobId: d.jobId });
    }
  }

  // 2. create new deliveries for READY jobs without one
  // Email-mandatory rule: the portal only ever receives jobs that carry an HR email
  const readyJobs = await db.job.findMany({
    where: {
      status: "READY",
      contact: { isNot: null },
      deliveries: { none: { status: { in: ["PENDING", "SENDING"] } } },
    },
    take: batchSize,
    orderBy: { scrapedAt: "asc" },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  for (const job of readyJobs) {
    const last = job.deliveries[0];
    if (last && last.status === "FAILED" && last.attempt >= maxAttempts) continue; // needs manual retry
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

async function tick(): Promise<void> {
  const s = state();
  if (s.ticking) return;
  s.ticking = true;
  try {
    const settings = await getSettings();
    s.tickCount += 1;

    // scrape phase
    const autoScrape = settings.get(SETTING_KEYS.autoScrape) !== "false";
    if (autoScrape && s.tickCount % 2 === 1) {
      const cap = parseInt(settings.get(SETTING_KEYS.demoJobCap) ?? "800", 10) || 800;
      const total = await db.job.count();
      if (total < cap) {
        const sources = await db.source.findMany({ where: { status: "ACTIVE" }, orderBy: { id: "asc" } });
        if (sources.length > 0) {
          s.sourceCursor = (s.sourceCursor + 1) % sources.length;
          await runScrapeForSource(sources[s.sourceCursor].id);
        }
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
