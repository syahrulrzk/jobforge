// Dump href patterns dari karir.com & dealls.com utk menemukan struktur listing job.
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox"],
});

async function dump(name, url, waitMs) {
  const page = await browser.newPage({ userAgent: UA });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(waitMs);
    const hrefs = await page.$$eval("a", (els) => els.map((e) => e.getAttribute("href")).filter(Boolean));
    const uniq = [...new Set(hrefs)];
    console.log(`== ${name} == total uniq hrefs:`, uniq.length);
    // kelompokkan by first path segment
    const bySeg = {};
    for (const h of uniq) {
      try {
        const u = new URL(h, url);
        const seg = "/" + u.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
        bySeg[seg] = (bySeg[seg] || 0) + 1;
      } catch {}
    }
    console.log("  path groups:", Object.entries(bySeg).sort((a, b) => b[1] - a[1]).slice(0, 12));
    // network requests ke API JSON
    const apiHits = [];
    page.on("response", (r) => {
      const ct = r.headers()["content-type"] || "";
      if (ct.includes("json") && r.url().includes("api")) apiHits.push(r.url());
    });
    await page.reload({ waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log("  api json hits:", [...new Set(apiHits)].slice(0, 10));
  } catch (e) {
    console.log(`== ${name} == FAIL:`, e.message);
  }
  await page.close();
}

await dump("karir.com", "https://karir.com", 8000);
await dump("dealls.com", "https://dealls.com/jobs", 8000);
await browser.close();
