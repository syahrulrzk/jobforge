import { db } from "@/lib/db";
import { COMPANY_TEMPLATES, CITIES, EMPLOYMENT_TYPES, JOB_ROLES, SOURCE_PROFILES, WORKPLACE_TYPES, chance, pick, randInt } from "./data";
import { buildDescription } from "./adapters";
import { companyFingerprint, jobFingerprint, normalizeCompanyName, normalizeTitle, validateEmail } from "./pipeline";
import { DELIVERY_ENDPOINT } from "./types";
import { resolveLogoUrl } from "./logo";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Initial seed: sources, companies, historical jobs,
// runs, deliveries, errors, activity logs.
// Idempotent: skipped when data already exists.
// ─────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let seedPromise: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}

async function seed(): Promise<void> {
  const existing = await db.source.count();
  if (existing > 0) return;

  // 1. Sources (§8)
  for (const p of SOURCE_PROFILES) {
    await db.source.create({
      data: {
        slug: p.slug,
        name: p.name,
        baseUrl: p.baseUrl,
        type: p.type,
        status: "ACTIVE",
        scraperType: p.scraperType,
        schedule: p.schedule,
        lastRunAt: new Date(Date.now() - randInt(1, 10) * HOUR),
      },
    });
  }
  const sources = await db.source.findMany();
  const sourceBySlug = new Map(sources.map((s) => [s.slug, s]));

  // 2. Companies (§11 — deduplicated by normalized name)
  for (const c of COMPANY_TEMPLATES) {
    await db.company.upsert({
      where: { normalizedName: companyFingerprint(c.name) },
      update: {},
      create: {
        name: c.name,
        normalizedName: companyFingerprint(c.name),
        logoUrl: resolveLogoUrl(c.website) ?? `${c.website}/assets/logo.png`,
        website: c.website,
        profile: c.profile,
        industry: c.industry,
        enrichedAt: new Date(Date.now() - randInt(1, 20) * DAY),
      },
    });
  }
  const companies = await db.company.findMany();
  const companyByNormalizedName = new Map(companies.map((c) => [c.normalizedName, c]));

  // 3. Historical jobs spread across 14 days
  const STATUS_WEIGHTS: [string, number][] = [
    ["PUBLISHED", 38],
    ["SENT", 12],
    ["READY", 8],
    ["NEEDS_ENRICHMENT", 7],
    ["REJECTED", 5],
    ["FAILED", 2],
    ["VALIDATING", 3],
    ["ENRICHING", 3],
    ["PROCESSING", 4],
    ["SCRAPED", 6],
  ];
  const statusPool: string[] = [];
  for (const [s, w] of STATUS_WEIGHTS) for (let i = 0; i < w; i++) statusPool.push(s);

  const TOTAL = 200;
  const usedFingerprints = new Set<string>();

  for (let i = 0; i < TOTAL; i++) {
    const company = pick(COMPANY_TEMPLATES);
    const role = pick(JOB_ROLES);
    const city = pick(CITIES);
    const status = pick(statusPool);
    const daysAgo = Math.floor(Math.random() * 14);
    const scrapedAt = new Date(Date.now() - daysAgo * DAY - randInt(0, 20) * HOUR);
    const sourceProfile = pick(SOURCE_PROFILES);
    const source = sourceBySlug.get(sourceProfile.slug)!;

    const hasEmail = !company.noPublicEmail;
    const emailStatus = hasEmail ? (company.badMx ? "UNKNOWN" : "VALID") : "UNKNOWN";
    const missingLogo = chance(0.05);
    const hasSalary = chance(sourceProfile.salaryChance);
    const salaryMin = role.salaryRange[0];
    const salaryMax = role.salaryRange[1];

    // terminal outcome logic — mandatory field validation (§17)
    let finalStatus = status;
    let statusReason: string | null = null;
    if (["NEEDS_ENRICHMENT", "REJECTED"].includes(status)) {
      if (!hasEmail && status === "NEEDS_ENRICHMENT") {
        statusReason = "NEEDS_ENRICHMENT: HR Email not available yet";
      } else if (missingLogo) {
        statusReason = "NEEDS_ENRICHMENT: Company Logo URL not available yet";
      } else {
        statusReason = "REJECTED: critical mandatory fields missing (Job Description)";
      }
    }
    if (!hasEmail && !["NEEDS_ENRICHMENT", "REJECTED", "SCRAPED", "PROCESSING", "ENRICHING", "VALIDATING", "FAILED"].includes(status)) {
      finalStatus = "NEEDS_ENRICHMENT";
      statusReason = "NEEDS_ENRICHMENT: HR Email not available yet";
    }

    const fp = jobFingerprint(company.name, role.title, city);
    if (usedFingerprints.has(fp)) continue;
    usedFingerprints.add(fp);

    const companyRow = companyByNormalizedName.get(companyFingerprint(company.name))!;

    const job = await db.job.create({
      data: {
        fingerprint: fp,
        title: role.title,
        normalizedTitle: normalizeTitle(role.title),
        description: buildDescription(role.title, company.name),
        salaryMin: hasSalary ? salaryMin : null,
        salaryMax: hasSalary ? salaryMax : null,
        currency: hasSalary ? "IDR" : null,
        location: chance(0.08) ? null : city,
        employmentType: chance(0.1) ? null : pick(EMPLOYMENT_TYPES),
        workplaceType: chance(0.1) ? null : pick(WORKPLACE_TYPES),
        requirements: JSON.stringify(role.requirements),
        skills: JSON.stringify(role.skills),
        status: finalStatus,
        statusReason,
        scrapedAt,
        publishedAt: finalStatus === "PUBLISHED" ? new Date(scrapedAt.getTime() + randInt(2, 20) * HOUR) : null,
        companyId: missingLogo && chance(0.3) ? null : companyRow.id,
      },
    });

    await db.jobSource.create({
      data: {
        jobId: job.id,
        sourceId: source.id,
        sourceJobId: `${source.slug.toUpperCase().slice(0, 3)}-${randInt(10000, 99999)}`,
        sourceUrl: `${sourceProfile.baseUrl}/job/${randInt(100000, 999999)}`,
        firstSeenAt: scrapedAt,
      },
    });

    if (hasEmail && !["SCRAPED", "PROCESSING"].includes(finalStatus)) {
      const email = `${company.emailLocal ?? "hr"}@${company.website.replace(/^https?:\/\/(www\.)?/, "")}`;
      const v = validateEmail(email);
      await db.jobContact.create({
        data: {
          jobId: job.id,
          hrEmail: email,
          emailSourceUrl: `${company.website}/career`,
          emailVerified: v.verified && !company.badMx,
          emailStatus: company.badMx ? "UNKNOWN" : v.status,
        },
      });
    }

    if (["SENT", "PUBLISHED"].includes(finalStatus)) {
      await db.apiDelivery.create({
        data: {
          jobId: job.id,
          endpoint: DELIVERY_ENDPOINT,
          requestId: `req_${randInt(100000, 999999)}${i}`,
          attempt: 1,
          maxAttempts: 3,
          status: "SUCCESS",
          responseCode: 200,
          responseBody: JSON.stringify({ success: true, message: "Jobs imported successfully", data: { received: 1, created: 1, updated: 0, duplicated: 0, failed: 0 } }),
          deliveredAt: new Date(scrapedAt.getTime() + randInt(1, 8) * HOUR),
          createdAt: scrapedAt,
        },
      });
    } else if (finalStatus === "FAILED" && chance(0.7)) {
      await db.apiDelivery.create({
        data: {
          jobId: job.id,
          endpoint: DELIVERY_ENDPOINT,
          requestId: `req_${randInt(100000, 999999)}${i}`,
          attempt: 3,
          maxAttempts: 3,
          status: "FAILED",
          responseCode: 500,
          responseBody: JSON.stringify({ success: false, message: "Internal Server Error" }),
          createdAt: scrapedAt,
        },
      });
    }
  }

  // 4. Historical scrape runs over 14 days (§24)
  for (const source of sources) {
    const runs = randInt(4, 7);
    for (let i = 0; i < runs; i++) {
      const failedRun = chance(0.12);
      const startedAt = new Date(Date.now() - randInt(1, 14) * DAY - randInt(0, 12) * HOUR);
      const durationMin = randInt(4, 38);
      const found = randInt(8, 30);
      const created = Math.floor(found * (0.55 + Math.random() * 0.25));
      const updated = Math.floor(found * (0.1 + Math.random() * 0.2));
      const dup = found - created - updated > 0 ? found - created - updated : 0;
      await db.scrapeRun.create({
        data: {
          sourceId: source.id,
          startedAt,
          finishedAt: new Date(startedAt.getTime() + durationMin * 60 * 1000),
          pagesScraped: randInt(2, 12),
          jobsFound: found,
          jobsCreated: failedRun ? 0 : created,
          jobsUpdated: failedRun ? 0 : updated,
          jobsRejected: failedRun ? 0 : randInt(0, 4),
          jobsDuplicate: failedRun ? 0 : dup,
          errorCount: failedRun ? randInt(1, 4) : chance(0.2) ? 1 : 0,
          status: failedRun ? "FAILED" : "SUCCESS",
        },
      });
    }
  }

  // 5. Historical errors (§25)
  const errorSamples: [string, string][] = [
    ["TIMEOUT", "Request to listing page exceeded 30s timeout"],
    ["NETWORK_ERROR", "ECONNRESET while fetching detail page"],
    ["PARSER_ERROR", "Job card selector .job-card__title not found — layout changed"],
    ["SOURCE_BLOCKED", "Source returned 403 — respecting block, backing off"],
    ["EMAIL_NOT_FOUND", "No published recruitment email found on career page"],
    ["EMAIL_INVALID", "Published email failed syntax validation"],
    ["API_ERROR", "Portal import responded 500 Internal Server Error"],
    ["INVALID_DATA", "Job description shorter than minimum length"],
  ];
  for (let i = 0; i < 16; i++) {
    const [errorType, message] = pick(errorSamples);
    const source = pick(sources);
    const seenAt = new Date(Date.now() - randInt(0, 10) * DAY - randInt(0, 20) * HOUR);
    await db.scrapeError.create({
      data: {
        sourceId: source.id,
        errorType,
        message,
        stack: `at fetchListing (${source.slug}/scraper.ts:142:9)\nat runScraper (worker/scraper.worker.ts:58:5)`,
        retryCount: randInt(0, 3),
        status: chance(0.3) ? "RESOLVED" : "OPEN",
        firstSeen: seenAt,
        lastSeen: new Date(seenAt.getTime() + randInt(0, 48) * HOUR),
      },
    });
  }

  // 6. Recent activity logs (§26 structured logging)
  const actions: [string, string, string][] = [
    ["scrape", "success", "Scrape run finished"],
    ["parse", "success", "Parsed 12 job cards"],
    ["normalize", "success", "Normalized job records to canonical format"],
    ["enrich", "success", "Company enrichment completed"],
    ["validate", "success", "Mandatory field validation passed"],
    ["dedup", "warning", "Duplicate job detected — linked to existing record"],
    ["deliver", "success", "Bulk import accepted by Job Portal"],
    ["error", "failed", "Scrape run failed"],
  ];
  for (let i = 0; i < 40; i++) {
    const [action, status, message] = pick(actions);
    await db.activityLog.create({
      data: {
        ts: new Date(Date.now() - i * randInt(2, 9) * 60 * 1000),
        source: pick(sources).slug,
        action,
        status,
        message,
        durationMs: randInt(120, 4200),
      },
    });
  }

  // 7. Settings (§23, §37)
  const defaults: Record<string, string> = {
    JOB_PORTAL_API_URL: "https://portal.jobforge.local/api/v1/jobs/import",
    JOB_PORTAL_API_KEY: "jf_live_9f2c8a41d7e64b05",
    BATCH_SIZE: "25",
    MAX_ATTEMPTS: "3",
    AUTO_SCRAPE: "true",
    AUTO_DELIVERY: "true",
    TICK_INTERVAL_MS: "5000",
    DEMO_JOB_CAP: "800",
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}
