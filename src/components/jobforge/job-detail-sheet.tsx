"use client";

// Shared job detail sheet (PRD §29) — dipakai oleh JobsView dan SearchView.
// Berisi fetch detail + tabs (Detail/Company/Canonical JSON/Delivery) + force-ready override.

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Mail, MapPin } from "lucide-react";
import { CompanyAvatar, EmptyState, StatusBadge, dateTime, formatIDR } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

export interface JobDetail {
  job: {
    id: string;
    title: string;
    description: string;
    status: string;
    statusReason: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string | null;
    location: string | null;
    employmentType: string | null;
    workplaceType: string | null;
    requirements: string[] | null;
    skills: string[] | null;
    fingerprint: string;
    scrapedAt: string;
    publishedAt: string | null;
    company: { id: string; name: string; logoUrl: string; website: string | null; profile: string; industry: string | null } | null;
    contact: { hrEmail: string; emailSourceUrl: string | null; emailVerified: boolean; emailStatus: string } | null;
    sources: { platform: string; slug: string; jobId: string; url: string }[];
    deliveries: { id: string; requestId: string; status: string; attempt: number; responseCode: number | null; createdAt: string }[];
  };
  canonical: Record<string, unknown> | null;
}

export function JobDetailSheet({ selectedId, onClose }: { selectedId: string | null; onClose: () => void }) {
  const { data: detailData } = useApi<JobDetail>(selectedId ? `/api/jobs/${selectedId}` : null);
  const detail = detailData?.job;

  const forceReady = async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/jobs/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_ready" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Override gagal");
      toast.success("Job dipaksa READY — delivery worker akan mengirim ke portal");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Override gagal");
    }
  };

  return (
    <Sheet open={!!selectedId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-zinc-800 bg-zinc-950 p-0 sm:max-w-xl" side="right">
        {detail ? (
          <div>
            <SheetHeader className="border-b border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-lg text-zinc-100">{detail.title}</SheetTitle>
                  <p className="mt-1 text-sm text-zinc-400">{detail.company?.name ?? "Perusahaan belum terpetakan"}</p>
                </div>
                <StatusBadge status={detail.status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {detail.location && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-300">
                    <MapPin className="h-3 w-3" /> {detail.location}
                  </span>
                )}
                {detail.employmentType && (
                  <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-300">{detail.employmentType.replace(/_/g, " ")}</span>
                )}
                {detail.workplaceType && (
                  <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-300">{detail.workplaceType}</span>
                )}
                <span className="rounded-md bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-300">{formatIDR(detail.salaryMin, detail.salaryMax, detail.currency)}</span>
              </div>
              {detail.statusReason && (
                <p className="mt-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-300/90">
                  {detail.statusReason}
                </p>
              )}
              {["NEEDS_ENRICHMENT", "VALIDATING", "ENRICHING", "PROCESSING"].includes(detail.status) && (
                <Button
                  size="sm"
                  className="mt-3 h-7 w-full bg-amber-500 text-[11px] text-zinc-950 hover:bg-amber-400"
                  onClick={() => void forceReady()}
                >
                  Override → READY (kirim manual ke portal)
                </Button>
              )}
            </SheetHeader>

            <div className="p-5">
              <Tabs defaultValue="detail">
                <TabsList className="bg-zinc-900">
                  <TabsTrigger value="detail" className="text-xs">Detail</TabsTrigger>
                  <TabsTrigger value="company" className="text-xs">Company</TabsTrigger>
                  <TabsTrigger value="canonical" className="text-xs">Canonical JSON</TabsTrigger>
                  <TabsTrigger value="delivery" className="text-xs">Delivery</TabsTrigger>
                </TabsList>

                <TabsContent value="detail" className="mt-4 space-y-4">
                  <section>
                    <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Deskripsi</h4>
                    <p className="text-sm whitespace-pre-wrap text-zinc-300">{detail.description}</p>
                  </section>
                  {detail.requirements && detail.requirements.length > 0 && (
                    <section>
                      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Requirements</h4>
                      <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
                        {detail.requirements.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </section>
                  )}
                  {detail.skills && detail.skills.length > 0 && (
                    <section>
                      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Skills</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.skills.map((s, i) => (
                          <Badge key={i} variant="outline" className="border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-300">{s}</Badge>
                        ))}
                      </div>
                    </section>
                  )}
                  <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">HR Email</span>
                      {detail.contact ? (
                        <a href={`mailto:${detail.contact.hrEmail}`} className="inline-flex items-center gap-1 text-teal-300 hover:underline">
                          <Mail className="h-3 w-3" /> {detail.contact.hrEmail}
                        </a>
                      ) : (
                        <span className="text-zinc-600 italic">belum ditemukan</span>
                      )}
                    </div>
                    {detail.contact?.emailSourceUrl && (
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Email Source</span>
                        <a href={detail.contact.emailSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-zinc-300 hover:underline">
                          {detail.contact.emailSourceUrl} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    )}
                    {detail.contact && (
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Email Validation</span>
                        <StatusBadge status={detail.contact.emailStatus} />
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Source Platform</span>
                      <span className="text-zinc-300">{detail.sources[0]?.platform ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="shrink-0 text-zinc-500">Original URL</span>
                      {detail.sources[0] ? (
                        <a href={detail.sources[0].url} target="_blank" rel="noreferrer" className="inline-flex max-w-[240px] items-center gap-1 truncate text-zinc-300 hover:underline">
                          {detail.sources[0].url} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Scraped At</span>
                      <span className="text-zinc-300">{dateTime(detail.scrapedAt)}</span>
                    </div>
                    {detail.publishedAt && (
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Published At</span>
                        <span className="text-zinc-300">{dateTime(detail.publishedAt)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-zinc-500">Fingerprint</span>
                      <code className="truncate rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{detail.fingerprint.slice(0, 24)}…</code>
                    </div>
                  </section>
                </TabsContent>

                <TabsContent value="company" className="mt-4 space-y-4">
                  {detail.company ? (
                    <>
                      <div className="flex items-center gap-3">
                        <CompanyAvatar name={detail.company.name} logoUrl={detail.company.logoUrl} website={detail.company.website} size={48} />
                        <div>
                          <p className="font-semibold text-zinc-100">{detail.company.name}</p>
                          {detail.company.website && (
                            <a href={detail.company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline">
                              {detail.company.website} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-300">{detail.company.profile}</p>
                      {detail.company.industry && <p className="text-xs text-zinc-500">Industri: {detail.company.industry}</p>}
                    </>
                  ) : (
                    <EmptyState title="Company belum ter-enrichment" hint="Job ini masih menunggu proses company enrichment" />
                  )}
                </TabsContent>

                <TabsContent value="canonical" className="mt-4">
                  <pre className="max-h-[50vh] overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                    {detailData?.canonical ? JSON.stringify(detailData.canonical, null, 2) : "// canonical payload tersedia setelah job READY"}
                  </pre>
                </TabsContent>

                <TabsContent value="delivery" className="mt-4 space-y-2">
                  {detail.deliveries.length === 0 ? (
                    <EmptyState title="Belum ada delivery" hint="Job akan dikirim ke Job Portal setelah berstatus READY" />
                  ) : (
                    detail.deliveries.map((d) => (
                      <div key={d.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
                        <StatusBadge status={d.status} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs text-zinc-300">{d.requestId}</p>
                          <p className="text-[11px] text-zinc-500">attempt {d.attempt} · {dateTime(d.createdAt)}</p>
                        </div>
                        {d.responseCode && <span className="font-mono text-xs text-zinc-400">HTTP {d.responseCode}</span>}
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-6">
            {/* a11y: Radix Dialog requires a Title even while detail is loading */}
            <SheetHeader className="sr-only">
              <SheetTitle>Detail Job</SheetTitle>
            </SheetHeader>
            <div className="h-6 w-2/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-40 animate-pulse rounded bg-zinc-800/60" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
