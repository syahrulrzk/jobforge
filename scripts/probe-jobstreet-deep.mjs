// Deep probe JobStreet: struktur kartu job, ld+json, URL search keyword,
// dan detail request GraphQL (operation name) yang dipanggil listing page.
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

const page = await browser.newPage({ userAgent: UA, viewport: { width: 1366, height: 900 } });
const gqlOps = [];
page.on("request", (req) => {
  const u = req.url();
  if (u.includes("graphql")) {
    const post = req.postData()?.slice(0, 200) ?? "(no body)";
    gqlOps.push(`${req.method()} ${u.slice(0, 80)} :: ${post}`);
  }
});

try {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // Keyword search URL — format SEEK: /id/jobs/<keyword>? atau ?what=
  await page.goto("https://id.jobstreet.com/id/jobs?what=frontend%20developer", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForTimeout(10000);
  console.log("title:", await page.title());

  // ld+json blocks di rendered DOM
  const lds = await page.$$eval('script[type="application/ld+json"]', (els) =>
    els.map((e) => e.textContent.trim().slice(0, 300)),
  );
  console.log("\nld+json blocks:", lds.length);
  lds.slice(0, 3).forEach((l) => console.log("  ", l.replace(/\s+/g, " ").slice(0, 220)));

  // kartu job: ambil teks 3 kartu pertama (struktur SEEK: title, company, lokasi)
  const cards = await page.$$eval("article", (els) =>
    els.slice(0, 3).map((e) => e.innerText.replace(/\n+/g, " | ").slice(0, 200)),
  );
  console.log("\narticle cards:", cards.length);
  cards.forEach((c, i) => console.log(`  [${i}]`, c));

  // jumlah link detail unik
  const links = await page.$$eval("a", (els) =>
    els.map((e) => e.getAttribute("href")).filter((h) => h && /\/id\/job\/\d+/.test(h)),
  );
  const uniqIds = new Set(links.map((h) => h.match(/\/id\/job\/(\d+)/)[1]));
  console.log("\nunique job ids:", uniqIds.size, "| sample:", [...uniqIds].slice(0, 5));

  // total hasil search (angka di header hasil)
  const bodyText = await page.locator("body").innerText();
  const count = bodyText.match(/([\d.,]+)\s+(?:Lowongan|lowongan|jobs)/);
  console.log("result count text:", count ? count[0] : "tidak ketemu");
  console.log("\nGraphQL ops:", gqlOps.length);
  gqlOps.slice(0, 4).forEach((g) => console.log("  ", g.slice(0, 180)));
} catch (e) {
  console.log("FAIL:", e.message.slice(0, 200));
}
await browser.close();
