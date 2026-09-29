// E2E render test — Dashboard (Overview) & Activity Console dengan data Indonesia:
// cek stat cards, grafik scraping activity (SVG recharts), source health, activity
// console berisi log pipeline terbaru, dan pastikan tidak ada console error / 404.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const failedRes = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160));
});
page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err).slice(0, 160)}`));
page.on("response", (res) => {
  if (res.status() >= 400) failedRes.push(`${res.status()} ${res.url()}`);
});
page.on("requestfailed", (req) => {
  failedRes.push(`FAILED ${req.url()} — ${req.failure()?.errorText}`);
});

try {
  // parity dulu dengan API — apa yang seharusnya tampil
  const dashApi = await (await fetch(`${BASE}/api/dashboard`)).json();
  const stats = dashApi?.stats ?? dashApi?.data?.stats ?? null;
  console.log("0. API /api/dashboard parity — stats:", stats ? JSON.stringify(stats).slice(0, 220) : "(bentuk lain)");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  console.log("1. homepage loaded:", await page.title());
  await page.waitForTimeout(2500); // biar chart & activity fetch selesai

  // 2. stat cards kebaca
  const body = await page.locator("body").innerText();
  const numbers = (body.match(/\d+/g) || []).length;
  console.log("2. stat cards: angka terdeteksi =", numbers > 5 ? "✓" : "?", `(${numbers} angka di body)`);

  // 3. grafik recharts ke-render (SVG dengan path/rect)
  const chartSvg = await page.locator("[class*='recharts-wrapper'] svg").count();
  const chartEls = await page.locator("[class*='recharts-']").count();
  console.log("3. grafik Scraping Activity: SVG =", chartSvg > 0 ? "✓ TER-RENDER" : "TIDAK ADA", `| elemen recharts = ${chartEls}`);

  // 4. sinyal data Indonesia di overview (topCompanies / sourceHealth / console)
  const idSignals = ["Dealls", "JobStreet", "Glints", "Jakarta", "Bekasi", "Sukabumi", "PT ", "published to Job Portal", "Scrape run finished"];
  const found = idSignals.filter((s) => body.includes(s));
  console.log("4. sinyal Indonesia:", found.length >= 4 ? "✓" : "?", `(${found.length}/${idSignals.length}) →`, found.join(", "));

  // 5. Activity Console mini di overview berisi log
  const consoleBox = page.locator("h3", { hasText: "Activity Console" }).first();
  const consoleVisible = await consoleBox.isVisible().catch(() => false);
  console.log("5. panel Activity Console di overview:", consoleVisible ? "✓ tampil" : "tidak ada");

  await page.screenshot({ path: "download/dashboard-overview.png", fullPage: true });
  console.log("   screenshot → download/dashboard-overview.png");

  // 6. buka halaman Activity Console penuh
  await page.getByRole("button", { name: /activity console/i }).first().click();
  await page.waitForTimeout(2500);
  const bodyAct = await page.locator("body").innerText();
  const logActions = ["scrape", "deliver", "import", "enrich", "validate"].filter((a) => bodyAct.includes(a));
  console.log("6. halaman Activity Console: jenis aksi terlihat =", logActions.join(", ") || "TIDAK ADA");
  const rows = await page.locator("table tbody tr, [class*='font-mono']").count();
  console.log("   baris log terdeteksi:", rows > 0 ? `✓ (${rows})` : "0");

  await page.screenshot({ path: "download/dashboard-activity.png", fullPage: false });
  console.log("   screenshot → download/dashboard-activity.png");
} catch (e) {
  console.log("FAIL:", e.message);
}

console.log("\nconsole errors:", consoleErrors.length === 0 ? "TIDAK ADA ✓" : consoleErrors.slice(0, 5));
console.log("resource gagal/4xx:", failedRes.length === 0 ? "TIDAK ADA ✓" : [...new Set(failedRes)].slice(0, 5));
await browser.close();
