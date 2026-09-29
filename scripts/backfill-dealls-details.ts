// ─────────────────────────────────────────────────────────────
// Backfill job Dealls lama: deskripsi pendek/berantakan + skills
// sedikit → diisi ulang dari detail page Dealls (dehydratedState):
//   Deskripsi / Tanggung Jawab / Kualifikasi + skills lengkap.
// Hanya job yang ter-link source dealls yang disentuh.
// Jalankan: npx tsx scripts/backfill-dealls-details.ts
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_DESCRIPTION = 4_000;

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

function extractDetail(html: string): { description: string | null; skills: string[] } | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { job?: Record<string, unknown>; dehydratedState?: { queries?: { state?: { data?: unknown } }[] } } };
    };
    const pp = data.props?.pageProps;
    let job: Record<string, unknown> | undefined = pp?.job;
    if (!job) {
      const q0 = pp?.dehydratedState?.queries?.[0]?.state?.data;
      if (q0 && typeof q0 === "object") job = (q0 as Record<string, unknown>).job as Record<string, unknown> ?? (q0 as Record<string, unknown>);
    }
    if (!job || typeof job !== "object") return null;
    const parts: string[] = [];
    const push = (label: string, h: unknown) => {
      const text = typeof h === "string" ? stripHtml(h) : "";
      if (text.length >= 30) parts.push(`${label}:\n${text}`);
    };
    push("Deskripsi", job.description);
    push("Tanggung Jawab", job.responsibilities);
    push("Kualifikasi", job.requirements);
    const skills: string[] = [];
    const pref = job.candidatePreference as Record<string, unknown> | undefined;
    const skillsRaw = (pref?.skills ?? job.skills) as unknown;
    if (Array.isArray(skillsRaw)) {
      for (const s of skillsRaw) {
        if (s && typeof s === "object") {
          const n = String((s as Record<string, unknown>).name ?? "").trim();
          if (n) skills.push(n);
        } else if (typeof s === "string" && s.trim()) skills.push(s.trim());
      }
    }
    return { description: parts.length > 0 ? parts.join("\n\n").slice(0, MAX_DESCRIPTION) : null, skills: skills.slice(0, 12) };
  } catch {
    return null;
  }
}

async function fetchDetail(url: string): Promise<{ description: string | null; skills: string[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
      if (res.ok) {
        const detail = extractDetail(await res.text());
        if (detail?.description) return detail;
      }
    } catch {
      // retry / skip
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

async function main() {
  const dealls = await db.source.findUnique({ where: { slug: "dealls" }, select: { id: true } });
  if (!dealls) {
    console.log("Source dealls tidak ada — selesai.");
    return;
  }
  const links = await db.jobSource.findMany({
    where: { sourceId: dealls.id, job: { status: { in: ["SCRAPED", "PROCESSING", "ENRICHING", "VALIDATING", "READY", "SENT", "PUBLISHED", "NEEDS_ENRICHMENT"] } } },
    select: { jobId: true, sourceUrl: true },
  });
  // target: deskripsi pendek (< 220 char — hasil lama cuma ringkasan) ATAU skills < 3
  const jobs = await db.job.findMany({
    where: { id: { in: links.map((l) => l.jobId) } },
    select: { id: true, description: true, skills: true },
  });
  const urlByJob = new Map(links.map((l) => [l.jobId, l.sourceUrl]));
  const targets = jobs.filter((j) => (j.description?.length ?? 0) < 220 || JSON.parse(j.skills ?? "[]").length < 3);
  console.log(`Job Dealls: ${jobs.length} — perlu backfill: ${targets.length}`);

  let updated = 0;
  let failed = 0;
  const CONCURRENCY = 3;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (job) => {
        const url = urlByJob.get(job.id);
        if (!url) return;
        const detail = await fetchDetail(url);
        if (!detail?.description) {
          failed += 1;
          return;
        }
        // pertahankan blok Salary bila ada di deskripsi lama
        const salaryBlock = job.description?.match(/\n\nSalary: [^\n]+/)?.[0] ?? "";
        const oldSkills: string[] = JSON.parse(job.skills ?? "[]");
        const newSkills = detail.skills.length > oldSkills.length ? detail.skills : oldSkills;
        await db.job.update({
          where: { id: job.id },
          data: {
            description: `${detail.description}${salaryBlock}`,
            skills: JSON.stringify(newSkills),
          },
        });
        updated += 1;
      }),
    );
    if (i + CONCURRENCY < targets.length) await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`Backfill selesai: ${updated} job diperkaya, ${failed} gagal di-fetch (detail page kosong/hilang)`);

  const stillShort = await db.job.count({ where: { id: { in: jobs.map((j) => j.id) }, description: { lt: "x" } } });
  void stillShort; // (skip — verifikasi manual di bawah)
  const sample = await db.job.findFirst({
    where: { id: { in: targets.map((t) => t.id) } },
    select: { title: true, description: true, skills: true },
  });
  if (sample) {
    console.log(`\nContoh hasil "${sample.title}":`);
    console.log("  deskripsi:", `${(sample.description ?? "").length} char`);
    console.log("  skills:", JSON.parse(sample.skills ?? "[]").join(", ").slice(0, 200));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
