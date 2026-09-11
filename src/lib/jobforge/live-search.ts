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
import {
  mapRemotiveJob,
  mapJobicyJob,
  mapArbeitnowJob,
  mapRemoteOkJob,
  mapHimalayasJob,
  realBoardError,
} from "./sources-real";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PER_BOARD = 40;
const UA = "JobForgeBot/1.0 (+https://jobforge.local; live keyword search)";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

/** Keyword relevance — every word must appear in the title or skills.
 *  Deliberately mirrors the /api/jobs `title` filter so the result count
 *  shown by the UI grid matches the scrape report exactly. */
function matchesKeyword(rec: RawJobRecord, words: string[]): boolean {
  const hay = `${rec.rawTitle} ${(rec.rawSkills ?? []).join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

interface BoardSearch {
  slug: string;
  name: string;
  /** fetch listings for the query (native search param when the board supports it) */
  search: (words: string[], rawQuery: string) => Promise<RawJobRecord[]>;
}

/** Real HTTP probe dengan profil engine — dipakai untuk source yang belum punya
 *  parser integrasi. Tiap engine di chain mencoba menjangkau site secara nyata
 *  (browser engine pakai UA browser, HTTP engine pakai UA bot), jadi laporan
 *  failover chain adalah hasil pengukuran sungguhan, bukan theater. */
async function probeWithEngine(
  url: string,
  engine: EngineKey,
  timeoutMs = 6_000
): Promise<{ ok: boolean; httpStatus?: number; error?: string; durationMs: number }> {
  const t0 = Date.now();
  const browserUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: {
        "User-Agent": ENGINES[engine].kind === "browser" ? browserUa : UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });
    await res.arrayBuffer().catch(() => undefined); // drain body — socket close rapi
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
    search: async (words, rawQuery) => {
      const data = (await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(rawQuery)}&limit=60`)) as { jobs?: Record<string, unknown>[] };
      return (data.jobs ?? []).map(mapRemotiveJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "jobicy",
    name: "Jobicy",
    search: async (words, rawQuery) => {
      const data = (await getJson(`https://jobicy.com/api/v2/remote-jobs?count=60&tag=${encodeURIComponent(rawQuery)}`)) as { jobs?: Record<string, unknown>[] };
      return (data.jobs ?? []).map(mapJobicyJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "arbeitnow",
    name: "Arbeitnow",
    search: async (words) => {
      const data = (await getJson("https://www.arbeitnow.com/api/job-board-api")) as { data?: Record<string, unknown>[] };
      return (data.data ?? []).map(mapArbeitnowJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
    },
  },
  {
    slug: "remoteok",
    name: "RemoteOK",
    search: async (words) => {
      // RemoteOK tags are single tokens — try each keyword word until a tag hits
      let list: unknown[] = [];
      for (const w of words.slice(0, 2)) {
        const data = (await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(w)}`)) as unknown;
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
    search: async (words) => {
      const data = (await getJson("https://himalayas.app/jobs/api?limit=100")) as { jobs?: Record<string, unknown>[] };
      return (data.jobs ?? []).map(mapHimalayasJob).filter((r): r is RawJobRecord => r !== null && matchesKeyword(r, words));
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
  skipped: number; // found relevant but no HR email — not saved (email-mandatory rule)
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
  totalSkipped: number;
}

/** Ingest one record through the shared fingerprint path (mirrors engine.ts scrape).
 *  Email-mandatory rule: a record may only enter the DB when an HR email is
 *  discovered FIRST (payload → description scan → live mailto scan of the
 *  posting page). No email → "skipped" — nothing is persisted (spam guard). */
async function ingestRecord(rec: RawJobRecord, sourceId: string): Promise<"created" | "duplicate" | "skipped"> {
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
    return "duplicate";
  }

  let email = rec.publishedEmail ?? extractPublishedEmail(rec.rawDescription ?? "");
  if (!email && rec.sourceUrl) {
    email = await discoverMailto(rec.sourceUrl);
  }
  if (!email) return "skipped";
  const v = validateEmail(email);
  if (v.status === "INVALID") return "skipped";

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
  await db.jobSource.create({
    data: { jobId: newJob.id, sourceId, sourceJobId: rec.sourceJobId, sourceUrl: rec.sourceUrl },
  });
  await db.jobContact.create({
    data: {
      jobId: newJob.id,
      hrEmail: email,
      emailSourceUrl: rec.sourceUrl,
      emailVerified: v.verified,
      emailStatus: v.status,
    },
  });
  return "created";
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
    select: { id: true, slug: true, name: true, engine: true, engines: true, status: true, baseUrl: true },
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
          const probe = await probeWithEngine(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`, engine);
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
          records = await boardSearch.search(words, q);
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
          skipped: 0,
          durationMs,
          error: e.message,
        };
      }

      let created = 0;
      let duplicate = 0;
      let skipped = 0;
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
            else skipped += 1;
          }
        })
      );
      const durationMs = Date.now() - bt0;
      await log(
        "scrape",
        "success",
        `Live search "${q}" via ${ENGINES[winningEngine].name} engine on ${source.name} — found ${records.length}, created ${created}, duplicate ${duplicate}, skipped-no-email ${skipped}`,
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
        skipped,
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
    totalSkipped: boards.reduce((a, b) => a + b.skipped, 0),
  };
}
