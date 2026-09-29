import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/jobforge/bootstrap";
import { bareDomain, saveHarvestToDb, storedEmailsForDomain, warehouseStats } from "@/lib/jobforge/harvest-store";
import { harvestDomainEmails } from "@/lib/jobforge/domain-email-harvest";
import { parseSearchEngine } from "@/lib/jobforge/email-finder";
import { resolveDomainFromName } from "@/lib/jobforge/logo";

export const dynamic = "force-dynamic";
// harvest (deep crawl + search + BBOT opsional) bisa lama — beri ruang
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────
// Domain Search — ala hunter.io (Tools · Cari Email)
//
// API khusus "search by domain" — TIDAK menyentuh Job/JobContact.
// Email yang ditemukan langsung masuk gudang data (HarvestedContact)
// dan terhubung ke Company — bukan ke job.
//
// GET /api/search/domain?domain=tokopedia.com
//   → semua email yang sudah tersimpan di gudang untuk domain itu
//     (+ stats gudang). Instan, tanpa scraping.
//
// POST /api/search/domain { domain }
//   → live harvest ala hunter.io: deep crawl situs (max 25 halaman)
//     + search @domain + BBOT — SEMUA tool otomatis, tanpa opsi.
//     Jalur langsung dulu; kalau kosong (diblokir anti-bot) sekali
//     retry via pool proxy gratis. Auto-save ke gudang.
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  await ensureBootstrap();
  const sp = req.nextUrl.searchParams;
  const domain = bareDomain(sp.get("domain") ?? "");
  if (domain.length < 3 || !domain.includes(".")) {
    return NextResponse.json({ error: "Masukkan domain yang valid — mis. tokopedia.com" }, { status: 422 });
  }

  const [emails, warehouse] = await Promise.all([storedEmailsForDomain(domain, 100), warehouseStats()]);

  return NextResponse.json({
    query: { domain },
    total: emails.length,
    warehouse,
    emails,
  });
}

export async function POST(req: NextRequest) {
  await ensureBootstrap();
  let body: { domain?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  // input boleh domain penuh atau nama perusahaan (di-resolve via Clearbit)
  const raw = body.domain?.trim() ?? "";
  if (raw.length < 3) {
    return NextResponse.json({ error: "Isi domain perusahaan dulu — mis. tokopedia.com" }, { status: 422 });
  }

  const started = Date.now();
  const looksLikeDomain = raw.includes(".") && !raw.includes(" ");
  const domain = looksLikeDomain ? bareDomain(raw) : ((await resolveDomainFromName(raw)) ?? "");

  if (!domain || !domain.includes(".")) {
    return NextResponse.json(
      { error: `Tidak bisa me-resolve "${raw}" jadi domain perusahaan — coba masukkan domain langsung` },
      { status: 422 },
    );
  }

  // ── Fully otomatis — ala hunter.io, tanpa knob operator: ──
  // 1. Semua engine + BBOT selalu ON (engine "auto" sudah chain
  //    DuckDuckGo → Bing → CSE bila env ada).
  // 2. Jalur langsung dulu (paling cepat). Kalau hasilnya KOSONG —
  //    kemungkinan IP server keblokir anti-bot — sekali retry via pool
  //    proxy gratis tervalidasi. Pool mati pun fallback aman ke direct.
  const searchEngine = parseSearchEngine("auto");

  let harvest = await harvestDomainEmails(domain, `https://${domain}`, searchEngine, true, "direct", null);

  if (harvest.emails.length === 0) {
    const retry = await harvestDomainEmails(domain, `https://${domain}`, searchEngine, true, "auto", null);
    if (retry.emails.length > 0) {
      harvest = {
        ...retry,
        steps: [
          ...harvest.steps,
          { source: "PROXY", status: "success", durationMs: 0, note: "jalur langsung kosong (kemungkinan diblokir anti-bot) — retry via proxy gratis" },
        ],
        durationMs: harvest.durationMs + retry.durationMs,
        pagesCrawled: harvest.pagesCrawled + retry.pagesCrawled,
      };
    }
  }

  // ── AUTO-SAVE (gudang data): semua hasil langsung masuk DB ──
  const saveResult = harvest.emails.length > 0 ? await saveHarvestToDb(harvest.emails, harvest.domain, domain) : null;

  return NextResponse.json({
    domain: harvest.domain,
    emails: harvest.emails.map((e) => ({ ...e, saved: true })),
    pagesCrawled: harvest.pagesCrawled,
    steps: harvest.steps,
    durationMs: harvest.durationMs,
    autoSaved: saveResult
      ? { created: saveResult.created, duplicate: saveResult.duplicate, companyName: saveResult.companyName }
      : null,
    totalMs: Date.now() - started,
  });
}
