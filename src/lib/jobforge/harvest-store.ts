// ─────────────────────────────────────────────────────────────
// JOBFORCE — Harvest Store (gudang data email)
//
// Persistensi hasil harvest (upsert Company + HarvestedContact) dan
// lookup email tersimpan per domain. Dipakai bersama oleh:
//   - /api/search/domain  (Domain Search ala hunter.io)
//   - /api/search/email   (mode HR — auto-save kandidat)
//
// HANYA email yang benar-benar ter-publish yang disimpan (§12.4) —
// tidak ada konstruksi name@domain.
// ─────────────────────────────────────────────────────────────
import { db } from "@/lib/db";

export interface HarvestedEmailInput {
  email: string;
  kind: string;
  category: string | null;
  sourceUrl: string;
  via: string;
  sources: string[];
}

export interface HarvestSaveResult {
  saved: number;
  created: number;
  duplicate: number;
  companyId: string | null;
  companyName: string | null;
}

/**
 * Simpan hasil harvest ke DB: upsert Company (by domain) + email unik ke
 * HarvestedContact. Return jumlah baru/duplikat.
 */
export async function saveHarvestToDb(
  emails: HarvestedEmailInput[],
  domain: string,
  companyName: string,
): Promise<HarvestSaveResult> {
  if (emails.length === 0) {
    return { saved: 0, created: 0, duplicate: 0, companyId: null, companyName: null };
  }

  // Company: cari by domain/nama → kalau belum ada, buat baru (harvest = sumber web publik)
  const domainBase = domain.split(".")[0];
  let company =
    (domain
      ? await db.company.findFirst({ where: { website: { contains: domainBase, mode: "insensitive" } } })
      : null) ??
    (companyName
      ? await db.company.findFirst({ where: { name: { contains: companyName.split(/\s+/)[0], mode: "insensitive" } } })
      : null);

  if (!company) {
    const displayName = companyName
      ? companyName.replace(/\b\w/g, (m) => m.toUpperCase())
      : domainBase.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    const normalizedName = (companyName || domainBase).toLowerCase().replace(/\s+/g, "-");
    company = await db.company
      .create({
        data: {
          name: displayName,
          normalizedName,
          website: domain ? `https://${domain}` : null,
          logoUrl: (await import("@/lib/jobforge/logo")).googleFaviconUrl(domain, 128),
          profile: `Perusahaan ditambahkan otomatis dari harvest email domain ${domain}`,
        },
      })
      .catch(() => null);
  }

  let created = 0;
  let duplicate = 0;
  for (const e of emails) {
    const r = await db.harvestedContact
      .upsert({
        where: { email: e.email },
        create: {
          email: e.email,
          companyId: company?.id ?? null,
          domain,
          kind: e.kind,
          category: e.category,
          via: e.via,
          sourceUrl: e.sourceUrl,
          sourcesJson: JSON.stringify(e.sources ?? []),
        },
        update: {
          // refresh sumber/kategori bila harvest ulang menemukan info baru
          category: e.category ?? undefined,
          sourceUrl: e.sourceUrl ?? undefined,
          sourcesJson: JSON.stringify(e.sources ?? []),
          ...(company ? { companyId: company.id } : {}),
        },
      })
      .catch(() => null);
    if (r) created += 1;
    else duplicate += 1;
  }

  return { saved: emails.length, created, duplicate, companyId: company?.id ?? null, companyName: company?.name ?? null };
}

/** Normalisasi domain: buang protokol/www/trailing slash. */
export function bareDomain(input: string): string {
  return input
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

export interface StoredHarvestEmail {
  email: string;
  kind: string;
  category: string | null;
  via: string;
  domain: string;
  sourceUrl: string | null;
  sources: string[];
  companyName: string | null;
  companyWebsite: string | null;
  createdAt: Date;
}

/** Email harvest yang sudah tersimpan di gudang untuk satu domain (exact + subdomain). */
export async function storedEmailsForDomain(domain: string, take = 100): Promise<StoredHarvestEmail[]> {
  if (!domain) return [];
  const rows = await db.harvestedContact.findMany({
    where: { OR: [{ domain: { equals: domain, mode: "insensitive" } }, { domain: { endsWith: `.${domain}`, mode: "insensitive" } }] },
    orderBy: { createdAt: "desc" },
    take,
    include: { company: { select: { name: true, website: true } } },
  });
  return rows.map((h) => {
    let sources: string[] = [];
    try {
      const parsed = JSON.parse(h.sourcesJson) as unknown;
      if (Array.isArray(parsed)) sources = parsed.filter((s): s is string => typeof s === "string");
    } catch {
      /* sourcesJson korup — biarkan kosong */
    }
    return {
      email: h.email,
      kind: h.kind,
      category: h.category,
      via: h.via,
      domain: h.domain,
      sourceUrl: h.sourceUrl,
      sources,
      companyName: h.company?.name ?? null,
      companyWebsite: h.company?.website ?? null,
      createdAt: h.createdAt,
    };
  });
}

/** Stats gudang data — total email + total domain (hunter.io style warehouse). */
export async function warehouseStats(): Promise<{ totalEmails: number; totalDomains: number }> {
  const [totalEmails, byDomain] = await Promise.all([
    db.harvestedContact.count(),
    db.harvestedContact.groupBy({ by: ["domain"], _count: { domain: true } }),
  ]);
  return { totalEmails, totalDomains: byDomain.length };
}
