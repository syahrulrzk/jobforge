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

export const COMPANY_TEMPLATES: CompanyTemplate[] = [
  { name: "PT Sinar Digital Indonesia", website: "https://www.sinardigital.co.id", industry: "Information Technology", profile: "Perusahaan yang bergerak di bidang teknologi informasi, fokus pada pengembangan platform digital dan layanan cloud untuk enterprise.", emailLocal: "career" },
  { name: "PT Nusantara Teknologi Kreatif", website: "https://nusantek.id", industry: "Information Technology", profile: "Software house yang berdiri sejak 2015, mengembangkan aplikasi mobile dan web untuk klien lintas industri di Indonesia.", emailLocal: "recruitment" },
  { name: "PT Global Media Anti", website: "https://globalmediaanti.com", industry: "Media & Publishing", profile: "Perusahaan media digital dengan jangkauan pembaca nasional, mengelola portal berita dan konten premium.", emailLocal: "hr" },
  { name: "PT Andalan Fintech Group", website: "https://andalanfintech.co.id", industry: "Financial Services", profile: "Grup fintech yang menyediakan layanan pembayaran digital, pinjaman online, dan pengelolaan aset.", emailLocal: "talent" },
  { name: "PT Maju E-Commerce Sentosa", website: "https://majuecommerce.id", industry: "E-Commerce", profile: "Marketplace nasional dengan jutaan pengguna aktif bulanan, menghubungkan penjual dan pembeli di seluruh Indonesia.", emailLocal: "jobs" },
  { name: "PT Bumi Logistik Prima", website: "https://bumilogistik.co.id", industry: "Logistics & Supply Chain", profile: "Jasa logistik terintegrasi dengan jaringan gudang di 34 provinsi dan armada pengiriman sendiri.", emailLocal: "hrd" },
  { name: "PT Cerdas Data Analytics", website: "https://cerdasdata.io", industry: "Data & Analytics", profile: "Konsultan data analytics dan business intelligence untuk perusahaan B2B, bank, dan institusi pemerintah.", emailLocal: "career" },
  { name: "PT Sehat Digital Medika", website: "https://sehatdigital.id", industry: "HealthTech", profile: "Platform kesehatan digital yang menghubungkan pasien dengan dokter, apotek, dan laboratorium.", emailLocal: "recruitment" },
  { name: "PT Pintar Edukasi Nusantara", website: "https://pintaredu.id", industry: "EdTech", profile: "Perusahaan edukasi teknologi dengan produk belajar online untuk pelajar dan profesional.", emailLocal: "hr" },
  { name: "PT Kreatif Studio Digital", website: "https://kreatifstudio.co", industry: "Creative & Design", profile: "Studio kreatif yang melayani branding, UI/UX design, dan produksi konten untuk brand nasional.", emailLocal: "career" },
  { name: "PT Trans Otomotif Indonesia", website: "https://transoto.co.id", industry: "Automotive", profile: "Distributor dan platform digital otomotif, termasuk layanan_servis purna jual dan marketplace suku cadang.", emailLocal: "jobs" },
  { name: "PT Hijau Energi Terbarukan", website: "https://hijauenergi.id", industry: "Energy & Utilities", profile: "Perusahaan energi terbarukan yang mengembangkan PLTS atap dan solusi energi bersih untuk komersial.", emailLocal: "recruitment" },
  { name: "PT Wisata Travelindo", website: "https://travelindo.com", industry: "Travel & Hospitality", profile: "OTA (Online Travel Agent) dengan produk tiket, hotel, dan paket wisata domestik maupun internasional.", emailLocal: "hrd" },
  { name: "PT Aman Asuransi Jiwa", website: "https://amanasuransi.co.id", industry: "Insurance", profile: "Perusahaan asuransi jiwa dengan produk proteksi digital dan layanan klaim online 24 jam.", emailLocal: "talent" },
  { name: "PT Cepat Kurir Kilat", website: "https://cepatkurir.id", industry: "Logistics & Supply Chain", profile: "Startup delivery instan same-day dengan jaringan kurir di 50+kota, fokus pada e-commerce fulfillment.", emailLocal: "jobs" },
  { name: "PT Bank Digital Harapan", website: "https://bankdigital.co.id", industry: "Banking", profile: "Bank digital dengan layanan perbankan penuh berbasis aplikasi, bagian dari grup keuangan besar.", emailLocal: "recruitment" },
  { name: "PT Rasa Kuliner Group", website: "https://rasakuliner.id", industry: "Food & Beverage", profile: "Grup restoran dan cloud kitchen dengan 120+ outlet di pulau Jawa dan Bali.", emailLocal: "hr" },
  { name: "PT Amanah Properti Utama", website: "https://amanahproperti.co.id", industry: "Real Estate", profile: "Pengembang properti residensial dan proptech marketplace untuk sewa dan jual-beli properti.", emailLocal: "career" },
  { name: "PT Tangguh Keamanan Siber", website: "https://tangguhsiber.io", industry: "Cybersecurity", profile: "Perusahaan keamanan siber yang menyediakan pentest, SOC, dan managed security untuk enterprise.", emailLocal: "talent" },
  { name: "PT Cerdik Game Studios", website: "https://cerdikgames.com", industry: "Gaming & Entertainment", profile: "Game studio indie yang memproduksi game mobile dengan jutaan unduhan di Asia Tenggara.", emailLocal: "jobs", noPublicEmail: true },
  { name: "PT Ramah Lingkungan Pack", website: "https://ramahpack.id", industry: "Manufacturing", profile: "Produsen kemasan ramah lingkungan dengan bahan biodegradable untuk UMKM dan korporasi.", emailLocal: "hrd", noPublicEmail: true },
  { name: "PT Prestasi Konsultan Manajemen", website: "https://prestasikonsul.com", industry: "Consulting", profile: "Firma konsultan manajemen yang membantu transformasi digital dan optimalisasi proses bisnis.", emailLocal: "career" },
  { name: "PT Cepat Telekomunikasi Molde", website: "https://cepattelco.co.id", industry: "Telecommunications", profile: "Operator telekomunikasi regional dengan layanan fiber optic dan solusi IoT untuk industri.", emailLocal: "recruitment" },
  { name: "PT Satu Agri Teknologi", website: "https://satuarti.id", industry: "AgriTech", profile: "Platform agriteknologi yang menghubungkan petani dengan pembeli korporat dan akses pembiayaan.", emailLocal: "hr", badMx: true },
  { name: "PT Unggul Konstruksi Bina", website: "https://unggulbina.co.id", industry: "Construction & Engineering", profile: "Kontraktor umum dan EPC untuk proyek infrastruktur gedung bertingkat dan jalan tol.", emailLocal: "jobs" },
  { name: "PT Melati Kosmetik Alami", website: "https://melatibeauty.id", industry: "FMCG & Beauty", profile: "Brand kosmetik alami lokal dengan distribusi di 8.000+ toko dan kanal e-commerce.", emailLocal: "career", badMx: true },
  { name: "PT Prima Otomasi Sistem", website: "https://primaotomasi.id", industry: "Industrial Automation", profile: "Penyedia solusi otomasi pabrik, robotika, dan sistem SCADA untuk manufaktur modern.", emailLocal: "hrd" },
  { name: "PT Harmoni Event Organizer", website: "https://harmonieo.id", industry: "Events & MICE", profile: "Penyelenggara event korporat, konser, dan pameran berskala nasional.", noPublicEmail: true },
  { name: "PT Andal Sport Digital", website: "https://andalsport.id", industry: "Sports & Fitness", profile: "Platform booking lapangan olahraga dan komunitas digital untuk pecinta aktivitas fisik.", emailLocal: "jobs" },
  { name: "PT Mitra Layanan Biro", website: "https://mitrabiro.co.id", industry: "Professional Services", profile: "Perusahaan jasa administrasi kepegawaian, payroll, dan HR outsourcing untuk klien B2B.", emailLocal: "recruitment" },
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
