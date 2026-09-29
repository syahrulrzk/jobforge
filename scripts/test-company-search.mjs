// E2E — fitur cari lowongan per perusahaan di halaman Cari LokerBase:
// isi field Perusahaan ("vidio") → hasil terfilter → reset bersih.
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 100)));

try {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /cari lokerbase/i }).first().click();
  await page.waitForTimeout(2000);

  // isi field perusahaan
  const compInput = page.locator("input[placeholder*='Perusahaan']").first();
  console.log("1. field Perusahaan tampil:", await compInput.isVisible());
  await compInput.fill("vidio");
  await page.waitForTimeout(1400); // debounce + fetch

  const body = await page.locator("body").innerText();
  const countMatch = body.match(/(\d+)\s+lowongan/);
  console.log("2. hasil dengan filter 'vidio':", countMatch ? countMatch[1] : "?", "lowongan");
  const allVidio = (body.match(/Vidio/gi) || []).length;
  console.log("   kemunculan 'Vidio' di hasil:", allVidio > 0 ? `✓ (${allVidio})` : "TIDAK ADA");
  await page.screenshot({ path: "download/search-company-filter.png" });

  // reset
  await page.getByRole("button", { name: /^reset$/i }).first().click();
  await page.waitForTimeout(1400);
  const bodyAfter = await page.locator("body").innerText();
  const countAfter = bodyAfter.match(/(\d+)\s+lowongan/);
  console.log("3. setelah reset:", countAfter ? countAfter[1] : "?", "lowongan (semua kembali)");
} catch (e) {
  console.log("FAIL:", e.message);
}
console.log("pageerrors:", errs.length === 0 ? "TIDAK ADA ✓" : errs);
await browser.close();
