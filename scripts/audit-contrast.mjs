// Contrast audit: untuk tiap view × tema, hitung WCAG contrast ratio
// semua elemen teks visible terhadap effective background-nya.
// Fail: < 4.5:1 (teks normal), < 3:1 (teks besar ≥24px / bold ≥18.66px).
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const VIEWS = [
  ["overview", "Dashboard"],
  ["search", "Cari LokerBase"],
  ["jobs", "Jobs"],
  ["sources", "Sources"],
  ["activity", "Activity Console"],
  ["settings", "Settings"],
];

function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function parse(s) {
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
}
function ratio(fg, bg) {
  const l1 = lum(fg), l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function blend(fg, bg) {
  const out = [0, 1, 2].map((i) => fg.rgb[i] * fg.a + bg.rgb[i] * (1 - fg.a));
  return { rgb: out, a: 1 };
}

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] });

async function auditTheme(theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await context.newPage();
  console.log(`\n===== TEMA: ${theme.toUpperCase()} =====`);
  for (const [key, label] of VIEWS) {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3_500);
    try {
      await page.click(`aside button:has-text("${label}")`, { timeout: 5_000 });
      await page.waitForTimeout(1_800);
    } catch { /* view default */ }

    const issues = await page.evaluate(() => {
      const parse = (s) => {
        const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
      };
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const blend = (fg, bg) => ({ rgb: [0, 1, 2].map((i) => fg.rgb[i] * fg.a + bg.rgb[i] * (1 - fg.a)), a: 1 });
      const WHITE = { rgb: [255, 255, 255], a: 1 };

      const fails = [];
      const seen = new Set();
      const els = document.querySelectorAll("body *");
      let sampled = 0;
      for (const el of els) {
        if (sampled > 1500) break;
        if (!(el instanceof HTMLElement) || el.children.length > 0) continue;
        const text = (el.textContent ?? "").trim();
        if (text.length < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const fgRaw = parse(cs.color);
        if (!fgRaw) continue;
        // effective bg: ancestor pertama yang opaque
        let bg = null, node = el;
        while (node && node instanceof Element) {
          const bgs = parse(getComputedStyle(node).backgroundColor);
          if (bgs && bgs.a >= 0.999) { bg = bgs; break; }
          if (bgs && bg === null) bg = bgs;
          node = node.parentElement;
        }
        if (!bg) bg = WHITE;
        const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
        const px = parseFloat(cs.fontSize);
        const bold = +cs.fontWeight >= 600;
        const large = px >= 24 || (bold && px >= 18.66);
        const need = large ? 3 : 4.5;
        const r = ratio(fg.rgb, bg.rgb);
        sampled++;
        if (r < need) {
          const key = `${cs.color}|${text.slice(0, 22)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fails.push({
            text: text.slice(0, 34),
            ratio: +r.toFixed(2),
            need,
            cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 70),
            tag: el.tagName.toLowerCase(),
          });
        }
      }
      return fails.slice(0, 12);
    });

    if (issues.length === 0) {
      console.log(`  ✓ ${key}: lolos`);
    } else {
      console.log(`  ✗ ${key}: ${issues.length} kombinasi di bawah threshold`);
      for (const i of issues) console.log(`      ${i.ratio}:1 (butuh ${i.need}) <${i.tag} class="${i.cls}"> "${i.text}"`);
    }
  }
  await context.close();
}

await auditTheme("dark");
await auditTheme("light");
await browser.close();
console.log("\naudit done");
