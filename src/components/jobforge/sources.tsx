"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Cpu, MoreHorizontal, Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { EmptyState, StatusBadge, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";
import { ENGINES, ENGINE_KEYS, parseEngineList, type EngineKey } from "@/lib/jobforge/engines";

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  type: string;
  status: string;
  scraperType: string;
  engine: string;
  engines: string;
  schedule: string;
  lastRunAt: string | null;
  jobCount: number;
  runCount: number;
  lastRun: { status: string; jobsFound: number; jobsCreated: number; jobsRejected: number; engine: string | null; startedAt: string } | null;
}

interface SourcesResponse {
  sources: SourceRow[];
}

const SCHEDULE_LABELS: Record<string, string> = {
  hourly: "Setiap 1 jam",
  every_6_hours: "Setiap 6 jam",
  every_12_hours: "Setiap 12 jam",
  daily: "Setiap 24 jam",
  manual: "Manual",
};

const EMPTY_FORM = {
  name: "",
  baseUrl: "",
  types: ["JOB_PORTAL"],
  scraperTypes: ["STATIC"],
  schedule: "every_6_hours",
  engines: ["cheerio"] as EngineKey[],
};

const TYPE_OPTIONS = [
  { value: "JOB_PORTAL", label: "Job Portal" },
  { value: "CAREER_SITE", label: "Career Site" },
  { value: "PUBLIC_SOURCE", label: "Public Source" },
];

const SCRAPER_OPTIONS = [
  { value: "STATIC", label: "STATIC (HTTP + DOM)" },
  { value: "DYNAMIC", label: "DYNAMIC (SPA render)" },
  { value: "API", label: "API" },
];

function EngineBadge({ engine, className = "" }: { engine: string | null | undefined; className?: string }) {
  const meta = engine ? ENGINES[engine as EngineKey] : null;
  if (!meta) return <span className="text-[11px] text-zinc-600">—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badge} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.name}
    </span>
  );
}

/** Chip toggle multi-select — dipakai untuk Tipe, Scraper, dan Engine di dialog source. */
function ChipToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

export function SourcesView({ live }: { live: boolean }) {
  const { data, reload } = useApi<SourcesResponse>("/api/sources", { intervalMs: live ? 6000 : null });
  const { data: settingsData, reload: reloadSettings } = useApi<{ settings: { enginePool: string } }>("/api/settings");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SourceRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [poolBusy, setPoolBusy] = useState(false);

  const activePool = useMemo(() => {
    const raw = settingsData?.settings.enginePool ?? "cheerio,crawlee,puppeteer,playwright,selenium";
    return raw.split(",").map((k) => k.trim()) as EngineKey[];
  }, [settingsData]);

  const toggleEngine = async (key: EngineKey) => {
    setPoolBusy(true);
    try {
      const next = activePool.includes(key) ? activePool.filter((k) => k !== key) : [...activePool, key];
      if (next.length === 0) {
        toast.error("Minimal satu engine harus aktif");
        return;
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enginePool: next.join(",") }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${ENGINES[key].name} ${next.includes(key) ? "diaktifkan" : "dinonaktifkan"} — run berikutnya memakai pool baru`);
      void reloadSettings();
    } catch {
      toast.error("Gagal mengubah engine pool");
    } finally {
      setPoolBusy(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const openEdit = (s: SourceRow) => {
    setEditing(s);
    setForm({
      name: s.name,
      baseUrl: s.baseUrl,
      types: (s.type || "JOB_PORTAL").split(",").map((x) => x.trim()).filter(Boolean),
      scraperTypes: (s.scraperType || "STATIC").split(",").map((x) => x.trim()).filter(Boolean),
      schedule: s.schedule,
      engines: parseEngineList(s.engines || s.engine, s.engine),
    });
    setDialogOpen(true);
  };

  const toggleFormValue = (list: string[], value: string): string[] =>
    list.includes(value) ? (list.length > 1 ? list.filter((v) => v !== value) : list) : [...list, value];

  const toggleFormEngine = (key: EngineKey) => {
    setForm((f) => ({
      ...f,
      // urutan klik = urutan prioritas failover (append di ekor)
      engines: f.engines.includes(key) ? (f.engines.length > 1 ? f.engines.filter((e) => e !== key) : f.engines) : [...f.engines, key],
    }));
  };

  const save = async () => {
    try {
      const res = await fetch(editing ? `/api/sources/${editing.id}` : "/api/sources", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          type: form.types,
          scraperType: form.scraperTypes,
          schedule: form.schedule,
          engines: form.engines,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal menyimpan");
      toast.success(editing ? "Source diperbarui" : "Source baru ditambahkan");
      setDialogOpen(false);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan source");
    }
  };

  const toggle = async (s: SourceRow) => {
    setBusyId(s.id);
    try {
      const next = s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await fetch(`/api/sources/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      toast.success(`${s.name} ${next === "ACTIVE" ? "diaktifkan" : "dinonaktifkan"}`);
      void reload();
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (s: SourceRow) => {
    setBusyId(s.id);
    toast.info(`Menjalankan scraper ${s.name}…`);
    try {
      const res = await fetch(`/api/sources/${s.id}/run`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Run gagal");
      toast.success(`Scrape run ${s.name} selesai — job masuk pipeline`);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run gagal");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (s: SourceRow) => {
    setBusyId(s.id);
    try {
      await fetch(`/api/sources/${s.id}`, { method: "DELETE" });
      toast.success(`${s.name} dihapus`);
      void reload();
    } finally {
      setBusyId(null);
    }
  };

  const sorted = useMemo(() => data?.sources ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Source adapter dapat ditambah tanpa mengubah core pipeline (PRD §9)
        </p>
        <Button size="sm" className="h-8 bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" /> Add Source
        </Button>
      </div>

      {/* §9.2 Engine Pool — pilih 1, 2, atau semua engine */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Engine Pool</h3>
            <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-300">
              {activePool.length}/{ENGINE_KEYS.length} aktif
            </span>
          </div>
          <p className="hidden text-[11px] text-zinc-600 sm:block">
            Engine Pool global membatasi engine yang boleh jalan — tiap source bisa pin beberapa engine + urutan prioritasnya sendiri (Edit source)
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {ENGINE_KEYS.map((key) => {
            const meta = ENGINES[key];
            const active = activePool.includes(key);
            return (
              <div
                key={key}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${active ? "border-zinc-700 bg-zinc-900/80" : "border-zinc-800/60 bg-zinc-900/30 opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} ${active ? "animate-pulse" : "opacity-40"}`} />
                      <p className="truncate text-[13px] font-semibold text-zinc-100">{meta.name}</p>
                      <span className="rounded bg-zinc-800 px-1 text-[9px] font-medium uppercase tracking-wide text-zinc-400">{meta.kind}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500">{meta.tech}</p>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-zinc-600">{meta.description}</p>
                    <p className="mt-1 font-mono text-[9px] tabular-nums text-zinc-600">~{meta.memoryMb} MB · {meta.latencyMs[0]}–{meta.latencyMs[1]} ms</p>
                  </div>
                  <Switch
                    checked={active}
                    disabled={poolBusy}
                    onCheckedChange={() => void toggleEngine(key)}
                    className="data-[state=checked]:bg-amber-500"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="max-h-[64vh] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-zinc-900">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Source</TableHead>
                <TableHead className="text-zinc-400">Engine</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Schedule</TableHead>
                <TableHead className="hidden text-zinc-400 md:table-cell">Last Run</TableHead>
                <TableHead className="text-right text-zinc-400">Jobs</TableHead>
                <TableHead className="hidden text-right text-zinc-400 lg:table-cell">Found</TableHead>
                <TableHead className="hidden text-right text-zinc-400 lg:table-cell">Rejected</TableHead>
                <TableHead className="w-10 text-right text-zinc-400">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800/60">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-zinc-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sorted.length === 0 ? (
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableCell colSpan={9}><EmptyState title="Belum ada source" hint="Tambahkan source pertama Anda" /></TableCell>
                </TableRow>
              ) : (
                sorted.map((s) => (
                  <TableRow key={s.id} className="border-zinc-800/60 hover:bg-zinc-800/30">
                    <TableCell>
                      <p className="font-medium text-zinc-100">{s.name}</p>
                      <p className="text-[11px] text-zinc-500">{s.baseUrl.replace(/^https?:\/\//, "")} · {s.scraperType.split(",").map((x) => x.trim()).join(" · ")}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[190px] flex-wrap gap-1">
                        {parseEngineList(s.engines || s.engine, s.engine).map((e) => (
                          <EngineBadge key={e} engine={e} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="hidden text-sm text-zinc-400 md:table-cell">{SCHEDULE_LABELS[s.schedule] ?? s.schedule}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {s.lastRun ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={s.lastRun.status} />
                            {s.lastRun.engine && <EngineBadge engine={s.lastRun.engine} />}
                          </div>
                          <p className="mt-0.5 text-[11px] text-zinc-500">{timeAgo(s.lastRun.startedAt)} · {s.lastRun.jobsFound} found</p>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600">belum pernah</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-zinc-200">{s.jobCount.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-zinc-400 lg:table-cell">{s.lastRun?.jobsFound ?? "—"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-zinc-400 lg:table-cell">{s.lastRun?.jobsRejected ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Switch
                          checked={s.status === "ACTIVE"}
                          disabled={busyId === s.id}
                          onCheckedChange={() => void toggle(s)}
                          className="data-[state=checked]:bg-emerald-500"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                          disabled={busyId === s.id}
                          onClick={() => void runNow(s)}
                          title="Run manual"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="border-zinc-800 bg-zinc-900">
                            <DropdownMenuItem onClick={() => openEdit(s)}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit source</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void toggle(s)}><Power className="mr-2 h-3.5 w-3.5" /> {s.status === "ACTIVE" ? "Disable" : "Enable"}</DropdownMenuItem>
                            <DropdownMenuItem className="text-rose-400 focus:text-rose-300" onClick={() => void remove(s)}>
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Hapus
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">{editing ? `Edit ${editing.name}` : "Tambah Source Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Nama Source</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. LinkedIn Jobs" className="border-zinc-800 bg-zinc-900" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Base URL</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://example.com/jobs" className="border-zinc-800 bg-zinc-900" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Tipe — bisa pilih lebih dari satu</Label>
              <div className="flex flex-wrap gap-1.5">
                {TYPE_OPTIONS.map((o) => (
                  <ChipToggle
                    key={o.value}
                    active={form.types.includes(o.value)}
                    onClick={() => setForm((f) => ({ ...f, types: toggleFormValue(f.types, o.value) }))}
                  >
                    {o.label}
                  </ChipToggle>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Tipe Scraper — bisa pilih lebih dari satu</Label>
              <div className="flex flex-wrap gap-1.5">
                {SCRAPER_OPTIONS.map((o) => (
                  <ChipToggle
                    key={o.value}
                    active={form.scraperTypes.includes(o.value)}
                    onClick={() => setForm((f) => ({ ...f, scraperTypes: toggleFormValue(f.scraperTypes, o.value) }))}
                  >
                    {o.label}
                  </ChipToggle>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">Scraper Engine — bisa lebih dari satu</Label>
                <button
                  type="button"
                  className="text-[11px] font-medium text-amber-400 hover:text-amber-300"
                  onClick={() => setForm((f) => ({ ...f, engines: [...ENGINE_KEYS] }))}
                >
                  Pilih semua engine
                </button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ENGINE_KEYS.map((k) => {
                  const idx = form.engines.indexOf(k);
                  const active = idx >= 0;
                  const meta = ENGINES[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleFormEngine(k)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        active ? "border-amber-500/60 bg-amber-500/10" : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot} ${active ? "" : "opacity-40"}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[12px] font-semibold ${active ? "text-amber-300" : "text-zinc-300"}`}>{meta.name}</span>
                        <span className="block truncate font-mono text-[9px] text-zinc-600">{meta.tech}</span>
                      </span>
                      {active && (
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-zinc-950">
                          {idx + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-600">
                Nomor = urutan prioritas: run dicoba ke engine 1 → 2 → dst., engine pertama yang sukses dipakai (riwayat failover terlihat di Runs). Engine tetap dibatasi Engine Pool global.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Schedule</Label>
              <Select value={form.schedule} onValueChange={(v) => setForm({ ...form, schedule: v })}>
                <SelectTrigger className="border-zinc-800 bg-zinc-900"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-900">
                  {Object.entries(SCHEDULE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-800 bg-zinc-900" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={() => void save()} disabled={!form.name || !form.baseUrl}>
              {editing ? "Simpan" : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
