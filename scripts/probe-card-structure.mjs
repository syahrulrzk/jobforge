// Struktur kartu job (JobStreet article, Glints card) + URL keyword Glints.
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

// A. JobStreet: struktur <article> — dump lines + link + cek salary line
{
  const page = await browser.newPage({ userAgent: UA });
  await stealth(page);
  try {
    await page.goto("https://id.jobstreet.com/id/admin-jobs", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(9000);
    const cards = await page.$$eval("article", (els) =>
      els.slice(0, 3).map((e) => ({
        lines: e.innerText.split("\n").map((l) => l.trim()).filter(Boolean),
        href: e.querySelector("a[href*='/id/job/']")?.getAttribute("href") ?? null,
      })),
    );
    console.log("== JobStreet articles ==");
    cards.forEach((c, i) => {
      console.log(`[${i}] href: ${c.href?.slice(0, 60)}`);
      c.lines.forEach((l, j) => console.log(`    ${j}: ${l.slice(0, 90)}`));
    });
  } catch (e) {
    console.log("JS FAIL:", e.message.slice(0, 120));
  }
  await page.close();
}

// B. Glints: keyword URL + struktur kartu
{
  const page = await browser.newPage({ userAgent: UA });
  await stealth(page);
  try {
    await page.goto("https://glints.com/id/lowongan-kerja?keyword=admin", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(12000);
    console.log("\n== Glints ?keyword=admin ==");
    console.log("title:", (await page.title()).slice(0, 90));
    const links = await page.$$eval("a", (els) =>
      els.map((e) => e.getAttribute("href")).filter((h) => h && /\/id\/opportunities\/jobs\/[^/]+\/[0-9a-f-]{20,}/.test(h)),
    );
    console.log("detail links:", new Set(links).size, "| sample:", [...new Set(links)].slice(0, 2).map((h) => h.slice(0, 80)));

    // dump struktur kartu: cari anchor detail, naik ke card container, ambil teks
    const cards = await page.$$eval("a[href*='/id/opportunities/jobs/']", (els) =>
      els.slice(0, 2).map((a) => {
        let node = a;
        for (let i = 0; i < 5 && node.parentElement; i++) node = node.parentElement;
        return { href: a.getAttribute("href")?.slice(0, 70), text: node.innerText.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10) };
      }),
    );
    cards.forEach((c, i) => {
      console.log(`  card[${i}] ${c.href}`);
      c.text.forEach((t, j) => console.log(`    ${j}: ${t.slice(0, 80)}`));
    });
  } catch (e) {
    console.log("Glints FAIL:", e.message.slice(0, 120));
  }
  await page.close();
}

await browser.close();
