// Task 16-d — recovery script for sandbox DB resets.
// Re-adds the proxy/headers columns if the DB file was restored from an old
// snapshot without them (schema drift breaks the Prisma client).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function columnExists(table: string, col: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`);
  return rows.some((r) => r.name === col);
}

async function main() {
  const table = "Source";
  if (!(await columnExists(table, "proxyUrl"))) {
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "proxyUrl" TEXT NOT NULL DEFAULT ''`);
    console.log("added Source.proxyUrl");
  } else console.log("Source.proxyUrl OK");
  if (!(await columnExists(table, "headersJson"))) {
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "headersJson" TEXT NOT NULL DEFAULT ''`);
    console.log("added Source.headersJson");
  } else console.log("Source.headersJson OK");

  // keep JobStreet in the state the user wants (only-ID sources, 5-engine chain)
  const srcs = await db.source.findMany({ select: { slug: true, status: true, engines: true, schedule: true } });
  console.log("sources:", srcs.map((s) => `${s.slug}(${s.status},${s.engines},${s.schedule})`).join(" | "));
}

main().finally(() => db.$disconnect());
