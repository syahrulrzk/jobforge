// ─────────────────────────────────────────────────────────────
// JOBFORCE — Source data pool for scraper simulation
// Realistic Indonesian job market data
// ─────────────────────────────────────────────────────────────

export interface CompanyTemplate {
  name: string;
  website: string;
  industry: string;
  profile: string;
  // email local-part used for HR contact (§12.2 priority)
  emailLocal?: string;
  // some companies deliberately have no published email → NEEDS_ENRICHMENT
  noPublicEmail?: boolean;
  // some domains deliberately fail MX validation
  badMx?: boolean;
}

// Real Indonesian companies — every domain below was verified to return a
// genuine favicon/logo from Google's s2 service, so enrichment shows real
// brand logos instead of generated placeholders.
export const COMPANY_TEMPLATES: CompanyTemplate[] = [
  { name: "PT Tokopedia", website: "https://www.tokopedia.com", industry: "E-Commerce", profile: "Marketplace pelopor Indonesia dengan ratusan juta pengguna, menghubungkan penjual dan pembeli dari seluruh nusantara lewat platform e-commerce dan layanan keuangan digital.", emailLocal: "career" },
  { name: "PT Shopee Indonesia", website: "https://shopee.co.id", industry: "E-Commerce", profile: "Platform e-commerce terkemuka di Asia Tenggara dengan operasi besar di Indonesia, mencakup marketplace, ShopeePay, dan logistik Shopee Xpress.", emailLocal: "recruitment" },
  { name: "PT Bukalapak", website: "https://www.bukalapak.com", industry: "E-Commerce", profile: "Perusahaan teknologi Indonesia yang menghadirkan marketplace sekaligus solusi UMKM, mitra warung, dan layanan digital bagi masyarakat luas.", emailLocal: "jobs" },
  { name: "PT Blibli", website: "https://www.blibli.com", industry: "E-Commerce", profile: "Omni-channel retailer milik Dian Swastatika Sentosa yang menggabungkan pengalaman belanja online dan offline untuk brand-brand global dan lokal.", emailLocal: "career" },
  { name: "PT Lazada Indonesia", website: "https://www.lazada.co.id", industry: "E-Commerce", profile: "Pionir e-commerce Asia Tenggara bagian dari Alibaba Group, fokus pada pengalaman belanja terintegrasi, logistik, dan pembayaran digital.", emailLocal: "hr" },
  { name: "PT Traveloka Indonesia", website: "https://www.traveloka.com", industry: "Travel & Hospitality", profile: "Decacorn teknologi Indonesia yang menyediakan produk tiket pesawat, hotel, finansial, dan lifestyle dalam satu aplikasi lifestyle superapp.", emailLocal: "talent" },
  { name: "PT Global Tiket Network", website: "https://www.tiket.com", industry: "Travel & Hospitality", profile: "Online travel agent asal Indonesia di bawah Blibli Tiket, menyediakan tiket pesawat, kereta, hotel, event, dan XPERIENCE untuk wisatawan domestik.", emailLocal: "career" },
  { name: "PT Grab Indonesia", website: "https://www.grab.com", industry: "Technology", profile: "Superapp terdepan di Asia Tenggara untuk transportasi daring, makanan, dan layanan keuangan digital, dengan komitmen menggerakkan ekonomi driver mitra.", emailLocal: "jobs" },
  { name: "PT Ruangguru", website: "https://www.ruangguru.com", industry: "EdTech", profile: "Platform belajar online terbesar di Indonesia dengan lebih dari 20 juta pengguna, menawarkan kelas online, tryout, les privat, dan RuangJabatan.", emailLocal: "recruitment" },
  { name: "PT Zenius Education", website: "https://www.zenius.net", industry: "EdTech", profile: "Perusahaan pendidikan yang menyediakan pembelajaran video, tryout UTBK, dan Zenius For Business untuk sekolah serta perusahaan di Indonesia.", emailLocal: "hr" },
  { name: "PT Halodoc", website: "https://www.halodoc.com", industry: "HealthTech", profile: "Platform kesehatan digital yang memudahkan pasien berkonsultasi dengan dokter, membeli obat, dan booking laboratorium secara online di seluruh Indonesia.", emailLocal: "career" },
  { name: "PT Alodokter", website: "https://www.alodokter.com", industry: "HealthTech", profile: "Jaringan dokter online terbesar di Indonesia dengan portal informasi kesehatan Alodokter dan layanan booking rumah sakit melalui aplikasi Halodoc partner.", emailLocal: "recruitment" },
  { name: "PT DANA Indonesia", website: "https://www.dana.id", industry: "Financial Services", profile: "Dompet digital nasional yang memungkinkan pengguna bertransaksi cashless, bayar QRIS, transfer, dan akses layanan keuangan dengan mudah dan aman.", emailLocal: "talent" },
  { name: "PT Kredivo", website: "https://www.kredivo.com", industry: "Financial Services", profile: "Platform kredit digital terkemuka di Indonesia yang menyediakan paylater dan cicilan tenor fleksibel untuk belanja online maupun offline.", emailLocal: "career" },
  { name: "PT Midtrans Payment Indonesia", website: "https://midtrans.com", industry: "Financial Services", profile: "Merchant payment gateway milik GoTo Financial, memproses beragam metode pembayaran digital untuk ribuan bisnis online dan offline di Indonesia.", emailLocal: "jobs" },
  { name: "PT Stockbit", website: "https://stockbit.com", industry: "Financial Services", profile: "Aplikasi investasi saham dan reksadana dengan komunitas investor terbesar di Indonesia, menggabungkan streaming data dan diskusi bersama analis.", emailLocal: "recruitment" },
  { name: "PT Ajaib Sekuritas Asia", website: "https://ajaib.co.id", industry: "Financial Services", profile: "Aplikasi investasi saham, reksadana, dan emas yang menargetkan investor ritel Indonesia dengan biaya rendah dan pengalaman yang sederhana.", emailLocal: "hr", badMx: true },
  { name: "PT SiCepat Ekspres Indonesia", website: "https://www.sicepat.com", industry: "Logistics & Supply Chain", profile: "Perusahaan logistik nasional dengan layanan kargo, same day, next day, dan reguler yang menjangkau lebih dari 400 kota di Indonesia.", emailLocal: "hrd" },
  { name: "PT Pos Anteraja", website: "https://anteraja.id", industry: "Logistics & Supply Chain", profile: "Jaringan kurir last-mile milik Pos Indonesia yang melayani pengiriman paket e-commerce dengan jangkauan hingga pelosok nusantara.", emailLocal: "jobs" },
  { name: "PT Ninja Xpress", website: "https://www.ninjavan.co", industry: "Logistics & Supply Chain", profile: "Logistik teknologi yang berfokus pada pengiriman e-commerce dengan teknologi sorting otomatis dan jaringan hub di seluruh Asia Tenggara.", emailLocal: "career" },
  { name: "PT Telkomsel", website: "https://www.telkomsel.com", industry: "Telecommunications", profile: "Operator seluler terbesar di Indonesia milik Telkom Indonesia dan Singtel, memimpin layanan 4G, 5G, digital advertising, dan UMKM melalui UMKM Zone.", emailLocal: "recruitment" },
  { name: "PT XL Axiata Tbk", website: "https://www.xl.co.id", industry: "Telecommunications", profile: "Operator telekomunikasi nasional yang menyediakan layanan seluler, broadband, dan solusi digital enterprise untuk korporasi di Indonesia.", emailLocal: "talent" },
  { name: "PT Detik Network", website: "https://www.detik.com", industry: "Media & Publishing", profile: "Grup media digital terbesar di Indonesia dengan portal detikcom serta kanal berita wajib baca bagi pembaca nasional dan internasional.", emailLocal: "hr" },
  { name: "PT Kompas Cyber Media", website: "https://www.kompas.com", industry: "Media & Publishing", profile: "Pengelola portal berita Kompas.com, media utama Kompas Gramedia yang menghadirkan jurnalisme berkualitas untuk jutaan pembaca setiap hari.", emailLocal: "career" },
  { name: "PT Kumparan Media", website: "https://kumparan.com", industry: "Media & Publishing", profile: "Platform media digital kolaboratif yang menghadirkan berita, video, dan infografis interaktif untuk pembaca muda Indonesia.", emailLocal: "hrd" },
  { name: "PT IDN Media", website: "https://www.idntimes.com", industry: "Media & Publishing", profile: "Media company multichannel untuk Gen Z dan milenial Indonesia, mengelola IDN Times, Popbela, IDN Financials, dan IDN Pictures.", emailLocal: "jobs", badMx: true },
  { name: "PT Glints Indonesia", website: "https://glints.com", industry: "Professional Services", profile: "Platform talent ecosystem di Asia Tenggara yang menghubungkan perusahaan dengan talenta teknis terbaik melalui rekrutmen dan talent management.", emailLocal: "talent" },
  { name: "PT Kalibrr", website: "https://www.kalibrr.com", industry: "Professional Services", profile: "Job marketplace dan career platform yang membantu perusahaan merekrut kandidat berkualitas dengan technology-driven matching.", noPublicEmail: true },
  { name: "PT Pasar Polis", website: "https://pasarpolis.com", industry: "Insurance", profile: "Insurtech terkemuka Indonesia yang bermitra dengan 40+ perusahaan asuransi untuk menjual polis secara digital dengan proses klaim cepat.", emailLocal: "recruitment", noPublicEmail: true },
  { name: "PT Sayurbox", website: "https://www.sayurbox.com", industry: "AgriTech", profile: "Platform agritek B2B2C yang memangkas rantai pasok sayur dari petani langsung ke konsumen dan bisnis dengan harga transparan.", emailLocal: "hr", noPublicEmail: true },
];

export const JOB_ROLES: {
  title: string;
  skills: string[];
  requirements: string[];
  salaryRange: [number, number];
}[] = [
  { title: "Backend Developer", skills: ["Node.js", "TypeScript", "PostgreSQL", "Redis"], requirements: ["Minimal 2 tahun pengalaman", "Menguasai Node.js dan TypeScript", "Memahami desain REST API dan database relasional"], salaryRange: [8000000, 15000000] },
  { title: "Frontend Developer", skills: ["React", "TypeScript", "Tailwind CSS"], requirements: ["Minimal 1 tahun pengalaman", "Menguasai React dan state management", "Paham responsive design"], salaryRange: [7000000, 13000000] },
  { title: "Fullstack Developer", skills: ["Next.js", "Node.js", "Prisma", "PostgreSQL"], requirements: ["Minimal 2 tahun pengalaman fullstack", "Mampu membangun fitur end-to-end", "Familiar dengan Prisma ORM"], salaryRange: [9000000, 16000000] },
  { title: "Mobile Developer", skills: ["Flutter", "Dart", "REST API"], requirements: ["Minimal 2 tahun pengalaman Flutter", "Pernah publish aplikasi ke Play Store/App Store", "Paham clean architecture"], salaryRange: [8000000, 14000000] },
  { title: "DevOps Engineer", skills: ["Docker", "Kubernetes", "CI/CD", "AWS"], requirements: ["Minimal 3 tahun pengalaman", "Menguasai Docker dan Kubernetes", "Berpengalaman dengan cloud provider"], salaryRange: [12000000, 22000000] },
  { title: "Data Analyst", skills: ["SQL", "Python", "Tableau", "Excel"], requirements: ["Minimal 1 tahun pengalaman analisis data", "Menguasai SQL dan visualisasi data", "Mampu menyusun dashboard bisnis"], salaryRange: [6000000, 11000000] },
  { title: "Data Engineer", skills: ["Python", "Airflow", "Spark", "PostgreSQL"], requirements: ["Minimal 2 tahun pengalaman data engineering", "Membangun data pipeline produksi", "Paham data warehousing"], salaryRange: [10000000, 18000000] },
  { title: "QA Engineer", skills: ["Automation Testing", "Selenium", "Playwright", "Postman"], requirements: ["Minimal 1 tahun pengalaman QA", "Mampu menulis test automation", "Teliti dan terorganisir"], salaryRange: [6000000, 10000000] },
  { title: "UI/UX Designer", skills: ["Figma", "Design System", "Prototyping"], requirements: ["Minimal 1 tahun pengalaman", "Menguasai Figma dan design system", "Punya portfolio produk digital"], salaryRange: [6000000, 12000000] },
  { title: "Product Manager", skills: ["Product Roadmap", "Agile", "Data-Driven"], requirements: ["Minimal 3 tahun pengalaman produk", "Mampu menyusun PRD dan roadmap", "Komunikasi yang baik dengan stakeholder"], salaryRange: [14000000, 25000000] },
  { title: "Digital Marketing Specialist", skills: ["SEO", "Google Ads", "Meta Ads", "Content Strategy"], requirements: ["Minimal 1 tahun pengalaman digital marketing", "Mengelola budget iklan bulanan", "Mampu menganalisis performa kampanye"], salaryRange: [5000000, 9000000] },
  { title: "IT Support Specialist", skills: ["Windows Server", "Networking", "Helpdesk"], requirements: ["Minimal 1 tahun pengalaman IT support", "Paham troubleshooting hardware dan jaringan", "Siap kerja shift"], salaryRange: [4500000, 7000000] },
  { title: "Software Engineer Intern", skills: ["JavaScript", "Git", "OOP"], requirements: ["Mahasiswa tingkat akhir atau fresh graduate", "Dasar pemrograman yang kuat", "Willing to learn fast"], salaryRange: [1500000, 3000000] },
  { title: "Site Reliability Engineer", skills: ["Grafana", "Prometheus", "Linux", "Golang"], requirements: ["Minimal 3 tahun pengalaman SRE/DevOps", "Pengalaman mengelola sistem berskala besar", "Paham SLO/SLA dan incident management"], salaryRange: [15000000, 28000000] },
  { title: "Scrum Master", skills: ["Scrum", "Jira", "Facilitation"], requirements: ["Sertifikasi Scrum Master diutamakan", "Minimal 2 tahun memimpin tim agile", "Kemampuan komunikasi dan mediasi kuat"], salaryRange: [10000000, 17000000] },
  { title: "Business Intelligence Developer", skills: ["Power BI", "SQL", "Data Modeling"], requirements: ["Minimal 2 tahun pengalaman BI", "Menguasai SQL advanced", "Berpengalaman membangun reporting suite"], salaryRange: [9000000, 15000000] },
  { title: "Content Writer", skills: ["Copywriting", "SEO Writing", "Research"], requirements: ["Minimal 1 tahun pengalaman menulis konten digital", "Bahasa Indonesia yang baik dan benar", "Portofolio artikel SEO"], salaryRange: [4500000, 8000000] },
  { title: "Customer Success Manager", skills: ["Account Management", "CRM", "Communication"], requirements: ["Minimal 2 tahun pengalaman customer success", "Mampu mengelola portofolio klien B2B", "Orientasi pada retensi dan upsell"], salaryRange: [8000000, 13000000] },
  { title: "Cloud Architect", skills: ["AWS", "Terraform", "Networking", "Security"], requirements: ["Minimal 5 tahun pengalaman infrastruktur cloud", "Sertifikasi AWS/GCP diutamakan", "Berpengalaman desain arsitektur multi-region"], salaryRange: [20000000, 35000000] },
  { title: "HR Generalist", skills: ["Recruitment", "Payroll", "Employee Relations"], requirements: ["Minimal 2 tahun pengalaman HR", "Menguasai proses rekrutmen hingga offboarding", "Paham regulasi ketenagakerjaan"], salaryRange: [6000000, 10000000] },
];

export const CITIES = [
  "Jakarta Selatan",
  "Jakarta Pusat",
  "Jakarta Utara",
  "Tangerang Selatan",
  "Bandung",
  "Surabaya",
  "Yogyakarta",
  "Semarang",
  "Medan",
  "Makassar",
  "Denpasar",
  "Remote",
];

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"];
export const WORKPLACE_TYPES = ["ONSITE", "REMOTE", "HYBRID"];

// Per-source characteristics for the simulation adapters (§9)
export interface SourceProfile {
  slug: string;
  name: string;
  baseUrl: string;
  type: string;
  scraperType: string;
  schedule: string;
  minJobs: number;
  maxJobs: number;
  // chance that a scraped job has salary info
  salaryChance: number;
  // chance the raw record is missing company logo (→ NEEDS_ENRICHMENT path)
  missingLogoChance: number;
  // chance the record title uses "- at Company" suffix format
  suffixTitleChance: number;
  // chance of duplicate against a previously seen job in this run
  intraDupChance: number;
}

export const SOURCE_PROFILES: SourceProfile[] = [
  // ── REAL boards (public job APIs, live data) ──
  { slug: "remotive", name: "Remotive", baseUrl: "https://remotive.com", type: "PUBLIC_SOURCE", scraperType: "API", schedule: "hourly", minJobs: 20, maxJobs: 30, salaryChance: 0.4, missingLogoChance: 0, suffixTitleChance: 0, intraDupChance: 0 },
  { slug: "jobicy", name: "Jobicy", baseUrl: "https://jobicy.com", type: "PUBLIC_SOURCE", scraperType: "API", schedule: "hourly", minJobs: 20, maxJobs: 30, salaryChance: 0.3, missingLogoChance: 0, suffixTitleChance: 0, intraDupChance: 0 },
  { slug: "arbeitnow", name: "Arbeitnow", baseUrl: "https://www.arbeitnow.com", type: "PUBLIC_SOURCE", scraperType: "API", schedule: "every_6_hours", minJobs: 15, maxJobs: 30, salaryChance: 0.1, missingLogoChance: 1, suffixTitleChance: 0, intraDupChance: 0 },
  { slug: "remoteok", name: "RemoteOK", baseUrl: "https://remoteok.com", type: "PUBLIC_SOURCE", scraperType: "API", schedule: "every_6_hours", minJobs: 15, maxJobs: 30, salaryChance: 0.25, missingLogoChance: 0.4, suffixTitleChance: 0, intraDupChance: 0 },
  // ── Legacy simulation boards (mock generator) ──
  { slug: "jobstreet", name: "JobStreet", baseUrl: "https://www.jobstreet.co.id", type: "JOB_PORTAL", scraperType: "DYNAMIC", schedule: "every_6_hours", minJobs: 14, maxJobs: 30, salaryChance: 0.55, missingLogoChance: 0.06, suffixTitleChance: 0.5, intraDupChance: 0.1 },
  { slug: "glints", name: "Glints", baseUrl: "https://glints.com", type: "JOB_PORTAL", scraperType: "DYNAMIC", schedule: "every_6_hours", minJobs: 10, maxJobs: 22, salaryChance: 0.7, missingLogoChance: 0.05, suffixTitleChance: 0.2, intraDupChance: 0.08 },
  { slug: "indeed", name: "Indeed", baseUrl: "https://id.indeed.com", type: "JOB_PORTAL", scraperType: "DYNAMIC", schedule: "every_12_hours", minJobs: 12, maxJobs: 26, salaryChance: 0.4, missingLogoChance: 0.12, suffixTitleChance: 0.35, intraDupChance: 0.15 },
  { slug: "kalibrr", name: "Kalibrr", baseUrl: "https://www.kalibrr.com", type: "JOB_PORTAL", scraperType: "STATIC", schedule: "every_12_hours", minJobs: 8, maxJobs: 18, salaryChance: 0.6, missingLogoChance: 0.05, suffixTitleChance: 0.15, intraDupChance: 0.07 },
  { slug: "karir", name: "Karir.com", baseUrl: "https://www.karir.com", type: "JOB_PORTAL", scraperType: "STATIC", schedule: "daily", minJobs: 6, maxJobs: 14, salaryChance: 0.3, missingLogoChance: 0.15, suffixTitleChance: 0.25, intraDupChance: 0.1 },
  { slug: "dealls", name: "Dealls", baseUrl: "https://dealls.com", type: "JOB_PORTAL", scraperType: "API", schedule: "daily", minJobs: 6, maxJobs: 12, salaryChance: 0.65, missingLogoChance: 0.04, suffixTitleChance: 0.1, intraDupChance: 0.05 },
  { slug: "career-sites", name: "Company Career Websites", baseUrl: "https://careers.example.co.id", type: "CAREER_SITE", scraperType: "STATIC", schedule: "daily", minJobs: 4, maxJobs: 10, salaryChance: 0.5, missingLogoChance: 0.03, suffixTitleChance: 0.05, intraDupChance: 0.05 },
];

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function chance(p: number): boolean {
  return Math.random() < p;
}
