// Smoke test tools eksternal: holehe + bbot + tesseract OCR
import { holeheVerify, bbotEmailEnum, ocrPageForEmails, toolAvailable } from "../src/lib/jobforge/external-email-tools";

async function main() {
  console.log("== availability ==");
  for (const t of ["bbot", "holehe", "tesseract"]) console.log(`  ${t}: ${await toolAvailable(t) ? "OK" : "MISSING"}`);

  console.log("\n== holehe (verifikasi email nyata: hr@sevima.co.id tidak diketahui — pakai umum) ==");
  const h = await holeheVerify("marketing@sevima.co.id");
  console.log(`  exists=${h.exists} usedOn=${h.usedOn.join(",") || "-"} (${(h.durationMs / 1000).toFixed(1)}s)`);
  console.log(`  note: ${h.note}`);

  console.log("\n== bbot email-enum (sevima.com) ==");
  const b = await bbotEmailEnum("sevima.com");
  console.log(`  ok=${b.ok} emails=${b.emails.map((e) => e.email).join(", ") || "-"} (${(b.durationMs / 1000).toFixed(1)}s)`);
  console.log(`  note: ${b.note}`);

  console.log("\n== tesseract OCR (sevima.com) ==");
  const o = await ocrPageForEmails("https://sevima.com");
  console.log(`  ok=${o.ok} emails=${o.emails.join(", ") || "-"} (${(o.durationMs / 1000).toFixed(1)}s)`);
  console.log(`  note: ${o.note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
