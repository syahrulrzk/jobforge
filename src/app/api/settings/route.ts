import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { SETTING_KEYS } from "@/lib/jobforge/types";
import { DEFAULT_ENGINE_POOL, ENGINE_KEYS } from "@/lib/jobforge/engines";

export const dynamic = "force-dynamic";

// GET /api/settings — dashboard settings (PRD §27 Settings, §37)
export async function GET() {
  await ensureBootstrap();
  const rows = await db.setting.findMany();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  // mask API key for the client (§37 secret handling)
  const key = map[SETTING_KEYS.portalApiKey] ?? "";
  const masked = key.length > 8 ? `${key.slice(0, 8)}${"•".repeat(Math.max(4, key.length - 8))}` : "••••••••";
  return NextResponse.json({
    settings: {
      portalApiUrl: map[SETTING_KEYS.portalApiUrl] ?? "",
      portalApiKeyMasked: masked,
      batchSize: map[SETTING_KEYS.batchSize] ?? "25",
      maxAttempts: map[SETTING_KEYS.maxAttempts] ?? "3",
      autoScrape: map[SETTING_KEYS.autoScrape] !== "false",
      autoDelivery: map[SETTING_KEYS.autoDelivery] !== "false",
      tickIntervalMs: map[SETTING_KEYS.tickIntervalMs] ?? "5000",
      demoJobCap: map[SETTING_KEYS.demoJobCap] ?? "800",
      dataMode: map[SETTING_KEYS.dataMode] ?? "real",
      enginePool: map[SETTING_KEYS.enginePool] ?? DEFAULT_ENGINE_POOL.join(","),
    },
  });
}

// PUT /api/settings — update settings
export async function PUT(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 422 });
  }
  const updates: [string, string][] = [];
  const b = body as Record<string, unknown>;
  if (typeof b.portalApiUrl === "string") updates.push([SETTING_KEYS.portalApiUrl, b.portalApiUrl]);
  if (typeof b.portalApiKey === "string" && b.portalApiKey.length >= 8 && !b.portalApiKey.includes("•")) {
    updates.push([SETTING_KEYS.portalApiKey, b.portalApiKey]);
  }
  if (b.batchSize !== undefined) updates.push([SETTING_KEYS.batchSize, String(Math.min(500, Math.max(1, parseInt(String(b.batchSize), 10) || 25)))]);
  if (b.maxAttempts !== undefined) updates.push([SETTING_KEYS.maxAttempts, String(Math.min(10, Math.max(1, parseInt(String(b.maxAttempts), 10) || 3)))]);
  if (b.autoScrape !== undefined) updates.push([SETTING_KEYS.autoScrape, String(Boolean(b.autoScrape))]);
  if (b.autoDelivery !== undefined) updates.push([SETTING_KEYS.autoDelivery, String(Boolean(b.autoDelivery))]);
  if (b.tickIntervalMs !== undefined) updates.push([SETTING_KEYS.tickIntervalMs, String(Math.min(60000, Math.max(2000, parseInt(String(b.tickIntervalMs), 10) || 5000)))]);
  if (b.demoJobCap !== undefined) updates.push([SETTING_KEYS.demoJobCap, String(Math.min(5000, Math.max(100, parseInt(String(b.demoJobCap), 10) || 800)))]);
  if (b.dataMode !== undefined) updates.push([SETTING_KEYS.dataMode, b.dataMode === "mock" ? "mock" : "real"]);
  if (b.enginePool !== undefined) {
    const requested = String(b.enginePool)
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => (ENGINE_KEYS as string[]).includes(k));
    updates.push([SETTING_KEYS.enginePool, requested.length > 0 ? requested.join(",") : DEFAULT_ENGINE_POOL.join(",")]);
  }

  for (const [key, value] of updates) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  return NextResponse.json({ ok: true, updated: updates.length });
}
