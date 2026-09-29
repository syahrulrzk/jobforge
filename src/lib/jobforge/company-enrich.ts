// ─────────────────────────────────────────────────────────────
// JOBFORGE — Company Profile Enrichment (§11 lanjutan)
// Scrape homepage perusahaan → description, industry, size.
//
// Sumber (semua dari halaman sendiri — tidak ada data karangan):
//   1. JSON-LD  <script type="application/ld+json"> Organization:
//               description, numberOfEmployees (minValue/maxValue/value)
//   2. Meta     description / og:description / keywords / <title>
//   3. Heuristik teks  — pola "X+ tahun/employees/karyawan" dari About page
//   4. Domain/keyword  — klasifikasi industri dari nama domain + kata kunci
//
// Domain di-resolve via Clearbit autocomplete bila company tanpa website
// (reuse resolveDomainFromName dari logo.ts).
// ─────────────────────────────────────────────────────────────
import { cleanCompanyName, extractDomain, resolveDomainFromName } from "./logo";

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML = 900_000; // 900KB cukup untuk homepage + JSON-LD

/** Placeholder lama — tidak boleh ada lagi di DB setelah backfill (profil wajib). */
export const PLACEHOLDER_PROFILE = "Profil perusahaan belum tersedia.";

// ── Derivasi profil dari data lowongan (100% dari DB, bukan karangan) ──
export interface JobFacts {
  titles: string[];
  locations: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  sources: string[];
  totalJobs: number;
}

function formatJuta(v: number): string {
  return v >= 1_000_000 ? `${Math.round(v / 100_000) / 10} juta` : `${v.toLocaleString("id-ID")}`;
}

/**
 * Profil terderivasi dari lowongan nyata perusahaan di DB — PEMAKAIAN TERAKHIR
 * (hanya bila situs, about page, dan Wikipedia sama-sama tidak memberi info).
 * Hanya memuat fakta yang benar-benar ada: posisi, lokasi, gaji, platform.
 */
function prettySource(slug: string): string {
  const map: Record<string, string> = { jobstreet: "JobStreet", glints: "Glints", dealls: "Dealls", indeed: "Indeed" };
  return map[slug.toLowerCase()] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function deriveProfileFromJobs(name: string, facts: JobFacts): string {
  const uniqTitles = [
    ...new Set(
      facts.titles
        .map((t) =>
          t
            .trim()
            .replace(/^lowongan(\s+kerja)?\s*[:]?(?=\w)/i, "")
            .replace(/^dibutuhkan\s*/i, "")
            .replace(/^job\s+vacanc(y|ies)\s*[:]?\s*/i, "")
            .replace(/^segera\s*/i, "")
            .trim()
        )
        .filter(Boolean)
    ),
  ];
  // lokasi harus mirip nama tempat — buang nilai kalimat/kotor dari scrape
  const uniqLoc = [
    ...new Set(
      facts.locations
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.length <= 45 && !/lowongan|job|career|dibutuhkan|segera/i.test(l))
    ),
  ];
  const uniqSrc = [...new Set(facts.sources.filter(Boolean))].slice(0, 2).map(prettySource);
  const parts: string[] = [];
  if (uniqTitles.length > 0) {
    parts.push(`${name} membuka kesempatan berkarir sebagai ${uniqTitles.slice(0, 3).join(", ")}.`);
  } else {
    parts.push(`${name} sedang membuka lowongan kerja.`);
  }
  if (uniqLoc.length > 0) {
    parts.push(`Penempatan tersedia di ${uniqLoc.slice(0, 3).join(", ")}.`);
  }
  if (facts.salaryMin && facts.salaryMax) {
    parts.push(`Gaji yang dipublikasikan berkisar Rp ${formatJuta(facts.salaryMin)}–${formatJuta(facts.salaryMax)} per bulan.`);
  }
  if (uniqSrc.length > 0) {
    parts.push(`Informasi lowongan dihimpun dari ${uniqSrc.join(" dan ")}.`);
  }
  return parts.join(" ");
}

export interface CompanyProfile {
  website: string; // https://domain — selalu terisi (dari website/db atau Clearbit)
  domain: string;
  description: string | null;
  industry: string | null;
  size: string | null; // "51-200", "201-500", dst — dari JSON-LD/heuristik
  source: "jsonld" | "meta" | "about-page" | "wikipedia" | "heuristik";
}

// ── Klasifikasi industri dari domain + kata kunci ─────────────
// CATATAN: token pendek (bni/bri/bca) HARUS full word-boundary — tanpa itu
// mereka nyangkut di substring HTML (class name, URL) dan salah klasifikasi.
const INDUSTRY_RULES: { re: RegExp; industry: string }[] = [
  { re: /\b(?:bank\s+(?:mandiri|negara|central|bca)|danamon|permata|muamalat|ocbc|uob|cimb)\b/i, industry: "Perbankan & Jasa Keuangan" },
  { re: /\b(?:fintech|paylater|kredivo|akulaku|midtrans|xendit|dompet\s+digital)\b/i, industry: "Fintech & Pembayaran" },
  { re: /\b(?:asuransi|insurance|takaful)\b/i, industry: "Asuransi" },
  { re: /\b(?:travel|tiket\.com|pegipegi|wisata|hotel|tour\s+operator)\b/i, industry: "Travel & Hospitality" },
  { re: /\b(?:kurir|logistik|ekspedisi|cargo|sicepat|anteraja|j\&?t\s+express|ninja\s+xp)\b/i, industry: "Logistik & Ekspedisi" },
  { re: /\b(?:edutech|edtech|bimbel|ruangguru|zenius|akupintar|lembaga\s+kursus)\b/i, industry: "Pendidikan & EdTech" },
  { re: /\b(?:klinik|rumah\s+sakit|halodoc|alodokter|farmasi|apotek|medis)\b/i, industry: "Kesehatan & Farmasi" },
  { re: /\b(?:marketplace|e-?commerce|tokopedia|bukalapak|blibli|shopee)\b/i, industry: "E-Commerce & Retail" },
  { re: /\b(?:game\s+(?:developer|studio)|esports?|game\s+online)\b/i, industry: "Game & Esports" },
  { re: /\b(?:portal\s+berita|streaming|vidio\.com|kumparan|media\s+(?:group|online|nusantara|indonesia|digital|network))\b/i, industry: "Media & Konten" },
  { re: /\b(?:konsultan|consulting|outsourcing|manpower|outsourcing\s+sdm)\b/i, industry: "Konsultan & SDM" },
  { re: /\b(?:konstruksi|kontraktor|real\s?estate|developer\s+properti|properti)\b/i, industry: "Konstruksi & Properti" },
  { re: /\b(?:manufaktur|manufacturing|pabrik)\b/i, industry: "Manufaktur & Industri" },
  { re: /\b(?:makanan|minuman|food\s+(?:and|&|)\s+beverage|katering|restoran|kuliner|nutrifood)\b/i, industry: "F&B & Kuliner" },
  { re: /\b(?:fashion|apparel|butik|tekstil|garmen|pakaian)\b/i, industry: "Fashion & Tekstil" },
  { re: /\b(?:software\s+house|it\s+(?:services|consulting|solutions?)|sistem\s+informasi|pengembang\s+(?:aplikasi|perangkat\s+lunak)|application\s+developer|digital\s+agency|teknologi\s+informasi)\b/i, industry: "Teknologi & Software" },
];

function classifyIndustry(text: string): string | null {
  for (const r of INDUSTRY_RULES) {
    if (r.re.test(text)) return r.industry;
  }
  return null;
}

/**
 * Klasifikasi industri dari teks lowongan perusahaan (judul + skill).
 * Sinyal turunan data sendiri — dipakai bila homepage tak memberi petunjuk.
 */
export function classifyIndustryFromJobText(text: string): string | null {
  return classifyIndustry(text);
}

// ── Ekstraksi helpers ─────────────────────────────────────────
function metaContent(html: string, nameRe: string): string | null {
  // <meta name="description" content="..."> / property="og:description"
  const re = new RegExp(`<meta[^>]+(?:${nameRe})[^>]+content\\s*=\\s*["']([^"']{20,600})["']`, "i");
  const alt = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']{20,600})["'][^>]+(?:${nameRe})`, "i");
  const m = html.match(re) ?? html.match(alt);
  if (!m) return null;
  return decodeHtml(m[1].trim());
}

function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{3,300})<\/title>/i);
  if (!m) return null;
  const t = decodeHtml(m[1].trim());
  // buang suffix umum: "Beranda - PT Foo | Situs Resmi"
  return t.replace(/\s*[\|–—-]\s*(beranda|home|situs resmi|official(?: site)?)\s*$/gi, "").trim() || null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return "";
      }
    });
}

function numberOfEmployeesFromJsonLd(node: Record<string, unknown>): string | null {
  const ne = node.numberOfEmployees ?? (node as { award?: unknown }).award;
  if (!ne || typeof ne !== "object") return null;
  const o = ne as Record<string, unknown>;
  const min = typeof o.minValue === "number" ? o.minValue : null;
  const max = typeof o.maxValue === "number" ? o.maxValue : null;
  const val = typeof o.value === "number" ? o.value : null;
  if (min != null && max != null) return `${min}-${max}`;
  if (val != null) return `${val}-${val}`;
  return null;
}

function walkJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      if (Array.isArray(parsed)) out.push(...(parsed as Record<string, unknown>[]));
      else if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
      if (out.length > 40) break; // pengaman
    } catch {
      // JSON-LD rusak — lewati
    }
  }
  return out;
}

function sizeFromHeuristics(text: string): string | null {
  // "lebih dari 500 karyawan", "1.000+ employees", "50 - 200 pegawai"
  const patterns = [
    /(?:lebih\s+dari|over|more\s+than)\s+([\d.,]+)\s*\+?\s*(?:karyawan|pegawai|employees?)/i,
    /([\d.,]+)\s*(?:\+|lebih)\s*(?:karyawan|pegawai|employees?)/i,
    /([\d.,]+)\s*(?:-|–|—|s\/d|sampai|hingga|to)\s*([\d.,]+)\s*(?:karyawan|pegawai|employees?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const parse = (s: string) => Number(s.replace(/\./g, "").replace(/,/g, ""));
    if (m.length >= 3 && m[2]) {
      const a = parse(m[1]);
      const b = parse(m[2]);
      if (a > 0 && b >= a) return `${a}-${b}`;
    } else {
      const v = parse(m[1]);
      if (v >= 5) return `${v}+`;
    }
  }
  return null;
}

function cleanDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 40) return null; // terlalu pendek = tagline tanpa info
  return t.slice(0, 600);
}

// ── Scrape utama ──────────────────────────────────────────────
async function fetchHomepage(website: string): Promise<string | null> {
  const url = website.startsWith("http") ? website : `https://${website}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 500) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, MAX_HTML));
  } catch {
    return null;
  }
}

const GENERIC_NAME_TOKENS = new Set([
  "indonesia", "internasional", "international", "group", "grup", "utama", "sentosa",
  "abadi", "sejahtera", "makmur", "nusantara", "global", "persada", "karya", "cipta",
]);

/**
 * Verifikasi bahwa homepage benar milik perusahaan tsb: minimal satu token
 * nama yang khas harus muncul di <title>/og:site_name/h1/meta description.
 * Mencegah salah atribusi (mis. "Zimmer Indonesia" → zimmermann.com).
 */
function verifyNameMatch(name: string, html: string): boolean {
  const tokens = cleanCompanyName(name)
    .toLowerCase()
    .split(" ")
    .filter((t) => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t));
  if (tokens.length === 0) return true; // nama generik total — tak bisa diverifikasi, izinkan
  const title = (pageTitle(html) ?? "") + " " + (metaContent(html, "property=[\"']og:site_name") ?? "");
  const desc = metaContent(html, "name=[\"']description|property=[\"']og:description") ?? "";
  const h1 = (html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ");
  const haystack = `${title} ${desc.slice(0, 300)} ${h1}`.toLowerCase();
  return tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack));
}

/** Cek ringan apakah website tersimpan pantas milik perusahaan (buat cleanup). */
export async function verifyCompanyDomain(name: string, website: string): Promise<boolean> {
  const html = await fetchHomepage(website);
  if (!html) return false; // situs mati — profil tak bisa dipertanggungjawabkan
  return verifyNameMatch(name, html);
}

// ── ABOUT PAGE ──────────────────────────────────────────────────
// Banyak situs menaruh deskripsi perusahaan di /about, /tentang-kami,
// /profil — discover dari link homepage lalu ambil paragraf terpanjang.
const ABOUT_LINK_RE = /(?:tentang(?:\s|-)?kami|about(?:\s|-)?us|profil(?:\s|-)?perusahaan|company\s+profile|siapa\s+kami)/i;

function findAboutLink(html: string, baseUrl: string): string | null {
  const links = [...html.matchAll(/href\s*=\s*["']([^"'#]{4,200})["']/gi)].map((m) => m[1]);
  for (const raw of links) {
    let abs: string;
    try {
      abs = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    try {
      const u = new URL(abs);
      const base = new URL(baseUrl);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue; // sama domain
      if (ABOUT_LINK_RE.test(u.pathname) || ABOUT_LINK_RE.test(decodeURIComponent(u.pathname))) return abs;
    } catch {
      continue;
    }
  }
  return null;
}

function extractAboutParagraphs(html: string): string | null {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]{80,1200}?)<\/p>/gi)]
    .map((m) => decodeHtml(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((t) => {
      if (t.length < 120) return false;
      // buang paragraf UI/menu/copyright
      if (/(copyright|©|all rights reserved|login|daftar|subscribe|newsletter|follow us|menu)/i.test(t)) return false;
      return true;
    });
  if (paras.length === 0) return null;
  // 2 paragraf terpanjang digabung — biasanya itu narasi perusahaan
  const sorted = [...paras].sort((a, b) => b.length - a.length).slice(0, 2);
  sorted.sort((a, b) => paras.indexOf(a) - paras.indexOf(b));
  return cleanDescription(sorted.join(" "));
}

// ── WIKIPEDIA ───────────────────────────────────────────────────
const WIKI_TIMEOUT_MS = 6000;

async function wikipediaSummary(name: string): Promise<string | null> {
  const q = cleanCompanyName(name);
  if (q.length < 3) return null;
  // verifikasi judul entri memang tentang perusahaan ini: token GENERIK dibuang
  // (united/creative/group/indonesia — tak bersifat pembeda), sisanya WAJIB
  // muncul di judul. Mencegah nyasar ("United Creative" → jurnal "...United
  // States of America" / "Creative Technology Ltd")
  const WIKI_GENERIC = new Set([
    "united", "creative", "group", "grup", "indonesia", "international", "internasional",
    "national", "global", "nusantara", "persero", "tbk", "corporation", "company",
    "inc", "ltd", "the", "and", "dan", "of", "for",
  ]);
  const nameTokens = q.toLowerCase().split(" ").filter((t) => t.length >= 3 && !WIKI_GENERIC.has(t));
  const titleMatches = (title: string): boolean => {
    if (nameTokens.length === 0) return false; // nama tanpa token khas → jangan asal cocok
    const tl = title.toLowerCase();
    return nameTokens.every((t) => tl.includes(t));
  };
  for (const lang of ["id", "en"]) {
    try {
      const searchRes = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1`,
        { signal: AbortSignal.timeout(WIKI_TIMEOUT_MS), headers: { "User-Agent": "JobForgeBot/1.0 (company profile enrichment)" } }
      );
      if (!searchRes.ok) continue;
      const searchJson = (await searchRes.json()) as { query?: { search?: { title: string }[] } };
      const title = searchJson.query?.search?.[0]?.title;
      if (!title || !titleMatches(title)) continue;
      const sumRes = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
        signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
        headers: { "User-Agent": "JobForgeBot/1.0 (company profile enrichment)" },
      });
      if (!sumRes.ok) continue;
      const sumJson = (await sumRes.json()) as { type?: string; extract?: string };
      if (sumJson.type && sumJson.type !== "standard") continue;
      const extract = sumJson.extract ?? "";
      if (extract.length >= 120 && /adalah|is a|merupakan/i.test(extract.slice(0, 200))) return cleanDescription(extract);
    } catch {
      // timeout/blocked — lanjut bahasa berikutnya
    }
  }
  return null;
}

/**
 * Enrich satu perusahaan. `knownWebsite` = website tersimpan di DB (boleh null).
 * Nama dipakai untuk Clearbit domain lookup bila website kosong — hasil lookup
 * WAJIB lolos verifikasi nama↔halaman sebelum description/industry disimpan.
 */
export async function enrichCompanyProfile(name: string, knownWebsite: string | null | undefined): Promise<CompanyProfile | null> {
  const directDomain = extractDomain(knownWebsite);
  const domain = directDomain ?? (await resolveDomainFromName(name));
  if (!domain) {
    // tanpa domain pun Wikipedia tetap dicoba — entri ensiklopedia tidak butuh situs
    const wiki = await wikipediaSummary(name);
    if (wiki) return { website: "", domain: "", description: wiki, industry: null, size: null, source: "wikipedia" };
    return null;
  }
  const website = directDomain ? (knownWebsite as string).startsWith("http") ? knownWebsite as string : `https://${extractDomain(knownWebsite)}` : `https://${domain}`;

  const html = await fetchHomepage(website);
  // domain dari tebakan nama (bukan website resmi) → wajib verifikasi nama↔halaman
  if (!directDomain && html && !verifyNameMatch(name, html)) {
    // situs tebakan bukan milik perusahaan — jangan atribusi; tapi Wikipedia
    // tetap boleh (ensiklopedia, bukan situs yang salah itu)
    const wiki = await wikipediaSummary(name);
    if (wiki) return { website: "", domain, description: wiki, industry: null, size: null, source: "wikipedia" };
    return null;
  }
  const haystack = html ? `${html.slice(0, 60_000)} ${domain}` : domain;

  // 1. JSON-LD Organization
  let description: string | null = null;
  let industry: string | null = null;
  let size: string | null = null;
  let source: CompanyProfile["source"] = "meta";
  if (html) {
    for (const node of walkJsonLd(html)) {
      const type = node["@type"];
      const isOrg = typeof type === "string" ? /organization|company|corporation|localbusiness/i.test(type) : Array.isArray(type) ? type.some((t) => typeof t === "string" && /organization|company|corporation|localbusiness/i.test(t)) : false;
      if (!isOrg) continue;
      description = cleanDescription(typeof node.description === "string" ? node.description : null) ?? description;
      size = numberOfEmployeesFromJsonLd(node) ?? size;
      const kw = typeof node.keywords === "string" ? node.keywords : null;
      industry = classifyIndustry(`${kw ?? ""} ${domain}`) ?? industry;
      if (description) source = "jsonld";
      if (description && size) break;
    }
    // 2. meta tags + teks terlihat — KLASIFIKASI HANYA DARI SINYAL VISIBLE
    //    (raw HTML mengandung atribut media=, class name, CSS → false positive)
    description = description ?? cleanDescription(metaContent(html, "name=[\"']description|property=[\"']og:description"));
    const visible = [
      pageTitle(html) ?? "",
      metaContent(html, "name=[\"']description|property=[\"']og:description") ?? "",
      metaContent(html, "name=[\"']keywords") ?? "",
      ...Array.from(html.matchAll(/<h[12][^>]*>([\s\S]{0,200}?)<\/h[12]>/gi), (m) => m[1].replace(/<[^>]+>/g, " ")),
    ]
      .join(" ")
      .slice(0, 4000);
    industry = industry ?? classifyIndustry(`${visible} ${domain}`);
    // 3. heuristik ukuran dari full page text
    const plainText = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    size = size ?? sizeFromHeuristics(plainText);
  } else {
    industry = classifyIndustry(domain);
  }
  if (!description && html) {
    const t = pageTitle(html);
    // title pendek + tanpa info perusahaan → jangan dipaksa jadi description
    if (t && t.length >= 60) {
      description = t.slice(0, 300);
      source = "meta";
    }
  }

  // 4. ABOUT PAGE — narasi "Tentang Kami" asli dari situs perusahaan
  if (!description && html) {
    const aboutUrl = findAboutLink(html, website);
    if (aboutUrl) {
      const aboutHtml = await fetchHomepage(aboutUrl);
      if (aboutHtml && (directDomain || verifyNameMatch(name, aboutHtml))) {
        description = extractAboutParagraphs(aboutHtml);
        if (description) source = "about-page";
      }
    }
  }

  // 5. WIKIPEDIA — ensiklopedia publik (id → en), hanya entri perusahaan
  if (!description) {
    const wiki = await wikipediaSummary(name);
    if (wiki) {
      description = wiki;
      source = "wikipedia";
    }
  }

  // domain ter-resolve = minimal website tersimpan (display + retry murah);
  // description/industry/size boleh null kalau situs mati/tanpa metadata.
  return { website, domain, description, industry, size, source: description ? source : "heuristik" };
}
