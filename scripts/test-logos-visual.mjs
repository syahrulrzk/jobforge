// Visual test — logo perusahaan di halaman Companies & Jobs:
// semua avatar harus <img> (favicon provider atau badge data:image/svg),
// TIDAK BOLEH ada fallback initials (div amber) — logo = field wajib.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 120)));

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  // halaman Companies
  await page.getByRole("button", { name: /^companies$/i }).first().click();
  await page.waitForTimeout(3000);
  const companyImgs = await page.locator("img[alt^='Logo']").count();
  const companyBadges = await page.locator("img[alt^='Logo'][src^='data:image/svg']").count();
  const companyInitials = await page.locator("div.bg-gradient-to-br").count();
  console.log("Companies: <img logo> =", companyImgs, "| badge svg =", companyBadges, "| fallback initials =", companyInitials);
  await page.screenshot({ path: "download/companies-logos.png" });

  // halaman Jobs
  await page.getByRole("button", { name: /^jobs$/i }).first().click();
  await page.waitForTimeout(3000);
  const jobImgs = await page.locator("img[alt^='Logo']").count();
  const jobBadges = await page.locator("img[alt^='Logo'][src^='data:image/svg']").count();
  const jobInitials = await page.locator("div.bg-gradient-to-br").count();
  console.log("Jobs:      <img logo> =", jobImgs, "| badge svg =", jobBadges, "| fallback initials =", jobInitials);
  await page.screenshot({ path: "download/jobs-logos.png" });
} catch (e) {
  console.log("FAIL:", e.message);
}
console.log("pageerrors:", consoleErrors.length === 0 ? "TIDAK ADA ✓" : consoleErrors);
await browser.close();
