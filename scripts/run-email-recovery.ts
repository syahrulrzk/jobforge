// ─────────────────────────────────────────────────────────────
// JobForge — Email recovery worker for NEEDS_ENRICHMENT jobs
//
//   DATABASE_URL=... bun scripts/run-email-recovery.ts [slug] [limit]
//
// Same §12 enrichment path as the engine's recovery loop
// (engine.ts processNeedyRealJob): scan the REAL posting page for a
// published email — mailto: first, then recruitment-prefixed
// (hr@/careers@/…), then any company address visible in the page
// (blacklisted: linkedin.com/noreply/sentry dkk. — never guessed, §12.4).
//
// Scopes to one source slug (default: linkedin). One attempt per job
// per process — jobs stay NEEDS_ENRICHMENT when nothing is published;
// they are never deleted (enrichment rule).
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const GENERIC_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_BLACKLIST =
  /noreply|no-reply|linkedin\.com|licdn\.com|sentry|example\.(com|org)|\.png|\.jpg|\.webp|privacy|abuse|dmarc|postmaster/i;

async function main() {
  const slug = process.argv[2]?.trim() || "linkedin";
  const limit = Math.max(1, Math.min(60, parseInt(process.argv[3] ?? "20", 10) || 20));

  const source = await db.source.findUnique({ where: { slug } });
  if (!source) {
    console.error(`source "${slug}" tidak ada di DB`);
    process.exit(1);
  }

  const needy = await db.job.findMany({
    where: { status: "NEEDS_ENRICHMENT", companyName: { not: null }, contact: null, jobLinks: { some: { sourceId: source.id } } },
    take: limit,
    orderBy: { scrapedAt: "desc" },
    include: { jobLinks: true },
  });
  console.log(`recovery email scan untuk ${needy.length} job "${source.name}" (NEEDS_ENRICHMENT, tanpa contact)\n`);

  const { discoverMailto, extractPublishedEmail } = await import("../src/lib/jobforge/engine");
  const { validateEmail, validateJob } = await import("../src/lib/jobforge/pipeline");
  const { findCompanyHrEmail } = await import("../src/lib/jobforge/company-email");

  let scanned = 0;
  let pageFail = 0;
  let found = 0;
  let invalidSkipped = 0;
  let promoted = 0;
  const discovered: { title: string; company: string; email: string; via: string }[] = [];

  async function scanOne(job: (typeof needy)[number]) {
    const pageUrl = job.jobLinks[0]?.sourceUrl;
    if (!pageUrl) return;
    scanned += 1;

    // 1) standard engine path: fetch page + mailto / recruitment-prefix patterns
    let email: string | null = null;
    let foundVia = "posting-page";
    let emailSourceUrl = pageUrl;
    try {
      email = await discoverMailto(pageUrl);
    } catch {
      email = null;
    }

    // 2) deeper pass on the same HTML — generic published address with blacklist
    if (!email) {
      try {
        const res = await fetch(pageUrl, {
          signal: AbortSignal.timeout(8_000),
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", Accept: "text/html" },
          cache: "no-store",
        });
        if (res.ok) {
          const html = (await res.text()).slice(0, 400_000);
          const decoded = html.replace(/&#x2F;|&#47;/g, "/").replace(/&amp;/g, "&").replace(/&#64;|@/g, "@");
          for (const m of decoded.match(GENERIC_EMAIL_RE) ?? []) {
            const cand = m.trim().toLowerCase();
            if (!EMAIL_BLACKLIST.test(cand)) {
              email = cand;
              break;
            }
          }
          if (!email) email = extractPublishedEmail(decoded); // belated recruitment-prefix pass
        } else {
          pageFail += 1;
        }
      } catch {
        pageFail += 1;
      }
    }

    if (!email) {
      // tier terakhir — sama dengan engine recovery loop: chain situs perusahaan
      // (homepage/karir/kontak, Clearbit domain, browser fallback untuk situs
      // yang diblokir). Hanya email ter-publish — tanpa tebakan (§12.4).
      const chain = await findCompanyHrEmail(job.companyName ?? "", null);
      if (chain) {
        email = chain.email;
        foundVia = `company-site:${chain.tier}/${chain.via}`;
        emailSourceUrl = chain.sourceUrl;
      }
    }
    if (!email) return;
    const v = validateEmail(email);
    if (v.status === "INVALID") {
      invalidSkipped += 1;
      return;
    }
    found += 1;
    discovered.push({ title: job.title.slice(0, 40), company: job.companyName ?? "?", email, via: foundVia });

    await db.jobContact.create({
      data: { jobId: job.id, hrEmail: email, emailSourceUrl, emailVerified: v.verified, emailStatus: v.status },
    });
    // §17 re-validate (report only) — the engine's validation stage makes
    // the real READY call with the company profile from the DB
    const res = validateJob({
      companyName: job.companyName,
      companyLogoUrl: job.companyLogoUrl,
      companyProfile: null,
      title: job.title,
      description: job.description,
      hrEmail: email,
      emailStatus: v.status,
      sourcePlatform: "linkedin",
      sourceUrl: pageUrl,
    });
    // engine semantics: contact saved → re-enter VALIDATING; the engine's
    // validation stage makes the READY call with the real company profile
    await db.job.update({ where: { id: job.id }, data: { status: "VALIDATING", statusReason: null } });
    if (res.outcome === "READY") promoted += 1;
  }

  // worker pool 4 — gentle on the boards
  for (let i = 0; i < needy.length; i += 4) {
    await Promise.all(needy.slice(i, i + 4).map(scanOne));
  }

  console.log("== Recovery report ==");
  console.log({ scanned, pageFail, found, invalidSkipped, promotedToReady: promoted });
  const hitRate = scanned > 0 ? ((found / scanned) * 100).toFixed(1) : "0.0";
  console.log(`hit rate: ${found}/${scanned} = ${hitRate}% (page gagal di-fetch: ${pageFail})`);
  if (discovered.length > 0) {
    console.log("\nEmail ditemukan:");
    for (const d of discovered) console.log(`  ✓ ${d.email.padEnd(36)} [${d.via}] — ${d.title} @ ${d.company}`);
  } else {
    console.log("Tidak ada email yang dipublikasikan di halaman yang discan — job tetap NEEDS_ENRICHMENT (tidak pernah dihapus, dicoba lagi nanti).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
