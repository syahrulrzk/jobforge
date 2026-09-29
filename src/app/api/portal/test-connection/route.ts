import { NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { db } from "@/lib/db";
import { SETTING_KEYS } from "@/lib/jobforge/types";

export const dynamic = "force-dynamic";

// POST /api/portal/test-connection — ping portal tujuan (mis. Karivia)
// dengan payload canonical dummy. TIDAK menyentuh tabel job/delivery apapun:
// responsnya cuma dilaporkan ke UI. Dipanggil dari Portal Settings.
export async function POST() {
  await ensureBootstrap();

  const rows = await db.setting.findMany();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const url = (map[SETTING_KEYS.portalApiUrl] ?? "").trim();
  const apiKey = (map[SETTING_KEYS.portalApiKey] ?? "").trim();

  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        code: null,
        latencyMs: 0,
        body: "JOB_PORTAL_API_URL belum diisi — isi endpoint portal dulu sebelum test.",
      },
      { status: 200 }
    );
  }

  // Payload dummy sesuai canonicalJobSchema (§7) — bentuknya identik dengan
  // yang dikirim delivery worker, jadi test connection = uji kontrak penuh.
  // Kalau portal memvalidasi dedup key, test ini berpotensi membuat 1 record
  // dummy di portal tujuan — itu efek samping yang wajar dari test asli.
  const payload = {
    source: {
      platform: "jobforge-test",
      job_id: `test_${Date.now()}`,
      url: "https://example.com/job/test-connection",
    },
    company: {
      name: "JobForge Connection Test",
      logo_url: "https://example.com/favicon.ico",
      website: "https://example.com",
      profile: "Payload dummy dari tombol Test Connection — aman diabaikan/dihapus.",
    },
    job: {
      title: "[TEST] JobForge Connection Test",
      description:
        "Ini payload uji koneksi dari JobForge. Bila Anda melihat job ini di sisi portal, koneksi & kontrak payload sudah benar.",
      salary: null,
      location: "Jakarta",
      employment_type: "Full-time",
      workplace_type: "Onsite",
      requirements: ["Test connection"],
      skills: ["test"],
    },
    contact: {
      hr_email: "recruitment@example.com",
      email_source: null,
      email_verified: false,
    },
    metadata: {
      scraped_at: new Date().toISOString(),
    },
  };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    const latencyMs = Date.now() - started;
    const ok = res.status === 200 || res.status === 201;
    return NextResponse.json({ ok, code: res.status, latencyMs, body: text }, { status: 200 });
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      {
        ok: false,
        code: null,
        latencyMs,
        body: aborted
          ? `Timeout — tidak ada respons dalam 15 detik dari ${url}`
          : `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(timer);
  }
}
