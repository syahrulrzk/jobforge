"use client";

// Keamanan dashboard (§37) — ganti password user dashboard.
// Password disimpan sbg SHA-256 hex di tabel Setting (DASHBOARD_PASSWORD).

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";

export function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!current || !next) {
      toast.error("Isi password lama dan baru");
      return;
    }
    if (next !== confirm) {
      toast.error("Konfirmasi password tidak sama");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || j.error) {
        toast.error(j.error ?? "Gagal mengganti password");
        return;
      }
      toast.success("Password diganti — berlaku untuk login berikutnya");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      toast.error("Gagal menghubungi server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-sm font-semibold text-foreground">Keamanan Dashboard</h3>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Password saat ini</Label>
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="border-border bg-card"
            autoComplete="current-password"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password baru (min. 8 karakter)</Label>
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="border-border bg-card"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ulangi password baru</Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="border-border bg-card"
              autoComplete="new-password"
            />
          </div>
        </div>
        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => void save()} disabled={saving}>
          {saving ? "Menyimpan…" : "Ganti password"}
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground/80">
          Sesi aktif tetap berlaku sampai habis masa berlakunya (12 jam). Keluar dan masuk kembali untuk memakai password baru.
        </p>
      </div>
    </section>
  );
}
