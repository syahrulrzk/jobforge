# JobForge — Dokumentasi Implementasi Production

> **Job Scraping & Aggregation Engine** — pipeline pengumpul lowongan kerja dari board publik Indonesia, dengan sistem multi-engine failover, dedup fingerprint, discovery email HR, dan pengiriman (delivery) ke Job Portal via API.

| | |
|---|---|
| **Versi dokumen** | 1.0 |
| **Tanggal** | 12 September 2026 |
| **Audiens** | Developer & maintainer proyek |
| **Basis kode** | `/home/z/my-project` (Next.js App Router) |
| **Status sistem** | Berjalan — 5 source Indonesia (JobStreet ACTIVE, Glints/Indeed/Kalibrr/Karir.com INACTIVE) |

---

## Daftar Isi

1. [Ringkasan Sistem](#1-ringkasan-sistem)
2. [Arsitektur Sistem](#2-arsitektur-sistem)
3. [Lifecycle Job (Status Pipeline)](#3-lifecycle-job-status-pipeline)
4. [Sistem Multi-Engine](#4-sistem-multi-engine)
5. [Pipeline Terjadwal (Background Engine)](#5-pipeline-terjadwal-background-engine)
6. [Live Search (Scrape On-Demand)](#6-live-search-scrape-on-demand)
7. [Integrasi Source Nyata](#7-integrasi-source-nyata)
8. [Dedup & Fingerprint](#8-dedup--fingerprint)
9. [Discovery Email HR](#9-discovery-email-hr)
10. [Data Model (Prisma / SQLite)](#10-data-model-prisma--sqlite)
11. [API Reference](#11-api-reference)
12. [Frontend (Dashboard UI)](#12-frontend-dashboard-ui)
13. [Konfigurasi & Settings](#13-konfigurasi--settings)
14. [Deployment Production](#14-deployment-production)
15. [Monitoring & Observability](#15-monitoring--observability)
16. [Runbook Operasional](#16-runbook-operasional)
17. [Keamanan](#17-keamanan)
18. [Keterbatasan & Roadmap Hardening](#18-keterbatasan--roadmap-hardening)
19. [Lampiran: Scripts Utilitas](#19-lampiran-scripts-utilitas)

---

## 1. Ringkasan Sistem

JobForge adalah aplikasi web (dashboard + engine) yang mengotomasi pengumpulan lowongan kerja dari berbagai job board publik, menormalisasi dan mendeduplikasinya, mencari email HR pada setiap lowongan, lalu mengirimkan lowongan yang sudah lengkap ke Job Portal lewat endpoint import API. Seluruh alur dapat dipantau dari dashboard internal berbasis Next.js.

**Stack teknologi (dari `package.json`):**

| Layer | Teknologi |
|---|---|
| Framework | Next.js 16.1.1 (App Router, TypeScript 5), React 19 |
| Styling | Tailwind CSS 4 + shadcn/ui (Radix primitives), lucide-react, sonner (toast), recharts (grafik) |
| State client | zustand |
| Database | SQLite via Prisma ORM 6 (`prisma/dev.db`) |
| Networking | undici (fetch + ProxyAgent), Playwright 1.62 (Chromium headless) |
| Validasi | zod |
| Runtime production | bun (menjalankan `.next/standalone/server.js`) |

**Prinsip desain yang dipatuhi kode:**

1. **Honest reporting / no theater** — engine tidak pernah mengarang data. Jika sebuah board memblokir scraper (mis. JobStreet → HTTP 403 Cloudflare), sistem melaporkan gagal dengan status HTTP asli, bukan menampilkan data palsu. Data simulasi hanya ada di mode `DATA_MODE=mock` yang terpisah eksplisit (`src/lib/jobforge/data.ts`, `src/lib/jobforge/adapters.ts`).
2. **Semua job masuk DB (enrichment rule)** — lowongan yang datanya belum lengkap (mis. email HR belum ketemu) **tetap disimpan** ber-status `NEEDS_ENRICHMENT` dengan `statusReason`, bukan dibuang. Recovery worker dan scrape berikutnya yang bertugas melengkapinya.
3. **Konfigurasi source adalah sumber kebenaran** — daftar board, urutan engine (failover chain), proxy, header kustom, dan jadwal semuanya dibaca dari tabel `Source` di DB, bukan hardcode di UI.
4. **Dedup deterministik** — satu lowongan yang muncul di banyak board tetap satu baris `Job`, dengan provenance per-board di `JobSource`.

**Peta modul inti (`src/lib/jobforge/`):**

| File | Peran |
|---|---|
| `engine.ts` | Background engine: scheduler tick, scrape terjadwal, pipeline stage advance, delivery, recovery NEEDS_ENRICHMENT |
| `live-search.ts` | Scrape live on-demand per keyword dengan pilihan board (dari Data Sources) |
| `engines.ts` | Registry 5 engine (Cheerio/Crawlee/Puppeteer/Playwright/Selenium) + parser chain/pool |
| `net.ts` | Lapisan fetch: UA browser/bot, proxy per-source, custom headers, timeout |
| `sources-real.ts` | Integrasi nyata board publik (Remotive, Jobicy, Arbeitnow, RemoteOK, Himalayas, JobStreet) |
| `pipeline.ts` | Normalisasi, fingerprint, validasi email & job |
| `adapters.ts` | Adapter hasil scrape → `RawJobRecord` (termasuk generator mode mock) |
| `portal.ts` | Client & handler bulk import ke Job Portal (`processBulkImport`) |
| `types.ts` | Konstanta domain: status, schedule, error type, `SETTING_KEYS` |
| `schemas.ts` | Skema zod untuk create/update source |
| `data.ts` | Template data simulasi (khusus mode mock) |
| `logo.ts` | Resolusi logo perusahaan (Google favicon → DuckDuckGo → badge) |
| `bootstrap.ts` / `seed.ts` | Inisialisasi DB saat first boot (idempoten) |

---

## 2. Arsitektur Sistem

Sistem terdiri dari lima lapisan: **sumber data** (board publik + import manual), **lapisan eksekusi** (background engine tick + live search user-initiated), **pipeline pemrosesan** (normalize → enrich → validate → deliver), **penyimpanan** (SQLite tunggal), dan **konsumen** (Job Portal + dashboard UI). Kedua jalur eksekusi (terjadwal & live) bermuara ke logika ingest yang sama sehingga dedup dan aturan enrichment konsisten.

```mermaid
flowchart TB
    subgraph SRC["Sumber Data"]
        BOARD["Job board publik<br/>(Remotive, Jobicy, JobStreet, ...)"]
        IMPORT["Bulk import API<br/>/api/v1/jobs/import"]
    end

    subgraph EXEC["Lapisan Eksekusi"]
        TICK["Background engine tick<br/>engine.ts · startEngine()"]
        LIVE["Live search on-demand<br/>live-search.ts"]
        FORCE["Force run per source<br/>/api/sources/[id]/run"]
    end

    subgraph PIPE["Pipeline Pemrosesan"]
        CHAIN["Engine chain failover<br/>5 engine per setting source"]
        NORM["Normalize + fingerprint"]
        MAIL["Email HR discovery<br/>payload → deskripsi → mailto"]
        VALID["Validasi mandatory fields"]
        DELIVER["Delivery ke portal<br/>batch 25 · retry 3x"]
    end

    subgraph STORE["Penyimpanan"]
        DB[("SQLite / Prisma<br/>Job · JobSource · JobContact<br/>ScrapeRun · ScrapeError · ActivityLog")]
    end

    subgraph OUT["Konsumen"]
        PORTAL["Job Portal<br/>internal"]
        UI["Dashboard JobForge<br/>11 view"]
    end

    BOARD --> TICK
    BOARD --> LIVE
    IMPORT --> PORTAL
    TICK --> CHAIN
    LIVE --> CHAIN
    FORCE --> TICK
    CHAIN --> NORM --> MAIL --> VALID --> DELIVER
    DELIVER --> PORTAL
    PIPE --> DB
    DB --> UI
    DB --> PORTAL
```

**Prinsip arsitektur penting:**

- **Satu proses Node tunggal** menjalankan engine scheduler (in-process `setInterval`). Ini berarti produksi hanya boleh menjalankan **satu instance aplikasi** per database — dua instance akan saling berebut scrape dan delivery (lihat §14 dan §18).
- **Semua network egress lewat `sourceFetchText()`** (`src/lib/jobforge/net.ts`) sehingga proxy, header kustom, dan pilihan UA seragam di semua jalur (scrape terjadwal, live search, scan mailto, probe engine).
- **Delivery internal** memakai endpoint import yang sama (`/api/v1/jobs/import`) dengan yang dibuka untuk integrasi eksternal, sehingga aturan validasi portal selalu satu pintu.

---

## 3. Lifecycle Job (Status Pipeline)

Setiap lowongan punya status di kolom `Job.status` (`prisma/schema.prisma` §16–§17, konstanta di `src/lib/jobforge/types.ts → JOB_STATUSES`). Alur normal dan cabang gagal:

```mermaid
stateDiagram-v2
    [*] --> SCRAPED: ingest (email valid)
    [*] --> NEEDS_ENRICHMENT: ingest (tanpa email HR)
    SCRAPED --> PROCESSING
    PROCESSING --> ENRICHING
    ENRICHING --> VALIDATING
    VALIDATING --> READY: semua mandatory OK
    VALIDATING --> NEEDS_ENRICHMENT: ada field kurang
    VALIDATING --> REJECTED: field kritis hilang
    NEEDS_ENRICHMENT --> VALIDATING: recovery (email/logo ketemu)
    READY --> SENT: delivery sukses
    SENT --> PUBLISHED: portal konfirmasi
    NEEDS_ENRICHMENT --> [*]: tetap tersimpan, tidak dihapus
    REJECTED --> [*]
    PUBLISHED --> [*]
```

| Status | Arti | Ditulis oleh |
|---|---|---|
| `SCRAPED` | Baru masuk dari scrape, email HR sudah didapat | `ingestRecord()` (live-search.ts), engine ingest |
| `PROCESSING` | Sedang dinormalisasi (salary, employment type, dll.) | `advanceStageBatches()` (engine.ts) |
| `ENRICHING` | Sedang dilengkapi (company, logo, profil) | `advanceStageBatches()` |
| `VALIDATING` | Sedang dicek terhadap mandatory fields | `advanceStageBatches()` |
| `READY` | Lolos validasi, menunggu delivery | `validateJob()` (pipeline.ts) |
| `SENT` | Diterima endpoint import portal | `deliverReadyJobs()` (engine.ts) |
| `PUBLISHED` | Dikonfirmasi publish oleh portal (±4 detik) | tick loop (engine.ts) |
| `NEEDS_ENRICHMENT` | Job valid tapi belum lengkap (umumnya tanpa email HR) — **tetap di DB** | ingest / `validateJob()` / recovery loop |
| `REJECTED` | Field kritis hilang (judul kosong, dsb.) | `validateJob()` |
| `FAILED` | Kegagalan teknis pemrosesan | engine |

**Aturan enrichment (berlaku sejak revisi terakhir, direkayasa di `engine.ts` + `live-search.ts`):**

1. Job yang hanya kekurangan **email HR** TIDAK dihapus dan TIDAK di-skip. Ia disimpan dengan `statusReason` yang menjelaskan apa yang kurang, contoh: `NEEDS_ENRICHMENT: HR Email not available yet — email HR belum ditemukan di payload/description/posting page`.
2. **Recovery worker** (`engine.ts` — loop `NEEDS_ENRICHMENT`, query `where: { status: "NEEDS_ENRICHMENT", contact: null }`, urut `scrapedAt desc`, batch 24): mencoba ulang (a) pemulihan logo perusahaan, (b) live scan `mailto:` pada halaman postingan — satu kali per job per proses (dilacak `EngineState.mailtoScanned: Set<string>` agar tidak spam board).
3. **Recovery via live search**: jika job NEEDS_ENRICHMENT ditemukan lagi oleh scrape berikutnya dan payload baru membawa email, `ingestRecord()` membuat `JobContact` lalu mengembalikan job ke `VALIDATING` (hasil dihitung sebagai `enriched` pada response live search).
4. Job tanpa email tetap terlihat di Jobs view (badge kuning) dan terhitung di KPI dashboard.

**Mandatory fields (§17, `types.ts → MANDATORY_FIELDS`):** Company Name, Company Logo URL, Company Profile, Job Title, Job Description, HR Email, Source Platform, Source URL. Kehilangan field non-kritis → `NEEDS_ENRICHMENT`; field kritis (judul dsb.) → `REJECTED`. Logika lengkap di `validateJob()` (`src/lib/jobforge/pipeline.ts:138`).

---

## 4. Sistem Multi-Engine

JobForge mendefinisikan **5 engine scraping** yang diregistrasi di `src/lib/jobforge/engines.ts → ENGINES`. Setiap source (board) menentukan sendiri urutan engine-nya (kolom `Source.engines`, CSV), dan urutan itu adalah **failover chain**: engine pertama yang berhasil memegang pekerjaan; jika gagal, engine berikutnya mencoba.

| Engine | Kind | Teknologi | Latensi (simulasi) | Memory (telemetri) | Karakter |
|---|---|---|---|---|---|
| Cheerio | `http` | Node HTTP + CSS selector | 150–500 ms | 48 MB | Tercepat, cocok halaman statis & API JSON |
| Crawlee | `http` | Crawler framework | 300–900 ms | 96 MB | Auto-throttle, retry, request queue |
| Puppeteer | `browser` | Headless Chromium (DevTools) | 900–2600 ms | 384 MB | SPA berat; driver belum terpasang di host ini → fail-fast jujur |
| Playwright | `browser` | Chromium/Firefox/WebKit | 700–2200 ms | 400 MB | Multi-browser, auto-wait, **dipakai nyata untuk JobStreet browser path** |
| Selenium | `browser` | WebDriver/Grid | 1200–3200 ms | 448 MB | Legacy; driver belum terpasang di host ini → fail-fast jujur |

**API registry (`engines.ts`):**

- `parseEngineList(value, fallbackEngine)` — membangun chain dari CSV `Source.engines`; kosong → fallback ke `Source.engine` (primary). Hasil: `EngineKey[]` urut prioritas.
- `parseEnginePool(value)` — membaca setting global `ENGINE_POOL` (CSV). Chain source **di-interseksi** dengan pool global (§9.3 PRD): engine yang tidak aktif di pool tidak ikut; jika interseksi kosong, chain penuh source yang dipakai.
- `rotateEngine(pool, cursor)` — rotasi round-robin antar run terjadwal (membebani engine secara bergantian).
- `engineJitter(engine)` — latensi/kegagalan simulasi untuk mode telemetry (hanya relevan di mode mock).

**Catatan realitas host ini:** hanya **Playwright** yang punya driver browser terpasang (paket `playwright` di `package.json`, Chromium headless). Puppeteer & Selenium dideklarasikan di registry (UI menampilkan chain-nya) tetapi di runtime integrasi nyata mereka **fail-fast dengan pesan jujur** — contoh: `driver Selenium tidak tersedia di host ini — pakai Playwright atau HTTP engine + proxy` (`live-search.ts → BOARD_SEARCHES[jobstreet]`). Tidak ada pura-pura mencoba.

### 4.1 Lapisan jaringan (`src/lib/jobforge/net.ts`)

Semua fetch HTTP source melewati satu fungsi: `sourceFetchText(url, cfg, opts) → { ok, status, text }`.

| Fitur | Implementasi | Dipakai untuk |
|---|---|---|
| UA profil | `BROWSER_UA` (UA Chrome riil) vs `BOT_UA = "JobForgeBot/1.0 (+https://jobforge.local)"` | Browser engine & peniruan browser → UA browser; HTTP engine murni → UA bot |
| Proxy per source | `Source.proxyUrl` (format `http://user:pass@host:port` / SOCKS) → `proxyAgentFor()` (undici `ProxyAgent`) | **Kunci utama bypass anti-bot IP-based** (Cloudflare/Datadome) |
| Header kustom | `Source.headersJson` (JSON) → `parseHeadersJson()` | Menyuntik cookie clearance (mis. `cf_clearance`) hasil manual |
| Timeout | `opts.timeoutMs` (default scrape 12–15 s; probe 6 s) | Mencegah engine menggantung chain |

Konfigurasi proxy & headers di-set per source lewat UI Data Sources (form Add/Edit Source, komponen `sources.tsx`) — tidak perlu deploy ulang.

---

## 5. Pipeline Terjadwal (Background Engine)

Inti otomasi ada di `src/lib/jobforge/engine.ts`. Fungsi `startEngine()` memulai loop in-process:

```
startEngine()                       // dipanggil dari ensureBootstrap() saat app start
  └─ setInterval(tick, TICK_INTERVAL_MS)   // default 5000 ms, min 2000 ms
tick()                              // guard re-entrancy: state.ticking
  ├─ tickCount % 2 === 1  → AUTO_SCRAPE: scrape semua source ACTIVE yang jatuh tempo jadwal
  ├─ advanceStageBatches()         // dorong job melintasi pipeline (§3)
  ├─ deliverReadyJobs()            // kirim READY → portal (§ delivery di bawah)
  └─ tickCount % 40 === 0 → health check DB (demo mode bookkeeping)
```

**Scrape per source — `runScrapeForSource(sourceId, forced)`:**

1. Baca `Source` dari DB; tentukan jalur: **integrasi nyata** (`REAL_BOARDS[slug]`, `sources-real.ts`) jika ada dan `DATA_MODE=real`; selain itu **generator mock** (`adapters.ts → scrapeSource`, hanya untuk demo).
2. Real path: fetch listing (JSON API atau HTML+JSON-LD), parse → `RawJobRecord[]` (`adapters.ts:19`), simpan `ScrapeRun` dengan metrik (`jobsFound/Created/Updated/Rejected/Duplicate`, `errorCount`, `engine` yang jalan).
3. Ingest: fingerprint → dedup (§8) → email discovery (§9) → create `Job` + `JobSource` + (bila email ada) `JobContact`. Tanpa email → `NEEDS_ENRICHMENT` (bukan dihapus).
4. Gagal total (semua chain / anti-bot): `ScrapeRun.status=FAILED`, `ScrapeError` bertipe `SOURCE_BLOCKED`/`TIMEOUT`/`NETWORK_ERROR` (`realBoardError()`), `Source.status → ERROR`, semua tercatat di Activity Log. Ini perilaku jujur yang membuat status JobStreet kadang tampil `ERROR` setelah tick gagal — bukan bug.

**Stage advance — `advanceStageBatches()`:** batch terbatas per tick (`take: 18` untuk VALIDATING, semacamnya untuk stage lain) supaya tick tetap ringan. VALIDATING memanggil `validateJob()` lalu menulis status akhir + `statusReason`. **Tidak ada purge job tanpa email** — aturan lama "email-mandatory → hapus" sudah dicabut; job tetap disimpan sebagai `NEEDS_ENRICHMENT`.

**Delivery — `deliverReadyJobs()`:**

- Ambil `READY` tanpa delivery aktif → buat `ApiDelivery` (endpoint `DELIVERY_ENDPOINT = /api/v1/jobs/import`, `requestId` unik).
- Advance delivery `PENDING/SENDING`: panggil `processBulkImport()` (`portal.ts`) → sukses → job `SENT`; gagal → retry dengan backoff 5 s → 15 s → 45 s, maks `MAX_ATTEMPTS` (default 3), setelah itu `FAILED` + `ScrapeError(API_ERROR)`.
- `SENT → PUBLISHED` dikonfirmasi tick berikutnya (±4 s).
- ⚠️ Baris `engine.ts:797` mensimulasikan kegagalan transient (`chance(0.07)` ~7%) untuk mendemokan strategi retry §21 — **belum dinonaktifkan otomatis di production**; lihat §18 (hardening).

**Kontrol manual dari UI/API:**

- `POST /api/pipeline` → `runPipelineNow()`: paksa jalankan semua source ACTIVE sekarang.
- `POST /api/sources/[id]/run` → `runSourceNow(sourceId)`: force run satu source (dipakai tombol "Run now" di Data Sources).

---

## 6. Live Search (Scrape On-Demand)

Fitur "Cari LokerBase → Scrape Live" (`src/lib/jobforge/live-search.ts`, API `POST /api/search/live`, UI `search.tsx`) menjalankan scrape per keyword saat user menekan tombol — tanpa menunggu jadwal.

```mermaid
sequenceDiagram
    participant U as User (Search view)
    participant A as POST /api/search/live
    participant L as liveKeywordScrape()
    participant S as Source (DB)
    participant B as Board publik
    U->>A: q + sources[] (pilihan board)
    A->>L: validasi body
    L->>S: baca Source terpilih / ACTIVE
    L->>L: susun chain per source (§9.3)
    loop tiap engine di chain (failover)
        L->>B: fetch listing + keyword filter
        B-->>L: JSON / HTML+JSON-LD (atau 403)
    end
    L->>S: ingestRecord (fingerprint, email, NEEDS_ENRICHMENT)
    L-->>U: found/created/duplicate/needsEnrichment/enriched + attempts[]
```

**Aturan perilaku (`liveKeywordScrape`):**

1. **Pilihan board dari DB, bukan hardcode** — `selectedSlugs` (dari Board picker yang menampilkan Data Sources) → `db.source.findMany({ where: { slug: { in: slugs } } })`; tanpa pilihan → semua `status: ACTIVE`. Memilih source INACTIVE/ERROR secara eksplisit tetap boleh (override manual, berguna untuk tes).
2. **Chain engine = setting source ∩ pool global** — persis jalur terjadwal, sehingga laporan "N engine dicoba" merefleksikan konfigurasi user.
3. **Keyword filter ALL-words** — `matchesKeyword()`: setiap kata query harus ada di judul atau skills; hasil grid UI dijamin sinkron dengan filter `/api/jobs?title=`.
4. **Batas aman**: `MAX_PER_BOARD = 40`, `FETCH_TIMEOUT_MS = 12 s`, worker pool ingest 6 konkuren agar total tetap dalam budget ±60 s.
5. **Report transparan** — response per board memuat `attempts[]` (engine, status, httpStatus, durationMs, note) yang dirender utuh di UI (chip per engine, engine gagal dicoret + tooltip detail), plus counter: `found / created / duplicate / needsEnrichment / enriched / skipped`.

**Ingest — `ingestRecord(rec, sourceId)` (aturan enrichment, revisi terakhir):**

| Kondisi | Hasil di DB | Return |
|---|---|---|
| Job baru, email valid ditemukan (payload → deskripsi → scan `mailto:` halaman posting) | `Job` status `SCRAPED` + `JobContact` | `created` |
| Job baru, email tidak ketemu / invalid | `Job` status `NEEDS_ENRICHMENT` + `statusReason`, **tanpa** `JobContact` | `needs_enrichment` |
| Fingerprint sudah ada | Link `JobSource` ditambahkan bila belum ada (provenance §15.1) | `duplicate` |
| Fingerprint ada, job lama `NEEDS_ENRICHMENT` tanpa contact, payload baru bawa email | `JobContact` dibuat + job kembali `VALIDATING` | `enriched` |

**Source tanpa parser integrasi** (mis. Glints/Indeed/Kalibrr yang belum diimplementasikan) tetap dijalankan chain-nya sebagai **probe nyata per engine** (`probeWithEngine()`, timeout 6 s) untuk mengukur aksesibilitas — hasilnya dilaporkan apa adanya (mis. `HTTP 403 — diblokir anti-bot`), tanpa data palsu.

---

## 7. Integrasi Source Nyata

Semua integrasi nyata ada di `src/lib/jobforge/sources-real.ts` dan diregistrasi di `REAL_BOARDS`:

| Slug | Jalur | Format data |
|---|---|---|
| `remotive` | `https://remotive.com/api/remote-jobs?search=...` | JSON |
| `jobicy` | `https://jobicy.com/api/v2/remote-jobs?count=60&tag=...` | JSON |
| `arbeitnow` | `https://www.arbeitnow.com/api/job-board-api` | JSON |
| `remoteok` | `https://remoteok.com/api?tag=...` (tag kata tunggal — dicoba per kata kunci) | JSON |
| `himalayas` | `https://himalayas.app/jobs/api?limit=100` | JSON |
| `jobstreet` | `https://id.jobstreet.com/id/jobs` + varian keyword `id.jobstreet.com/id/{query}-jobs` | HTML dengan JSON-LD `JobPosting` |

**Parser JobStreet** — dua fungsi kunci:

- `extractJobPostingsFromHtml(html)` (`sources-real.ts:291`) — mengambil blok `<script type="application/ld+json">` bertipe `JobPosting` dari halaman listing SEO.
- `mapJobStreetJob(j)` (`sources-real.ts:318`) — memetakan JSON-LD → `RawJobRecord` (judul, perusahaan, logo, lokasi, deskripsi, salaryText, employmentType).

**Jalur browser JobStreet** — `searchJobStreetBrowser()` (`live-search.ts`): Chromium Playwright headless dengan anti-detection ringan (`navigator.webdriver` ditutup, `chrome.runtime` disuntik, locale `id-ID`, timezone `Asia/Jakarta`, flag `--disable-blink-features=AutomationControlled`), menunggu maksimal 4×3 s bila judul halaman menunjukkan interstitial Cloudflare ("Just a moment..."), lalu ekstrak JSON-LD dari DOM. Dari IP datacenter, tantangan Cloudflare umumnya **tidak selesai** → gagal jujur dengan pesan `Cloudflare challenge tidak selesai di IP ini — set proxy residensial di setting source`.

**Realitas anti-bot JobStreet (terukur):** kelima engine mengalami blokir (HTTP 403 Cloudflare challenge) dari IP sandbox ini, baik jalur HTTP maupun browser headless. Konsekuensi desain:

1. Sistem melaporkan kegagalan transparan (chain penuh + status HTTP di UI dan Activity Log) — **tidak pernah men-display data palsu**.
2. Dua tuas bypass resmi tersedia di level source: **proxy residensial** (`Source.proxyUrl`) dan **cookie/header clearance** (`Source.headersJson`). Playwright path otomatis memakai keduanya.
3. Dashboard tetap fungsional untuk board lain; JobStreet akan otomatis berjalan begitu proxy diisi — tanpa perubahan kode.

**Error mapping** — `realBoardError()`: pesan mengandung `timeout` → `TIMEOUT`; mengandung `401/403` → `SOURCE_BLOCKED`; selain itu `NETWORK_ERROR`. Tipe ini yang tampil di view Errors dan memicu `Source.status=ERROR` oleh engine terjadwal.

---

## 8. Dedup & Fingerprint

Dedup deterministik ada di `src/lib/jobforge/pipeline.ts` dan dipakai bersama oleh scrape terjadwal, live search, dan bulk import:

- **`jobFingerprint(companyName, title, location)`** (`pipeline.ts:77`) — SHA-256 atas kombinasi `normalizeCompanyName(company) + normalizeTitle(title) + normalizeLocation(location)`. Disimpan di `Job.fingerprint` (kolom `@unique`).
- **Normalisasi**: `normalizeTitle()` memotong suffix lokasi/employment (`- Jakarta - Full Time`), lowercase, rapikan spasi; `normalizeLocation()` menyeragamkan penulisan kota; `normalizeCompanyName()` membuang bentuk legal (`PT`, `CV`, `(Persero)`).
- **`companyFingerprint(name)`** — kunci dedup perusahaan (`Company.normalizedName @unique`): perusahaan yang sama dari board berbeda digabung jadi satu entitas (dedup domain > nama ternormalisasi).

**Provenance multi-board (§15.1–15.2)** — lowongan yang sama di board berbeda tetap **satu** `Job`, tapi setiap penemuan board membuat baris `JobSource { jobId, sourceId, sourceJobId, sourceUrl, firstSeenAt }` dengan unique constraint `(sourceId, sourceJobId)`. Efek praktisnya:

1. Scrape ulang yang menemukan job lama menghasilkan `duplicate` (bukan baris baru), dan link provenance terpasang bila board itu baru pertama kali melihatnya.
2. Detail job di UI bisa menampilkan "juga terlihat di board X, Y".
3. Penghapusan sebuah Source meng-cascade `JobSource`-nya saja — job tetap hidup bila punya provenance lain.

**Implikasi operasional:** jika judul/perusahaan/lokasi berubah di board asal, fingerprint berubah dan job dianggap baru. Ini disengaja (lowongan repost memang layak muncul lagi), namun memudahkan duplikasi logis bila board sering mengedit judul — pemantauan lewat KPI `duplicate` per run.

---

## 9. Discovery Email HR

Email HR adalah field paling sulit dan paling bernilai. JobForge mencarinya **berlapis** (§12 PRD), tanpa pernah menebak:

1. **Email di payload source** — sebagian API board membawanya (field email/apply email) → `rec.publishedEmail`.
2. **Scan teks deskripsi** — `extractPublishedEmail(text)` (`engine.ts:765`) menyaring alamat email dari body postingan (regex email standar, difilter agar bukan gambar/asset path).
3. **Scan live halaman posting** — `discoverMailto(pageUrl)` (`engine.ts:746`) fetch URL postingan asli lalu menangkap tautan `mailto:`. Satu percobaan per job per proses (`mailtoScanned`) untuk menghormati board.

**Validasi & prioritas:**

- `validateEmail(email)` (`pipeline.ts:95`) → status `VALID | INVALID | UNKNOWN` + flag `verified` (cek MX-like heuristic & blokir domain sementara/mailinator-like). Email `INVALID` tidak pernah disimpan sebagai contact — job dengan hanya email invalid masuk `NEEDS_ENRICHMENT` dengan reason `HR Email (invalid)`.
- `emailPriorityScore()` + `HR_EMAIL_PRIORITY` (`types.ts:137`) mengurutkan kualitas alamat: `recruitment@ > career@ > careers@ > hr@ > hrd@ > talent@ > jobs@ > karir@`.
- Hasil disimpan di `JobContact { hrEmail, emailSourceUrl, emailVerified, emailStatus }` (1:1 dengan Job).

**Yang tidak dilakukan (anti-spam §12.4):** tidak mengkonstruksi email dari pola domain (`hr@domain.com`) untuk job dari source nyata. Pola template hanya ada di jalur data mock untuk demo recovery. Portal hanya menerima job dengan email (delivery rule, `deliverReadyJobs`).

---

## 10. Data Model (Prisma / SQLite)

Skema lengkap: `prisma/schema.prisma` (komentar merujuk bagian PRD). SQLite file: `prisma/dev.db` (env `DATABASE_URL`).

| Model | Peran | Kolom/relasi kunci | Indeks |
|---|---|---|---|
| `Source` | Definisi board + konfigurasi scraping | `slug @unique`, `status` (ACTIVE/INACTIVE/ERROR), `scraperType` (STATIC/DYNAMIC/API), `engine` (primary), `engines` (CSV chain), `schedule` (hourly/every_6_hours/every_12_hours/daily/manual), `proxyUrl`, `headersJson` | `status` |
| `Job` | Lowongan ternormalisasi | `fingerprint @unique`, `title`, `normalizedTitle`, `companyName`, `companyLogoUrl`, `description`, salary fields, `status`, `statusReason`, `companyId?` | `status`, `scrapedAt`, `companyId` |
| `Company` | Entitas perusahaan terdedup | `normalizedName @unique`, `logoUrl`, `website`, `profile`, `industry`, `enrichedAt` | `normalizedName` |
| `JobSource` | Provenance per board | `jobId → Job (cascade)`, `sourceId → Source (cascade)`, `sourceJobId`, `sourceUrl`, `@@unique([sourceId, sourceJobId])` | `jobId` |
| `JobContact` | Email HR (1:1 Job) | `jobId @unique`, `hrEmail`, `emailStatus` (VALID/INVALID/UNKNOWN), `emailVerified` | `emailStatus` |
| `ScrapeRun` | Audit satu run scrape | `sourceId`, `engine`, `status` (RUNNING/SUCCESS/FAILED), `jobsFound/Created/Updated/Rejected/Duplicate`, `errorCount` | `sourceId`, `status`, `startedAt` |
| `ScrapeError` | Error monitoring terpusat | `errorType` (NETWORK_ERROR/TIMEOUT/PARSER_ERROR/SOURCE_ERROR/SOURCE_BLOCKED/INVALID_DATA/EMAIL_NOT_FOUND/EMAIL_INVALID/API_ERROR/DATABASE_ERROR), `status` (OPEN/RESOLVED), `retryCount` | `errorType`, `status`, `lastSeen` |
| `ApiDelivery` | Tracking pengiriman ke portal | `jobId`, `endpoint`, `requestId`, `status` (PENDING/SENDING/SUCCESS/FAILED), `attempt/maxAttempts`, `nextRetryAt`, `responseCode/Body` | `status`, `jobId`, `createdAt` |
| `ActivityLog` | Log terstruktur Activity Console | `ts`, `source`, `jobId`, `action` (scrape/parse/normalize/enrich/validate/dedup/deliver/import/error), `status` (success/failed/info/warning), `message`, `durationMs` | `ts` |
| `Setting` | Konfigurasi key-value (§13) | `key @id`, `value` | — |

**Relasi (ringkas):** `Source 1—n JobSource n—1 Job 1—1 JobContact`; `Job n—1 Company (onDelete: SetNull)`; `Source 1—n ScrapeRun / ScrapeError`; `Job 1—n ApiDelivery`.

**Migrasi:** skema diubah lewat `npm run db:push` (tanpa file migrasi — cocok untuk fase ini) atau `db:migrate` bila ingin jejak migrasi formal. First boot menjalankan `ensureBootstrap()` (`bootstrap.ts`) → `ensureSeed()` (`seed.ts`) yang idempoten: membuat source Indonesia + settings default bila belum ada.

---

## 11. API Reference

Semua route di `src/app/api/**/route.ts` (Next.js App Router, `export const dynamic = "force-dynamic"`). Konvensi respons: JSON; error `{ error: string }` dengan status HTTP sesuai.

### 11.1 Daftar route

| Method & Path | Fungsi | Handler inti |
|---|---|---|
| `GET /api` | Health/meta service | — |
| `GET /api/dashboard` | KPI agregat + distribusi status + kesehatan source | agregasi Prisma |
| `GET /api/jobs` | List/filter job (title, status, workplace, salary, withEmail, page) | Prisma query |
| `GET /api/jobs/[id]` | Detail job + contact + provenance | Prisma include |
| `PATCH /api/jobs/[id]` | Ubah status manual (body zod) | Prisma |
| `GET/POST /api/sources` | List & create source (zod: `sourceCreateSchema`) | `schemas.ts` |
| `PATCH/DELETE /api/sources/[id]` | Update source (`sourceUpdateSchema`) / delete (cascade jobLinks) | `schemas.ts` |
| `POST /api/sources/[id]/run` | Force run satu source sekarang | `runSourceNow()` |
| `POST /api/search/live` | Live keyword scrape multi-board | `liveKeywordScrape()` |
| `GET /api/companies` (+`[id]`) | List/detail perusahaan + job terkait | Prisma |
| `GET /api/contacts` | List JobContact + status verifikasi | Prisma |
| `GET /api/deliveries` | List ApiDelivery + status retry | Prisma |
| `POST /api/deliveries` | Retry delivery gagal — body `{ "id": "<deliveryId>" }` | `retryDelivery()` |
| `GET /api/runs` | Riwayat ScrapeRun per source | Prisma |
| `GET /api/errors` | List ScrapeError (filter/status) | Prisma |
| `PATCH /api/errors` | Tandai error RESOLVED — body `{ "id": "<errorId>" }` | `resolveError()` |
| `GET /api/activity` | Log aktivitas (filter action/status/source/q, limit maks 1000, offset) | Prisma |
| `GET/PUT /api/settings` | Baca/ubah `Setting` (ENGINE_POOL, AUTO_*, dsb.) | `Setting` model |
| `POST /api/pipeline` | Jalankan pipeline penuh sekarang | `runPipelineNow()` |
| `GET /api/logo/[domain]` | Proxy/fetch logo perusahaan | `fetchLogoPng()` |
| `POST /api/v1/jobs/import` | **Endpoint import portal** (auth Bearer) | `processBulkImport()` |

### 11.2 Kontrak penting

**`POST /api/search/live`** — body `{ "q": "business analyst", "sources": ["jobstreet", "remotive"] }` (`sources` opsional; kosong = semua ACTIVE). Respons:

```jsonc
{
  "q": "developer", "durationMs": 12345,
  "boards": [{
    "board": "Remotive", "slug": "remotive",
    "engine": "cheerio",            // engine pemenang / terakhir
    "engines": ["cheerio"],          // chain penuh setting source
    "attempts": [{ "engine": "cheerio", "status": "success",
                   "httpStatus": 200, "durationMs": 812, "note": "found 3" }],
    "status": "success",
    "found": 3, "created": 0, "duplicate": 0,
    "needsEnrichment": 3,           // masuk DB, menunggu email HR
    "enriched": 0,                   // job lama yang terisi email dari payload baru
    "skipped": 0, "durationMs": 812
  }],
  "totalFound": 3, "totalCreated": 0, "totalDuplicate": 0,
  "totalNeedsEnrichment": 3, "totalEnriched": 0, "totalSkipped": 0
}
```

**`POST /api/v1/jobs/import`** — header `Authorization: Bearer <JOB_PORTAL_API_KEY>` (`verifyPortalAuth()`, `portal.ts:15`). Body sesuai `bulkImportSchema`: `{ source, scraped_at, jobs: CanonicalJob[] }` (maks 500/job batch). Respons `ImportResponse` (`types.ts:112`): `{ success, message, data: { received, created, updated, duplicated, failed } }`. Endpoint ini juga dipakai internal oleh delivery loop — satu pintu validasi.

**`GET /api/dashboard`** — mengembalikan: `activeSources`, `successRuns`/`failedRuns`, `readyJobs`/`sentPublished`, `publishedJobs`, **`needsEnrichment`**, `rejectedJobs`, `pendingDeliveries`/`failedDeliveries`, `openErrors`, `statusDist[]`, `sourcesHealth[]`, dan `recentActivity` (60 terakhir).

---

## 12. Frontend (Dashboard UI)

Single-page app shell dengan navigasi sidebar (`src/app/page.tsx` → `src/components/jobforge/shell.tsx`, state view via zustand). Semua view ada di `src/components/jobforge/`:

| Komponen | View | Isi utama |
|---|---|---|
| `overview.tsx` | Dashboard | KPI cards, distribusi status pipeline, Activity Console mini (30 log), tombol "Run pipeline now" |
| `sources.tsx` | Data Sources | CRUD source (sheet form: engine chain picker urut prioritas, proxy, headers JSON, schedule), status dot, tombol Run now, engine badges |
| `search.tsx` | Cari LokerBase | Dua mode: Cari Database (filter instan) & Scrape Live (Board picker + keyword) — chips hasil menampilkan **seluruh attempt engine** (yang gagal dicoret, tooltip detail), counter NEEDS_ENRICHMENT (kuning) dan enriched (hijau) |
| `jobs.tsx` | Jobs | Tabel/filter job per status (termasuk `NEEDS_ENRICHMENT`), badge status (`ui-bits.tsx → StatusBadge`), detail via sheet |
| `job-detail-sheet.tsx` | — | Slide-over detail lengkap: deskripsi, salary, contact, provenance per board, statusReason untuk NEEDS_ENRICHMENT |
| `contacts.tsx` | HR Contacts | Email HR + status verifikasi |
| `companies.tsx` | Companies | Perusahaan terdedup + logo + job terkait |
| `deliveries.tsx` | API Deliveries | Status pengiriman portal, attempt/backoff, retry manual |
| `runs.tsx` | Scrape Runs | Riwayat run + metrik per engine |
| `errors.tsx` | Errors | ScrapeError OPEN/RESOLVED + resolve action |
| `activity.tsx` | Activity Console | Log penuh terminal-style: filter action/status/source/kata kunci, load older, export `.log` |
| `settings.tsx` | Settings | Form `Setting` (engine pool, auto scrape/delivery, tick interval, portal API) |
| `ui-bits.tsx` | — | Design tokens kecil: `StatusBadge` (warna per status, `NEEDS_ENRICHMENT` = kuning), `CompanyAvatar`, `formatIDR`, `timeAgo` |

**Data fetching**: hook `useApi` (`src/hooks/use-api.ts`) di atas fetch native dengan polling ringan untuk view monitoring. Toast via sonner. Grafik via recharts (dashboard). Drag & drop urutan engine chain memakai `@dnd-kit`.

---

## 13. Konfigurasi & Settings

**Dua lapis konfigurasi:**

1. **Per-source** (tabel `Source`): chain engine (`engines`), proxy (`proxyUrl`), header kustom (`headersJson`), jadwal (`schedule`). Diedit dari UI tanpa deploy.
2. **Global** (tabel `Setting`, konstanta `SETTING_KEYS` di `src/lib/jobforge/types.ts:151`):

| Key | Default | Arti |
|---|---|---|
| `JOB_PORTAL_API_URL` | internal | Base URL portal tujuan delivery |
| `JOB_PORTAL_API_KEY` | — | Bearer key untuk `/api/v1/jobs/import` |
| `BATCH_SIZE` | `25` | Ukuran batch delivery per siklus |
| `MAX_ATTEMPTS` | `3` | Percobaan maksimum delivery sebelum FAILED |
| `AUTO_SCRAPE` | `true` | Tick genap menjalankan scrape terjadwal |
| `AUTO_DELIVERY` | `true` | Kirim READY → portal otomatis |
| `TICK_INTERVAL_MS` | `5000` | Periode tick engine (min 2000) |
| `DEMO_JOB_CAP` | — | Batas job generator mock (demo) |
| `DATA_MODE` | `real` | `real` = integrasi nyata; `mock` = generator simulasi |
| `ENGINE_POOL` | semua engine | CSV engine aktif global (interseksi dengan chain source) |

**Environment variables** (`.env`, dibaca Prisma/Next):

| Var | Wajib | Isi |
|---|---|---|
| `DATABASE_URL` | ✅ | `file:/absolut/path/prisma/dev.db` — di production pakai path absolut di volume persisten |
| `PORT` | — | Port server standalone (default 3000) |

---

## 14. Deployment Production

### 14.1 Ringkasan strategi

Next.js dibangun sebagai **standalone output** lalu dijalankan dengan bun. Database SQLite berarti **deployment single-node dengan volume persisten** — pilih VPS kecil (2 vCPU / 2–4 GB RAM sudah cukup; browser engine butuh headroom memori).

### 14.2 Langkah VPS (Ubuntu 22.04+)

```bash
# 1. Runtime & tooling
curl -fsSL https://bun.sh/install | bash        # bun (runtime produksi)
# Node 20 opsional untuk tooling/Prisma CLI
sudo apt update && sudo apt install -y nodejs npm nginx

# 2. Kode & dependensi
git clone <repo> /opt/jobforge && cd /opt/jobforge
npm install                                     # termasuk prisma + playwright
npx playwright install chromium                 # driver browser utk jalur Playwright

# 3. Konfigurasi
cp .env.example .env                            # set DATABASE_URL absolut, PORT
npm run db:push                                 # terapkan schema ke SQLite
npm run build                                   # next build + copy static/public ke .next/standalone

# 4. Jalankan (dua opsi)
npm run start                                   # bun .next/standalone/server.js
# atau via PM2 (disarankan):
pm2 start "bun .next/standalone/server.js" --name jobforge --time
pm2 save && pm2 startup                         # auto-start saat reboot
```

### 14.3 Nginx reverse proxy + TLS

```nginx
server {
  server_name jobforge.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;   # live search bisa >60 detik
  }
}
# TLS: sudo certbot --nginx -d jobforge.example.com
```

> `proxy_read_timeout` wajib dinaikkan — Scrape Live dapat berjalan ±60 s (timeout fetch 12 s × chain 5 engine + ingest).

### 14.4 Backup & restore SQLite

```bash
# Backup aman (snapshot konsisten, tanpa stop app) — cron per jam/hari:
sqlite3 /opt/jobforge/prisma/dev.db ".backup '/var/backups/jobforge-$(date +%F-%H).db'"

# Restore:
pm2 stop jobforge
cp /var/backups/jobforge-2026-09-12-09.db /opt/jobforge/prisma/dev.db
pm2 start jobforge
```

Alternatif robust: [Litestream](https://litestream.io) (streaming replication SQLite → S3). Retensi minimum 7 hari. **Uji restore secara berkala** — backup yang belum pernah direstore belum terbukti backup.

### 14.5 Aturan operasi penting

1. **Satu instance per database.** Scheduler berjalan in-process (`setInterval`); dua instance = scrape & delivery ganda. Untuk high availability, jadikan scheduler external (§18).
2. **Volume persisten untuk `prisma/dev.db`** — container/VM tidak boleh kehilangan file DB.
3. **Idempoten first boot** — `ensureBootstrap()` membuat seed bila tabel kosong; deploy ulang aman.
4. **Restart aman** — state in-process (`mailtoScanned`, tick counter) hilang saat restart; efeknya hanya percobaan mailto scan ulang, tidak merusak data.
5. **Pantau memori** — jalur Playwright memunculkan Chromium (±400 MB per halaman). Di VPS 2 GB, batasi live search bersamaan atau tamb swap.

---

## 15. Monitoring & Observability

Tiga sinyal bawaan, semuanya tersimpan di DB dan tampil di dashboard:

1. **`ActivityLog`** — log terstruktur per aksi (`scrape/parse/normalize/enrich/validate/dedup/deliver/import/error`, status `success/failed/info/warning`, durasi ms, source, jobId). Dikirim lewat helper `log()` (`engine.ts:69`) di seluruh pipeline. View: **Activity Console** (terminal-style, filter, export).
2. **`ScrapeError`** — agregasi error bertipe dengan status OPEN/RESOLVED dan `retryCount`. View: **Errors**. Muncul otomatis dari `recordError()` (`engine.ts:91`).
3. **`ScrapeRun`** — metrik per run (found/created/updated/rejected/duplicate/errorCount, engine yang jalan). View: **Scrape Runs**.

**KPI dashboard (`/api/dashboard`)** yang layak dipantau harian:

| KPI | Arti praktis |
|---|---|
| `activeSources` vs `ERROR` | Kesehatan board — JobStreet berstatus ERROR berarti tick terakhir diblokir |
| `needsEnrichment` | Backlog job tanpa email HR — naik terus berarti banyak source butuh proxy/parser baru |
| `openErrors` + tipe dominan | `SOURCE_BLOCKED` banyak → masalah anti-bot; `TIMEOUT` → jaringan/board lambat |
| `failedDeliveries` | Portal import bermasalah atau payload ditolak |
| `statusDist` | Kesehatan funnel: job menumpuk di stage tertentu = bottleneck stage itu |

Rekomendasi tambahan production: uptime probe eksternal (mis. pinging `/api` tiap menit), dan alert sederhana bila `failedRuns` berturut-turut > N untuk source ACTIVE.

---

## 16. Runbook Operasional

| Gejala | Penyebab | Tindakan |
|---|---|---|
| Live search JobStreet: 5 engine gagal, `HTTP 403` / `Cloudflare challenge` | Board memblokir IP datacenter (anti-bot) | 1) Isi `Source.proxyUrl` dengan **proxy residensial** (UI Data Sources) — tanpa ubah kode; 2) tambahkan cookie clearance di `Source.headersJson` bila punya; 3) jika tetap gagal, terima laporan jujur — sistem dirancang tidak mengarang data |
| Status JobStreet berubah sendiri jadi `ERROR` | Tick terjadwal gagal → engine menandai jujur | Normal. Status kembali `ACTIVE` otomatis saat run berikutnya sukses; live search dengan pilihan manual tetap bisa menjalankannya |
| Live search: pesan `driver Puppeteer/Selenium tidak tersedia` | Driver browser tsb. memang belum terpasang di host | Pakai Playwright/HTTP di chain, atau pasang driver bila benar-benar dibutuhkan (`npm i puppeteer`, Selenium grid) |
| `needsEnrichment` menumpuk | Board tidak mengekspos email HR | Recovery worker & scrape berikutnya berjalan otomatis; percepat dengan live search ulang (payload baru bisa membawa email → `enriched`); untuk kasus manual, isi email lewat detail job |
| Deliveries banyak `FAILED` (500) | Portal down / key salah / payload ditolak | Cek `responseBody` di view Deliveries → perbaiki → `POST /api/deliveries` body `{"id": "<deliveryId>"}` |
| Job duplikat muncul lagi | Judul/lokasi di board berubah → fingerprint baru | Perilaku dedup by-design; pantau KPI `duplicate` |
| DB hilang/korup setelah restart (sandbox/host reset) | Volume tidak persisten | Restore dari backup (§14.4); pastikan `DATABASE_URL` menunjuk volume permanen |
| Engine tidak jalan sama sekali | App tidak memanggil bootstrap / tick terbunuh | Cek log awal `Worker engine started — tick every Xs`; restart via PM2; pastikan hanya satu instance |
| Log tidak muncul di Activity Console | Filter aktif / limit | Reset filter; gunakan Load older (API mendukung limit hingga 1000, offset) |
| Logo perusahaan kosong | Provider favicon gagal | `npx tsx scripts/backfill-logos.ts`; recovery worker juga mencoba otomatis |

---

## 17. Keamanan

- **Endpoint import portal** dilindungi Bearer key: `verifyPortalAuth()` (`portal.ts:15`) membandingkan header `Authorization` dengan `Setting JOB_PORTAL_API_KEY`. Ganti key secara berkala; rotasi = ubah Setting (tanpa deploy).
- **Validasi input** — semua create/update source melewati zod (`sourceCreateSchema`, `sourceUpdateSchema` di `schemas.ts`); bulk import lewat `canonicalJobSchema` + `bulkImportSchema` (maks 500 job) dengan sanitasi field.
- **Rate-limit etis terhadap board** — batas per run (`MAX_PER_BOARD=40`), timeout ketat, mailto scan 1×/job/proses, UA teridentifikasi (`JobForgeBot/1.0`) untuk jalur HTTP murni. Bukan pengganti rate limiter agresif, tapi mencegah ban cepat.
- **Belum ada (hardening backlog, lihat §18):** auth pada dashboard admin (semua endpoint UI terbuka), CORS whitelist, rate limit per-IP pada `/api/search/live`, dan audit log untuk aksi mutasi manual.

---

## 18. Keterbatasan & Roadmap Hardening

**Keterbatasan yang diketahui (jujur, terukur):**

1. **JobStreet & anti-bot kelas enterprise** — dari IP datacenter, Cloudflare challenge tidak selesai baik via HTTP maupun Chromium headless. Jalur resmi untuk menembus: proxy residensial per-source (sudah didukung penuh konfigurasi & runtime) atau kemitraan/API resmi. Opsi stealth plugin (`puppeteer-extra-plugin-stealth` dsb.) adalah peningkatan probabilistik, bukan jaminan.
2. **Driver Puppeteer/Selenium belum terpasang** — chain menampilkan keduanya, runtime fail-fast jujur. Instalasi hanya perlu bila source spesifik membutuhkannya.
3. **Simulasi tersisa di jalur delivery** — `engine.ts:797` (`chance(0.07)`) mensimulasikan kegagalan transient portal untuk demo retry. **Untuk production sebenarnya, baris ini harus dimatikan** (ganti dengan percobaan nyata saja).
4. **Mode mock masih satu switch away** — `DATA_MODE=mock` mengaktifkan generator (`adapters.ts`, `data.ts`). Pastikan production selalu `real`.
5. **Single-node SQLite + scheduler in-process** — tidak horizontal-scale; satu instance saja. Roadmap: ekstrak scheduler ke worker terpisah (cron + endpoint internal) bila butuh multi-instance/read-replica.
6. **Dashboard tanpa auth** — pasang basic auth di Nginx (cepat) atau next-auth (paket sudah ada di dependency) sebelum papar ke internet publik.

**Urutan hardening yang disarankan:** (1) matikan simulasi delivery + kunci `DATA_MODE=real`; (2) auth dashboard; (3) backup otomatis teruji-restore; (4) proxy residensial untuk JobStreet bila memang menjadi kebutuhan bisnis; (5) rate-limit `/api/search/live` per-IP; (6) scheduler eksternal bila scaling.

---

## 19. Lampiran: Scripts Utilitas

Direktori `scripts/` — dijalankan dengan `npx tsx scripts/<nama>.ts` (kecuali .py/.sh/.mjs):

| Script | Fungsi |
|---|---|
| `check-db-state.ts` | Snapshot cepat DB: daftar source + distribusi status job |
| `test-needs-enrichment.ts` | E2E flow NEEDS_ENRICHMENT (source uji sementara → live search ×2 → inspeksi → cleanup) |
| `test-live-search-sources.py` | E2E kombinasi pilihan board (satu board / campuran / default ACTIVE) |
| `test-jobstreet-parser.ts` | Unit-test parser JSON-LD JobStreet |
| `probe-jobstreet.py`, `probe-js-*.mjs`, `js-probe*.png/html`, `cf-challenge.html` | Artefak investigasi anti-bot JobStreet (probe HTTP/browser/turnstile) |
| `fix-jobstreet-status.ts` | Kembalikan `Source.status=ACTIVE` (setelah ERROR akibat blokir) |
| `set-jobstreet-manual.ts` | Set schedule JobStreet ke manual |
| `migrate-*.ts` | Migrasi one-off skema/data (multi-engine, proxy support, real companies, dst.) |
| `cleanup-*.ts`, `purge-no-email-jobs.ts` | Pembersihan data (purge sudah usang sejak aturan NEEDS_ENRICHMENT) |
| `backfill-logos.ts` | Isi ulang logo perusahaan |
| `test-proxy-plumbing.mjs` | Uji proxy per-source (undici ProxyAgent) |
| `diagnose.ts` | Diagnosa umum DB/konfigurasi |

---

*Dokumen ini dihasilkan langsung dari basis kode pada 12 September 2026. Bila struktur kode berubah signifikan (mis. setelah implementasi proxy residensial JobStreet atau ekstraksi scheduler), perbarui bagian §5, §7, §14, dan §18.*
