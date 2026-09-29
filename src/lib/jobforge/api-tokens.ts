import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// API Consumer Token (§19b) — auth Bearer untuk pull endpoint
// GET /api/v1/jobs/pull. Raw token HANYA terlihat sekali di
// response create; DB menyimpan SHA256 hash + prefix 12 char
// untuk identifikasi di UI (pola GitHub/Stripe).
// ─────────────────────────────────────────────────────────────

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiToken(): { raw: string; hash: string; prefix: string } {
  const raw = `jfk_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, 12) };
}

export type ApiTokenPrincipal = {
  id: string;
  name: string;
  pullCount: number;
};

/** Verifikasi header Authorization Bearer → token ACTIVE atau null. */
export async function verifyApiToken(header: string | null): Promise<ApiTokenPrincipal | null> {
  if (!header) return null;
  const raw = header.replace(/^Bearer\s+/i, "").trim();
  if (raw.length < 8) return null;
  const row = await db.apiToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!row || row.status !== "ACTIVE") return null;
  // last-used best-effort (jangan pernah gagalkan request karena audit)
  await db.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { id: row.id, name: row.name, pullCount: row.pullCount };
}
