// Task 16-c (round 2) — try to pass the Cloudflare challenge:
// 1) wait for auto-solve  2) click the Turnstile checkbox inside the CF iframe
// 3) if passed → dump cf_clearance cookie (same-IP handoff to HTTP engines).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const TARGET = "https://id.jobstreet.com/id/frontend-developer-jobs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: process.env.HEADFUL !== "1",
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1366,850",
    "--lang=id-ID",
  ],
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

function isChallenge(t) {
  return /just a moment|tunggu sebentar|attention required/i.test(t);
}

try {
  const resp = await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("nav status:", resp?.status());
  await page.waitForTimeout(5_000);
  console.log("title:", (await page.title()).slice(0, 60));

  if (isChallenge(await page.title())) {
    // find the CF challenge / Turnstile iframe and try clicking its checkbox
    const frames = page.frames().filter((f) => /challenges\.cloudflare\.com|turnstile/i.test(f.url()));
    console.log("CF frames found:", frames.length, frames.map((f) => f.url().slice(0, 60)));
    for (const fr of frames) {
      for (const sel of ['input[type="checkbox"]', "#challenge-stage", ".ctp-checkbox-label", "body"]) {
        try {
          const el = fr.locator(sel).first();
          await el.waitFor({ state: "visible", timeout: 3_000 });
          await el.click({ timeout: 3_000 });
          console.log(`clicked ${sel} in CF frame`);
          break;
        } catch (e) {
          console.log(`click ${sel}: ${String(e).slice(0, 70)}`);
        }
      }
    }
    // also try clicking the center of the visible iframe element on the page
    try {
      const box = await page.locator("iframe[src*='challenges.cloudflare.com']").first().boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log("clicked iframe center", JSON.stringify(box));
      }
    } catch (e) {
      console.log("iframe-center click failed:", String(e).slice(0, 70));
    }
    await page.waitForTimeout(9_000);
    console.log("title after click:", (await page.title()).slice(0, 60));
  }

  const passed = !isChallenge(await page.title());
  console.log("challenge passed:", passed);
  if (passed) {
    const html = await page.content();
    console.log("html len:", html.length, "| JSON-LD JobPosting:", (html.match(/"@type"\s*:\s*"JobPosting"/g) || []).length);
    console.log("jobTitle cards:", await page.locator('[data-automation="jobTitle"]').count());
    writeFileSync("scripts/js-probe.html", html);
  }
  const cookies = await ctx.cookies("https://id.jobstreet.com");
  const cf = cookies.find((c) => c.name === "cf_clearance");
  console.log("cf_clearance:", cf ? `${cf.value.slice(0, 24)}... (len ${cf.value.length}, expires ${new Date(cf.expires * 1000).toISOString()})` : "NOT OBTAINED");
  writeFileSync("scripts/js-cookies.json", JSON.stringify(cookies, null, 2));
  await page.screenshot({ path: "scripts/js-probe2.png" });
} catch (err) {
  console.log("PROBE ERROR:", err?.message ?? err);
}
await browser.close();
