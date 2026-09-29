"use client";

// ─────────────────────────────────────────────────────────────
// Dokumentasi Integrasi (§19b) — halaman yang bisa dibagikan ke
// consumer: cara auth, alur lease/ack, referensi endpoint, dan
// contoh kode siap-copy.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, Check, Copy, KeyRound, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Kode dikopi");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Gagal mengopi");
    }
  };
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-zinc-950 dark:border-zinc-800">
      {title && (
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
          <span className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">{title}</span>
        </div>
      )}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => void copy()}
        className="absolute top-1.5 right-1.5 h-7 w-7 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100"
        title="Kopi"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre className="overflow-x-auto p-3.5 font-mono text-[11px] leading-relaxed text-zinc-100">{code}</pre>
    </div>
  );
}

function ParamTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-card">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Parameter</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipe</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Deskripsi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, type, desc]) => (
            <tr key={name} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2"><code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] text-foreground">{name}</code></td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{type}</td>
              <td className="px-3 py-2 text-foreground/90">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

const NAV = [
  { id: "mulai", label: "Memulai" },
  { id: "alur", label: "Alur Lease/Ack" },
  { id: "get-pull", label: "GET /jobs/pull" },
  { id: "post-ack", label: "POST ack/release" },
  { id: "recovery", label: "Recovery & Error" },
  { id: "contoh", label: "Contoh Lengkap" },
];

export function ApiDocsView() {
  return (
    <div className="flex h-full min-h-0 gap-6">
      {/* nav kiri */}
      <nav className="hidden w-48 shrink-0 flex-col gap-0.5 lg:flex">
        {NAV.map((n, i) => (
          <a
            key={n.id}
            href={`#${n.id}`}
            className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {i + 1}. {n.label}
          </a>
        ))}
      </nav>

      {/* konten */}
      <div className="min-w-0 flex-1 space-y-8 overflow-y-auto pb-6 pr-1">
        {/* hero */}
        <div className="rounded-xl border border-border bg-card/60 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-foreground">Jobforge Pull API</h2>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/5 text-[10px] text-emerald-700 dark:text-emerald-300">v1</Badge>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            API untuk menarik lowongan (job) dari Jobforge secara berkala. Autentikasi memakai Bearer token,
            data dikirim dalam format JSON dengan model <span className="font-medium text-foreground">lease/ack</span> —
            job yang diambil diunci sementara, lalu dikonfirmasi final setelah berhasil diproses.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-background/60 px-3 py-2.5">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Base URL</p>
              <code className="mt-0.5 block font-mono text-xs text-foreground">https://&lt;host&gt;/api/v1</code>
            </div>
            <div className="rounded-lg border border-border bg-background/60 px-3 py-2.5">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Format</p>
              <p className="mt-0.5 text-xs text-foreground">JSON · UTF-8 · Bearer auth</p>
            </div>
          </div>
        </div>

        <Section id="mulai" title="1 · Memulai">
          <ol className="list-inside list-decimal space-y-2 text-sm text-foreground/90">
            <li>
              Minta <span className="font-medium">API Token</span> ke admin Jobforge (dibuat di menu{" "}
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><KeyRound className="h-3 w-3" /> API &amp; Integrasi → Token</span>).
              Raw token <span className="font-medium">hanya tampil sekali</span> saat dibuat — simpan baik-baik.
            </li>
            <li>Panggil <code className="rounded bg-accent px-1 font-mono text-xs">GET /api/v1/jobs/pull</code> dengan header Bearer.</li>
            <li>Proses job yang diterima di sistem kamu.</li>
            <li>
              Konfirmasi final via <code className="rounded bg-accent px-1 font-mono text-xs">POST ack</code> — job yang di-ack
              tidak akan dikirim ulang. Yang gagal diproses bisa dilepas dengan <code className="rounded bg-accent px-1 font-mono text-xs">release</code>.
            </li>
          </ol>
          <CodeBlock
            title="Auth"
            code={`Authorization: Bearer jfk_xxxxxxxxxxxxxxxxxxxxxxxx`}
          />
        </Section>

        <Section id="alur" title="2 · Alur Lease/Ack">
          <p className="text-sm text-muted-foreground">
            Job tidak langsung final saat ditarik. GET memberi <span className="font-medium text-foreground">lease</span>{" "}
            (kunci sementara); kamu yang menentukan final atau tidak lewat POST.
          </p>
          <div className="flex flex-col items-stretch gap-1.5">
            {[
              { t: "GET /jobs/pull", d: "Job dikunci untukmu selama N menit (lease). Tersembunyi dari consumer lain.", c: "border-amber-500/30 bg-amber-500/5" },
              { t: "Proses data", d: "Simpan/index job di sistem kamu. Tidak ada batasan waktu selama dalam lease.", c: "border-border bg-card/50" },
              { t: "POST ack", d: "Konfirmasi final — job tidak pernah muncul lagi di pull manapun.", c: "border-emerald-500/30 bg-emerald-500/5" },
            ].map((s, i) => (
              <div key={s.t}>
                <div className={cn("rounded-lg border px-3.5 py-2.5", s.c)}>
                  <p className="text-sm font-medium text-foreground">{s.t}</p>
                  <p className="text-xs text-muted-foreground">{s.d}</p>
                </div>
                {i < 2 && <ArrowDown className="mx-auto my-0.5 h-3.5 w-3.5 text-muted-foreground/60" />}
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <Timer className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
              <span className="font-medium">Lease kadaluarsa otomatis:</span> kalau kamu tidak ack dalam waktu lease,
              job dianggap tidak diambil — kembali ke pool dan bisa ditarik consumer lain (atau kamu lagi).
              Jangan ack sebelum data benar-benar aman tersimpan di sistemmu.
            </p>
          </div>
        </Section>

        <Section id="get-pull" title="3 · GET /api/v1/jobs/pull">
          <p className="text-sm text-muted-foreground">Menarik job READY dan memberi lease pada semuanya.</p>
          <ParamTable
            rows={[
              ["limit", "integer · 1–100 (default 50)", "Jumlah maksimal job per permintaan"],
              ["lease_minutes", "integer · 1–120 (default 15)", "Durasi lease dalam menit"],
              ["include_pulled", "\"1\"", "Recovery — ikutkan job yang sudah final (baca-only)"],
            ]}
          />
          <CodeBlock
            title="Response 200 (disederhanakan)"
            code={`{
  "success": true,
  "data": {
    "count": 1,
    "lease_minutes": 15,
    "jobs": [
      {
        "id": "cmu7wasgu0002j6nlvtybnz0q",
        "code": "JOBS00301",
        "lease_until": "2026-09-19T05:00:13.000Z",
        "source": { "platform": "remotive", "job_id": "…", "url": "https://…" },
        "company": { "name": "PT Maju Jaya", "logo_url": "https://…", "profile": "…" },
        "job": {
          "title": "Backend Engineer",
          "description": "…",
          "salary": { "min": 8000000, "max": 15000000, "currency": "IDR" },
          "location": "Jakarta",
          "employment_type": "FULL_TIME",
          "workplace_type": "HYBRID",
          "requirements": ["…"],
          "skills": ["nodejs"]
        },
        "contact": { "hr_email": "hr@majujaya.co.id", "email_verified": true },
        "metadata": { "scraped_at": "2026-09-19T04:00:00.000Z" }
      }
    ]
  }
}`}
          />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">code</span> adalah ID unik yang stabil — pakai itu sebagai kunci dedup di sistemmu.
            Bila <code className="rounded bg-accent px-1 font-mono">count: 0</code>, tidak ada job baru saat ini; panggil ulang nanti.
          </p>
        </Section>

        <Section id="post-ack" title="4 · POST /api/v1/jobs/pull — ack / release">
          <p className="text-sm text-muted-foreground">
            Konfirmasi final atau lepaskan lease. <code className="rounded bg-accent px-1 font-mono">ids</code> menerima
            job <code className="rounded bg-accent px-1 font-mono">id</code> maupun <code className="rounded bg-accent px-1 font-mono">code</code> (JOBS####).
          </p>
          <CodeBlock
            title="Ack — final"
            code={`curl -X POST https://<host>/api/v1/jobs/pull \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"ack","ids":["JOBS00301","JOBS00302"]}'`}
          />
          <CodeBlock
            title="Release — balikin ke pool"
            code={`curl -X POST https://<host>/api/v1/jobs/pull \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"release","ids":["JOBS00302"]}'`}
          />
          <CodeBlock
            title="Response 200"
            code={`{ "success": true, "data": { "action": "ack", "affected": 2, "skipped": 0 } }`}
          />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">skipped</span> &gt; 0 berarti ada id yang bukan milik tokonmu,
            sudah final, atau tidak dikenal — aman diabaikan atau dicek ulang.
          </p>
        </Section>

        <Section id="recovery" title="5 · Recovery & Error">
          <div className="space-y-2.5 text-sm">
            <div className="rounded-lg border border-border bg-card/50 px-3.5 py-2.5">
              <p className="font-medium text-foreground">Consumer crash sebelum ack?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tidak ada data hilang — tunggu lease kadaluarsa, job kembali ke pool dan bisa ditarik lagi.
                Butuh lihat job final yang sudah pernah dikirim? Pakai <code className="rounded bg-accent px-1 font-mono">include_pulled=1</code>.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 px-3.5 py-2.5">
              <p className="font-medium text-foreground">401 Unauthorized</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Token salah, sudah di-revoke, atau header Bearer tidak ada.</p>
            </div>
            <div className="rounded-lg border border-border bg-card/50 px-3.5 py-2.5">
              <p className="font-medium text-foreground">422 Validation</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Body POST tidak valid — action harus &quot;ack&quot;/&quot;release&quot; dan ids array non-kosong (maks 200).</p>
            </div>
          </div>
        </Section>

        <Section id="contoh" title="6 · Contoh Lengkap (polling loop)">
          <CodeBlock
            title="Bash — polling sederhana"
            code={`#!/bin/bash
TOKEN="jfk_xxx"
while true; do
  RES=$(curl -s "https://<host>/api/v1/jobs/pull?limit=50" \\
    -H "Authorization: Bearer $TOKEN")
  COUNT=$(echo "$RES" | jq '.data.count')
  if [ "$COUNT" -gt 0 ]; then
    echo "$RES" | jq -r '.data.jobs[].id' > /tmp/ids.txt
    # ... proses job di sini ...
    curl -X POST "https://<host>/api/v1/jobs/pull" \\
      -H "Authorization: Bearer $TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "{\\"action\\":\\"ack\\",\\"ids\\":[$(cat /tmp/ids.txt | sed 's/^/"/;s/$/"/' | paste -sd,)]}"
  fi
  sleep 300
done`}
          />
          <CodeBlock
            title="Node.js / TypeScript"
            code={`const TOKEN = process.env.JOBFORGE_TOKEN!;
const BASE = "https://<host>/api/v1";

async function pull() {
  const res = await fetch(\`\${BASE}/jobs/pull?limit=50\`, {
    headers: { Authorization: \`Bearer \${TOKEN}\` },
  });
  if (!res.ok) throw new Error(\`pull gagal: \${res.status}\`);
  const { data } = await res.json();
  if (data.count === 0) return;

  const processed: string[] = [];
  for (const job of data.jobs) {
    try {
      await saveToMyDatabase(job);   // simpan dulu
      processed.push(job.code);      // baru tandai layak ack
    } catch {
      // gagal proses → dilepas balik ke pool
      await fetch(\`\${BASE}/jobs/pull\`, {
        method: "POST",
        headers: { Authorization: \`Bearer \${TOKEN}\`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", ids: [job.code] }),
      });
    }
  }
  if (processed.length > 0) {
    await fetch(\`\${BASE}/jobs/pull\`, {
      method: "POST",
      headers: { Authorization: \`Bearer \${TOKEN}\`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ack", ids: processed }),
    });
  }
}`}
          />
        </Section>

        <p className="pb-2 text-center text-[11px] text-muted-foreground">
          Jobforge Pull API v1 · model lease/ack · pertanyaan integrasi hubungi admin Jobforge
        </p>
      </div>
    </div>
  );
}
