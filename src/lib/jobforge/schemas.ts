import { z } from "zod";

export const sourceCreateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  baseUrl: z.string().url("Base URL must be a valid URL"),
  type: z.enum(["JOB_PORTAL", "CAREER_SITE", "PUBLIC_SOURCE"]),
  scraperType: z.enum(["STATIC", "DYNAMIC", "API"]),
  schedule: z.enum(["hourly", "every_6_hours", "every_12_hours", "daily", "manual"]),
});

export const sourceUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  baseUrl: z.string().url().optional(),
  type: z.enum(["JOB_PORTAL", "CAREER_SITE", "PUBLIC_SOURCE"]).optional(),
  scraperType: z.enum(["STATIC", "DYNAMIC", "API"]).optional(),
  schedule: z.enum(["hourly", "every_6_hours", "every_12_hours", "daily", "manual"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ERROR"]).optional(),
});
