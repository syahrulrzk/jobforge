import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// GET /api/contacts — HR contacts listing (PRD §12, §27)
export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  const q = sp.get("q")?.trim() ?? "";
  const status = sp.get("status") ?? "";

  const where: Record<string, unknown> = {};
  if (q) where.hrEmail = { contains: q };
  if (status) where.emailStatus = status;

  const [total, contacts] = await Promise.all([
    db.jobContact.count({ where }),
    db.jobContact.findMany({
      where,
      include: {
        job: {
          select: {
            id: true,
            title: true,
            status: true,
            company: { select: { id: true, name: true, logoUrl: true, website: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const stats = await db.jobContact.groupBy({ by: ["emailStatus"], _count: { emailStatus: true } });

  return NextResponse.json({
    total,
    page,
    pageSize,
    stats: {
      VALID: stats.find((s) => s.emailStatus === "VALID")?._count.emailStatus ?? 0,
      INVALID: stats.find((s) => s.emailStatus === "INVALID")?._count.emailStatus ?? 0,
      UNKNOWN: stats.find((s) => s.emailStatus === "UNKNOWN")?._count.emailStatus ?? 0,
    },
    contacts: contacts.map((c) => ({
      id: c.id,
      hrEmail: c.hrEmail,
      emailSourceUrl: c.emailSourceUrl,
      emailVerified: c.emailVerified,
      emailStatus: c.emailStatus,
      job: c.job,
    })),
  });
}
