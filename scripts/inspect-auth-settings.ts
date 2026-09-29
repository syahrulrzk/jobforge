// Inspeksi kredensial auth di tabel Setting — apakah ada DASHBOARD_USERNAME/
// DASHBOARD_PASSWORD tersisa dari seed lama (yang bikin default tidak dipakai).
// Jalankan: npx tsx scripts/inspect-auth-settings.ts
import { db } from "@/lib/db";

async function main() {
  const rows = await db.setting.findMany({
    where: { key: { in: ["DASHBOARD_USERNAME", "DASHBOARD_PASSWORD", "DASHBOARD_SESSION_SECRET"] } },
  });
  console.log(`Baris auth di Setting: ${rows.length}`);
  for (const r of rows) {
    const v = r.key === "DASHBOARD_PASSWORD" ? `${r.value.slice(0, 12)}… (len=${r.value.length})` : r.value.slice(0, 40);
    console.log(`  ${r.key} = ${v} (updatedAt ${r.updatedAt.toISOString()})`);
  }
  if (rows.length === 0) {
    console.log("→ Tidak ada override. Kredensial default: admin / jobforge-admin (atau dari env)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
