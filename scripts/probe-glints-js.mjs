// Probe Playwright: Glints & JobStreet via real system Chrome.
// Pantau network response (JSON API yang dipanggil frontend) + link detail job.
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

async function probe(name, url, linkPattern, waitMs = 12000) {
  const page = await browser.newPage({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  const apiHits = [];
  page.on("response", (r) => {
    const u = r.url();
    const ct = r.headers()["content-type"] || "";
    if (ct.includes("json") && !u.includes("google") && !u.includes("sentry")) {
      apiHits.push(`${r.status()} ${u.slice(0, 130)}`);
    }
  });
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(waitMs);
    const title = await page.title();
    const links = await page.$$eval("a", (els, pat) =>
      els.map((e) => e.getAttribute("href")).filter((h) => h && new RegExp(pat).test(h)),
      linkPattern,
    );
    console.log(`== ${name} ==`);
    console.log("title:", title);
    console.log("job detail links:", new Set(links).size, "| sample:", [...new Set(links)].slice(0, 3));
    console.log("JSON API calls:");
    [...new Set(apiHits)].slice(0, 12).forEach((a) => console.log("  ", a));
  } catch (e) {
    console.log(`== ${name} == FAIL:`, e.message.slice(0, 200));
  }
  await page.close();
}

await probe("Glints", "https://glints.com/id/opportunities?latestJob", "/opportunities/", 12000);
await probe("JobStreet", "https://id.jobstreet.com/id/jobs", "/job/", 10000);
await browser.close();
