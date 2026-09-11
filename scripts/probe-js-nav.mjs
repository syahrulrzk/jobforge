// Task 16-c (round 3) — validate the bypass INSIDE the Playwright context:
// navigate → wait (challenge settle / clearance mint) → reload → check content.
// If page opens: dump JSON-LD JobPosting count + card count (parser feasibility).
// HEADFUL=1 + xvfb-run for the headful variant (better CF pass rate).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const TARGET = process.env.TARGET_URL || "https://id.jobstreet.com/id/frontend-developer-jobs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: process.env.HEADFUL !== "1",
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1366,850", "--lang=id-ID"],
});
const ctx = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1366, height: 850 },
  locale: "id-ID",
  timezoneId: "Asia/Jakarta",
  extraHTTPHeaders: { "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["id-ID", "id", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
const CHAL = /tunggu sebentar|just a moment|attention required/i;

try {
  const resp = await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("nav:", resp?.status());
  for (let i = 1; i <= 4; i++) {
    await page.waitForTimeout(6_000);
    const t = await page.title();
    console.log(`t+${i * 6}s:`, t.slice(0, 50));
    if (!CHAL.test(t)) break;
  }
  if (CHAL.test(await page.title())) {
    console.log("reload once more…");
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(8_000);
    console.log("after reload:", (await page.title()).slice(0, 50));
  }

  const passed = !CHAL.test(await page.title());
  console.log("PASSED:", passed);
  if (passed) {
    const html = await page.content();
    const jl = (html.match(/"@type"\s*:\s*"JobPosting"/g) || []).length;
    console.log("html len:", html.length, "| JSON-LD JobPosting:", jl);
    console.log("jobTitle cards:", await page.locator('[data-automation="jobTitle"]').count());
    console.log("article cards:", await page.locator("article").count());
    writeFileSync("scripts/js-probe.html", html);
    // sample a couple of titles for sanity
    const titles = await page.locator('[data-automation="jobTitle"]').allTextContents();
    console.log("sample titles:", titles.slice(0, 5).map((t) => t.trim().slice(0, 60)));
  }
  await page.screenshot({ path: "scripts/js-probe3.png" });
} catch (err) {
  console.log("ERROR:", err?.message ?? err);
}
await browser.close();
