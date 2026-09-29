// Verifikasi presisi avatar di halaman Companies:
// hitung img logo vs fallback initials (div amber 1-2 char) + deteksi img broken.
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /^companies$/i }).first().click();
await page.waitForTimeout(3000);
const result = await page.evaluate(() => {
  const initialsDivs = [...document.querySelectorAll("div")].filter((d) => {
    const t = (d.textContent || "").trim();
    const cls = d.className || "";
    return t.length <= 2 && t.length > 0 && typeof cls === "string" && cls.includes("from-amber-500");
  });
  const logoImgs = [...document.querySelectorAll("img[alt^='Logo']")];
  const broken = logoImgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 80));
  return {
    totalAvatars: logoImgs.length + initialsDivs.length,
    imgLogos: logoImgs.length,
    badgeSvg: logoImgs.filter((i) => i.src.startsWith("data:image/svg")).length,
    initialsFallback: initialsDivs.map((d) => d.textContent.trim()),
    brokenImgs: broken,
  };
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
