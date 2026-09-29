import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { generateApiToken } from "@/lib/jobforge/api-tokens";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// /api/tokens — manajemen API Consumer Token (§19b)
// Token dipakai consumer sebagai Bearer auth untuk
// GET /api/v1/jobs/pull.
// ─────────────────────────────────────────────────────────────

// GET — daftar token (tanpa raw/hash — cuma prefix + metadata)
export async function GET() {
  await ensureBootstrap();
  const tokens = await db.apiToken.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      status: true,
      lastUsedAt: true,
      pullCount: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  return NextResponse.json({ tokens });
}

// POST — buat token baru. Raw token hanya dikembalikan SEKALI di sini.
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return NextResponse.json({ error: "Nama token minimal 2 karakter" }, { status: 422 });
  }
  const { raw, hash, prefix } = generateApiToken();
  const row = await db.apiToken.create({
    data: { name, tokenHash: hash, tokenPrefix: prefix },
    select: { id: true, name: true, tokenPrefix: true, status: true, createdAt: true },
  });
  return NextResponse.json({ token: row, raw }, { status: 201 });
}

// PATCH — edit token: { id, name? } ganti label
export async function PATCH(req: NextRequest) {
  await ensureBootstrap();
  const body = (await req.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "Nama token minimal 2 karakter" }, { status: 422 });
  const existing = await db.apiToken.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Token tidak ditemukan" }, { status: 404 });
  const updated = await db.apiToken.update({
    where: { id },
    data: { name },
    select: { id: true, name: true, tokenPrefix: true, status: true },
  });
  return NextResponse.json({ token: updated });
}

// DELETE ?id= — revoke token aktif (soft), atau ?purge=1 untuk hard delete
// permanen beserta riwayat pull-nya.
export async function DELETE(req: NextRequest) {
  await ensureBootstrap();
  const id = req.nextUrl.searchParams.get("id");
  const purge = req.nextUrl.searchParams.get("purge") === "1";
  if (!id) return NextResponse.json({ error: "Parameter id wajib" }, { status: 400 });
  const existing = await db.apiToken.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Token tidak ditemukan" }, { status: 404 });

  if (purge) {
    // hard delete — ApiPullLog ikut terhapus (onDelete: Cascade)
    await db.apiToken.delete({ where: { id } });
    return NextResponse.json({ ok: true, purged: true });
  }

  if (existing.status === "REVOKED") {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }
  await db.apiToken.update({
    where: { id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
