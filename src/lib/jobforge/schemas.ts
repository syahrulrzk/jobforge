import { z } from "zod";

export const ENGINE_VALUES = ["cheerio", "crawlee", "puppeteer", "playwright", "selenium"] as const;
export const TYPE_VALUES = ["JOB_PORTAL", "CAREER_SITE", "PUBLIC_SOURCE"] as const;
export const SCRAPER_VALUES = ["STATIC", "DYNAMIC", "API"] as const;

/**
 * Terima nilai tunggal ATAU array dari UI — output CSV string.
 * Kolom DB (type / scraperType / engines) menyimpan CSV untuk multi-select (§9.3).
 */
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.array(z.enum(values)).min(1)])
    .transform((v) => (Array.isArray(v) ? v.join(",") : v));
}

export const sourceCreateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  baseUrl: z.string().url("Base URL must be a valid URL"),
  type: csvEnum(TYPE_VALUES),
  scraperType: csvEnum(SCRAPER_VALUES),
  schedule: z.enum(["hourly", "every_6_hours", "every_12_hours", "daily", "manual"]),
  // multi-engine per source — urutan array = urutan prioritas failover
  engines: z.array(z.enum(ENGINE_VALUES)).min(1, "Minimal satu engine harus dipilih").optional(),
  engine: z.enum(ENGINE_VALUES).optional(), // backward-compat single engine
});

export const sourceUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  baseUrl: z.string().url().optional(),
  type: csvEnum(TYPE_VALUES).optional(),
  scraperType: csvEnum(SCRAPER_VALUES).optional(),
  schedule: z.enum(["hourly", "every_6_hours", "every_12_hours", "daily", "manual"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ERROR"]).optional(),
  engines: z.array(z.enum(ENGINE_VALUES)).min(1, "Minimal satu engine harus dipilih").optional(),
  engine: z.enum(ENGINE_VALUES).optional(),
});
