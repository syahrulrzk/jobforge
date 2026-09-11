import { CITIES, COMPANY_TEMPLATES, EMPLOYMENT_TYPES, JOB_ROLES, WORKPLACE_TYPES, chance, pick, randInt, type SourceProfile } from "./data";
import type { ErrorType } from "./types";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Source Adapter Architecture (PRD §9, §10)
// Each source = scraper + parser + mapper.
// Core engine never depends on source-specific HTML structure.
//
// scraper.ts  → fetch raw HTML/API response (STATIC via Cheerio,
//               DYNAMIC via Playwright, API via fetch)
// parser.ts   → extract fields from raw payload
// mapper.ts   → map to RawJobRecord (pre-canonical)
//
// In this sandbox the network layer is simulated; in production
// each adapter performs real requests with timeout, retry,
// concurrency limit and request delay (PRD §10.4).
// ─────────────────────────────────────────────────────────────

export interface RawJobRecord {
  sourcePlatform: string;
  sourceJobId: string;
  sourceUrl: string;
  // raw, un-normalized fields as they appear on the source page
  rawTitle: string;
  rawCompanyName: string | null;
  rawCompanyLogoUrl: string | null;
  rawCompanyWebsite: string | null;
  rawCompanyProfile: string | null;
  rawDescription: string | null;
  rawSalaryText: string | null;
  rawLocation: string | null;
  rawEmploymentType: string | null;
  rawWorkplaceType: string | null;
  rawRequirements: string[];
  rawSkills: string[];
  // career page hint used by HR email discovery (§12)
  careerPageUrl: string | null;
  publishedEmail: string | null;
  scrapedAt: string;
}

export interface ScrapeResult {
  records: RawJobRecord[];
  pagesScraped: number;
  errors: { type: ErrorType; message: string }[];
}

let jobCounter = Math.floor(Math.random() * 90000) + 10000;

function nextJobId(prefix: string): string {
  jobCounter += randInt(3, 97);
  return `${prefix}-${jobCounter}`;
}

function buildDescription(role: string, company: string): string {
  return [
    `${company} sedang mencari ${role} untuk bergabung dengan tim kami.`,
    ``,
    `Tanggung Jawab:`,
    `- Melaksanakan pekerjaan ${role} sesuai target dan standar perusahaan`,
    `- Berkolaborasi dengan tim produk, engineering, dan bisnis`,
    `- Menganalisis dan meningkatkan kualitas hasil kerja secara berkelanjutan`,
    `- Melaporkan progres dan hambatan secara rutin kepada atasan`,
    ``,
    `Benefit:`,
    `- BPJS Kesehatan & Ketenagakerjaan`,
    `- Thrift dan bonus tahunan`,
    `- Fleksible working arrangement untuk posisi tertentu`,
  ].join("\n");
}

/**
 * Simulation scraper for one source.
 * Produces intentionally imperfect raw records so the downstream
 * pipeline (normalize → enrich → validate → dedup) is exercised
 * end-to-end: duplicates across sources, missing emails, missing
 * logos, missing salary, bad MX domains, etc.
 */
export function scrapeSource(profile: SourceProfile, existingTitles: Set<string>): ScrapeResult {
  const errors: { type: ErrorType; message: string }[] = [];

  // §10.4 request control — occasional network failure on the source
  const fatalChance = 0.04;
  if (chance(fatalChance)) {
    errors.push({
      type: pick(["TIMEOUT", "NETWORK_ERROR", "SOURCE_BLOCKED"] as ErrorType[]),
      message: `Failed to fetch listing page from ${profile.baseUrl} after 3 retries`,
    });
    if (chance(0.5)) {
      // fatal — no records at all this run
      return { records: [], pagesScraped: randInt(1, 3), errors };
    }
  }

  const count = randInt(profile.minJobs, profile.maxJobs);
  const records: RawJobRecord[] = [];
  const pages = Math.ceil(count / 10);

  for (let i = 0; i < count; i++) {
    const company = pick(COMPANY_TEMPLATES);
    const role = pick(JOB_ROLES);
    const city = pick(CITIES);

    // §15.1 — deliberately recreate the same job so cross-source
    // and intra-source deduplication triggers
    const isDup = records.length > 3 && chance(profile.intraDupChance);
    const dupCompany = isDup ? records[records.length - 1] : null;

    const usedCompany = dupCompany
      ? COMPANY_TEMPLATES.find((c) => c.name === (dupCompany.rawCompanyName ?? "").replace(/^PT /, "PT "))
      ?? company
      : company;
    const usedRole = dupCompany ? role : role;

    // title format variance between sources
    let rawTitle = usedRole.title;
    if (chance(profile.suffixTitleChance)) {
      rawTitle = `${usedRole.title} - ${usedCompany.name}`;
    }

    const hasSalary = chance(profile.salaryChance);
    const salaryText = hasSalary
      ? `IDR ${Math.round(usedRole.salaryRange[0] / 500000) * 500000 / 1e6}jt - ${Math.round(usedRole.salaryRange[1] / 500000) * 500000 / 1e6}jt per bulan`
      : null;

    records.push({
      sourcePlatform: profile.slug,
      sourceJobId: nextJobId(profile.slug.slice(0, 3).toUpperCase()),
      sourceUrl: `${profile.baseUrl}/job/${nextJobId("J")}`,
      rawTitle,
      rawCompanyName: usedCompany.name,
      rawCompanyLogoUrl: chance(profile.missingLogoChance)
        ? null
        : `${usedCompany.website}/assets/logo.png`,
      rawCompanyWebsite: usedCompany.website,
      rawCompanyProfile: usedCompany.profile,
      rawDescription: buildDescription(usedRole.title, usedCompany.name),
      rawSalaryText: salaryText,
      rawLocation: chance(0.08) ? null : city,
      rawEmploymentType: chance(0.15) ? null : pick(EMPLOYMENT_TYPES),
      rawWorkplaceType: chance(0.15) ? null : pick(WORKPLACE_TYPES),
      rawRequirements: usedRole.requirements,
      rawSkills: usedRole.skills,
      careerPageUrl: `${usedCompany.website}/career`,
      publishedEmail:
        usedCompany.noPublicEmail
          ? null
          : `${usedCompany.emailLocal ?? "hr"}@${usedCompany.website.replace(/^https?:\/\/(www\.)?/, "")}`,
      scrapedAt: new Date().toISOString(),
    });
    void existingTitles;
  }

  if (records.length > 0 && chance(0.06)) {
    errors.push({
      type: "PARSER_ERROR",
      message: `Failed to parse ${randInt(1, 3)} job card(s): selector .job-card changed layout`,
    });
  }

  return { records, pagesScraped: pages, errors };
}

// Seed-time scraper variant that targets a specific existing title set
// to manufacture cross-source duplicates deterministically.
export function scrapeCrossSourceDuplicate(
  profile: SourceProfile,
  reference: RawJobRecord
): RawJobRecord {
  return {
    ...reference,
    sourcePlatform: profile.slug,
    sourceJobId: nextJobId(profile.slug.slice(0, 3).toUpperCase()),
    sourceUrl: `${profile.baseUrl}/job/${nextJobId("J")}`,
    rawTitle: chance(profile.suffixTitleChance)
      ? `${reference.rawTitle} - ${reference.rawCompanyName ?? ""}`
      : reference.rawTitle,
    rawSalaryText: reference.rawSalaryText,
    scrapedAt: new Date().toISOString(),
  };
}

export { buildDescription };
