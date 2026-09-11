// One-off backfill: replace legacy fake logo URLs (`/assets/logo.png` style)
// with provider-resolved Clearbit PNG links. Safe to re-run.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  const withProto = website.startsWith("http") ? website : `https://${website}`;
  try {
    const host = new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

async function main() {
  const companies = await db.company.findMany({
    where: {
      OR: [{ logoUrl: "" }, { logoUrl: { endsWith: "/assets/logo.png" } }],
    },
    select: { id: true, name: true, website: true, logoUrl: true },
  });

  console.log(`Companies to backfill: ${companies.length}`);
  let updated = 0;
  for (const c of companies) {
    const domain = extractDomain(c.website);
    if (!domain) continue;
    const logoUrl = `https://logo.clearbit.com/${domain}?size=256`;
    await db.company.update({ where: { id: c.id }, data: { logoUrl, enrichedAt: new Date() } });
    console.log(`  ✓ ${c.name}: ${c.logoUrl || "(empty)"} → ${logoUrl}`);
    updated++;
  }
  console.log(`Done — ${updated} companies updated.`);

  const total = await db.company.count();
  const withLogo = await db.company.count({ where: { logoUrl: { not: "" } } });
  console.log(`Logo coverage: ${withLogo}/${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
