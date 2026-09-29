// Smoke test harvest mode — semua email publik untuk satu domain
import { harvestDomainEmails } from "../src/lib/jobforge/domain-email-harvest";

async function main() {
  const targets = [{ name: "", website: "sevima.com" }];
  for (const t of targets) {
    console.log(`\n=== harvest ${t.website} ===`);
    const r = await harvestDomainEmails(t.name, t.website, "auto", false);
    console.log(`domain: ${r.domain} | pages: ${r.pagesCrawled} | ${r.emails.length} email | ${(r.durationMs / 1000).toFixed(1)}s`);
    for (const s of r.steps) console.log(`  ${s.status === "success" ? "✓" : "✗"} ${s.source} (${(s.durationMs / 1000).toFixed(1)}s): ${s.note}`);
    for (const e of r.emails) console.log(`  [${e.kind}${e.category ? "/" + e.category : ""}] ${e.email} via=${e.via} src=${e.sourceUrl.slice(0, 60)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
