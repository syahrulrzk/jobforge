// ─────────────────────────────────────────────────────────────
// JobForge — Backfill logo perusahaan (§11 logo wajib)
//
// Requirement user: LOGO + EMAIL wajib ada per perusahaan.
// Email sudah tertangani (Dealls payload, recovery scan JobStreet/Glints).
// Script ini menutup sisi LOGO untuk company yang sudah ada di DB:
//
//   chain per company:
//     1. website tersimpan  → Google favicon 128 (logo asli brand)
//     2. nama perusahaan    → Clearbit autocomplete → domain → favicon
//     3. fallback terakhir  → badge SVG deterministik (data URI) — dijamin ada
//
// Rerunnable & idempotent: company yang sudah punya logo valid dilewati.
// Jalankan: DATABASE_URL=... npx tsx scripts/backfill-logos.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";
import { resolveLogoUrl } from "../src/lib/jobforge/logo";

const db = new PrismaClient();

function isValidStoredLogo(url: string | null): boolean {
  if (!url || url.length < 8) return false;
  if (url.endsWith("/assets/logo.png")) return false; // placeholder mock lama
  return true;
}

async function main() {
  const t0 = Date.now();
  const companies = await db.company.findMany({
    select: { id: true, name: true, website: true, logoUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const need = companies.filter((c) => !isValidStoredLogo(c.logoUrl));
  console.log(`company total: ${companies.length} | butuh logo: ${need.length}`);

  let resolved = 0;
  let badged = 0;
  let failed = 0;
  const seen = new Map<string, string | null>(); // nama → hasil, biar query provider hemat

  for (let i = 0; i < need.length; i += 5) {
    await Promise.all(
      need.slice(i, i + 5).map(async (c) => {
        const cached = seen.get(c.name.toLowerCase());
        const logo =
          cached ??
          (await resolveLogoUrl(c.website, c.name)) ??
          null;
        seen.set(c.name.toLowerCase(), logo);
        if (!logo) {
          failed += 1;
          console.log(`  ✗ ${c.name} — tidak bisa di-resolve`);
          return;
        }
        if (logo.startsWith("data:image/svg")) badged += 1;
        else resolved += 1;
        await db.company.update({ where: { id: c.id }, data: { logoUrl: logo, enrichedAt: new Date() } });
      })
    );
    if (i % 25 === 0) console.log(`  ...${Math.min(i + 5, need.length)}/${need.length} diproses`);
  }

  console.log(`\nfavicon provider: ${resolved} | badge SVG: ${badged} | gagal: ${failed}`);

  // ringkasan coverage
  const [withLogo, totalCompanies] = await Promise.all([
    db.company.count({ where: { logoUrl: { not: "" } } }),
    db.company.count(),
  ]);
  const jobsNoCompany = await db.job.count({ where: { companyId: null, status: { notIn: ["REJECTED"] } } });
  console.log(`\ncoverage: ${withLogo}/${totalCompanies} company punya logo`);
  console.log(`job aktif tanpa company: ${jobsNoCompany}`);
  console.log(`selesai dalam ${Date.now() - t0}ms`);

  await db.activityLog.create({
    data: {
      source: "enrich",
      action: "enrich",
      status: "success",
      message: `Logo backfill: ${resolved} favicon + ${badged} badge untuk ${need.length} company (coverage ${withLogo}/${totalCompanies})`,
      durationMs: Date.now() - t0,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
