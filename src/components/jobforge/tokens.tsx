"use client";

// ─────────────────────────────────────────────────────────────
// API Tokens (§19b) — kelola token consumer untuk pull job via
// GET /api/v1/jobs/pull. Raw token hanya tampil SEKALI saat
// dibuat (pola GitHub PAT) — setelah itu cuma prefix.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState, StatusBadge, dateTime, timeAgo } from "./ui-bits";
import { useApi } from "@/hooks/use-api";

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  status: string;
  lastUsedAt: string | null;
  pullCount: number;
  createdAt: string;
  revokedAt: string | null;
}

export function TokensView() {
  const { data, reload } = useApi<{ tokens: TokenRow[] }>("/api/tokens");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  // raw token hasil create — hanya dirender sekali di dialog
  const [created, setCreated] = useState<{ raw: string; name: string } | null>(null);
  // edit nama token
  const [editing, setEditing] = useState<TokenRow | null>(null);
  const [editName, setEditName] = useState("");
  // hapus permanen (soft revoke dulu → purge)
  const [purging, setPurging] = useState<TokenRow | null>(null);

  const create = async () => {
    if (name.trim().length < 2) {
      toast.error("Nama token minimal 2 karakter");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal membuat token");
      setCreated({ raw: json.raw, name: json.token.name });
      setName("");
      setCreating(false);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat token");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/tokens?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Token di-revoke");
      void reload();
    } else {
      toast.error("Gagal revoke token");
    }
  };

  const rename = async () => {
    if (!editing || editName.trim().length < 2) {
      toast.error("Nama token minimal 2 karakter");
      return;
    }
    const res = await fetch("/api/tokens", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, name: editName.trim() }),
    });
    if (res.ok) {
      toast.success("Nama token diperbarui");
      setEditing(null);
      void reload();
    } else {
      const json = await res.json().catch(() => null);
      toast.error(json?.error ?? "Gagal mengubah nama token");
    }
  };

  const purge = async () => {
    if (!purging) return;
    const res = await fetch(`/api/tokens?id=${purging.id}&purge=1`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`Token "${purging.name}" dan riwayatnya dihapus permanen`);
      setPurging(null);
      void reload();
    } else {
      toast.error("Gagal menghapus token");
    }
  };

  const copyRaw = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.raw);
      toast.success("Token dikopi ke clipboard");
    } catch {
      toast.error("Gagal mengopi — salin manual dari kolom");
    }
  };

  const activeCount = data?.tokens.filter((t) => t.status === "ACTIVE").length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header aksi */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setCreating(true)} className="h-8 gap-1.5 bg-amber-500 text-amber-950 hover:bg-amber-400">
          <Plus className="h-3.5 w-3.5" /> Buat Token
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {activeCount} token aktif · total {data?.tokens.length ?? 0}
        </span>
      </div>

      {/* Tabel token */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Nama</TableHead>
                <TableHead className="text-muted-foreground">Token</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">Job Ditarik</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Terakhir Dipakai</TableHead>
                <TableHead className="hidden text-right text-muted-foreground lg:table-cell">Dibuat</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="border-border/60">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 w-full animate-pulse rounded bg-accent" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.tokens.length === 0 ? (
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState
                      title="Belum ada API token"
                      hint="Buat token untuk memberi akses consumer menarik job via GET /api/v1/jobs/pull"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                data.tokens.map((t) => (
                  <TableRow key={t.id} className="border-border/60 hover:bg-accent/30">
                    <TableCell className="max-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                        <button
                          className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                          title="Edit nama"
                          onClick={() => {
                            setEditing(t);
                            setEditName(t.name);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-card/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90">{t.tokenPrefix}…</code>
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground sm:table-cell">{t.pullCount}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{t.lastUsedAt ? timeAgo(t.lastUsedAt) : "—"}</TableCell>
                    <TableCell className="hidden text-right text-xs text-muted-foreground lg:table-cell">{dateTime(t.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        {t.status === "ACTIVE" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                            title="Revoke token"
                            onClick={() => void revoke(t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                            title="Hapus permanen beserta riwayat"
                            onClick={() => setPurging(t)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Dialog buat token */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="border-border bg-background dark:bg-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Buat API Token</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Token dipakai consumer sebagai header <code className="rounded bg-accent px-1 font-mono">Authorization: Bearer …</code> untuk
              endpoint <code className="rounded bg-accent px-1 font-mono">GET /api/v1/jobs/pull</code>.
            </p>
            <Input
              autoFocus
              placeholder='Nama token, mis. "Portal Produksi"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              className="h-8 border-border bg-card text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 border-border bg-card" onClick={() => setCreating(false)}>
                Batal
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void create()} className="h-8 bg-amber-500 text-amber-950 hover:bg-amber-400">
                {saving ? "Membuat…" : "Buat Token"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog edit nama */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="border-border bg-background dark:bg-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Nama Token</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Label internal saja — nilai token tidak berubah dan consumer tidak terpengaruh.
            </p>
            <Input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void rename()}
              className="h-8 border-border bg-card text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 border-border bg-card" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button size="sm" onClick={() => void rename()} className="h-8 bg-amber-500 text-amber-950 hover:bg-amber-400">
                Simpan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog hapus permanen */}
      <Dialog open={!!purging} onOpenChange={(open) => !open && setPurging(null)}>
        <DialogContent className="border-border bg-background dark:bg-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Hapus Token Permanen?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Token <span className="font-medium text-foreground">"{purging?.name}"</span> ({purging?.tokenPrefix}…) dan
              <span className="font-medium text-foreground"> seluruh riwayat pull-nya</span> akan dihapus permanen. Token
              sudah revoked jadi tidak bisa dipakai lagi — aksi ini hanya membersihkan data.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 border-border bg-card" onClick={() => setPurging(null)}>
                Batal
              </Button>
              <Button size="sm" variant="destructive" className="h-8" onClick={() => void purge()}>
                Hapus Permanen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog raw token — cuma sekali ini raw terlihat */}
      <Dialog open={!!created} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="border-border bg-background dark:bg-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Token &quot;{created?.name}&quot; dibuat
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Salin sekarang — raw token <span className="font-medium text-foreground">tidak akan ditampilkan lagi</span> (disimpan sebagai hash).
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs text-foreground">
                {created?.raw}
              </code>
              <Button size="icon" variant="outline" className="h-8 w-8 shrink-0 border-border bg-card" title="Kopi token" onClick={() => void copyRaw()}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-700 dark:text-amber-300">
              Simpan di tempat aman — hilang = buat token baru
            </Badge>
            <div className="flex justify-end">
              <Button size="sm" className="h-8 bg-amber-500 text-amber-950 hover:bg-amber-400" onClick={() => setCreated(null)}>
                Sudah Disimpan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
