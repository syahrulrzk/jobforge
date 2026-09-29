// ─────────────────────────────────────────────────────────────
// Restrukturisasi .env ala Laravel (rapi, terkelompok, komentar).
// Value asli dipertahankan PERSIS — file ini hanya menyusun ulang.
// Tidak ada value yang di-print ke stdout (aman terhadap log).
//
// Jalankan: npx tsx scripts/reorganize-env.ts
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "fs";

function parseEnv(path: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) map.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
  }
  return map;
}

const original = parseEnv(".env");
const required = ["DATABASE_URL", "GOOGLE_CSE_KEY", "GOOGLE_CSE_CX"];
for (const k of required) {
  if (!original.has(k)) {
    console.error(`Key wajib hilang dari .env lama: ${k} — dibatalkan.`);
    process.exit(1);
  }
}

const v = (k: string) => original.get(k) ?? "";

const content = `# ═══════════════════════════════════════════════════════════════
#  JOBFORCE — Environment Configuration
#  Format ala Laravel: terkelompok per-seksi, ada komentar.
#  JANGAN commit file ini (sudah didaftarkan di .gitignore).
# ═══════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────
# 1. APPLICATION
# ─────────────────────────────────────────────
# Baris di bawah ini belum dibaca kode — disiapkan biar konsisten
# kalau nanti butuh (mis. metadata layout, akses admin, dsb).
APP_NAME="JobForge"
APP_ENV=local                  # local | staging | production
APP_URL=http://localhost:3000
# NODE_ENV=development         # Next.js mengatur ini otomatis — JANGAN di-set di sini

# ─────────────────────────────────────────────
# 2. DATABASE  (WAJIB — dipakai Prisma)
# ─────────────────────────────────────────────
# Provider: PostgreSQL. Local dev via docker-compose (service postgres).
DATABASE_URL=${v("DATABASE_URL")}

# ─────────────────────────────────────────────
# 3. EMAIL FINDER — Google Programmable Search
# ─────────────────────────────────────────────
# Dipakai fitur "Cari Email" & "People Search" (mode Google CSE).
# Kosong = fitur fallback ke mode lain (harvest/mailto) tetap jalan.
GOOGLE_CSE_KEY=${v("GOOGLE_CSE_KEY")}
GOOGLE_CSE_CX=${v("GOOGLE_CSE_CX")}

# ─────────────────────────────────────────────
# 4. PROXY  (opsional — scraper engine fallback)
# ─────────────────────────────────────────────
# Isi kalau target board mulai memblokir IP (403/429).
# JOBFORCE_PROXY_URL=           # contoh: http://user:pass@proxy.example.com:8080
# PROXY_URL=                    # alias lama, dipakai kalau JOBFORCE_PROXY_URL kosong

# ─────────────────────────────────────────────
# 5. CACHE / QUEUE  (opsional — docker-compose)
# ─────────────────────────────────────────────
# REDIS_URL dipass oleh docker-compose, tapi belum dipakai kode app.
# REDIS_URL=redis://localhost:6379

# ─────────────────────────────────────────────
# 6. ENGINE SETTINGS — DISIMPAN DI DATABASE, BUKAN ENV
# ─────────────────────────────────────────────
# Konfigurasi pipeline (API key portal, batch, retry, jadwal) ada di
# tabel "Setting" dan dikelola dari Dashboard → Settings. Kuncinya
# (referensi, jangan ditaruh di sini):
#   JOB_PORTAL_API_URL, JOB_PORTAL_API_KEY, BATCH_SIZE, MAX_ATTEMPTS,
#   AUTO_SCRAPE, AUTO_DELIVERY, TICK_INTERVAL_MS, DATA_MODE, ENGINE_POOL
`;

writeFileSync(".env", content, { mode: 0o600 });

// Verifikasi: value harus identik dengan sebelum restructure
const after = parseEnv(".env");
let ok = true;
for (const k of required) {
  const same = after.get(k) === original.get(k);
  if (!same) ok = false;
  console.log(`${same ? "✓" : "✗ GAGAL"} value ${k} dipertahankan`);
}
console.log(ok ? "\n.env restructure selesai — value 100% utuh ✓" : "\nADA VALUE BERUBAH — periksa manual!");
process.exit(ok ? 0 : 1);
