// ─────────────────────────────────────────────────────────────
// Backfill profil + logo perusahaan dari API perusahaan Sejutacita
// (Dealls) — SEMUA data diambil dari yang ter-publish perusahaan
// (description/website/sector/logoUrl/size). Tidak ada karangan:
//   - profil template "X membuka kesempatan berkarir sebagai…"
//     (derifatif dari judul job) → DIGANTI profil asli bila API
//     punya description; bila tidak, jadi placeholder jujur.
//   - logo: CDN resmi Dealls dipakai bila company belum punya
//     logo CDN; favicon s2 dibiarkan bila sudah terisi.
// Company dicocokkan via slug dari URL job Dealls (…~<companySlug>).
// Jalankan: npx tsx scripts/backfill-company-profiles.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

interface DeallsCo {
  profile: string | null;
  website: string | null;
  logoUrl: string | null;
  sector: string | null;
  size: string | null;
}

async function fetchDeallsCompany(slug: string): Promise<DeallsCo | null> {
  try {
    const res = await fetch(`https://api.sejutacita.id/v1/job-portal/company/slug/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const c = (await res.json())?.data?.result;
    if (!c || typeof c !== "object") return null;
    const descHtml = typeof c.description === "string" ? c.description : "";
    const desc = stripHtml(descHtml);
    const size = c.size && typeof c.size === "object" ? (c.size.start && c.size.end ? `${c.size.start}-${c.size.end} karyawan` : c.size.start ? `${c.size.start}+ karyawan` : null) : null;
    return {
      profile: desc.length >= 30 ? desc.slice(0, 2_000) : null,
      website: typeof c.website === "string" && c.website.trim() ? c.website.trim() : null,
      logoUrl: typeof c.logoUrl === "string" && c.logoUrl.startsWith("http") ? c.logoUrl : null,
      sector: typeof c.sector === "string" && c.sector.trim() ? c.sector.trim() : null,
      size,
    };
  } catch {
    return null;
  }
}

// Pola profil derifatif/template — BUKAN profil asli perusahaan
// "X membuka kesempatan berkarir sebagai <judul>" diteruskan kalimat derifatif
// dari judul job — mulai selalu dengan nama company + frasa template ini.
const FABRICATED_RE =
  /^(Profil perusahaan belum tersedia\.|Perusahaan ditambahkan otomatis dari harvest|.+ membuka kesempatan berkarir sebagai )/;

async function main() {
  // company + slug Dealls dari URL job (detail …~slug ATAU company page …/company/slug)
  const links = await db.jobSource.findMany({
    where: { sourceUrl: { contains: "dealls.com" } },
    select: { sourceUrl: true, job: { select: { company: { select: { id: true, name: true } } } } },
  });
  const byCompany = new Map<string, string>();
  for (const l of links) {
    const cid = l.job?.company?.id;
    if (!cid) continue;
    if (byCompany.has(cid)) continue;
    const m =
      l.sourceUrl.match(/dealls\.com\/company\/([^/~?]+)/) ??
      l.sourceUrl.match(/dealls\.com\/loker\/[^/~]+~([^/~?]+)/);
    if (m) byCompany.set(cid, decodeURIComponent(m[1]));
  }
  console.log(`Company ter-link job Dealls dengan slug: ${byCompany.size}`);

  const companies = await db.company.findMany({
    where: { id: { in: [...byCompany.keys()] } },
    select: { id: true, name: true, logoUrl: true, website: true, profile: true, industry: true, size: true },
  });
  const needProfile = companies.filter((c) => FABRICATED_RE.test(c.profile ?? "") || (c.profile ?? "").length < 40);
  console.log(`Company perlu backfill profil asli: ${needProfile.length} (dari ${companies.length})`);

  let updated = 0;
  let noDesc = 0;
  for (const c of needProfile) {
    const slug = byCompany.get(c.id);
    if (!slug) continue;
    const co = await fetchDeallsCompany(slug);
    if (!co) {
      noDesc += 1;
      continue;
    }
    const data: Record<string, unknown> = { enrichedAt: new Date() };
    if (co.profile) data.profile = co.profile;
    else if (FABRICATED_RE.test(c.profile ?? "")) data.profile = "Profil perusahaan belum tersedia.";
    if (co.website && !c.website) data.website = co.website;
    if (co.sector && !c.industry) data.industry = co.sector;
    if (co.size && !c.size) data.size = co.size;
    // logo CDN Dealls = logo asli; favicon s2 boleh tetap bila sudah ada
    if (co.logoUrl && (c.logoUrl.includes("google.com/s2/favicons") || !c.logoUrl)) data.logoUrl = co.logoUrl;
    await db.company.update({ where: { id: c.id }, data });
    updated += 1;
    await new Promise((r) => setTimeout(r, 250)); // sopan ke API
  }
  console.log(`Selesai: ${updated} company di-update, ${noDesc} tidak ketemu di API Dealls`);

  // Verifikasi
  const after = await db.company.findMany({
    where: { id: { in: companies.map((c) => c.id) } },
    select: { name: true, profile: true, industry: true, website: true, logoUrl: true },
    take: 6,
  });
  console.log("\nSampel sesudah:");
  for (const c of after) {
    console.log(`- ${c.name.slice(0, 34)} | ${(c.industry ?? "-").slice(0, 18)} | profil="${c.profile.slice(0, 70)}"`);
  }
  const stillFabricated = await db.company.count({
    where: { id: { in: companies.map((c) => c.id) }, OR: [{ profile: { contains: "membuka kesempatan berkarir" } }, { profile: "Profil perusahaan belum tersedia." }] },
  });
  console.log(`\nSisa profil template/kosong: ${stillFabricated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
