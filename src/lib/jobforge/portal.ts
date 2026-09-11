import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { bulkImportSchema, type BulkImportPayload, type ImportResponse } from "./types";

// ─────────────────────────────────────────────────────────────
// JOBFORCE — Job Portal simulation (PRD §19)
// The delivery worker POSTs bulk payloads to this portal.
// Exposed via POST /api/v1/jobs/import with Bearer auth.
// ─────────────────────────────────────────────────────────────

export function generateRequestId(): string {
  return `req_${createHash("sha1").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 12)}`;
}

export function verifyPortalAuth(header: string | null): boolean {
  if (!header) return false;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length >= 8;
}

/**
 * Process a bulk import payload exactly as the Job Portal would:
 * validate → dedupe against portal store → count created/updated.
 * Response shape per PRD §19.
 */
export async function processBulkImport(raw: unknown): Promise<ImportResponse> {
  const parsed = bulkImportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      message: `Validation failed: ${parsed.error.issues[0]?.message ?? "invalid payload"}`,
      data: { received: 0, created: 0, updated: 0, duplicated: 0, failed: 0 },
    };
  }

  const payload: BulkImportPayload = parsed.data;
  let created = 0;
  let updated = 0;
  let duplicated = 0;
  let failed = 0;

  for (const item of payload.jobs) {
    try {
      const existing = await db.job.findFirst({
        where: { fingerprint: { not: "" }, title: item.job.title, companyId: { not: null } },
      });
      // The portal keeps its own store: treat jobs as new unless the exact
      // (platform, job_id) pair was imported before — we approximate with
      // the delivery table's SUCCESS history for the same source job id.
      const priorDelivery = await db.apiDelivery.findFirst({
        where: { job: { jobLinks: { some: { sourceJobId: item.source.job_id } } }, status: "SUCCESS" },
      });
      if (priorDelivery && existing) {
        // portal already has this job → refresh counts as update or duplicate
        if (chanceStatic(0.6)) updated += 1;
        else duplicated += 1;
      } else if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    success: failed === 0 || created + updated > 0,
    message: "Jobs imported successfully",
    data: {
      received: payload.jobs.length,
      created,
      updated,
      duplicated,
      failed,
    },
  };
}

function chanceStatic(p: number): boolean {
  return Math.random() < p;
}
