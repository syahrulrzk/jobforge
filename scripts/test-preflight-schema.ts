// Verifikasi pre-flight delivery gate (bulkImportSchema §7/§19):
// 1. payload canonical lengkap & valid → lolos
// 2. logo_url kosong → tertolak (mandatory §11)
// 3. hr_email tidak valid → tertolak
// 4. description kosong → tertolak (mandatory §17)
// Jalankan: bun scripts/test-preflight-schema.ts
import { bulkImportSchema } from "../src/lib/jobforge/types";

const base = {
  source: { platform: "remotive", job_id: "RM-1", url: "https://remotive.com/jobs/1" },
  company: {
    name: "PT Maju Jaya",
    logo_url: "https://logo.example.com/maju.png",
    website: "https://majujaya.co.id",
    profile: "Perusahaan manufaktur nasional.",
  },
  job: {
    title: "Backend Engineer",
    description: "Membangun API skala besar untuk platform logistik.",
    salary: { min: 8_000_000, max: 15_000_000, currency: "IDR" },
    location: "Jakarta",
    employment_type: "FULL_TIME",
    workplace_type: "HYBRID",
    requirements: ["Node.js"],
    skills: ["Node.js"],
  },
  contact: {
    hr_email: "hrd@majujaya.co.id",
    email_source: "https://majujaya.co.id/careers",
    email_verified: true,
  },
  metadata: { scraped_at: new Date().toISOString() },
};

const payload = (job: Record<string, unknown>) => ({
  source: "remotive",
  scraped_at: base.metadata.scraped_at,
  jobs: [job],
});

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
}

const ok = bulkImportSchema.safeParse(payload(base));
check("payload lengkap & valid → lolos", ok.success);

const noLogo = structuredClone(base);
(noLogo.company as Record<string, unknown>).logo_url = "";
check(
  "logo_url kosong → tertolak",
  !bulkImportSchema.safeParse(payload(noLogo)).success
);

const badEmail = structuredClone(base);
(badEmail.contact as Record<string, unknown>).hr_email = "bukan-email";
check(
  "hr_email invalid → tertolak",
  !bulkImportSchema.safeParse(payload(badEmail)).success
);

const noDesc = structuredClone(base);
(noDesc.job as Record<string, unknown>).description = "";
check(
  "description kosong → tertolak",
  !bulkImportSchema.safeParse(payload(noDesc)).success
);

const noSalary = structuredClone(base);
(noSalary.job as Record<string, unknown>).salary = null;
check("salary null → tetap lolos (opsional)", bulkImportSchema.safeParse(payload(noSalary)).success);

console.log(`\n${pass} lolos, ${fail} gagal`);
process.exit(fail === 0 ? 0 : 1);
