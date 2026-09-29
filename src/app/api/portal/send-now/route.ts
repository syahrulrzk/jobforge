import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { sendReadyJobsToPortal, countReadyJobsForPortal } from "@/lib/jobforge/engine";

export const dynamic = "force-dynamic";

// GET /api/portal/send-now — jumlah job READY yang siap dikirim ke portal.
// Preview untuk kartu "Kirim ke portal" di Portal Settings.
export async function GET() {
  await ensureBootstrap();
  try {
    const ready = await countReadyJobsForPortal();
    return NextResponse.json({ ready });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menghitung job siap kirim" },
      { status: 500 }
    );
  }
}

// POST /api/portal/send-now — kirim manual semua job READY ke portal (PRD §31
// dashboard actions). Sama seperti jalur otomatis deliverReadyJobs(): antrekan
// job READY yang lolos pre-flight, lalu flush dalam satu panggilan.
export async function POST() {
  await ensureBootstrap();
  try {
    const result = await sendReadyJobsToPortal();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send to portal failed" },
      { status: 500 }
    );
  }
}
