import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Canonical Job Schema (PRD §7) + Zod validation
// ─────────────────────────────────────────────────────────────

export const JOB_STATUSES = [
  "SCRAPED",
  "PROCESSING",
  "ENRICHING",
  "VALIDATING",
  "READY",
  "SENT",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
  "NEEDS_ENRICHMENT",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SOURCE_STATUSES = ["ACTIVE", "INACTIVE", "ERROR"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SCRAPER_TYPES = ["STATIC", "DYNAMIC", "API"] as const;
export type ScraperType = (typeof SCRAPER_TYPES)[number];

export const SOURCE_TYPES = ["JOB_PORTAL", "CAREER_SITE", "PUBLIC_SOURCE"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SCHEDULES = ["hourly", "every_6_hours", "every_12_hours", "daily", "manual"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export const ERROR_TYPES = [
  "NETWORK_ERROR",
  "TIMEOUT",
  "PARSER_ERROR",
  "SOURCE_ERROR",
  "SOURCE_BLOCKED",
  "INVALID_DATA",
  "EMAIL_NOT_FOUND",
  "EMAIL_INVALID",
  "API_ERROR",
  "DATABASE_ERROR",
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const DELIVERY_STATUSES = ["PENDING", "SENDING", "SUCCESS", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const EMAIL_STATUSES = ["VALID", "INVALID", "UNKNOWN"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

// §16 Job Lifecycle — transition map
export const LIFECYCLE_FLOW: Record<string, JobStatus[]> = {
  SCRAPED: ["PROCESSING"],
  PROCESSING: ["ENRICHING"],
  ENRICHING: ["VALIDATING"],
  VALIDATING: ["READY", "NEEDS_ENRICHMENT", "REJECTED"],
  READY: ["SENT"],
  SENT: ["PUBLISHED"],
};

// §7 Canonical Job JSON payload
export const canonicalJobSchema = z.object({
  source: z.object({
    platform: z.string(),
    job_id: z.string(),
    url: z.string().url(),
  }),
  company: z.object({
    name: z.string().min(1),
    // logo_url WAJIB (§11): resolveLogoUrl dijamin mengembalikan sesuatu —
    // favicon provider (website/nama→domain) atau badge SVG deterministik.
    // JobStreet/Glints tidak ekspos logo, tapi di-resolve via nama→domain.
    logo_url: z.string().min(1),
    website: z.string().url().optional().nullable(),
    profile: z.string().min(1),
  }),
  job: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    salary: z
      .object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        currency: z.string(),
      })
      .nullable(),
    location: z.string().optional().nullable(),
    employment_type: z.string().optional().nullable(),
    workplace_type: z.string().optional().nullable(),
    requirements: z.array(z.string()).optional().nullable(),
    skills: z.array(z.string()).optional().nullable(),
  }),
  contact: z.object({
    hr_email: z.string().email(),
    email_source: z.string().url().optional().nullable(),
    email_verified: z.boolean(),
  }),
  metadata: z.object({
    scraped_at: z.string(),
  }),
});
export type CanonicalJob = z.infer<typeof canonicalJobSchema>;

// §19 Bulk import payload
export const bulkImportSchema = z.object({
  source: z.string().min(1),
  scraped_at: z.string(),
  jobs: z.array(canonicalJobSchema).min(1).max(500),
});
export type BulkImportPayload = z.infer<typeof bulkImportSchema>;

// §19 API Response shape
export interface ImportResponse {
  success: boolean;
  message: string;
  data: {
    received: number;
    created: number;
    updated: number;
    duplicated: number;
    failed: number;
  };
}

// §17 Validation Rules — mandatory fields
export const MANDATORY_FIELDS = [
  "Company Name",
  "Company Logo URL",
  "Company Profile",
  "Job Title",
  "Job Description",
  "HR Email",
  "Source Platform",
  "Source URL",
] as const;

// §12.2 HR email priority patterns
export const HR_EMAIL_PRIORITY = [
  "recruitment@",
  "career@",
  "careers@",
  "hr@",
  "hrd@",
  "talent@",
  "jobs@",
  "karir@",
];

export const DELIVERY_ENDPOINT = "/api/v1/jobs/import";

// Engine settings keys (§23, §37)
export const SETTING_KEYS = {
  portalApiUrl: "JOB_PORTAL_API_URL",
  portalApiKey: "JOB_PORTAL_API_KEY",
  batchSize: "BATCH_SIZE",
  maxAttempts: "MAX_ATTEMPTS",
  autoScrape: "AUTO_SCRAPE",
  autoDelivery: "AUTO_DELIVERY",
  tickIntervalMs: "TICK_INTERVAL_MS",
  demoJobCap: "DEMO_JOB_CAP",
  dataMode: "DATA_MODE", // real | mock — live public job APIs vs simulation generator
  enginePool: "ENGINE_POOL", // CSV of active engines: cheerio,crawlee,puppeteer,playwright,selenium
} as const;
