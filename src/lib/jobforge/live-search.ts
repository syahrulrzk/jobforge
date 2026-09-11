// ─────────────────────────────────────────────────────────────
// JOBFORCE — Live keyword scrape (on-demand search mode)
//
// Search mode "engine": user types a position ("business analyst")
// and picks WHICH boards to scrape — the list comes from the Data
// Sources the user added in the Sources view (DB), not a hardcoded
// board list. The engine chain per board follows that source's own
// setting (§9.3 multi-engine, urutan = prioritas failover).
// Results flow through the same fingerprint / dedup path as
// scheduled scrapes, so:
//
//   - new postings are persisted (status SCRAPED → pipeline) and
//     immediately visible in the search results grid
//   - known postings are only linked to the board again (dedup §15.1)
//
// Sources without a real integration (JobStreet dkk. — anti-bot)
// are reported honestly as failed — never mocked (anti-spam §9.3).
// Every run is logged to the Activity Console with the engine that
// executed it.
// ─────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import type { RawJobRecord } from "./adapters";
import { jobFingerprint, normalizeTitle, validateEmail } from "./pipeline";
import { ENGINES, parseEngineList, parseEnginePool, type EngineKey } from "./engines";
import { discoverMailto, extractPublishedEmail, log } from "./engine";
import { SETTING_KEYS } from "./types";
import { BROWSER_UA, sourceFetchText, type SourceNetConfig } from "./net";
import {
  mapRemotiveJob,
  mapJobicyJob,
  mapArbeitnowJob,
  mapRemoteOkJob,
  mapHimalayasJob,
  mapJobStreetJob,
  jobStreetSearchUrl,
  extractJobPostingsFromHtml,
  realBoardError,
} from "./sources-real";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PER_BOARD = 40;
const UA = "JobForgeBot/1.0 (+https://jobforge.local; live keyword search)";

async function getJson(url: string, cfg?: SourceNetConfig): Promise<unknown> {
  const res = await sourceFetchText(url, cfg ?? {}, { accept: "application/json", timeoutMs: FETCH_TIMEOUT_MS });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  try {
    return JSON.parse(res.text) as unknown;
  } catch {
    throw new Error(`${url} returned non-JSON body`);
  }
}

/** Keyword relevance — every word must appear in the title or skills.
 *  Deliberately mirrors the /api/jobs `title` filter so the result count
 *  shown by the UI grid matches the scrape report exactly. */
function matchesKeyword(rec: RawJobRecord, words: string[]): boolean {
  const hay = `${rec.rawTitle} ${(rec.rawSkills ?? []).join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Per-attempt fetch context: which engine is trying + the source's own
 *  network settings (residential proxy, custom clearance headers). */
interface LiveBoardCtx extends SourceNetConfig {
  engine: EngineKey;
}

interface BoardSearch {
  slug: string;
  name: string;
  /** fetch listings for the query (native search param when the board supports it) */
  search: (words: string[], rawQuery: string, ctx: LiveBoardCtx) => Promise<RawJobRecord[]>;
}

// ── JobStreet browser path (engine: playwright) ─────────────────
// Real Chromium via Playwright — the only honest way through the
// Cloudflare Turnstile interstitial when the exit IP (direct or via
// the source's residential proxy) gets challenged. If the challenge
// does not settle headless, fail over honestly — no fake data.
async function searchJobStreetBrowser(url: string, ctx: LiveBoardCtx): Promise<RawJobRecord[]> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    throw new Error(`Playwright tidak bisa dimuat di host ini: ${err instanceof Error ? err.message.slice(0, 90) : "unknown"}`);
  }
  const proxy = (ctx.proxyUrl ?? "").trim();
  const browser = await chromium.launch({
    headless: true,
    ...(proxy ? { proxy: { server: proxy } } : {}),
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1366,850", "--lang=id-ID"],
  });
  try {
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      viewport: { width: 1366, height: 850 },
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      extraHTTPHeaders: { "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["id-ID", "id", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      (window as unknown as Record<string, unknown>).chrome = { runtime: {} };
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const CHAL = /just a moment|tunggu sebentar|attention required/i;
    for (let i = 0; i < 4; i++) {
      if (!CHAL.test(await page.title())) break;
      await page.waitForTimeout(3_000); // beri waktu challenge JS auto-solve di IP yang dipercaya
    }
    if (CHAL.test(await page.title())) {
      throw new Error("Cloudflare challenge tidak selesai di IP ini — set proxy residensial di setting source");
    }
    const html = await page.content();
    const postings = extractJobPostingsFromHtml(html);
    if (postings.length === 0) throw new Error("halaman terbuka via browser tapi tidak ada JSON-LD JobPosting");
    return postings.map(mapJobStreetJob).filter((r): r is RawJobRecord => r !== null);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Real HTTP probe dengan profil engine + network config source (proxy/headers) — dipakai untuk source yang belum punya
 *  parser integrasi. Tiap engine di chain mencoba menjangkau site secara nyata
 *  (browser engine pakai UA browser, HTTP engine pakai UA bot), jadi laporan
 *  failover chain adalah hasil pengukuran sungguhan, bukan theater. */
async function probeWithEngine(
  url: string,
  engine: EngineKey,
  cfg: SourceNetConfig = {},
  timeoutMs = 6_000
): Promise<{ ok: boolean; httpStatus?: number; error?: string; durationMs: number }> {
  const t0 = Date.now();
  try {
    const res = await sourceFetchText(url, cfg, {
      ua: ENGINES[engine].kind === "browser" ? "browser" : "bot",
      timeoutMs,
    });
    return {
      ok: res.ok,
      httpStatus: res.status,
      durationMs: Date.now() - t0,
      error: res.ok ? undefined : `HTTP ${res.status}${res.status === 403 ? " — diblokir anti-bot" : res.status === 429 ? " — rate limited" : ""}`,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    };
  }
}

// Real keyword-search integrations per board slug. A source found in
// this map can be scraped live; anything else (JobStreet, Glints…)
// has no real integration yet and is reported as such — no mock data.
// Boards with native keyword search use it (remotive `search`, jobicy
// `tag`, remoteok single-word `tag`); the rest pull a larger batch and
// filter locally.
const BOARD_SEARCHES: BoardSearch[] = [
  {
    slug: "remotive",
    name: "Remotive",
    search: async (words, rawQuery, ctx) => {
      const data = (await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(rawQuery)}&limit=60`, ctx)) as { jobs?: Record<string, unknown>[] };
      return (data.jobs ?? []).map(mapRemotiveJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "jobicy",
    name: "Jobicy",
    search: async (words, rawQuery, ctx) => {
      const data = (await getJson(`https://jobicy.com/api/v2/remote-jobs?count=60&tag=${encodeURIComponent(rawQuery)}`, ctx)) as { jobs?: Record<string, unknown>[] };
      return (data.jobs ?? []).map(mapJobicyJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "arbeitnow",
    name: "Arbeitnow",
    search: async (words, _rawQuery, ctx) => {
      const data = (await getJson("https://www.arbeitnow.com/api/job-board-api", ctx)) as { data?: Record<string, unknown>[] };
      return (data.data ?? []).map(mapArbeitnowJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "remoteok",
    name: "RemoteOK",
    search: async (words, _rawQuery, ctx) => {
      // RemoteOK tags are single tokens — try each keyword word until a tag hits
      let list: unknown[] = [];
      for (const w of words.slice(0, 2)) {
        const data = (await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(w)}`, ctx)) as unknown;
        list = Array.isArray(data) ? data : [];
        if (list.some((x) => x && typeof x === "object" && (x as Record<string, unknown>).position)) break;
      }
      return list
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !!(x as Record<string, unknown>).position)
        .map(mapRemoteOkJob)
        .filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "himalayas",
    name: "Himalayas",
    search: async (words, _rawQuery, ctx) => {
      const data = (await getJson("https://himalayas.app/jobs/api?limit=100", ctx)) as { jobs?: Record<string, unknown>[] };
      return (data.jobs ?? []).map(mapHimalayasJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "jobstreet",
    name: "JobStreet",
    // SEO listing page (id.jobstreet.com/id/{query}-jobs) with schema.org
    // JSON-LD JobPosting blocks. HTTP engines fetch it directly — works
    // when the source has a residential proxy; 403 → failover. The
    // Playwright attempt launches a REAL Chromium (proxy-aware) and can
    // complete the Cloudflare challenge on a trusted exit IP.
    search: async (words, rawQuery, ctx) => {
      const url = jobStreetSearchUrl(rawQuery);
      if (ctx.engine === "playwright") {
        return searchJobStreetBrowser(url, ctx);
      }
      if (ENGINES[ctx.engine].kind === "browser") {
        // puppeteer / selenium — no driver on this host; honest fast-fail, no theater
        throw new Error(`driver ${ENGINES[ctx.engine].name} tidak tersedia di host ini — pakai Playwright atau HTTP engine + proxy`);
      }
      const { ok, status, text } = await sourceFetchText(url, ctx, { ua: "browser", timeoutMs: 12_000 });
      if (!ok) {
        throw new Error(`HTTP ${status}${status === 403 ? " — Cloudflare challenge (set proxy residensial / pakai engine Playwright)" : ""}`);
      }
      const postings = extractJobPostingsFromHtml(text);
      if (postings.length === 0) throw new Error("halaman terbuka tapi tidak ada JSON-LD JobPosting (kemungkinan masih di challenge)");
      return postings.map(mapJobStreetJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
];

export interface LiveEngineAttempt {
  engine: EngineKey;
  status: "success" | "failed";
  httpStatus?: number;
  durationMs: number;
  note?: string;
}

export interface LiveSearchBoardResult {
  board: string;
  slug: string;
  /** engine yang menang (sukses) / terakhir dicoba (gagal total) */
  engine: EngineKey;
  /** chain penuh yang dijalankan untuk source ini (setting source, §9.3) */
  engines: EngineKey[];
  /** riwayat attempt per engine — failover terlihat di UI */
  attempts: LiveEngineAttempt[];
  status: "success" | "failed";
  found: number;
  created: number;
  duplicate: number;
  /** job baru/lama yang masuk DB tapi belum lengkap (no/invalid HR email) */
  needsEnrichment: number;
  /** job NEEDS_ENRICHMENT lama yang berhasil dikasih email dari payload baru */
  enriched: number;
  skipped: number; // record benar-benar dibuang (sekarang: 0 — semua masuk DB)
  durationMs: number;
  error?: string;
}

export interface LiveSearchResult {
  q: string;
  durationMs: number;
  boards: LiveSearchBoardResult[];
  totalFound: number;
  totalCreated: number;
  totalDuplicate: number;
  totalNeedsEnrichment: number;
  totalEnriched: number;
  totalSkipped: number;
}

/** Ingest one record through the shared fingerprint path (mirrors engine.ts scrape).
 *  Enrichment rule (direktif user): a record ALWAYS enters the DB. When an HR
 *  email is discovered (payload → description scan → live mailto scan of the
 *  posting page) the job enters the normal pipeline (SCRAPED) with a contact;
 *  when it is not, the job is saved flagged NEEDS_ENRICHMENT — never dropped.
 *  Known jobs stuck in NEEDS_ENRICHMENT get a second chance: if this payload
 *  carries an email the old record lacked, the contact is created and the job
 *  re-enters validation (recovery §36, no purge). */
async function ingestRecord(
  rec: RawJobRecord,
  sourceId: string
): Promise<"created" | "duplicate" | "needs_enrichment" | "enriched"> {
  const fp = jobFingerprint(rec.rawCompanyName ?? "", rec.rawTitle, rec.rawLocation);
  const existing = await db.job.findUnique({ where: { fingerprint: fp } });

  if (existing) {
    // §15.1 — duplicate: attach board provenance if missing
    const link = await db.jobSource.findFirst({ where: { jobId: existing.id, sourceId } });
    if (!link) {
      await db.jobSource.create({
        data: { jobId: existing.id, sourceId, sourceJobId: rec.sourceJobId, sourceUrl: rec.sourceUrl },
      });
    }
    // Recovery — job lama NEEDS_ENRICHMENT tanpa contact: kalau payload baru
    // bawa email yang dulu nggak ketemu, simpan contact + balikin ke VALIDATING.
    if (existing.status === "NEEDS_ENRICHMENT") {
      const hasContact = await db.jobContact.findUnique({ where: { jobId: existing.id } });
      if (!hasContact) {
        const email = rec.publishedEmail ?? extractPublishedEmail(rec.rawDescription ?? "");
        if (email) {
          const v = validateEmail(email);
          if (v.status !== "INVALID") {
            await db.jobContact.create({
              data: { jobId: existing.id, hrEmail: email, emailSourceUrl: rec.sourceUrl, emailVerified: v.verified, emailStatus: v.status },
            });
            await db.job.update({ where: { id: existing.id }, data: { status: "VALIDATING", statusReason: null } });
            return "enriched";
          }
        }
      }
    }
    return "duplicate";
  }

  let email = rec.publishedEmail ?? extractPublishedEmail(rec.rawDescription ?? "");
  if (!email && rec.sourceUrl) {
    email = await discoverMailto(rec.sourceUrl);
  }
  const v = email ? validateEmail(email) : null;
  const emailOk = !!v && v.status !== "INVALID";

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
      // Email ada → jalur normal SCRAPED; nggak ada / invalid → NEEDS_ENRICHMENT
      // (tetap masuk DB — enrichment worker yang lanjut cari emailnya)
      status: emailOk ? "SCRAPED" : "NEEDS_ENRICHMENT",
      statusReason: emailOk
        ? null
        : v
          ? "NEEDS_ENRICHMENT: HR Email (invalid) — alamat email di posting tidak valid"
          : "NEEDS_ENRICHMENT: HR Email not available yet — email HR belum ditemukan di payload/description/posting page",
      scrapedAt: new Date(rec.scrapedAt),
      companyId: null,
    },
  });
  await db.jobSource.create({
    data: { jobId: newJob.id, sourceId, sourceJobId: rec.sourceJobId, sourceUrl: rec.sourceUrl },
  });
  if (emailOk && v) {
    await db.jobContact.create({
      data: {
        jobId: newJob.id,
        hrEmail: email!,
        emailSourceUrl: rec.sourceUrl,
        emailVerified: v.verified,
        emailStatus: v.status,
      },
    });
  }
  return emailOk ? "created" : "needs_enrichment";
}

export async function liveKeywordScrape(rawQuery: string, selectedSlugs?: string[]): Promise<LiveSearchResult> {
  const q = rawQuery.trim().slice(0, 120);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const t0 = Date.now();

  // Board list dari Data Sources (DB) — bukan hardcode:
  //   - user memilih board tertentu (slug list) → scrape source itu apa pun
  //     statusnya (override manual, dipakai juga buat tes source ERROR/INACTIVE)
  //   - tanpa pilihan → semua source ACTIVE ikut scrape
  const slugs = (selectedSlugs ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sources = await db.source.findMany({
    where: slugs.length > 0 ? { slug: { in: slugs } } : { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, engine: true, engines: true, status: true, baseUrl: true, proxyUrl: true, headersJson: true },
  });

  // Global Engine Pool (§9.2) — dipakai buat interseksi prioritas §9.3
  const poolRow = await db.setting.findUnique({ where: { key: SETTING_KEYS.enginePool } });
  const pool = parseEnginePool(poolRow?.value);

  const boards = await Promise.all(
    sources.map(async (source): Promise<LiveSearchBoardResult> => {
      const bt0 = Date.now();
      // §9.3 engine chain — urutan prioritas dari setting source sendiri
      // (user klik engine di Add/Edit Source = urutan failover). Live search
      // user-initiated: setting source selalu menang atas pool global.
      const pinned = parseEngineList(source.engines, source.engine);
      const candidates = pinned.filter((e) => pool.includes(e));
      const chain: EngineKey[] = candidates.length > 0 ? candidates : pinned;

      const boardSearch = BOARD_SEARCHES.find((b) => b.slug === source.slug);
      if (!boardSearch) {
        // ── Source tanpa parser integrasi (JobStreet dkk.) — chain tetap
        // dijalankan PENUH: tiap engine di setting source mencoba menjangkau
        // site secara nyata (HTTP probe per engine). Hasilnya jujur:
        // berapa engine dicoba, mana yang kena blok anti-bot, status HTTP-nya.
        // TIDAK ada data palsu — probe hanya cek aksesibilitas, tidak parse.
        const attempts: LiveEngineAttempt[] = [];
        const baseUrl = source.baseUrl?.trim() || "";
        for (let i = 0; i < chain.length; i++) {
          const engine = chain[i];
          if (!baseUrl) {
            attempts.push({ engine, status: "failed", durationMs: 0, note: "baseUrl source belum diisi" });
            continue;
          }
          const probe = await probeWithEngine(
            /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`,
            engine,
            { proxyUrl: source.proxyUrl, headersJson: source.headersJson }
          );
          attempts.push({
            engine,
            status: probe.ok ? "success" : "failed",
            httpStatus: probe.httpStatus,
            durationMs: probe.durationMs,
            note: probe.error ?? `site reachable (HTTP ${probe.httpStatus})`,
          });
          if (probe.ok) break; // engine pertama yang bisa menjangkau menang
          const next = chain[i + 1] ? ENGINES[chain[i + 1]].name : null;
          if (next) {
            await log("scrape", "warning", `${ENGINES[engine].name} gagal jangkau ${source.name} (${probe.error ?? "gagal"}) — failover ke ${next}`, { source: source.slug });
          }
        }
        const reached = attempts.find((a) => a.status === "success");
        const msg = !baseUrl
          ? "baseUrl source belum diisi — chain engine tidak ada yang bisa dicoba"
          : reached
            ? `Site reachable via ${ENGINES[reached.engine].name} (HTTP ${reached.httpStatus}) tapi belum ada parser integrasi — tidak ada data di-parse asal-asalan`
            : `${attempts.length} engine dicoba (${attempts.map((a) => ENGINES[a.engine].name).join(" → ")}) — semua diblokir/di-gagalankan situs (anti-bot)`;
        const durationMs = Date.now() - bt0;
        await log("scrape", "failed", `Live search "${q}" on ${source.name} — ${msg}`, { source: source.slug, durationMs });
        return {
          board: source.name,
          slug: source.slug,
          engine: attempts[attempts.length - 1]?.engine ?? chain[0],
          engines: chain,
          attempts,
          status: "failed",
          found: 0,
          created: 0,
          duplicate: 0,
          needsEnrichment: 0,
          enriched: 0,
          skipped: 0,
          durationMs,
          error: msg,
        };
      }

      // ── Source dengan integrasi nyata — failover chain §9.3: engine
      // pertama yang sukses dipakai; fetch gagal → engine prioritas berikutnya.
      let records: RawJobRecord[] | null = null;
      let winningEngine: EngineKey = chain[0];
      let lastError: Error | null = null;
      const attempts: LiveEngineAttempt[] = [];
      for (let i = 0; i < chain.length; i++) {
        const engine = chain[i];
        const at0 = Date.now();
        try {
          records = await boardSearch.search(words, q, { engine, proxyUrl: source.proxyUrl, headersJson: source.headersJson });
          winningEngine = engine;
          lastError = null;
          attempts.push({ engine, status: "success", durationMs: Date.now() - at0, note: `found ${records.length}` });
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          attempts.push({ engine, status: "failed", durationMs: Date.now() - at0, note: lastError.message.slice(0, 160) });
          const next = chain[i + 1] ? ENGINES[chain[i + 1]].name : null;
          if (next) {
            await log("scrape", "warning", `${ENGINES[engine].name} gagal fetch ${source.name} (live search) — failover ke ${next}`, { source: source.slug });
          }
        }
      }

      if (records === null) {
        const e = realBoardError(source.name, lastError ?? new Error("semua engine chain gagal"));
        const durationMs = Date.now() - bt0;
        await log(
          "scrape",
          "failed",
          `Live search "${q}" gagal total di ${source.name} — ${chain.length} engine dicoba (${chain.map((en) => ENGINES[en].name).join(" → ")})`,
          { source: source.slug, durationMs }
        );
        return {
          board: source.name,
          slug: source.slug,
          engine: chain[chain.length - 1],
          engines: chain,
          attempts,
          status: "failed",
          found: 0,
          created: 0,
          duplicate: 0,
          needsEnrichment: 0,
          enriched: 0,
          skipped: 0,
          durationMs,
          error: e.message,
        };
      }

      let created = 0;
      let duplicate = 0;
      let needsEnrichment = 0;
      let enriched = 0;
      // small worker pool — ingest (incl. the posting-page mailto scan for new
      // records) runs concurrently so a fresh keyword cannot exceed the 60s budget
      const list = records.slice(0, MAX_PER_BOARD);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(6, Math.max(1, list.length)) }, async () => {
          while (cursor < list.length) {
            const rec = list[cursor++];
            const res = await ingestRecord(rec, source.id);
            if (res === "created") created += 1;
            else if (res === "duplicate") duplicate += 1;
            else if (res === "enriched") enriched += 1;
            else needsEnrichment += 1;
          }
        })
      );
      const durationMs = Date.now() - bt0;
      await log(
        "scrape",
        "success",
        `Live search "${q}" via ${ENGINES[winningEngine].name} engine on ${source.name} — found ${records.length}, created ${created}, duplicate ${duplicate}, needs-enrichment ${needsEnrichment}, enriched ${enriched}`,
        { source: source.slug, durationMs }
      );
      return {
        board: source.name,
        slug: source.slug,
        engine: winningEngine,
        engines: chain,
        attempts,
        status: "success",
        found: records.length,
        created,
        duplicate,
        needsEnrichment,
        enriched,
        skipped: 0,
        durationMs,
      };
    })
  );

  return {
    q,
    durationMs: Date.now() - t0,
    boards,
    totalFound: boards.reduce((a, b) => a + b.found, 0),
    totalCreated: boards.reduce((a, b) => a + b.created, 0),
    totalDuplicate: boards.reduce((a, b) => a + b.duplicate, 0),
    totalNeedsEnrichment: boards.reduce((a, b) => a + b.needsEnrichment, 0),
    totalEnriched: boards.reduce((a, b) => a + b.enriched, 0),
    totalSkipped: boards.reduce((a, b) => a + b.skipped, 0),
  };
}
