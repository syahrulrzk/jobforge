// Probe: apakah "SIM Group" punya listing aktif di JobStreet/Glints saat ini?
import { fetchJobStreetBrowser, fetchGlintsBrowser, jobStreetSeoSearchUrl, glintsSearchUrl } from "../src/lib/jobforge/browser-boards";

console.log("== JobStreet 'sim group' ==");
try {
  const js = await fetchJobStreetBrowser(jobStreetSeoSearchUrl("sim group"), undefined, 30);
  console.log(`records: ${js.length}`);
  for (const r of js.slice(0, 6)) console.log(` - ${r.rawTitle.slice(0, 55)} | ${(r.rawCompanyName ?? "?").slice(0, 40)} | ${r.rawLocation ?? "?"}`);
} catch (e) {
  console.log("gagal:", e instanceof Error ? e.message.slice(0, 120) : e);
}
console.log("\n== Glints 'sim group' ==");
try {
  const gl = await fetchGlintsBrowser(glintsSearchUrl("sim group"), undefined, 30);
  console.log(`records: ${gl.length}`);
  for (const r of gl.slice(0, 6)) console.log(` - ${r.rawTitle.slice(0, 55)} | ${(r.rawCompanyName ?? "?").slice(0, 40)} | ${r.rawLocation ?? "?"}`);
} catch (e) {
  console.log("gagal:", e instanceof Error ? e.message.slice(0, 120) : e);
}
