// Screenshot JobForge views in BOTH themes + contrast audit.
// Playwright (system Chrome). Theme set via localStorage theme (next-themes,
// no flash) + header toggle sanity check on first light view.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/tmp/shots";
const VIEWS = ["overview", "search", "jobs", "sources", "activity", "settings"];

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function shotTheme(theme) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5_000);

  // buka view via sidebar nav (client-side view state, bukan route)
  for (const view of VIEWS) {
    const label = { overview: "Dashboard", search: "Cari LokerBase", jobs: "Jobs", sources: "Sources", activity: "Activity Console", settings: "Settings" }[view];
    try {
      await page.click(`aside button:has-text("${label}")`, { timeout: 5_000 });
      await page.waitForTimeout(2_200);
      await page.screenshot({ path: `${OUT}/${theme}-${view}.png` });
      console.log(`✓ ${theme}/${view}`);
    } catch (e) {
      console.log(`✗ ${theme}/${view}: ${e.message.slice(0, 80)}`);
    }
  }

  // sanity: toggle button dari dark → light menampilkan Moon (target light)
  if (theme === "light") {
    const title = await page.locator('header button[title*="Ganti ke mode"]').getAttribute("title");
    console.log("toggle title di mode light:", title);
  }
  await context.close();
}

await shotTheme("dark");
await shotTheme("light");
await browser.close();
console.log("done");
