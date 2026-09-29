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
//   dealls      https://api.sejutacita.id/v1/explore-job/job  logo ✓ email HR ✓ salary IDR
//
// Each board also exports a mapper (mapRemotiveJob, mapJobicyJob, …)
// reused by the live keyword search (live-search.ts).
//
// HR emails: remotive/jobicy/arbeitnow/remoteok/himalayas do NOT expose them
// — per §12.4 the pipeline never guesses, so such jobs land in
// NEEDS_ENRICHMENT and the recovery worker scans the posting page for a
// real mailto: contact. DEALLS is the exception: the Sejutacita API
// payload embeds the recruiter's email (author.email), so Indonesian jobs
// ingest with a real HR contact straight to READY.
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
  if (v.includes("freelance") || v.includes("freelancer") || v.includes("gig")) return "FREELANCE";
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

// ── Dealls (api.sejutacita.id) — Indonesian job board ──────────
// Dealls (dealls.com, parent company Sejutacita) serves its job
// listings through an OPEN API — measured from this datacenter IP:
//   GET https://api.sejutacita.id/v1/explore-job/job?page=1&limit=N
//        &sortParam=mostRelevant&sortBy=asc&boostTheBoostedJob=true
//        &published=true&status=active[&search=<keyword>]
//   → 200 JSON, no auth, no Origin header required, no anti-bot.
// totalDocs ~1.1k active Indonesian postings. Payload carries
// company (name + CDN logo), city ("Jakarta Selatan"),
// workplaceType (onSite/hybrid/remote), employmentTypes
// (fullTime/freelance/contract/internship), skills, salaryRange
// {start,end} in IDR when published — and the recruiter's email
// (author.email), which feeds §12 directly.
// Full description lives on the SSR detail page (/loker/<slug>)
// inside __NEXT_DATA__ (hiringTeam email + responsibilities HTML);
// the list API does not include it.

export const SEJUTACITA_LIST_URL =
  "https://api.sejutacita.id/v1/explore-job/job?page=1&sortParam=mostRelevant&sortBy=asc&boostTheBoostedJob=true&published=true&status=active";const DEALLS_DETAIL_PREFIX = "https://dealls.com/loker/";

interface SejutacitaJob {
  id: string;
  slug: string;
  role: string;
  employmentTypes?: string[];
  workplaceType?: string | null;
  publishedAt?: string;
  salaryRange?: { start?: number; end?: number } | null;
  country?: { name?: string } | null;
  city?: { name?: string } | null;
  company?: {
    name?: string;
    slug?: string;
    logoUrl?: string | null;
    sector?: string | null;
    insight?: Record<string, unknown> | null;
  } | null;
  skills?: { name?: string }[] | null;
  author?: { email?: string | null } | null;
}

function mapWorkplaceDealls(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").toLowerCase();
  if (v === "remote") return "REMOTE";
  if (v === "hybrid") return "HYBRID";
  if (v === "onsite" || v === "on_site" || v === "on site") return "ONSITE";
  return null;
}

export function mapDeallsJob(j: SejutacitaJob): RawJobRecord | null {
  const title = clean(j.role);
  const company = clean(j.company?.name);
  const jobSlug = String(j.slug ?? "").trim();
  const companySlug = String(j.company?.slug ?? "").trim();
  if (!title || !company || !jobSlug || !companySlug) return null;
  const sourceUrl = `${DEALLS_DETAIL_PREFIX}${encodeURIComponent(jobSlug)}~${encodeURIComponent(companySlug)}`;
  const salaryText =
    j.salaryRange?.start && j.salaryRange?.end
      ? `IDR ${Number(j.salaryRange.start).toLocaleString("id-ID")} - ${Number(j.salaryRange.end).toLocaleString("id-ID")} per bulan`
      : null;
  const email = clean(j.author?.email) ?? null;
  const emailOk =
    email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) &&
    !/noreply|no-reply|sejutacita\.id|dealls\.com/i.test(email)
      ? email
      : null;
  return {
    sourcePlatform: "dealls",
    sourceJobId: `dealls-${j.id}`.slice(0, 120),
    sourceUrl,
    rawTitle: title,
    rawCompanyName: company,
    rawCompanyLogoUrl: clean(j.company?.logoUrl) ?? null,
    // slug perusahaan tersedia dari sourceUrl detail job (…/loker/<job>~<companySlug>)
    // — profil asli di-fetch di tahap company enrichment (engine.ts)
    rawCompanyWebsite: companySlug ? `https://dealls.com/company/${encodeURIComponent(companySlug)}` : null,
    rawCompanyProfile: null, // profil asli perusahaan di-fetch terpisah (§11 engine)
    rawDescription: null, // filled by the detail-page fetch below
    rawSalaryText: salaryText,
    rawLocation: clean(j.city?.name) ?? clean(j.country?.name) ?? "Indonesia",
    rawEmploymentType: mapEmployment((j.employmentTypes ?? [])[0] ?? null),
    rawWorkplaceType: mapWorkplaceDealls(j.workplaceType),
    rawRequirements: [],
    rawSkills: (j.skills ?? []).map((s) => String(s.name ?? "").trim()).filter(Boolean).slice(0, 6),
    careerPageUrl: sourceUrl,
    publishedEmail: emailOk,
    scrapedAt: isoDate(j.publishedAt),
  };
}

/**
 * Extract the full job detail from the SSR detail page's __NEXT_DATA__.
 * Struktur terukur 2026-09-17: detail job ada di React Query cache
 * pageProps.dehydratedState.queries[0].state.data — field description
 * sering kosong, konten asli di responsibilities (HTML) + requirements
 * (HTML), dan skills lengkap di candidatePreference.skills [{name}].
 * Fallback struktur lama pageProps.job tetap didukung.
 */
export function extractDeallsDetail(html: string): {
  description: string | null;
  requirements: string | null;
  skills: string[];
} | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { job?: Record<string, unknown>; dehydratedState?: { queries?: { state?: { data?: unknown } }[] } } };
    };
    const pp = data.props?.pageProps;
    let job: Record<string, unknown> | undefined = pp?.job;
    if (!job) {
      const q0 = pp?.dehydratedState?.queries?.[0]?.state?.data;
      if (q0 && typeof q0 === "object") job = (q0 as Record<string, unknown>).job as Record<string, unknown> ?? (q0 as Record<string, unknown>);
    }
    if (!job || typeof job !== "object") return null;
    const descHtml = typeof job.description === "string" ? job.description : "";
    const respHtml = typeof job.responsibilities === "string" ? job.responsibilities : "";
    const reqHtml = typeof job.requirements === "string" ? job.requirements : "";
    const parts: string[] = [];
    const pushSection = (label: string, html2: string) => {
      const text = stripHtml(html2);
      if (text.length >= 30) parts.push(`${label}:\n${text}`);
    };
    pushSection("Deskripsi", descHtml);
    pushSection("Tanggung Jawab", respHtml);
    pushSection("Kualifikasi", reqHtml);
    const skills: string[] = [];
    const pref = job.candidatePreference as Record<string, unknown> | undefined;
    const skillsRaw = (pref?.skills ?? job.skills) as unknown;
    if (Array.isArray(skillsRaw)) {
      for (const s of skillsRaw) {
        if (s && typeof s === "object") {
          const n = String((s as Record<string, unknown>).name ?? "").trim();
          if (n) skills.push(n);
        } else if (typeof s === "string" && s.trim()) {
          skills.push(s.trim());
        }
      }
    }
    return {
      description: parts.length > 0 ? parts.join("\n\n").slice(0, MAX_DESCRIPTION) : null,
      requirements: reqHtml ? stripHtml(reqHtml).slice(0, MAX_DESCRIPTION) : null,
      skills: skills.slice(0, 12),
    };
  } catch {
    return null;
  }
}

/** Backward-compatible wrapper: deskripsi rapi saja. */
export function extractDeallsDescription(html: string): string | null {
  return extractDeallsDetail(html)?.description ?? null;
}

/**
 * Profil perusahaan ASLI dari API perusahaan Sejutacita (bukan karangan):
 *   GET /v1/job-portal/company/slug/<slug> → description (HTML), website,
 *   size {start,end}, sector, logoUrl — semuanya ter-publish oleh perusahaan
 *   di Dealls. Tidak ada field yang dikonstruksi (§12.4). Cache in-process
 *   per slug — satu perusahaan banyak lowongan.
 */
const deallsCompanyCache = new Map<string, { profile: string | null; website: string | null; logoUrl: string | null; sector: string | null; size: string | null }>();

function deallsSizeLabel(size: unknown): string | null {
  if (!size || typeof size !== "object") return null;
  const s = size as { start?: number | null; end?: number | null };
  if (s.start && s.end) return `${s.start}-${s.end} karyawan`;
  if (s.start) return `${s.start}+ karyawan`;
  return null;
}

export async function fetchDeallsCompanyProfile(
  companySlug: string,
  cfg?: SourceNetConfig,
): Promise<{ profile: string | null; website: string | null; logoUrl: string | null; sector: string | null; size: string | null } | null> {
  const slug = companySlug.trim();
  if (!slug) return null;
  const cached = deallsCompanyCache.get(slug);
  if (cached) return cached;
  try {
    const data = (await getJson(`https://api.sejutacita.id/v1/job-portal/company/slug/${encodeURIComponent(slug)}`)) as {
      data?: { result?: Record<string, unknown> };
    };
    const c = data.data?.result;
    if (!c || typeof c !== "object") {
      deallsCompanyCache.set(slug, { profile: null, website: null, logoUrl: null, sector: null, size: null });
      return null;
    }
    const descHtml = typeof c.description === "string" ? c.description : "";
    const profile = stripHtml(descHtml).length >= 30 ? stripHtml(descHtml).slice(0, 2_000) : null;
    const website = clean(c.website) ?? null;
    const logoUrl = clean(c.logoUrl) ?? null;
    const sector = clean(c.sector) ?? null;
    const size = deallsSizeLabel(c.size);
    const out = { profile, website, logoUrl, sector, size };
    deallsCompanyCache.set(slug, out);
    return out;
  } catch {
    return null; // API gagal — honest null, pipeline lanjut tanpa profil
  }
}

/**
 * Fill rawDescription (dan skills + profil perusahaan) for Dealls records by
 * fetching their SSR detail pages (list API has no description — the pipeline
 * REJECTS records without one). Deskripsi dirangkai rapi: Deskripsi /
 * Tanggung Jawab / Kualifikasi (dari dehydratedState detail page); skills
 * di-merge dari candidatePreference.skills bila lebih lengkap dari payload
 * listing; profil perusahaan diambil ASLI dari API perusahaan Sejutacita
 * (description/website/logo/sector/size ter-publish — bukan karangan).
 * Low concurrency + one retry per page: the Next.js SSR pages throttle a
 * 6-wide burst from one IP (measured: 18/30 descriptions empty on the first
 * scheduled run). Fallback = meta description from the same page. Records
 * still missing a description are returned unchanged — the pipeline treats
 * them honestly per §12.4 instead of fabricating text.
 */
export async function enrichDeallsDescriptions(
  records: RawJobRecord[],
  cfg?: SourceNetConfig,
  cap = 30,
): Promise<{ records: RawJobRecord[]; pagesScraped: number; allDescriptionsEmpty: boolean }> {
  const CONCURRENCY = 3;
  const slice = records.slice(0, cap);
  const filled = new Map<number, { description: string; skills: string[] | null }>();
  const fetchOne = async (slugPair: string): Promise<{ description: string; skills: string[] | null } | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { ok, text } = await sourceFetchText(`${DEALLS_DETAIL_PREFIX}${slugPair}`, cfg ?? {}, {
          ua: "browser",
          timeoutMs: 12_000,
        });
        if (ok) {
          const detail = extractDeallsDetail(text);
          if (detail?.description) return { description: detail.description, skills: detail.skills.length > 0 ? detail.skills : null };
          // fallback — meta description selalu di-render SSR Dealls
          const meta = text.match(/<meta[^>]+name=["']description["'][^>]+content=("[^"]*"|'[^']*')/i);
          if (meta) {
            const raw = meta[1].slice(1, -1).replace(/&amp;/g, "&").replace(/&quot;/g, '"');
            if (raw.trim().length >= 30) return { description: `Ringkasan lowongan: ${raw.trim()}`.slice(0, MAX_DESCRIPTION), skills: null };
          }
        }
      } catch {
        // retry / give up — honest downstream handling
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
    return null;
  };
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const chunk = slice.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (rec, j) => {
        const slugPair = rec.sourceUrl.replace(DEALLS_DETAIL_PREFIX, "");
        const detail = await fetchOne(slugPair);
        if (detail) filled.set(i + j, detail);
      }),
    );
  }
  // Profil perusahaan ASLI via API perusahaan (cache in-process, sekali per slug)
  const companySlugs = new Set(
    slice
      .map((r) => (r.rawCompanyWebsite ?? "").replace("https://dealls.com/company/", ""))
      .filter(Boolean),
  );
  await Promise.all([...companySlugs].map((slug) => fetchDeallsCompanyProfile(slug, cfg)));
  const out: RawJobRecord[] = records.map((rec, i) => {
    const detail = filled.get(i);
    if (detail === undefined) return rec;
    // skills: merge — detail page lebih lengkap dari listing (listing kadang cuma 2)
    const mergedSkills =
      detail.skills && detail.skills.length > rec.rawSkills.length ? detail.skills : rec.rawSkills;
    return { ...rec, rawDescription: detail.description, rawSkills: mergedSkills };
  });
  return {
    records: out,
    pagesScraped: 1 + Math.ceil(slice.length / CONCURRENCY),
    allDescriptionsEmpty: slice.length > 0 && filled.size === 0,
  };
}

async function fetchDealls(cfg?: SourceNetConfig): Promise<ScrapeResult> {
  const data = (await getJson(`${SEJUTACITA_LIST_URL}&limit=30`)) as {
    data?: { docs?: SejutacitaJob[] };
  };
  const docs = data.data?.docs ?? [];
  const mapped = docs.map(mapDeallsJob).filter((r): r is RawJobRecord => r !== null);
  const { records, pagesScraped, allDescriptionsEmpty } = await enrichDeallsDescriptions(mapped, cfg, 30);
  const errors: { type: ErrorType; message: string }[] = [];
  if (mapped.length > 0 && allDescriptionsEmpty) {
    errors.push({ type: "PARSER_ERROR", message: "Dealls: semua detail page gagal di-fetch — description kosong" });
  }
  return { records, pagesScraped, errors };
}

// ── LinkedIn & JobStreet/Glints integrations removed (direktif user):
// fokus scraping ke Dealls (Sejutacita API). Fitur Cari Email tetap jalan
// — scanPageForEmailBrowser (browser-boards.ts) masih dipakai company-email.ts.

export const REAL_BOARDS: Record<string, ((cfg: SourceNetConfig) => Promise<ScrapeResult>) | undefined> = {
  remotive: fetchRemotive,
  jobicy: fetchJobicy,
  arbeitnow: fetchArbeitnow,
  remoteok: fetchRemoteOk,
  himalayas: fetchHimalayas,
  dealls: fetchDealls,
};

export function realBoardError(sourceName: string, err: unknown): { type: ErrorType; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const type: ErrorType = /timeout/i.test(msg) ? "TIMEOUT" : / 40[13]/.test(msg) ? "SOURCE_BLOCKED" : "NETWORK_ERROR";
  return { type, message: `${sourceName}: ${msg}` };
}
