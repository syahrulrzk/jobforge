// Probe detail page: apakah email HR / mailto muncul di DOM JobStreet & Glints?
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const stealth = async (page) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function scan(name, url, waitMs) {
  const page = await browser.newPage({ userAgent: UA });
  await stealth(page);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(waitMs);
    console.log(`== ${name} ==`);
    console.log("title:", (await page.title()).slice(0, 80));
    const body = await page.locator("body").innerText();
    // mailto links
    const mailtos = await page.$$eval("a[href^='mailto:']", (els) =>
      els.map((e) => e.getAttribute("href")),
    );
    console.log("mailto links:", mailtos.length, mailtos.slice(0, 3));
    // email di body text
    const emails = [...new Set(body.match(EMAIL_RE) ?? [])].filter(
      (e) => !/noreply|no-reply|cloudflare|seekasia|jobstreet\.com|glints\.com|sentry|example/i.test(e),
    );
    console.log("emails in body:", emails.length, emails.slice(0, 5));
    // desc length (job description sanity)
    console.log("body length:", body.length);
  } catch (e) {
    console.log(`== ${name} == FAIL:`, e.message.slice(0, 120));
  }
  await page.close();
}

await scan("JobStreet detail", "https://id.jobstreet.com/id/job/94591182", 8000);
await scan("Glints detail", "https://glints.com/id/opportunities/jobs/sales-generalis-bank-mandiri-penempatan-karawang/68241683-eac4-4fef-bc83-e3f49f709456", 12000);
await browser.close();
