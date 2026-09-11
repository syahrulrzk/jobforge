// Task 16-c — stealth browser probe: can Playwright Chromium pass the
// JobStreet (Cloudflare) challenge from this datacenter IP?
// Real browser, real navigation — no mocks. Reports what it finds.
import { chromium } from "playwright";

const TARGET = process.env.TARGET_URL || "https://www.jobstreet.co.id/id/frontend-developer-jobs";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1366,850",
    "--lang=id-ID",
  ],
});
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  viewport: { width: 1366, height: 850 },
  locale: "id-ID",
  timezoneId: "Asia/Jakarta",
  extraHTTPHeaders: { "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["id-ID", "id", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
const t0 = Date.now();
try {
  const resp = await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("nav status:", resp?.status(), "| final url:", page.url(), "|", Date.now() - t0, "ms");
  console.log("title t0:", (await page.title()).slice(0, 80));

  // give any JS challenge time to auto-solve
  for (const wait of [5_000, 8_000]) {
    await page.waitForTimeout(wait);
    const t = (await page.title()).slice(0, 80);
    console.log(`title +${wait}ms:`, t);
    if (!/just a moment|attention required|moment/i.test(t)) break;
  }

  const html = await page.content();
  console.log("html length:", html.length);
  console.log("markers — datadome:", /datadome/i.test(html), "| cf-challenge:", /challenge-platform|turnstile/i.test(html));
  const jsonLd = (html.match(/"@type"\s*:\s*"JobPosting"/g) || []).length;
  console.log("JSON-LD JobPosting count:", jsonLd);
  const cards = await page.locator('[data-automation="jobTitle"]').count();
  console.log("jobTitle cards:", cards);
  if (cards > 0) {
    console.log("first card:", (await page.locator('[data-automation="jobTitle"]').first().textContent())?.trim());
  }
  await page.screenshot({ path: "scripts/js-probe.png" });
  // persist HTML for parser inspection
  const { writeFileSync } = await import("node:fs");
  writeFileSync("scripts/js-probe.html", html);
  console.log("saved: scripts/js-probe.html + js-probe.png");
} catch (err) {
  console.log("PROBE ERROR:", err?.message ?? err);
  await page.screenshot({ path: "scripts/js-probe-error.png" }).catch(() => {});
}
await browser.close();
