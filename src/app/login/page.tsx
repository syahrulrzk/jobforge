"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User, Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || j.error) {
        toast.error(j.error ?? "Login gagal");
        return;
      }
      const next = params.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch {
      toast.error("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username" className="text-xs text-muted-foreground">Username</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="pl-9"
            autoComplete="username"
            autoFocus
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-xs text-muted-foreground">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-9"
            autoComplete="current-password"
            required
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={loading}
        className="w-full bg-amber-500 text-zinc-950 hover:bg-amber-400"
      >
        {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {loading ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/60 p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15">
            <Lock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">JobForge Dashboard</h1>
          <p className="text-center text-xs text-muted-foreground">
            Masuk untuk mengakses pipeline & delivery portal
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
