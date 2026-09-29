// Test engine email-finder: cari email HR via internet untuk beberapa domain
import { findEmailFromInternet } from "../src/lib/jobforge/email-finder";

async function main() {
  const targets: { name: string; website?: string }[] = [
    { name: "sim group", website: "simgroup.co.id" },
    { name: "sevima", website: "sevima.com" },
  ];
  for (const t of targets) {
    console.log(`\n=== ${t.name} (${t.website ?? "-"}) ===`);
    const r = await findEmailFromInternet(t.name, t.website);
    console.log("found:", r.found, "| email:", r.email?.email ?? "-", "| via:", r.email?.via ?? "-", "| role:", r.email?.role ?? "-", "| person:", r.email?.personName ?? "-");
    console.log("candidates:", r.candidates.map((c) => c.email).join(", ") || "-");
    for (const s of r.steps) {
      console.log(`  ${s.status === "success" ? "✓" : s.status === "skipped" ? "○" : "✗"} ${s.engine} (${(s.durationMs / 1000).toFixed(1)}s): ${s.note}`);
    }
    console.log("total:", (r.durationMs / 1000).toFixed(1) + "s");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
