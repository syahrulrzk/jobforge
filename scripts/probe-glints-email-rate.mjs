// Scan 6 detail Glints — seberapa sering email muncul di DOM?
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ userAgent: UA });
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const urls = [
  "https://glints.com/id/opportunities/jobs/sales-generalis-penempatan-cirebon/747334cc-9ccd-41ed-9d30-c02c9887c2ee",
  "https://glints.com/id/opportunities/jobs/live-operator-streaming-e-commerce/e41c0c69-aa65-4bfc-8057-1cf1d96b6c7f",
  "https://glints.com/id/opportunities/jobs/reflexology-therapist/82d612a6-5d7d-4b84-8204-f2e145450f19",
  "https://glints.com/id/opportunities/jobs/admin-perpajakan-dan-purchasing/7e820f7b-eb36-4f84-81f7-a82019395346",
  "https://glints.com/id/opportunities/jobs/sales-online/2c79c6a5-0987-4ccf-9245-0fbcafe23382",
  "https://glints.com/id/opportunities/jobs/human-resource-intern-trainee/4dc4807f-1c6e-4785-8074-ca34afd4ef8d",
];

let hit = 0;
for (const u of urls) {
  try {
    await page.goto(u, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(9000);
    const body = await page.locator("body").innerText();
    const emails = [...new Set(body.match(EMAIL_RE) ?? [])].filter(
      (e) => !/noreply|cloudflare|glints\.com|sentry|example/i.test(e),
    );
    console.log(u.split("/jobs/")[1].slice(0, 8), "->", emails.length ? emails.join(",") : "no email");
    if (emails.length) hit++;
  } catch (e) {
    console.log("FAIL", e.message.slice(0, 60));
  }
}
console.log(`\nhit rate: ${hit}/${urls.length}`);
await browser.close();
