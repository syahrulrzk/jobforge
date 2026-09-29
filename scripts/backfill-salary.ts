// ─────────────────────────────────────────────────────────────
// Backfill salaryMin/salaryMax dari blok "Salary: IDR X - Y per
// bulan" di description (sumber asli Dealls) — menggantikan nilai
// estimasi ×1.35 / NULL dari normalizer lama.
// Jalankan: npx tsx scripts/backfill-salary.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function parseIdrBlock(desc: string | null): { min: number; max: number } | null {
  if (!desc) return null;
  const range = desc.match(/Salary:\s*IDR\s*([\d.,]+)\s*[-–]\s*(?:IDR\s*)?([\d.,]+)/i);
  if (range) {
    const lo = Math.round(Number(range[1].replace(/\./g, "").replace(/,/g, ".")));
    const hi = Math.round(Number(range[2].replace(/\./g, "").replace(/,/g, ".")));
    if (lo > 0 && hi >= lo) return { min: lo, max: hi };
  }
  const single = desc.match(/Salary:\s*IDR\s*([\d.,]+)/i);
  if (single) {
    const v = Math.round(Number(single[1].replace(/\./g, "").replace(/,/g, ".")));
    if (v > 0) return { min: v, max: v };
  }
  return null;
}

async function main() {
  const jobs = await db.job.findMany({
    where: { description: { contains: "Salary: IDR" } },
    select: { id: true, title: true, description: true, salaryMin: true, salaryMax: true, currency: true },
  });
  console.log(`Job dengan blok Salary di description: ${jobs.length}`);

  let fixed = 0;
  let kept = 0;
  for (const j of jobs) {
    const parsed = parseIdrBlock(j.description);
    if (!parsed) continue;
    const exact = j.salaryMin === parsed.min && j.salaryMax === parsed.max;
    if (exact) {
      kept += 1;
      continue;
    }
    await db.job.update({
      where: { id: j.id },
      data: { salaryMin: parsed.min, salaryMax: parsed.max, currency: "IDR" },
    });
    fixed += 1;
    if (fixed <= 5) {
      console.log(`  fixed: "${j.title.slice(0, 36)}" ${j.salaryMin ?? "null"}–${j.salaryMax ?? "null"} → ${parsed.min}–${parsed.max}`);
    }
  }
  console.log(`\nSelesai: ${fixed} job dikoreksi ke range asli, ${kept} sudah tepat`);

  const nullSal = await db.job.count({ where: { description: { contains: "Salary: IDR" }, salaryMin: null } });
  console.log(`Sisa job ber-blok Salary dengan salaryMin NULL: ${nullSal}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
