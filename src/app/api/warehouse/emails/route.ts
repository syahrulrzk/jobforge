import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Gudang Data Email — SEMUA email dalam satu tabel:
//   1. HarvestedContact — hasil Domain Search / harvest internet
//   2. JobContact       — email HR dari pipeline scrape/enrichment
// Digabung + dedupe by email. Email HR dapat flag isHr + label
// "Email HR". Search, filter kind/domain, dan pagination diterapkan
// pada hasil gabungan — stats (total email/domain/HR) dihitung dari
// SEMUA data, bukan cuma hasil filter.
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;

  const q = sp.get("q")?.trim().toLowerCase() ?? "";
  const domain = sp.get("domain")?.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() ?? "";
  const kind = sp.get("kind")?.trim() ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("pageSize") ?? "50") || 50));

  interface MergedRow {
    email: string;
    kind: string;
    category: string | null;
    via: string;
    domain: string;
    sourceUrl: string | null;
    sourcesCount: number;
    companyName: string | null;
    companyWebsite: string | null;
    isHr: boolean;
    createdAt: Date;
  }

  const emailDomain = (email: string): string => email.split("@")[1]?.toLowerCase() ?? "";

  // ── Ambil SEMUA data (tanpa filter) — filter di JS setelah merge ──
  const [harvested, hrContacts] = await Promise.all([
    db.harvestedContact.findMany({
      orderBy: { createdAt: "desc" },
      include: { company: { select: { name: true, website: true } } },
    }),
    db.jobContact.findMany({
      orderBy: { createdAt: "desc" },
      include: { job: { select: { companyName: true, company: { select: { name: true, website: true } } } } },
    }),
  ]);

  // ── Merge + dedupe by email (HR duluan supaya label "Email HR" menang) ──
  const merged = new Map<string, MergedRow>();
  for (const h of harvested) {
    merged.set(h.email.toLowerCase(), {
      email: h.email,
      kind: h.kind,
      category: h.category,
      via: h.via,
      domain: h.domain.toLowerCase(),
      sourceUrl: h.sourceUrl,
      sourcesCount: (() => {
        try {
          const parsed = JSON.parse(h.sourcesJson) as unknown;
          return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string").length : 0;
        } catch {
          return 0;
        }
      })(),
      companyName: h.company?.name ?? null,
      companyWebsite: h.company?.website ?? null,
      isHr: false,
      createdAt: h.createdAt,
    });
  }
  for (const c of hrContacts) {
    const key = c.hrEmail.toLowerCase();
    const existing = merged.get(key);
    const companyName = c.job.company?.name ?? c.job.companyName ?? null;
    const companyWebsite = c.job.company?.website ?? null;
    if (existing) {
      // email sama ada di kedua sumber — tandai sebagai HR juga
      existing.isHr = true;
      if (!existing.companyName) {
        existing.companyName = companyName;
        existing.companyWebsite = companyWebsite;
      }
    } else {
      merged.set(key, {
        email: c.hrEmail,
        kind: "hr",
        category: "Email HR",
        via: "pipeline",
        domain: emailDomain(c.hrEmail),
        sourceUrl: c.emailSourceUrl,
        sourcesCount: 0,
        companyName,
        companyWebsite,
        isHr: true,
        createdAt: c.createdAt,
      });
    }
  }

  const all = [...merged.values()].sort((a, b) => {
    if (a.isHr !== b.isHr) return a.isHr ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // ── Stats dari SEMUA data gabungan (bukan hasil filter) ──
  const totalEmails = all.length;
  const totalDomains = new Set(all.map((r) => r.domain).filter(Boolean)).size;
  const totalHr = all.filter((r) => r.isHr).length;

  // ── Filter di hasil gabungan ──
  const filtered = all.filter((r) => {
    if (q && !r.email.toLowerCase().includes(q) && !r.domain.includes(q) && !(r.companyName ?? "").toLowerCase().includes(q)) return false;
    if (domain && r.domain !== domain && !r.domain.endsWith(`.${domain}`)) return false;
    if ((kind === "role" || kind === "personal" || kind === "unknown" || kind === "hr") && r.kind !== kind) return false;
    return true;
  });

  return NextResponse.json({
    total: filtered.length,
    page,
    pageSize,
    warehouse: {
      totalEmails,
      totalDomains,
      totalHr,
    },
    emails: filtered.slice((page - 1) * pageSize, page * pageSize).map((h) => ({
      ...h,
      createdAt: h.createdAt,
    })),
  });
}
