// ─────────────────────────────────────────────────────────────
// JOBFORCE — Real source fetchers (PRD §9 adapter architecture)
//
// REAL DATA MODE: pulls live job listings from free public job-board
// APIs (no API key required) and maps them into RawJobRecord so the
// downstream pipeline (normalize → enrich → validate → dedup →
// deliver) processes genuine postings from genuine companies:
//
//   remotive    https://remotive.com/api/remote-jobs        logo ✓ salary text
//   jobicy      https://jobicy.com/api/v2/remote-jobs       logo ✓ structured salary
//   arbeitnow   https://www.arbeitnow.com/api/job-board-api logo ✗ (enrichment fills it)
//   remoteok    https://remoteok.com/api                    logo ~ partial
//   himalayas   https://himalayas.app/jobs/api              logo ✓ salary structured
//
// Each board also exports a mapper (mapRemotiveJob, mapJobicyJob, …)
// reused by the live keyword search (live-search.ts).
//
// HR emails are NOT exposed by these boards — per §12.4 the pipeline
// never guesses: such jobs land in NEEDS_ENRICHMENT and the recovery
// worker scans the posting page for a real mailto: contact.
// ─────────────────────────────────────────────────────────────

import type { RawJobRecord, ScrapeResult } from "./adapters";
import type { ErrorType } from "./types";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_DESCRIPTION = 4_000;
const UA = "JobForgeBot/1.0 (+https://jobforge.local; job aggregation demo)";

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

function mapEmployment(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("full")) return "FULL_TIME";
  if (v.includes("part")) return "PART_TIME";
  if (v.includes("contract")) return "CONTRACT";
  if (v.includes("intern")) return "INTERNSHIP";
  return null;
}

function isoDate(input: unknown): string {
  const t = typeof input === "number" ? input : Date.parse(String(input ?? ""));
  if (Number.isFinite(t) && t > 0) return new Date(t).toISOString();
  return new Date().toISOString();
}

function clean(text: unknown): string | null {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > 0 ? s.slice(0, 160) : null;
}

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

// ── Remotive ────────────────────────────────────────────────
export function mapRemotiveJob(j: Record<string, unknown>): RawJobRecord | null {
  const title = clean(j.title);
  const company = clean(j.company_name);
  const url = clean(j.url);
  if (!title || !company || !url) return null;
  return {
    sourcePlatform: "remotive",
    sourceJobId: `rem-${String(j.id ?? url)}`,
    sourceUrl: url,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: clean(j.company_logo) ?? null,
    rawCompanyWebsite: null,
    rawCompanyProfile: null,
    rawDescription: stripHtml(String(j.description ?? "")) || null,
    rawSalaryText: clean(j.salary),
    rawLocation: clean(j.candidate_required_location) ?? "Remote — Worldwide",
    rawEmploymentType: mapEmployment(String(j.job_type ?? "")),
    rawWorkplaceType: "REMOTE",
    rawRequirements: [],
    rawSkills: Array.isArray(j.tags) ? j.tags.map((t) => String(t)).slice(0, 6) : [],
    careerPageUrl: url,
    publishedEmail: null,
    scrapedAt: isoDate(j.publication_date),
  };
}

async function fetchRemotive(): Promise<ScrapeResult> {
  const data = (await getJson("https://remotive.com/api/remote-jobs?limit=30")) as { jobs?: Record<string, unknown>[] };
  const records = (data.jobs ?? []).map(mapRemotiveJob).filter((r): r is RawJobRecord => r !== null);
  return { records, pagesScraped: 1, errors: [] };
}

// ── Jobicy ──────────────────────────────────────────────────
export function mapJobicyJob(j: Record<string, unknown>): RawJobRecord | null {
  const title = clean(j.jobTitle);
  const company = clean(j.companyName);
  const url = clean(j.url);
  if (!title || !company || !url) return null;
  const salaryText =
    j.salaryMin && j.salaryMax
      ? `${String(j.salaryCurrency ?? "USD")} ${Number(j.salaryMin).toLocaleString("en-US")} - ${Number(j.salaryMax).toLocaleString("en-US")} per year`
      : null;
  const types = Array.isArray(j.jobType) ? j.jobType.map(String) : [];
  return {
    sourcePlatform: "jobicy",
    sourceJobId: `jobicy-${String(j.id ?? j.jobSlug ?? url)}`,
    sourceUrl: url,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: clean(j.companyLogo) ?? null,
    rawCompanyWebsite: null,
    rawCompanyProfile: null,
    rawDescription: stripHtml(String(j.jobDescription ?? j.jobExcerpt ?? "")) || null,
    rawSalaryText: salaryText,
    rawLocation: clean(j.jobGeo) ?? "Remote — Worldwide",
    rawEmploymentType: mapEmployment(types[0] ?? null),
    rawWorkplaceType: "REMOTE",
    rawRequirements: [],
    rawSkills: Array.isArray(j.jobIndustry) ? j.jobIndustry.map((t) => String(t)).slice(0, 6) : [],
    careerPageUrl: url,
    publishedEmail: null,
    scrapedAt: isoDate(j.pubDate),
  };
}

async function fetchJobicy(): Promise<ScrapeResult> {
  const data = (await getJson("https://jobicy.com/api/v2/remote-jobs?count=30")) as { jobs?: Record<string, unknown>[] };
  const records = (data.jobs ?? []).map(mapJobicyJob).filter((r): r is RawJobRecord => r !== null);
  return { records, pagesScraped: 1, errors: [] };
}

// ── Arbeitnow ───────────────────────────────────────────────
export function mapArbeitnowJob(j: Record<string, unknown>): RawJobRecord | null {
  const title = clean(j.title);
  const company = clean(j.company_name);
  const url = clean(j.url);
  if (!title || !company || !url) return null;
  const types = Array.isArray(j.job_types) ? j.job_types.map(String) : [];
  const tags = Array.isArray(j.tags) ? j.tags.map(String).slice(0, 6) : [];
  return {
    sourcePlatform: "arbeitnow",
    sourceJobId: `arb-${String(j.slug ?? url)}`.slice(0, 120),
    sourceUrl: url,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: null, // board does not publish logos — enrichment resolves later
    rawCompanyWebsite: null,
    rawCompanyProfile: null,
    rawDescription: stripHtml(String(j.description ?? "")) || null,
    rawSalaryText: null,
    rawLocation: clean(j.location) ?? (j.remote ? "Remote" : null),
    rawEmploymentType: mapEmployment(types[0] ?? null),
    rawWorkplaceType: j.remote ? "REMOTE" : null,
    rawRequirements: [],
    rawSkills: tags,
    careerPageUrl: url,
    publishedEmail: null,
    scrapedAt: isoDate(j.created_at),
  };
}

async function fetchArbeitnow(): Promise<ScrapeResult> {
  const data = (await getJson("https://www.arbeitnow.com/api/job-board-api")) as { data?: Record<string, unknown>[] };
  const records = (data.data ?? []).map(mapArbeitnowJob).filter((r): r is RawJobRecord => r !== null);
  return { records, pagesScraped: 1, errors: [] };
}

// ── RemoteOK ────────────────────────────────────────────────
export function mapRemoteOkJob(j: Record<string, unknown>): RawJobRecord | null {
  const title = clean(j.position);
  const company = clean(j.company);
  const url = clean(j.url);
  if (!title || !company || !url) return null;
  const salaryText =
    j.salary_min && j.salary_max && Number(j.salary_max) > 0
      ? `USD ${Number(j.salary_min).toLocaleString("en-US")} - ${Number(j.salary_max).toLocaleString("en-US")} per year`
      : null;
  return {
    sourcePlatform: "remoteok",
    sourceJobId: `rok-${String(j.id ?? j.slug ?? url)}`.slice(0, 120),
    sourceUrl: url,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: clean(j.company_logo) ?? null,
    rawCompanyWebsite: null,
    rawCompanyProfile: null,
    rawDescription: stripHtml(String(j.description ?? "")) || null,
    rawSalaryText: salaryText,
    rawLocation: clean(j.location) ?? "Remote — Worldwide",
    rawEmploymentType: mapEmployment(String(j.employment_type ?? "")),
    rawWorkplaceType: "REMOTE",
    rawRequirements: [],
    rawSkills: Array.isArray(j.tags) ? j.tags.map((t) => String(t)).slice(0, 6) : [],
    careerPageUrl: url,
    publishedEmail: null,
    scrapedAt: isoDate(j.date ?? j.epoch),
  };
}

async function fetchRemoteOk(): Promise<ScrapeResult> {
  const raw = (await getJson("https://remoteok.com/api")) as unknown;
  const list = Array.isArray(raw) ? raw : [];
  const records: RawJobRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue; // first element = legal notice
    const rec = mapRemoteOkJob(item as Record<string, unknown>);
    if (rec) records.push(rec);
  }
  return { records, pagesScraped: 1, errors: [] };
}

// ── Himalayas ───────────────────────────────────────────────
export function mapHimalayasJob(j: Record<string, unknown>): RawJobRecord | null {
  const title = clean(j.title);
  const company = clean(j.companyName);
  const url = clean(j.applicationLink) ?? clean(j.guid);
  if (!title || !company || !url) return null;
  const salaryText =
    j.minSalary && j.maxSalary
      ? `${String(j.currency ?? "USD")} ${Number(j.minSalary).toLocaleString("en-US")} - ${Number(j.maxSalary).toLocaleString("en-US")} per ${String(j.salaryPeriod ?? "year")}`
      : null;
  // pubDate is epoch SECONDS — isoDate expects ms
  const pubDate = typeof j.pubDate === "number" ? j.pubDate * 1000 : j.pubDate;
  const locs = Array.isArray(j.locationRestrictions) ? j.locationRestrictions.map(String) : [];
  const cats = Array.isArray(j.categories) ? j.categories.map(String).slice(0, 4) : [];
  return {
    sourcePlatform: "himalayas",
    sourceJobId: `him-${String(j.guid ?? url).split("/").filter(Boolean).pop() ?? url}`.slice(0, 120),
    sourceUrl: url,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: clean(j.companyLogo) ?? null,
    rawCompanyWebsite: null,
    rawCompanyProfile: null,
    rawDescription: stripHtml(String(j.description ?? j.excerpt ?? "")) || null,
    rawSalaryText: salaryText,
    rawLocation: locs.length > 0 ? clean(locs.slice(0, 3).join(", ")) ?? "Remote — Worldwide" : "Remote — Worldwide",
    rawEmploymentType: mapEmployment(String(j.employmentType ?? "")),
    rawWorkplaceType: "REMOTE",
    rawRequirements: Array.isArray(j.seniority) ? j.seniority.map((s) => String(s)).slice(0, 3) : [],
    rawSkills: cats.map((c) => c.replace(/-/g, " ")),
    careerPageUrl: url,
    publishedEmail: null,
    scrapedAt: isoDate(pubDate),
  };
}

async function fetchHimalayas(): Promise<ScrapeResult> {
  const data = (await getJson("https://himalayas.app/jobs/api?limit=30")) as { jobs?: Record<string, unknown>[] };
  const records = (data.jobs ?? []).map(mapHimalayasJob).filter((r): r is RawJobRecord => r !== null);
  return { records, pagesScraped: 1, errors: [] };
}

export const REAL_BOARDS: Record<string, (() => Promise<ScrapeResult>) | undefined> = {
  remotive: fetchRemotive,
  jobicy: fetchJobicy,
  arbeitnow: fetchArbeitnow,
  remoteok: fetchRemoteOk,
  himalayas: fetchHimalayas,
};

export function realBoardError(sourceName: string, err: unknown): { type: ErrorType; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const type: ErrorType = /timeout/i.test(msg) ? "TIMEOUT" : / 40[13]/.test(msg) ? "SOURCE_BLOCKED" : "NETWORK_ERROR";
  return { type, message: `${sourceName}: ${msg}` };
}
