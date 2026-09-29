// E2E render test — halaman Cari LokerBase dengan data Indonesia:
// buka dashboard, klik nav Cari LokerBase, cek kartu hasil, jalankan
// pencarian nyata, dan pastikan tidak ada console error.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const failed404 = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160));
});
page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err).slice(0, 160)}`));
page.on("response", (res) => {
  if (res.status() >= 400) failed404.push(`${res.status()} ${res.url()}`);
});
page.on("requestfailed", (req) => {
  failed404.push(`FAILED ${req.url()} — ${req.failure()?.errorText}`);
});

try {
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
console.log("1. homepage loaded:", await page.title());
console.log("   4xx/5xx saat load homepage:", failed404.length ? [...new Set(failed404)] : "tidak ada");

  // klik nav Cari LokerBase
  const nav = page.getByRole("button", { name: /cari lokerbase/i }).first();
  await nav.click();
  await page.waitForTimeout(2500);
  console.log("2. nav Cari LokerBase diklik — header:", await page.locator("h2").first().innerText());

  // kartu hasil (default browse all, withEmail=1)
  await page.waitForSelector("text=/job/i", { timeout: 10000 });
  const cards = await page.locator("a[href*='/c/'], [data-slot='card']").count();
  const bodyText = await page.locator("body").innerText();
  const hasLoker = /loker|lowongan|job/i.test(bodyText);
  console.log("3. body mengandung kata job/lowongan:", hasLoker, "| elemen kartu terdeteksi:", cards);

  // cek konten Indonesia di kartu (lokasi kota ID / perusahaan ID)
  const idSignals = ["Jakarta", "Surabaya", "Bandung", "Bekasi", "Makassar", "Vidio", "SEVIMA", "IDEKU", "Bumame"];
  const foundSignals = idSignals.filter((s) => bodyText.includes(s));
  console.log("4. sinyal data Indonesia di halaman:", foundSignals.join(", ") || "TIDAK ADA");

  // jalankan pencarian nyata
  const input = page.locator("input[placeholder*='Posisi']").first();
  await input.fill("sales");
  await page.waitForTimeout(1200); // debounce 350ms + fetch
  const bodyAfter = await page.locator("body").innerText();
  const salesHits = (bodyAfter.match(/sales/gi) || []).length;
  console.log("5. search 'sales' — kemunculan kata 'sales' di body:", salesHits);

  // cek chip posisi populer ada
  const popularVisible = await page.locator("button", { hasText: "Frontend Developer" }).count();
  console.log("6. chip posisi populer terlihat:", popularVisible > 0);

  // cek toggle mode live ada
  const liveBtn = await page.locator("button", { hasText: "Scrape Live" }).count();
  console.log("7. toggle mode Scrape Live ada:", liveBtn > 0);

  // screenshot mode db
  await page.screenshot({ path: "download/search-db-mode.png", fullPage: false });

  // ── Chip kota populer (filter lokasi sekali klik) ──
  // 9. klik chip Jakarta → hasil terfilter ke lokasi Jakarta
  const jakartaChip = page.locator("button", { hasText: /^Jakarta/ }).first();
  await jakartaChip.click();
  await page.waitForTimeout(1200); // debounce + fetch
  const bodyJakarta = await page.locator("body").innerText();
  const countMatch = bodyJakarta.match(/(\d+[\d.]*)\s+lowongan/);
  console.log("9. chip Jakarta diklik — result count:", countMatch ? countMatch[1] : "?");
  const jakartaChipActive = await jakartaChip.getAttribute("title");
  console.log("   chip aktif (title):", jakartaChipActive);
  // semua kartu harus lokasi Jakarta-an — cek sample via API parity
  const jakartaApi = await (await fetch("http://localhost:3000/api/jobs?location=jakarta&withEmail=1&pageSize=5")).json();
  console.log("   API parity: location=jakarta total =", jakartaApi.total);

  // 10. klik lagi → filter lepas, hasil balik ke total penuh
  await jakartaChip.click();
  await page.waitForTimeout(1200);
  const bodyAll = await page.locator("body").innerText();
  const countAll = bodyAll.match(/(\d+[\d.]*)\s+lowongan/);
  console.log("10. chip diklik lagi (toggle off) — result count:", countAll ? countAll[1] : "?");

  // 11. kombinasi: chip kota + keyword — "admin" di Bandung
  await input.fill("admin");
  await page.locator("button", { hasText: /^Bandung/ }).first().click();
  await page.waitForTimeout(1200);
  const bodyCombo = await page.locator("body").innerText();
  console.log("11. admin + Bandung — tersedia filter gabungan:", /lowongan/.test(bodyCombo));
  await page.screenshot({ path: "download/search-city-chips.png", fullPage: false });
} catch (e) {
  console.log("FAIL:", e.message);
}

console.log("\nconsole errors:", consoleErrors.length === 0 ? "TIDAK ADA ✓" : consoleErrors.slice(0, 5));
console.log("resource 404:", failed404.length === 0 ? "TIDAK ADA ✓" : [...new Set(failed404)].slice(0, 5));
await browser.close();
