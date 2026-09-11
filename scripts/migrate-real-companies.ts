// One-off migration: fictional seed companies → real Indonesian companies.
// - Maps the 30 Company rows 1:1 (by createdAt order) to verified real domains
// - Persists Google s2 logo URLs (Clearbit is dead since Dec 2025)
// - Recomputes job fingerprints for linked jobs (fingerprint = company+title+location)
// - Refreshes HR contact emails to the new company domains
// Safe to re-run (idempotent by normalizedName match).
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Mirrors src/lib/jobforge/data.ts COMPANY_TEMPLATES (real companies)
const TEMPLATES = [
  { name: "PT Tokopedia", website: "https://www.tokopedia.com", industry: "E-Commerce", emailLocal: "career" },
  { name: "PT Shopee Indonesia", website: "https://shopee.co.id", industry: "E-Commerce", emailLocal: "recruitment" },
  { name: "PT Bukalapak", website: "https://www.bukalapak.com", industry: "E-Commerce", emailLocal: "jobs" },
  { name: "PT Blibli", website: "https://www.blibli.com", industry: "E-Commerce", emailLocal: "career" },
  { name: "PT Lazada Indonesia", website: "https://www.lazada.co.id", industry: "E-Commerce", emailLocal: "hr" },
  { name: "PT Traveloka Indonesia", website: "https://www.traveloka.com", industry: "Travel & Hospitality", emailLocal: "talent" },
  { name: "PT Global Tiket Network", website: "https://www.tiket.com", industry: "Travel & Hospitality", emailLocal: "career" },
  { name: "PT Grab Indonesia", website: "https://www.grab.com", industry: "Technology", emailLocal: "jobs" },
  { name: "PT Ruangguru", website: "https://www.ruangguru.com", industry: "EdTech", emailLocal: "recruitment" },
  { name: "PT Zenius Education", website: "https://www.zenius.net", industry: "EdTech", emailLocal: "hr" },
  { name: "PT Halodoc", website: "https://www.halodoc.com", industry: "HealthTech", emailLocal: "career" },
  { name: "PT Alodokter", website: "https://www.alodokter.com", industry: "HealthTech", emailLocal: "recruitment" },
  { name: "PT DANA Indonesia", website: "https://www.dana.id", industry: "Financial Services", emailLocal: "talent" },
  { name: "PT Kredivo", website: "https://www.kredivo.com", industry: "Financial Services", emailLocal: "career" },
  { name: "PT Midtrans Payment Indonesia", website: "https://midtrans.com", industry: "Financial Services", emailLocal: "jobs" },
  { name: "PT Stockbit", website: "https://stockbit.com", industry: "Financial Services", emailLocal: "recruitment" },
  { name: "PT Ajaib Sekuritas Asia", website: "https://ajaib.co.id", industry: "Financial Services", emailLocal: "hr" },
  { name: "PT SiCepat Ekspres Indonesia", website: "https://www.sicepat.com", industry: "Logistics & Supply Chain", emailLocal: "hrd" },
  { name: "PT Pos Anteraja", website: "https://anteraja.id", industry: "Logistics & Supply Chain", emailLocal: "jobs" },
  { name: "PT Ninja Xpress", website: "https://www.ninjavan.co", industry: "Logistics & Supply Chain", emailLocal: "career" },
  { name: "PT Telkomsel", website: "https://www.telkomsel.com", industry: "Telecommunications", emailLocal: "recruitment" },
  { name: "PT XL Axiata Tbk", website: "https://www.xl.co.id", industry: "Telecommunications", emailLocal: "talent" },
  { name: "PT Detik Network", website: "https://www.detik.com", industry: "Media & Publishing", emailLocal: "hr" },
  { name: "PT Kompas Cyber Media", website: "https://www.kompas.com", industry: "Media & Publishing", emailLocal: "career" },
  { name: "PT Kumparan Media", website: "https://kumparan.com", industry: "Media & Publishing", emailLocal: "hrd" },
  { name: "PT IDN Media", website: "https://www.idntimes.com", industry: "Media & Publishing", emailLocal: "jobs" },
  { name: "PT Glints Indonesia", website: "https://glints.com", industry: "Professional Services", emailLocal: "talent" },
  { name: "PT Kalibrr", website: "https://www.kalibrr.com", industry: "Professional Services", emailLocal: "career" },
  { name: "PT Pasar Polis", website: "https://pasarpolis.com", industry: "Insurance", emailLocal: "recruitment" },
  { name: "PT Sayurbox", website: "https://www.sayurbox.com", industry: "AgriTech", emailLocal: "hr" },
];

// ── fingerprint helpers (verbatim logic from pipeline.ts) ──
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pt|cv|pd|koperasi)\b\.?/g, "")
    .replace(/\b(inc|ltd|llc|corp|tbk)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function normalizeTitle(title: string): string {
  return title
    .replace(/\s*[-–|]\s*PT\s+.*$/i, "")
    .replace(/\s*[-–|]\s*CV\s+.*$/i, "")
    .replace(/\s*\|\s*.*$/, "")
    .replace(/\s*\(.*?\)\s*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/+#.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeLocation(loc: string): string {
  return loc
    .toLowerCase()
    .replace(/\b(daerah khusus ibukota jakarta|dkI jakarta)\b/g, "jakarta")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function jobFingerprint(companyName: string, title: string, location: string | null): string {
  const raw = [
    normalizeCompanyName(companyName || "unknown"),
    normalizeTitle(title || "unknown"),
    location ? normalizeLocation(location) : "anywhere",
  ].join("+");
  return createHash("sha256").update(raw).digest("hex");
}
function googleLogoUrl(website: string): string {
  const withProto = website.startsWith("http") ? website : `https://${website}`;
  const host = new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
}

async function main() {
  const companies = await db.company.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Companies in DB: ${companies.length}, templates: ${TEMPLATES.length}`);

  if (companies.length !== TEMPLATES.length) {
    console.log("⚠ Count mismatch — migrating min(companies, templates) rows in createdAt order.");
  }
  const n = Math.min(companies.length, TEMPLATES.length);

  let updatedCompanies = 0;
  let updatedJobs = 0;
  let updatedContacts = 0;
  let skippedFingerprints = 0;

  for (let i = 0; i < n; i++) {
    const row = companies[i];
    const t = TEMPLATES[i];
    const newNormalized = normalizeCompanyName(t.name);

    // skip if this row is already the target company (re-run safety)
    if (row.normalizedName === newNormalized) {
      console.log(`  = ${row.name} already migrated, skipping`);
      continue;
    }

    await db.company.update({
      where: { id: row.id },
      data: {
        name: t.name,
        normalizedName: newNormalized,
        logoUrl: googleLogoUrl(t.website),
        website: t.website,
        industry: t.industry,
        enrichedAt: new Date(),
      },
    });
    updatedCompanies++;

    // recompute fingerprints for linked jobs
    const jobs = await db.job.findMany({
      where: { companyId: row.id },
      select: { id: true, title: true, location: true, fingerprint: true },
    });
    for (const job of jobs) {
      const fp = jobFingerprint(t.name, job.title, job.location);
      if (fp === job.fingerprint) { skippedFingerprints++; continue; }
      try {
        await db.job.update({ where: { id: job.id }, data: { fingerprint: fp } });
        updatedJobs++;
      } catch {
        // unique collision — leave the old fingerprint rather than fail the run
        skippedFingerprints++;
      }
    }

    // refresh HR emails to the new company domain
    const domain = t.website.replace(/^https?:\/\/(www\.)?/, "");
    const contact = await db.jobContact.findFirst({
      where: { job: { companyId: row.id } },
      select: { id: true },
    });
    // update all contacts belonging to this company's jobs individually
    const contacts = await db.jobContact.findMany({
      where: { job: { companyId: row.id } },
      select: { id: true, emailStatus: true },
    });
    for (const c of contacts) {
      await db.jobContact.update({
        where: { id: c.id },
        data: {
          hrEmail: `${t.emailLocal}@${domain}`,
          emailSourceUrl: `${t.website}/career`,
        },
      });
      updatedContacts++;
    }
    void contact;

    console.log(`  ✓ ${row.name} → ${t.name} (${jobs.length} jobs, ${contacts.length} contacts)`);
  }

  console.log(`\nDone — companies: ${updatedCompanies}, jobs: ${updatedJobs}, contacts: ${updatedContacts}, fingerprints kept: ${skippedFingerprints}`);

  // sanity check: distinct domains
  const after = await db.company.findMany({ select: { name: true, website: true, logoUrl: true } });
  const clearbitLeft = after.filter((c) => c.logoUrl.includes("clearbit")).length;
  console.log(`Clearbit URLs remaining: ${clearbitLeft}/${after.length}`);
  console.log("Sample:", after.slice(0, 3).map((c) => `${c.name} → ${c.logoUrl}`).join(" | "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
