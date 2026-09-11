import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { retryDelivery } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// GET /api/deliveries — API delivery tracking (PRD §33)
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  const status = sp.get("status") ?? "";

  const where = status ? { status } : {};

  const [total, deliveries, stats] = await Promise.all([
    db.apiDelivery.count({ where }),
    db.apiDelivery.findMany({
      where,
      include: {
        job: { select: { id: true, title: true, status: true, company: { select: { name: true, logoUrl: true, website: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.apiDelivery.groupBy({ by: ["status"], _count: { status: true } }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    stats: {
      SUCCESS: stats.find((s) => s.status === "SUCCESS")?._count.status ?? 0,
      FAILED: stats.find((s) => s.status === "FAILED")?._count.status ?? 0,
      PENDING: stats.find((s) => s.status === "PENDING")?._count.status ?? 0,
      SENDING: stats.find((s) => s.status === "SENDING")?._count.status ?? 0,
    },
    deliveries: deliveries.map((d) => ({
      id: d.id,
      requestId: d.requestId,
      job: d.job,
      endpoint: d.endpoint,
      attempt: d.attempt,
      maxAttempts: d.maxAttempts,
      status: d.status,
      responseCode: d.responseCode,
      responseBody: d.responseBody,
      createdAt: d.createdAt,
      deliveredAt: d.deliveredAt,
    })),
  });
}

// POST /api/deliveries — retry a failed delivery (PRD §21)
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "Missing delivery id" }, { status: 422 });
  }
  try {
    await retryDelivery(id);
    return NextResponse.json({ ok: true, message: "Delivery queued for retry" });
  } catch {
    return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
  }
}
