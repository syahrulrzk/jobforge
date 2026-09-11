/**
 * Task 16-f — parser unit test for the JobStreet integration.
 * The FIXTURE below replicates the schema.org JSON-LD JobPosting blocks
 * JobStreet embeds in its SEO listing pages (structure per schema.org spec).
 * It validates extractJobPostingsFromHtml + mapJobStreetJob logic —
 * it is NOT a scrape and NOT fake pipeline data.
 */
import { extractJobPostingsFromHtml, mapJobStreetJob } from "../src/lib/jobforge/sources-real";

const FIXTURE_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "JobStreet" },
    {
      "@type": "JobPosting",
      title: "Senior Frontend Developer",
      description: "<p>We are hiring a <b>senior frontend developer</b>.</p><p>React, TypeScript.</p>",
      datePosted: "2026-09-01",
      employmentType: "FULL_TIME",
      hiringOrganization: {
        "@type": "Organization",
        name: "PT Teknologi Maju Bersama",
        logo: "https://media-jobstreet.s3.amazonaws.com/company/logo.png",
      },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Jakarta Selatan",
          addressRegion: "JK",
          addressCountry: "ID",
        },
      },
      jobLocationType: "TELECOMMUTE",
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "IDR",
        value: { "@type": "QuantitativeValue", minValue: 12000000, maxValue: 20000000, unitText: "MONTH" },
      },
      identifier: { "@type": "PropertyValue", name: "jobstreet", value: "job-12345678" },
      url: "https://id.jobstreet.com/id/senior-frontend-developer-jobs-12345678",
    },
    {
      "@type": "JobPosting",
      title: "Business Analyst",
      hiringOrganization: { name: "Bank Digital Nusantara" },
      jobLocation: [{ address: { addressLocality: "Bandung", addressRegion: "JB" } }],
      url: "https://id.jobstreet.com/id/business-analyst-jobs-87654321",
    },
  ],
};

const FIXTURE_HTML = `<!DOCTYPE html><html lang="id"><head><title>Frontend developer Jobs - JobStreet</title>
<script type="application/ld+json">${JSON.stringify(FIXTURE_JSONLD)}</script>
<script type="application/ld+json">{"broken": trailing,,,}</script>
</head><body><div>listing</div></body></html>`;

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== extractJobPostingsFromHtml ===");
const postings = extractJobPostingsFromHtml(FIXTURE_HTML);
check("finds 2 JobPosting (skips broken block + non-JobPosting)", postings.length === 2, `got ${postings.length}`);

console.log("=== mapJobStreetJob (full record) ===");
const rec = mapJobStreetJob(postings[0]);
check("not null", rec !== null);
if (rec) {
  check("sourcePlatform=jobstreet", rec.sourcePlatform === "jobstreet");
  check("rawTitle", rec.rawTitle === "Senior Frontend Developer", rec.rawTitle ?? "null");
  check("rawCompanyName", rec.rawCompanyName === "PT Teknologi Maju Bersama", rec.rawCompanyName ?? "null");
  check("logo extracted", rec.rawCompanyLogoUrl === "https://media-jobstreet.s3.amazonaws.com/company/logo.png", rec.rawCompanyLogoUrl ?? "null");
  check("description stripped HTML", rec.rawDescription?.includes("senior frontend developer") === true && !rec.rawDescription.includes("<"), rec.rawDescription?.slice(0, 60));
  check("location Jakarta Selatan, JK", rec.rawLocation === "Jakarta Selatan, JK", rec.rawLocation ?? "null");
  check("employmentType FULL_TIME", rec.rawEmploymentType === "FULL_TIME", rec.rawEmploymentType ?? "null");
  check("workplaceType REMOTE (TELECOMMUTE)", rec.rawWorkplaceType === "REMOTE", rec.rawWorkplaceType ?? "null");
  check("salary text IDR formatted", rec.rawSalaryText?.includes("12.000.000") === true && rec.rawSalaryText.includes("20.000.000"), rec.rawSalaryText ?? "null");
  check("sourceJobId js-job-12345678", rec.sourceJobId === "js-job-12345678", rec.sourceJobId);
  check("sourceUrl", rec.sourceUrl === "https://id.jobstreet.com/id/senior-frontend-developer-jobs-12345678");
  check("scrapedAt from datePosted", rec.scrapedAt.startsWith("2026-09-01"), rec.scrapedAt);
  check("publishedEmail null (on-site apply)", rec.publishedEmail === null);
}

console.log("=== mapJobStreetJob (minimal record) ===");
const rec2 = mapJobStreetJob(postings[1]);
check("not null", rec2 !== null);
if (rec2) {
  check("location from single-element array", rec2.rawLocation === "Bandung, JB", rec2.rawLocation ?? "null");
  check("sourceJobId from url tail", rec2.sourceJobId === "js-business-analyst-jobs-87654321", rec2.sourceJobId);
  check("salary null when absent", rec2.rawSalaryText === null);
  check("employmentType null when absent", rec2.rawEmploymentType === null);
}

console.log("=== mapJobStreetJob (no location → Indonesia fallback) ===");
const rec3 = mapJobStreetJob({ title: "QA Engineer", hiringOrganization: { name: "PT Minim Data" }, url: "https://id.jobstreet.com/id/qa-engineer-jobs-1" });
check("location fallback Indonesia", rec3?.rawLocation === "Indonesia", rec3?.rawLocation ?? "null");

console.log("=== mapJobStreetJob (invalid → null) ===");
check("missing url → null", mapJobStreetJob({ title: "X", hiringOrganization: { name: "Y" } }) === null);

console.log(failures === 0 ? "\nALL PARSER TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
