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
import { sourceFetchText, type SourceNetConfig } from "./net";

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

async function fetchRemotive(_cfg?: SourceNetConfig): Promise<ScrapeResult> {
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

async function fetchJobicy(_cfg?: SourceNetConfig): Promise<ScrapeResult> {
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

async function fetchArbeitnow(_cfg?: SourceNetConfig): Promise<ScrapeResult> {
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

async function fetchRemoteOk(_cfg?: SourceNetConfig): Promise<ScrapeResult> {
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

async function fetchHimalayas(_cfg?: SourceNetConfig): Promise<ScrapeResult> {
  const data = (await getJson("https://himalayas.app/jobs/api?limit=30")) as { jobs?: Record<string, unknown>[] };
  const records = (data.jobs ?? []).map(mapHimalayasJob).filter((r): r is RawJobRecord => r !== null);
  return { records, pagesScraped: 1, errors: [] };
}

// ── JobStreet (id.jobstreet.com) ───────────────────────────────
// JobStreet Indonesia migrated to the SEEK platform domain
// (www.jobstreet.co.id → id.jobstreet.com) and protects the whole
// zone with an interactive Cloudflare Turnstile challenge. From a
// datacenter IP every anonymous path is 403 — measured (Task 16):
// plain HTTP, stealth headless, headful + Xvfb, Turnstile click.
// The integration therefore works when EITHER applies:
//   1. the source has a residential proxyUrl set (HTTP path), or
//   2. a browser engine (Playwright) runs the fetch and the challenge
//      auto-passes on the exit IP (also proxy-backed).
// Listings expose schema.org JSON-LD JobPosting blocks — parsed, no
// HTML scraping of brittle DOM classes.

/** Extract all schema.org JobPosting objects from a page's ld+json blocks. */
export function extractJobPostingsFromHtml(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of blocks) {
    try {
      const parsed: unknown = JSON.parse(m[1].trim());
      const queue: unknown[] = [parsed];
      let idx = 0; // index-based walk — preserves document order (LIFO pop would reverse)
      while (idx < queue.length) {
        const cur = queue[idx++];
        if (Array.isArray(cur)) {
          queue.push(...cur);
        } else if (cur && typeof cur === "object") {
          const obj = cur as Record<string, unknown>;
          if (obj["@graph"]) queue.push(obj["@graph"]);
          const t = obj["@type"];
          const type = Array.isArray(t) ? t.map(String).join(",") : String(t ?? "");
          if (/JobPosting/i.test(type)) out.push(obj);
        }
      }
    } catch {
      // malformed block — skip it, keep the rest
    }
  }
  return out;
}

export function mapJobStreetJob(j: Record<string, unknown>): RawJobRecord | null {
  const title = clean(j.title);
  const org = (j.hiringOrganization ?? {}) as Record<string, unknown>;
  const company = clean(org.name);
  const url = clean(j.url) ?? clean(j["@id"]);
  if (!title || !company || !url) return null;
  const idObj = (j.identifier ?? {}) as Record<string, unknown>;
  const jobId =
    clean(idObj.value) ??
    clean(idObj.name) ??
    url.split("?")[0].split("/").filter(Boolean).pop() ??
    url;
  const logoRaw = org.logo;
  const logo =
    typeof logoRaw === "string"
      ? clean(logoRaw)
      : Array.isArray(logoRaw)
        ? clean((logoRaw[0] as Record<string, unknown> | undefined)?.url ?? (logoRaw[0] as string | undefined))
        : clean((logoRaw as Record<string, unknown> | undefined)?.url);
  const locs = Array.isArray(j.jobLocation) ? j.jobLocation : j.jobLocation ? [j.jobLocation] : [];
  const locName = locs
    .map((l) => {
      const addr = ((l as Record<string, unknown> | undefined)?.address ?? {}) as Record<string, unknown>;
      return [addr.addressLocality, addr.addressRegion].filter(Boolean).map(String).join(", ");
    })
    .filter(Boolean)[0] ?? null;
  const salary = (j.baseSalary ?? {}) as Record<string, unknown>;
  const money = (salary.value ?? {}) as Record<string, unknown>;
  const salaryText =
    money.minValue && money.maxValue
      ? `${String(salary.currency ?? "IDR")} ${Number(money.minValue).toLocaleString("id-ID")} - ${Number(money.maxValue).toLocaleString("id-ID")} /${String(salary.unitText ?? "month")}`
      : null;
  return {
    sourcePlatform: "jobstreet",
    sourceJobId: `js-${String(jobId).slice(0, 100)}`,
    sourceUrl: url,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: logo,
    rawCompanyWebsite: null,
    rawCompanyProfile: null,
    rawDescription: stripHtml(String(j.description ?? "")) || null,
    rawSalaryText: salaryText,
    rawLocation: locName ?? "Indonesia",
    rawEmploymentType: mapEmployment(String(j.employmentType ?? "")),
    rawWorkplaceType: String(j.jobLocationType ?? "") === "TELECOMMUTE" ? "REMOTE" : null,
    rawRequirements: [],
    rawSkills: Array.isArray(j.skills) ? j.skills.map((s) => String(s)).slice(0, 6) : [],
    careerPageUrl: url,
    publishedEmail: null, // JobStreet keeps applications on-site — email gate applies downstream
    scrapedAt: isoDate(j.datePosted),
  };
}

/** SEO listing URL: /id/{kata-dengan-dash}-jobs — JobStreet's canonical keyword page. */
export function jobStreetSearchUrl(rawQuery: string): string {
  const slug = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return `https://id.jobstreet.com/id/${slug || "jobs"}-jobs`;
}

async function fetchJobStreet(cfg: SourceNetConfig): Promise<ScrapeResult> {
  const url = "https://id.jobstreet.com/id/jobs"; // general listing — keyword runs go through live-search
  const { ok, status, text } = await sourceFetchText(url, cfg, { ua: "browser", timeoutMs: 15_000 });
  if (!ok) throw new Error(`${url} responded ${status}${status === 403 ? " — Cloudflare challenge (set proxy residensial di source)" : ""}`);
  const records = extractJobPostingsFromHtml(text)
    .map(mapJobStreetJob)
    .filter((r): r is RawJobRecord => r !== null);
  if (records.length === 0) throw new Error("halaman terbuka tapi tidak ada JSON-LD JobPosting — kemungkinan masih di challenge");
  return { records, pagesScraped: 1, errors: [] };
}

export const REAL_BOARDS: Record<string, ((cfg: SourceNetConfig) => Promise<ScrapeResult>) | undefined> = {
  remotive: fetchRemotive,
  jobicy: fetchJobicy,
  arbeitnow: fetchArbeitnow,
  remoteok: fetchRemoteOk,
  himalayas: fetchHimalayas,
  jobstreet: fetchJobStreet,
};

export function realBoardError(sourceName: string, err: unknown): { type: ErrorType; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const type: ErrorType = /timeout/i.test(msg) ? "TIMEOUT" : / 40[13]/.test(msg) ? "SOURCE_BLOCKED" : "NETWORK_ERROR";
  return { type, message: `${sourceName}: ${msg}` };
}
