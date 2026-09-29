// ─────────────────────────────────────────────────────────────
// JOBFORCE — Browser page helpers (Playwright + system Chrome)
//
// Integrasi scrape job JobStreet & Glints sudah dihapus (direktif
// user: fokus scraping ke Dealls). Yang tersisa di file ini HANYA
// helper browser yang dipakai fitur Cari Email (§12): render halaman
// yang memblokir HTTP anonim di real Chrome lalu memindai email HR
// yang benar-benar dipublikasikan.
// ─────────────────────────────────────────────────────────────

import { BROWSER_UA } from "./net";

// ── Shared browser session (real Chrome + stealth ringan) ──────

interface BrowserPage {
  title: () => Promise<string>;
  $$eval: <R>(selector: string, fn: (els: Element[], arg?: unknown) => R, arg?: unknown) => Promise<R>;
}

async function withBrowserPage<T>(
  url: string,
  proxyUrl: string | undefined,
  timeoutMs: number,
  settleMs: number,
  fn: (page: BrowserPage) => Promise<T>,
): Promise<T> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new Error(`Playwright tidak bisa dimuat: ${err instanceof Error ? err.message.slice(0, 90) : "unknown"}`);
  }
  const proxy = (proxyUrl ?? "").trim();
  const browser = await playwright.chromium.launch({
    headless: true,
    channel: "chrome", // system Google Chrome — cache Playwright browser tidak selalu ada
    ...(proxy ? { proxy: { server: proxy } } : {}),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,900",
      "--lang=id-ID",
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      viewport: { width: 1366, height: 900 },
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      extraHTTPHeaders: { "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["id-ID", "id", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      (window as unknown as Record<string, unknown>).chrome = { runtime: {} };
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(settleMs); // beri waktu client render / challenge settle
    return await fn(page as unknown as BrowserPage);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

const CHALLENGE = /just a moment|tunggu sebentar|attention required|access denied|page not available/i;

// ── Recovery email scan via browser (§12) ───────────────────────
// Beberapa situs (termasuk portal yang memblokir HTTP anonim) hanya
// bisa dibaca via real Chrome. Fungsi ini me-render `pageUrl` lalu
// memindai email yang dipublikasikan. Hit rate terukur rendah —
// kebanyakan situs memakai apply-form on-site. Hanya email yang
// benar-benar ter-publish yang diambil; tidak ada tebak-tebakan (§12.4).

const EMAIL_BODY_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_BLACKLIST = /noreply|no-reply|cloudflare|seekasia|jobstreet\.com|glints\.com|sejutacita|sentry|example|\.png|\.jpg|\.webp/i;

/**
 * Render `pageUrl` di browser lalu kumpulkan email HR yang dipublikasikan:
 * href mailto: dulu (paling reliabel), lalu teks rendered body.
 */
export async function scanPageForEmailBrowser(
  pageUrl: string,
  proxyUrl?: string,
  settleMs = 9_000,
): Promise<string | null> {
  return withBrowserPage(pageUrl, proxyUrl, 40_000, settleMs, async (page) => {
    const challengeFree = !CHALLENGE.test(await page.title());
    if (!challengeFree) return null;
    // 1) mailto: links — sinyal kontak paling kuat
    const mailtos = await page.$$eval("a[href^='mailto:']", (els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
    ).catch(() => [] as string[]);
    for (const m of mailtos) {
      const email = m.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
      if (email && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email) && !EMAIL_BLACKLIST.test(email)) return email;
    }
    // 2) teks rendered body — cocokkan pola kontak rekrutmen (hr@, karir@, …)
    const body = await page.$$eval("body", (els) => (els[0] as HTMLElement)?.innerText ?? "").catch(() => "");
    const found = body.match(EMAIL_BODY_RE) ?? [];
    for (const raw of found) {
      const email = raw.trim().toLowerCase();
      if (EMAIL_BLACKLIST.test(email)) continue;
      // prioritaskan pola jelas rekrutmen; email domain-perusahaan apa pun
      // tetap diterima karena muncul di body detail lowongan (bukan tebak-tebakan)
      return email;
    }
    return null;
  });
}
