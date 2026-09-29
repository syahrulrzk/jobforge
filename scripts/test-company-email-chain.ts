// ─────────────────────────────────────────────────────────────
// Live test: company HR-email chain over a source's companies
//   bun scripts/test-company-email-chain.ts [slug] [limit]
// Default: linkedin, 12 companies. Prints per-company result + hit rate.
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const slug = process.argv[2]?.trim() || "linkedin";
  const limit = Math.max(1, Math.min(40, parseInt(process.argv[3] ?? "12", 10) || 12));

  const source = await db.source.findUnique({ where: { slug } });
  if (!source) {
    console.error(`source "${slug}" tidak ada`);
    process.exit(1);
  }
  const jobs = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT", companyName: { not: null }, contact: null, jobLinks: { some: { sourceId: source.id } } },
    select: { companyName: true },
    orderBy: { scrapedAt: "desc" },
  });
  const companies = [...new Set(jobs.map((j) => j.companyName as string))].slice(0, limit);
  console.log(`chain email-HR untuk ${companies.length} perusahaan dari ${source.name}:\n`);

  const { findCompanyHrEmail } = await import("../src/lib/jobforge/company-email");
  const { validateEmail } = await import("../src/lib/jobforge/pipeline");

  let hits = 0;
  const results: string[] = [];
  for (const name of companies) {
    const t0 = Date.now();
    const res = await findCompanyHrEmail(name, null);
    const ms = Date.now() - t0;
    if (res) {
      const v = validateEmail(res.email);
      const ok = v.status !== "INVALID";
      if (ok) hits += 1;
      results.push(
        `  ${ok ? "✓" : "✗(invalid)"} ${name.padEnd(28)} → ${res.email.padEnd(34)} [${res.tier}/${res.via}, ${v.status}, ${ms}ms]`,
      );
    } else {
      results.push(`  · ${name.padEnd(28)} → (tidak ter-publish / tak terjangkau, ${ms}ms)`);
    }
  }
  console.log(results.join("\n"));
  console.log(`\nhit rate: ${hits}/${companies.length} = ${((hits / companies.length) * 100).toFixed(1)}%`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
