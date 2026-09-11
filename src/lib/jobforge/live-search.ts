// ─────────────────────────────────────────────────────────────
// JOBFORCE — Live keyword scrape (on-demand search mode)
//
// Search mode "engine": user types a position ("business analyst")
// and the engine pool runs an on-demand scrape against ALL real job
// boards in parallel. Results flow through the same fingerprint /
// dedup path as scheduled scrapes, so:
//
//   - new postings are persisted (status SCRAPED → pipeline) and
//     immediately visible in the search results grid
//   - known postings are only linked to the board again (dedup §15.1)
//
// Every board run rotates over the active ENGINE_POOL (§9.2) and is
// logged to the Activity Console with the engine that executed it.
// ─────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import type { RawJobRecord, ScrapeResult } from "./adapters";
import { jobFingerprint, normalizeTitle } from "./pipeline";
import { ENGINES, parseEnginePool, rotateEngine, type EngineKey } from "./engines";
import { log } from "./engine";
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

// Boards with native keyword search use it (remotive `search`, jobicy `tag`,
// remoteok single-word `tag`); the rest pull a larger batch and filter locally.
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

export interface LiveSearchBoardResult {
  board: string;
  slug: string;
  engine: EngineKey;
  status: "success" | "failed";
  found: number;
  created: number;
  duplicate: number;
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
}

/** Ingest one record through the shared fingerprint path (mirrors engine.ts scrape). */
async function ingestRecord(rec: RawJobRecord, sourceId: string): Promise<"created" | "duplicate"> {
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
  return "created";
}

export async function liveKeywordScrape(rawQuery: string): Promise<LiveSearchResult> {
  const q = rawQuery.trim().slice(0, 120);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const t0 = Date.now();

  // active engine pool (§9.2) — rotate one engine per board run
  const poolRow = await db.setting.findUnique({ where: { key: SETTING_KEYS.enginePool } });
  const pool = parseEnginePool(poolRow?.value);

  const sources = await db.source.findMany({
    where: { slug: { in: BOARD_SEARCHES.map((b) => b.slug) } },
    select: { id: true, slug: true },
  });
  const sourceBySlug = new Map(sources.map((s) => [s.slug, s.id]));

  const boards = await Promise.all(
    BOARD_SEARCHES.map(async (board, i): Promise<LiveSearchBoardResult> => {
      const { engine } = rotateEngine(pool, i);
      const bt0 = Date.now();
      try {
        const records = await board.search(words, q);
        let created = 0;
        let duplicate = 0;
        const sourceId = sourceBySlug.get(board.slug);
        for (const rec of records.slice(0, MAX_PER_BOARD)) {
          if (!sourceId) break;
          const res = await ingestRecord(rec, sourceId);
          if (res === "created") created += 1;
          else duplicate += 1;
        }
        const durationMs = Date.now() - bt0;
        await log(
          "scrape",
          "success",
          `Live search "${q}" via ${ENGINES[engine].name} engine on ${board.name} — found ${records.length}, created ${created}, duplicate ${duplicate}`,
          { source: board.slug, durationMs }
        );
        return { board: board.name, slug: board.slug, engine, status: "success", found: records.length, created, duplicate, durationMs };
      } catch (err) {
        const e = realBoardError(board.name, err);
        const durationMs = Date.now() - bt0;
        await log("scrape", "failed", `Live search "${q}" on ${board.name} failed — ${e.message}`, { source: board.slug, durationMs });
        return { board: board.name, slug: board.slug, engine, status: "failed", found: 0, created: 0, duplicate: 0, durationMs, error: e.message };
      }
    })
  );

  return {
    q,
    durationMs: Date.now() - t0,
    boards,
    totalFound: boards.reduce((a, b) => a + b.found, 0),
    totalCreated: boards.reduce((a, b) => a + b.created, 0),
    totalDuplicate: boards.reduce((a, b) => a + b.duplicate, 0),
  };
}
