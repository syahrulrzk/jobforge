// Probe: apakah Kalibrr job-board ke-render client-side dan bisa dibaca Playwright?
// Hasil dipakai untuk memutuskan integrasi board Indonesia (jawaban user: job portal luar).
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome", // system Google Chrome — cache Playwright kehapus tiap sandbox restart
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
});
try {
  await page.goto("https://www.kalibrr.com/id/job-board", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000); // tunggu client render
  console.log("title:", await page.title());

  // link detail job di rendered DOM (pola /c/<company-slug>/jobs/<id>)
  const links = await page.$$eval(
    "a",
    (els) =>
      els
        .map((e) => e.getAttribute("href"))
        .filter((h) => h && /\/c\/[^/]+\/jobs\/\d+/.test(h)),
  );
  console.log("total job detail links:", new Set(links).size);
  console.log("sample:", [...new Set(links)].slice(0, 3));

  // JSON-LD JobPosting di rendered DOM?
  const ld = await page.$$eval(
    'script[type="application/ld+json"]',
    (els) => els.map((e) => e.textContent.slice(0, 300)),
  );
  console.log("ld+json blocks:", ld.length);
  ld.forEach((l) => console.log(" ld:", l.replace(/\s+/g, " ").slice(0, 200)));

  // teks kartu job pertama
  const cardText = await page.$$eval("a[href*='/jobs/']", (els) =>
    els.slice(0, 3).map((e) => e.innerText.replace(/\n/g, " | ").slice(0, 150)),
  );
  cardText.forEach((t) => console.log(" card:", t));
} catch (e) {
  console.log("FAIL:", e.message);
}
await browser.close();
