// Probe terakhir: karir.com & dealls.com via Playwright (system Chrome).
// Pertanyaan: apakah listing job ke-render di browser dari IP datacenter?
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox"],
});

async function probe(name, url, linkPattern) {
  const page = await browser.newPage({ userAgent: UA });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000); // tunggu client render
    const title = await page.title();
    const links = await page.$$eval(
      "a",
      (els, pat) =>
        els
          .map((e) => e.getAttribute("href"))
          .filter((h) => h && new RegExp(pat).test(h)),
      linkPattern,
    );
    const uniq = [...new Set(links)];
    console.log(`== ${name} ==`);
    console.log("title:", title);
    console.log("job detail links:", uniq.length);
    console.log("sample:", uniq.slice(0, 3));
    const ld = await page.$$eval(
      'script[type="application/ld+json"]',
      (els) => els.map((e) => e.textContent),
    );
    const jobLd = ld.filter((t) => t.includes("JobPosting"));
    console.log("ld+json JobPosting blocks:", jobLd.length);
    if (jobLd.length > 0) console.log(" ld sample:", jobLd[0].replace(/\s+/g, " ").slice(0, 250));
  } catch (e) {
    console.log(`== ${name} == FAIL:`, e.message);
  }
  await page.close();
}

await probe("karir.com", "https://karir.com", "/lowongan|/job|/karir");
await probe("dealls.com", "https://dealls.com/jobs", "/jobs?|/job-");
await browser.close();
