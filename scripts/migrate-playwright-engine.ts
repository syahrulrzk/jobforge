// One-off migration: add Playwright as the 5th engine (Task 9).
// - Upserts the himalayas.app real source, pinned to engine "playwright"
// - Expands ENGINE_POOL to all 5 engines (cheerio,crawlee,puppeteer,playwright,selenium)
// Safe to re-run (upserts).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  await db.source.upsert({
    where: { slug: "himalayas" },
    update: { name: "Himalayas", baseUrl: "https://himalayas.app", type: "PUBLIC_SOURCE", scraperType: "API", engine: "playwright", schedule: "hourly", status: "ACTIVE" },
    create: {
      slug: "himalayas",
      name: "Himalayas",
      baseUrl: "https://himalayas.app",
      type: "PUBLIC_SOURCE",
      scraperType: "API",
      engine: "playwright",
      schedule: "hourly",
      status: "ACTIVE",
    },
  });
  console.log("✓ real source ready: Himalayas (engine: playwright)");

  const pool = "cheerio,crawlee,puppeteer,playwright,selenium";
  await db.setting.upsert({ where: { key: "ENGINE_POOL" }, update: { value: pool }, create: { key: "ENGINE_POOL", value: pool } });
  console.log(`✓ setting ENGINE_POOL=${pool}`);

  const active = await db.source.findMany({ where: { status: "ACTIVE" }, select: { name: true, engine: true } });
  console.log("\nActive sources:", active.map((s) => `${s.name}[${s.engine}]`).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
