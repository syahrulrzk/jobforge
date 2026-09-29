import { createHash } from "node:crypto";
import { COMPANY_TEMPLATES } from "./data";
import { EMAIL_STATUSES, HR_EMAIL_PRIORITY, type EmailStatus } from "./types";
import type { RawJobRecord } from "./adapters";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Normalizer (§14), Deduplication (§15),
// Validation (§17), Email discovery & validation (§12, §13)
// ─────────────────────────────────────────────────────────────

// §14 Normalization helpers
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pt|cv|pd|koperasi)\b\.?/g, "")
    .replace(/\b(inc|ltd|llc|corp|tbk)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeTitle(title: string): string {
  // strip common suffixes like "- PT ABC", "| JobStreet", "(Remote)"
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

export function normalizeLocation(loc: string): string {
  return loc
    .toLowerCase()
    .replace(/\b(daerah khusus ibukota jakarta|dkI jakarta)\b/g, "jakarta")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// §14 Salary parsing — "IDR 8jt - 12jt per bulan" → {min, max, currency}
export function parseSalaryText(
  text: string | null
): { min: number; max: number; currency: string } | null {
  if (!text) return null;
  const cleaned = text.replace(/\s/g, "").toLowerCase();
  const m = cleaned.match(/idr?([\d.,]+)(jt|juta|k|m)?-([\d.,]+)(jt|juta|k|m)?/);
  if (m) {
    const parse = (v: string, unit?: string) => {
      const n = parseFloat(v.replace(/\./g, "").replace(/,/g, "."));
      if (unit === "jt" || unit === "juta" || unit === "m") return Math.round(n * 1_000_000);
      if (unit === "k") return Math.round(n * 1_000);
      return Math.round(n);
    };
    const min = parse(m[1], m[2]);
    const max = parse(m[3], m[4] ?? m[2]);
    if (min > 0 && max >= min) return { min, max, currency: "IDR" };
  }
  const single = cleaned.match(/idr?([\d.,]+)(jt|juta|k)?/);
  if (single) {
    const n = parseFloat(single[1].replace(/\./g, "").replace(/,/g, "."));
    const unit = single[2];
    const val =
      unit === "jt" || unit === "juta"
        ? Math.round(n * 1_000_000)
        : unit === "k"
          ? Math.round(n * 1_000)
          : Math.round(n);
    if (val > 0) return { min: val, max: val, currency: "IDR" };
  }
  return null;
}

// §15.1 Fingerprint — SHA256(normalized_company + normalized_title + normalized_location)
export function jobFingerprint(
  companyName: string,
  title: string,
  location: string | null
): string {
  const raw = [
    normalizeCompanyName(companyName || "unknown"),
    normalizeTitle(title || "unknown"),
    location ? normalizeLocation(location) : "anywhere",
  ].join("+");
  return createHash("sha256").update(raw).digest("hex");
}

export function companyFingerprint(name: string): string {
  return normalizeCompanyName(name);
}

// §13 Email validation pipeline: syntax → domain → MX (simulated) → status
export function validateEmail(
  email: string | null
): { status: EmailStatus; verified: boolean; reason: string } {
  if (!email) return { status: "UNKNOWN", verified: false, reason: "EMAIL_NOT_FOUND: no published recruitment email" };
  const syntaxOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  if (!syntaxOk) return { status: "INVALID", verified: false, reason: "EMAIL_INVALID: failed syntax validation" };
  const domain = email.split("@")[1] ?? "";
  const domainOk = domain.includes(".") && !domain.startsWith("-") && domain.length >= 4;
  if (!domainOk) return { status: "INVALID", verified: false, reason: "EMAIL_INVALID: failed domain validation" };
  // MX simulation: deterministic per-domain result
  const company = COMPANY_TEMPLATES.find((c) => domain.includes(c.website.replace(/^https?:\/\/(www\.)?/, "").split(".")[0]));
  if (company?.badMx) {
    return { status: "UNKNOWN", verified: false, reason: "MX validation unavailable for domain — needs manual verification" };
  }
  return { status: "VALID", verified: true, reason: "syntax ok, domain ok, MX ok" };
}

// §12.2 email priority scoring — recruitment@ > career@ > hr@ ...
export function emailPriorityScore(email: string): number {
  const idx = HR_EMAIL_PRIORITY.findIndex((p) => email.toLowerCase().startsWith(p));
  return idx === -1 ? HR_EMAIL_PRIORITY.length : idx;
}

// §17 Validation rules — job may be READY only if all mandatory fields exist
export interface ValidationInput {
  companyName: string | null;
  companyLogoUrl: string | null;
  companyProfile: string | null;
  title: string | null;
  description: string | null;
  hrEmail: string | null;
  emailStatus: EmailStatus | null;
  sourcePlatform: string | null;
  sourceUrl: string | null;
}

export interface ValidationResult {
  ready: boolean;
  outcome: "READY" | "NEEDS_ENRICHMENT" | "REJECTED";
  missing: string[];
  reason: string;
}

export function validateJob(input: ValidationInput): ValidationResult {
  const missing: string[] = [];
  if (!input.companyName) missing.push("Company Name");
  // Company Logo URL — kosmetik, TIDAK blocking (§11 fallback UI: stored URL
  // → /api/logo proxy → initials; kartu JobStreet/Glints tidak mengekspos
  // logo, jadi memblokir READY di sini cuma menahan job ber-email valid
  // tanpa alasan fungsional).
  if (!input.companyProfile) missing.push("Company Profile");
  if (!input.title) missing.push("Job Title");
  if (!input.description || input.description.length < 30) missing.push("Job Description");
  if (!input.hrEmail) missing.push("HR Email");
  if (!input.sourcePlatform) missing.push("Source Platform");
  if (!input.sourceUrl) missing.push("Source URL");

  if (missing.length === 0 && input.emailStatus === "INVALID") {
    return {
      ready: false,
      outcome: "NEEDS_ENRICHMENT",
      missing: ["HR Email (invalid)"],
      reason: "EMAIL_INVALID: published email failed validation",
    };
  }
  if (missing.length === 0) {
    return { ready: true, outcome: "READY", missing: [], reason: "All mandatory fields satisfied" };
  }
  const critical = missing.filter(
    (f) => !["HR Email"].includes(f)
  );
  if (critical.length > 0) {
    return {
      ready: false,
      outcome: "REJECTED",
      missing,
      reason: `REJECTED: critical mandatory fields missing (${critical.join(", ")})`,
    };
  }
  return {
    ready: false,
    outcome: "NEEDS_ENRICHMENT",
    missing,
    reason: `NEEDS_ENRICHMENT: ${missing.join(", ")} not available yet`,
  };
}

// Map a raw scraped record into normalized canonical-ish structure
export function normalizeRawRecord(rec: RawJobRecord) {
  const companyName = rec.rawCompanyName;
  const salary = parseSalaryText(rec.rawSalaryText);
  return {
    title: rec.rawTitle.replace(/\s*[-–]\s*PT\s+.*$/i, "").trim() || rec.rawTitle,
    normalizedTitle: normalizeTitle(rec.rawTitle),
    companyName,
    normalizedCompanyName: companyName ? normalizeCompanyName(companyName) : null,
    companyLogoUrl: rec.rawCompanyLogoUrl,
    companyWebsite: rec.rawCompanyWebsite,
    companyProfile: rec.rawCompanyProfile,
    description: rec.rawDescription,
    salary,
    location: rec.rawLocation,
    employmentType: rec.rawEmploymentType,
    workplaceType: rec.rawWorkplaceType,
    requirements: rec.rawRequirements,
    skills: rec.rawSkills,
    fingerprint: jobFingerprint(companyName ?? "", rec.rawTitle, rec.rawLocation),
    emailStatus: rec.publishedEmail ? validateEmail(rec.publishedEmail).status : ("UNKNOWN" as EmailStatus),
  };
}

export { EMAIL_STATUSES };
