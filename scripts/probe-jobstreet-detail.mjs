// Probe lanjutan: (1) SEO keyword URL JobStreet, (2) JSON-LD detail page,
// (3) Glints URL yang benar + GraphQL ops-nya.
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

// 1. SEO keyword URL
{
  const page = await browser.newPage({ userAgent: UA });
  await stealth(page);
  try {
    await page.goto("https://id.jobstreet.com/id/frontend-developer-jobs", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(9000);
    console.log("== SEO URL frontend-developer-jobs ==");
    console.log("title:", (await page.title()).slice(0, 90));
    const links = await page.$$eval("a", (els) =>
      els.map((e) => e.getAttribute("href")).filter((h) => h && /\/id\/job\/\d+/.test(h)),
    );
    console.log("unique job ids:", new Set(links.map((h) => h.match(/\d+/)[0])).size);
  } catch (e) {
    console.log("SEO URL FAIL:", e.message.slice(0, 120));
  }
  await page.close();
}

// 2. Detail page JSON-LD
{
  const page = await browser.newPage({ userAgent: UA });
  await stealth(page);
  try {
    await page.goto("https://id.jobstreet.com/id/job/89180406", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(8000);
    console.log("\n== detail page 89180406 ==");
    console.log("title:", (await page.title()).slice(0, 90));
    const lds = await page.$$eval('script[type="application/ld+json"]', (els) =>
      els.map((e) => e.textContent.trim()),
    );
    for (const ld of lds) {
      try {
        const j = JSON.parse(ld);
        const graph = j["@graph"] ?? [j];
        const posting = graph.find((x) => x["@type"] === "JobPosting");
        if (posting) {
          console.log("JobPosting ld+json DITEMUKAN:");
          console.log("  title:", posting.title);
          console.log("  org:", posting.hiringOrganization?.name);
          console.log("  datePosted:", posting.datePosted);
          console.log("  employmentType:", posting.employmentType);
          console.log("  desc len:", (posting.description || "").length);
          const loc = posting.jobLocation?.[0]?.address;
          console.log("  location:", loc ? `${loc.addressLocality}, ${loc.addressRegion}` : null);
          console.log("  salary:", JSON.stringify(posting.baseSalary ?? null).slice(0, 150));
        }
      } catch {}
    }
  } catch (e) {
    console.log("detail FAIL:", e.message.slice(0, 120));
  }
  await page.close();
}

// 3. Glints — URL benar + GraphQL ops
{
  const page = await browser.newPage({ userAgent: UA });
  await stealth(page);
  const gql = [];
  page.on("request", (req) => {
    if (req.url().includes("graphql") && req.method() === "POST") {
      gql.push((req.postData() ?? "").slice(0, 160));
    }
  });
  try {
    await page.goto("https://glints.com/id/opportunities", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(12000);
    console.log("\n== Glints /id/opportunities ==");
    console.log("title:", (await page.title()).slice(0, 90));
    const links = await page.$$eval("a", (els) =>
      els
        .map((e) => e.getAttribute("href"))
        .filter((h) => h && /opportunities\/.+/.test(h) && !/opportunities\?/.test(h)),
    );
    console.log("detail links:", new Set(links).size, "| sample:", [...new Set(links)].slice(0, 3));
    console.log("GraphQL ops:");
    [...new Set(gql)].slice(0, 6).forEach((g) => console.log("  ", g.slice(0, 150)));
  } catch (e) {
    console.log("Glints FAIL:", e.message.slice(0, 120));
  }
  await page.close();
}

await browser.close();
