// Cari URL listing Glints yang baru (rebrand TapLoker) + baca isi response
// GraphQL getCustomSlugPagesWithActiveJobs.
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

const page = await browser.newPage({ userAgent: UA });
await page.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

// tangkap response getCustomSlugPagesWithActiveJobs
page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("getCustomSlugPagesWithActiveJobs")) {
    try {
      const body = await res.text();
      console.log("== getCustomSlugPages response ==");
      console.log(body.slice(0, 1500));
    } catch {}
  }
});

// coba beberapa kandidat URL listing Glints
for (const url of [
  "https://glints.com/id/lowongan-kerja",
  "https://glints.com/id/taploker",
  "https://taploker.com",
]) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(9000);
    const title = await page.title();
    const links = await page.$$eval("a", (els) =>
      els.map((e) => e.getAttribute("href")).filter(Boolean),
    );
    const jobish = [...new Set(links)].filter(
      (h) => /lowongan|opportunit|loker|job/i.test(h) && !/facebook|twitter|instagram|linkedin/.test(h),
    );
    console.log(`\n== ${url} ==`);
    console.log("title:", title.slice(0, 90));
    console.log("link job-ish:", jobish.length, "| sample:", jobish.slice(0, 5));
  } catch (e) {
    console.log(`\n== ${url} == FAIL:`, e.message.slice(0, 100));
  }
}
await browser.close();
