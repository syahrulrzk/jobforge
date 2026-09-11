// Set status JobStreet kembali ACTIVE (efek run gagal sebelumnya menandai ERROR)
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const js = await db.source.update({
    where: { slug: "jobstreet" },
    data: { status: "ACTIVE" },
  });
  console.log(`JobStreet → ${js.status}`);
  const counts = await db.source.groupBy({ by: ["status"], _count: true });
  console.log(counts);
}

main().finally(() => db.$disconnect());
