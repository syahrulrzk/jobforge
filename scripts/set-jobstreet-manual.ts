// Task 16-a (part 2) — align JobStreet schedule with user's shown state (Manual).
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  await db.source.update({ where: { slug: "jobstreet" }, data: { schedule: "manual" } });
  const s = await db.source.findUnique({ where: { slug: "jobstreet" } });
  console.log(`jobstreet: sched=${s?.schedule} status=${s?.status} engines=${s?.engines}`);
}
main().finally(() => db.$disconnect());
