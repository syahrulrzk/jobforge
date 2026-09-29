import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Tools — Cari Orang & Jabatan
//
// GET /api/search/people?role=hr&company=abc&domain=abc.co.id
//
// Mencari orang/kontak per jabatan (HR Manager, Talent Acquisition,
// Recruitment Lead, dst). Sumber data = email HR yang benar-benar
// ter-publish dan tersimpan di JobContact (§12) — TIDAK ada nama yang
// ditebak atau profil yang dikonstruksi (§12.4).
//
// Jabatan diinferensi dari prefix email (hr@, talent@, recruitment@ …)
// + konteks pekerjaan yang terkait. Nama pribadi hanya ditampilkan bila
// pola email-nya jelas nama (firstname.lastname@) — dan ditandai
// "inferred", bukan terverifikasi.
// ─────────────────────────────────────────────────────────────

/** Pola prefix email → jabatan yang bisa disimpulkan secara jujur. */
const ROLE_MAP: { re: RegExp; role: string }[] = [
  { re: /^hrd([.\-_]|@|$)/i, role: "HRD" },
  { re: /^hr([.\-_]|@|$)/i, role: "HR" },
  { re: /^(recruitment|recruit|rekrutmen)([.\-_]|@|$)/i, role: "Recruitment" },
  { re: /^(talent|ta)([.\-_]|@|$)/i, role: "Talent Acquisition" },
  { re: /^(career|careers|karir|karier)([.\-_]|@|$)/i, role: "Careers" },
  { re: /^(jobs?|loker|lowongan)([.\-_]|@|$)/i, role: "Jobs" },
  { re: /^(people|peopleops|peopleops|poc)([.\-_]|@|$)/i, role: "People Ops" },
  { re: /^(ga|generalaffairs)([.\-_]|@|$)/i, role: "General Affairs" },
];

function inferRole(local: string): string {
  for (const { re, role } of ROLE_MAP) if (re.test(local)) return role;
  return "Kontak Perusahaan";
}

/** Nama pribadi hanya bila pola email jelas nama — ditandai inferred. */
function inferPersonName(local: string): { name: string; inferred: true } | null {
  // firstname.lastname@ / firstlast@ (min 2 bagian huruf, bukan kata role)
  if (ROLE_MAP.some(({ re }) => re.test(local))) return null;
  const parts = local.split(/[._\-]/).filter((p) => /^[a-z]+$/i.test(p));
  if (parts.length < 2 || parts.some((p) => p.length < 2)) return null;
  const name = parts
    .slice(0, 2)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return { name, inferred: true };
}

export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const role = sp.get("role")?.trim() ?? "";
  const company = sp.get("company")?.trim() ?? "";
  const domain = (sp.get("domain") ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(60, Math.max(6, parseInt(sp.get("pageSize") ?? "12", 10) || 12));

  if (!role && !company && !domain) {
    return NextResponse.json({ error: "Isi jabatan (mis. HR), nama, atau domain perusahaan" }, { status: 422 });
  }

  const companyBase = domain ? domain.split(".")[0] : "";
  const companyWords = (company || companyBase.replace(/-/g, " ")).split(/\s+/).filter((w) => w.length >= 3);

  // JobContact + job + company — dedup per email+company di memori
  // (dataset kontak kecil ribuan-baris; groupBy email cukup di app layer)
  const contacts = await db.jobContact.findMany({
    where: {},
    include: {
      job: {
        select: {
          id: true,
          title: true,
          companyName: true,
          company: { select: { id: true, name: true, logoUrl: true, website: true, industry: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 800,
  });

  // Agregasi per email+company → satu kartu orang/kontak
  type PersonCard = {
    key: string;
    hrEmail: string;
    localPart: string;
    companyDomain: string | null;
    role: string;
    personName: string | null;
    personInferred: boolean;
    company: { id: string; name: string; logoUrl: string; website: string | null; industry: string | null } | null;
    companyName: string;
    emailStatus: string;
    emailSourceUrl: string | null;
    jobCount: number;
    sampleJobs: { id: string; title: string }[];
    lastSeen: string;
  };

  const map = new Map<string, PersonCard>();
  for (const c of contacts) {
    const job = c.job;
    const comp = job.company;
    const compName = comp?.name ?? job.companyName ?? "—";
    const compDomain = (() => {
      try {
        return comp?.website ? new URL(comp.website).hostname.replace(/^www\./, "") : null;
      } catch {
        return null;
      }
    })();

    // filter perusahaan (nama atau domain)
    if (companyWords.length) {
      const hay = `${compName} ${compDomain ?? ""}`.toLowerCase();
      if (!companyWords.every((w) => hay.includes(w.toLowerCase()))) continue;
    }
    // filter domain eksplisit
    if (domain && !(compDomain ?? "").includes(domain.split(".")[0])) continue;

    const [localPart, emailDomain] = c.hrEmail.split("@");
    const key = `${c.hrEmail.toLowerCase()}|${comp?.id ?? compName}`;
    const lastSeenIso = c.createdAt.toISOString();
    const existing = map.get(key);
    if (existing) {
      existing.jobCount += 1;
      if (existing.sampleJobs.length < 3) existing.sampleJobs.push({ id: job.id, title: job.title });
      if (lastSeenIso > existing.lastSeen) existing.lastSeen = lastSeenIso;
      continue;
    }

    const person = inferPersonName(localPart);
    map.set(key, {
      key,
      hrEmail: c.hrEmail,
      localPart,
      companyDomain: emailDomain ?? compDomain,
      role: inferRole(localPart),
      personName: person?.name ?? null,
      personInferred: !!person,
      company: comp
        ? { id: comp.id, name: comp.name, logoUrl: comp.logoUrl, website: comp.website, industry: comp.industry }
        : null,
      companyName: compName,
      emailStatus: c.emailStatus,
      emailSourceUrl: c.emailSourceUrl,
      jobCount: 1,
      sampleJobs: [{ id: job.id, title: job.title }],
      lastSeen: lastSeenIso,
    });
  }

  // role filter halus (token di dalam role/lokasi/local part) + sort jobCount
  let all = [...map.values()];
  if (role) {
    const rl = role.toLowerCase();
    all = all.filter(
      (p) =>
        p.role.toLowerCase().includes(rl) ||
        p.localPart.toLowerCase().includes(rl) ||
        ROLE_MAP.some(({ role: r }) => r.toLowerCase().includes(rl) && r === p.role)
    );
  }
  all.sort((a, b) => b.jobCount - a.jobCount || a.companyName.localeCompare(b.companyName));

  const total = all.length;
  const paged = all.slice((page - 1) * pageSize, page * pageSize);

  // statistik per jabatan — buat chip filter cepat
  const roleStats = new Map<string, number>();
  for (const p of all) roleStats.set(p.role, (roleStats.get(p.role) ?? 0) + 1);

  return NextResponse.json({
    total,
    page,
    pageSize,
    stats: [...roleStats.entries()]
      .map(([r, n]) => ({ role: r, count: n }))
      .sort((a, b) => b.count - a.count),
    people: paged,
  });
}
