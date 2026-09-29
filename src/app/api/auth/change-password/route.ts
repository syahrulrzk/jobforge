import { NextResponse } from "next/server";
import { changePassword } from "@/lib/jobforge/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/change-password — ganti password user dashboard.
// Body: { currentPassword, newPassword }
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const result = await changePassword(body.currentPassword ?? "", body.newPassword ?? "");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal mengganti password" },
      { status: 500 }
    );
  }
}
