// ─────────────────────────────────────────────────────────────
// JOBFORCE — External OSINT tools bridge (Tools · Cari Email)
//
// Jembatan ke 3 tool yang sudah ter-install di host:
//
//   BBOT       (bbot)       — OSINT framework. Flag email-enum
//                           (emailformat, skymem, newsletters, pgp,
//                           hunterio …) mengumpulkan email yang
//                           benar-benar ter-publish untuk sebuah
//                           domain. Output JSON via --json -om json.
//   HOLEHE     (holehe)     — cek apakah sebuah email terdaftar di
//                           ~120 layanan (verifikasi keberadaan
//                           email, bukan tebakan). Output JSON via
//                           --json (atau -C CSV → dinormalisasi).
//   TESSERACT  (tesseract)  — OCR screenshot halaman; beberapa situs
//                           (LinkedIn included) merender kontak
//                           sebagai gambar — email tak terbaca di
//                           HTML tapi terbaca di pixel.
//
// Semua wrapper: timeout ketat, tidak pernah melempar — return
// struktur hasil + pesan gagal yang jujur.
// ─────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BBOT_TIMEOUT_MS = 180_000; // scan email-enum bisa 1–3 menit
const HOLEHE_TIMEOUT_MS = 90_000; // ~120 situs, paralel di dalam tool
const OCR_TIMEOUT_MS = 30_000;
const OCR_MIN_W = 900; // screenshot terlalu kecil → tesseract susah baca

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, HOME: process.env.HOME ?? "/tmp" } });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: `spawn gagal: ${e instanceof Error ? e.message : "unknown"}`, timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    // bbot: tanpa TTY, install-deps memanggil getpass → hang/EOF. Pipakan
    // stdin kosong yang langsung ditutup membuat prompt sudo segera gagal
    // alih-alih menunggu timeout penuh.
    child.stdin?.end();
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000); // jaga memori
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Tool ada di PATH? (sandbox/host bisa beda) */
export async function toolAvailable(cmd: string): Promise<boolean> {
  const r = await run("which", [cmd], 5_000);
  return r.code === 0 && r.stdout.trim().length > 0;
}

// ── BBOT — email enumeration per domain ─────────────────────────
export interface BbotResult {
  ok: boolean;
  emails: { email: string; source: string }[];
  note: string;
  durationMs: number;
}

/**
 * Jalankan BBOT email-enum untuk satu domain.
 * Hanya modul pasif (safe, non-intrusive): emailformat, skymem,
 * newsletters, pgp + hunterio kalau API key tersedia.
 *
 * CATATAN SANDBOX: BBOT mencoba install deps saat run pertama dan minta
 * sudo password (getpass) — tanpa TTY itu EOFError/crash. Solusi:
 * stdin "echo" tetap disediakan, dan kegagalan install diteruskan sebagai
 * pesan jujur (helper lain seperti OCR tetap jalan).
 */
export async function bbotEmailEnum(domain: string): Promise<BbotResult> {
  const started = Date.now();
  const outDir = await mkdtemp(path.join(tmpdir(), "bbot-jobforge-"));
  try {
    const args = [
      "-t",
      domain,
      "-m",
      "emailformat,skymem,newsletters,pgp",
      "--flags",
      "safe",
      "-y",
      "--no-color",
      "-om",
      "json",
      "-o",
      outDir,
    ];
    const r = await run("bbot", args, BBOT_TIMEOUT_MS);
    // BBOT menulis output ke output/<scan>/output.json — glob manual
    const emails = new Map<string, string>();
    if (r.stdout) collectBbotJson(r.stdout, emails);
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(outDir, { withFileTypes: true });
      for (const dir of entries) {
        if (!dir.isDirectory()) continue;
        const scanDir = path.join(outDir, dir.name);
        const files = await readdir(scanDir).catch(() => [] as string[]);
        for (const f of files) {
          if (f.endsWith(".json")) {
            const content = await readFile(path.join(scanDir, f), "utf8").catch(() => "");
            if (content) collectBbotJson(content, emails);
          }
        }
      }
    } catch {
      /* output dir kosong — biarkan hasil dari stdout */
    }

    if (r.timedOut) {
      return { ok: emails.size > 0, emails: [...emails].map(([email, source]) => ({ email, source })), note: "timeout 180s — hasil parsial dipakai", durationMs: Date.now() - started };
    }
    if (r.code !== 0 && emails.size === 0) {
      const errLine = (r.stderr || r.stdout).split("\n").find((l) => /error|not found|no module|unrecognized|sudo|password/i.test(l)) ?? "";
      return {
        ok: false,
        emails: [],
        note: errLine
          ? `bbot gagal: ${errLine.trim().slice(0, 140)}`
          : "bbot tidak menemukan email (atau gagal install deps di host ini)",
        durationMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      emails: [...emails].map(([email, source]) => ({ email, source })),
      note: emails.size > 0 ? `${emails.size} email dari modul email-enum` : "bbot selesai — tidak ada email ter-publish di sumber pasif",
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function collectBbotJson(raw: string, into: Map<string, string>): void {
  // BBOT JSON: newline-delimited event atau array — ambil EMAIL_ADDRESS events
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const obj = JSON.parse(s) as {
        type?: string;
        data?: { type?: string; value?: string; source?: string };
      };
      const value = obj.data?.value ?? "";
      const type = obj.data?.type ?? obj.type ?? "";
      if (type.includes("EMAIL_ADDRESS") && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value)) {
        const email = value.toLowerCase();
        if (!into.has(email)) into.set(email, obj.data?.source ?? "bbot");
      }
    } catch {
      /* bukan JSON — lewati */
    }
  }
}

// ── HOLEHE — verifikasi keberadaan email ────────────────────────
export interface HoleheResult {
  ok: boolean;
  /** true = email terdaftar di minimal satu layanan (ada aslinya) */
  exists: boolean;
  usedOn: string[];
  note: string;
  durationMs: number;
}

/** Jalankan holehe untuk satu email — verifikasi email nyata via 120+ situs. */
export async function holeheVerify(email: string): Promise<HoleheResult> {
  const started = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "holehe-jobforge-"));
  const csvPath = path.join(dir, "out.csv");
  try {
    const r = await run("holehe", [email, "--csv", "--no-color", "-T", "12"], HOLEHE_TIMEOUT_MS, dir);
    const usedOn: string[] = [];
    const csv = await readFile(csvPath, "utf8").catch(() => "");
    if (csv) {
      for (const line of csv.split("\n")) {
        // format: Email,Target,Password-Recovery,HTTP-Status,Timeout
        const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        if (cols.length >= 5 && cols[1] && cols[1] !== "Target") {
          const recovery = cols[2].toLowerCase();
          const status = cols[3];
          if (recovery === "used" || status === "200") usedOn.push(cols[1]);
        }
      }
    } else if (r.stdout) {
      // fallback parse output teks: "[+] xxx.com — used"
      for (const m of r.stdout.matchAll(/\[\+\]\s*([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        usedOn.push(m[1].toLowerCase());
      }
    }
    if (r.timedOut) {
      return { ok: true, exists: usedOn.length > 0, usedOn, note: `timeout — parsial: ${usedOn.length} layanan terdeteksi`, durationMs: Date.now() - started };
    }
    return {
      ok: true,
      exists: usedOn.length > 0,
      usedOn: [...new Set(usedOn)].slice(0, 12),
      note: usedOn.length > 0 ? `terverifikasi terdaftar di ${usedOn.length} layanan (contoh: ${usedOn.slice(0, 3).join(", ")})` : "tidak terdaftar di layanan mana pun — kemungkinan email mati/typo",
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── TESSERACT — OCR screenshot halaman ──────────────────────────
export interface OcrResult {
  ok: boolean;
  text: string;
  emails: string[];
  note: string;
  durationMs: number;
}

/**
 * Screenshot halaman pakai Playwright (system Chrome) lalu OCR dengan
 * tesseract — memunculkan email yang dirender sebagai gambar/kanvas.
 */
export async function ocrPageForEmails(url: string, settleMs = 6_000, proxyUrl?: string): Promise<OcrResult> {
  const started = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "ocr-jobforge-"));
  const shotPath = path.join(dir, "page.png");
  try {
    const { BROWSER_UA } = await import("./net");
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled", "--lang=id-ID"],
      // browser ikut lewat proxy bila pool aktif — blokir anti-bot biasanya per-IP
      ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
    });
    let shotOk = false;
    try {
      const context = await browser.newContext({
        userAgent: BROWSER_UA,
        viewport: { width: 1366, height: 1000 },
        locale: "id-ID",
        timezoneId: "Asia/Jakarta",
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
      await page.waitForTimeout(settleMs);
      await page.screenshot({ path: shotPath, fullPage: true });
      shotOk = true;
    } finally {
      await browser.close().catch(() => undefined);
    }
    if (!shotOk) return { ok: false, text: "", emails: [], note: "screenshot gagal", durationMs: Date.now() - started };

    // fullPage bisa sangat panjang — scale ke 1400px lebar biar OCR akurat & cepat
    const r = await run(
      "tesseract",
      [shotPath, "stdout", "--psm", "6", "-l", "eng+ind"],
      OCR_TIMEOUT_MS,
    );
    const text = r.stdout ?? "";
    const emails = [
      ...new Set(
        (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.trim().toLowerCase()),
      ),
    ].filter((e) => !/noreply|no-reply|example|sentry|\.png|\.jpg/i.test(e));

    const note =
      emails.length > 0
        ? `OCR menemukan ${emails.length} email di gambar halaman${proxyUrl ? " (via proxy)" : ""}`
        : r.timedOut
          ? "OCR timeout"
          : `OCR selesai — tidak ada email di gambar${proxyUrl ? " (via proxy)" : ""}`;
    return { ok: true, text: text.slice(0, 20_000), emails, note, durationMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      text: "",
      emails: [],
      note: `OCR gagal: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"}`,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
