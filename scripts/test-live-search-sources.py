#!/usr/bin/env python3
"""E2E test Task 14 — live search per-source picker + engine follows source setting."""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:3000"


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def show(tag, status, body):
    print(f"\n=== {tag} → HTTP {status} ===")
    if "error" in body:
        print("error:", body["error"])
        return
    print(f"q={body['q']} dur={(body['durationMs']/1000):.1f}s total: found={body['totalFound']} created={body['totalCreated']} dup={body['totalDuplicate']} skipped={body['totalSkipped']}")
    for b in body["boards"]:
        print(f"  - {b['board']:<14} engine={b['engine']:<11} {b['status']:<8} found={b['found']:<4} new={b['created']:<3} dup={b['duplicate']:<3} skip={b['skipped']:<3} {('ERR: ' + b['error'][:80]) if b.get('error') else ''}")


# 1. Pilih 1 board tanpa integrasi nyata (JobStreet) → laporan jujur, tanpa mock
s, b = post("/api/search/live", {"q": "frontend developer", "sources": ["jobstreet"]})
show("TEST 1 — JobStreet only (tanpa integrasi nyata)", s, b)
assert s == 200 and len(b["boards"]) == 1 and b["boards"][0]["status"] == "failed", "TEST 1 FAIL"
assert b["totalCreated"] == 0, "TEST 1 harus 0 job baru (anti-spam)"
print("  PASS — JobStreet dilaporkan gagal jujur, 0 mock")

# 2. Pilih 1 board real (Remotive) → engine ngikutin setting source (cheerio)
s, b = post("/api/search/live", {"q": "frontend developer", "sources": ["remotive"]})
show("TEST 2 — Remotive only (engine harus sesuai setting source)", s, b)
assert s == 200 and len(b["boards"]) == 1, "TEST 2 FAIL"
assert b["boards"][0]["slug"] == "remotive" and b["boards"][0]["engine"] == "cheerio", "TEST 2 engine bukan cheerio"
print("  PASS — hanya Remotive yang discrape, engine cheerio (setting source)")

# 3. Campuran: JobStreet (gagal jujur) + Arbeitnow (sukses, puppeteer)
s, b = post("/api/search/live", {"q": "engineer", "sources": ["jobstreet", "arbeitnow"]})
show("TEST 3 — Campuran JobStreet + Arbeitnow", s, b)
assert s == 200 and len(b["boards"]) == 2, "TEST 3 FAIL"
by_slug = {x["slug"]: x for x in b["boards"]}
assert by_slug["jobstreet"]["status"] == "failed", "TEST 3 jobstreet harus failed"
assert by_slug["arbeitnow"]["status"] == "success" and by_slug["arbeitnow"]["engine"] == "puppeteer", "TEST 3 arbeitnow"
print("  PASS — campuran: integrasi nyata jalan, sisanya laporan jujur")

# 4. Tanpa pilihan → default semua source ACTIVE
s, b = post("/api/search/live", {"q": "designer"})
show("TEST 4 — Tanpa pilihan (default semua ACTIVE)", s, b)
assert s == 200 and len(b["boards"]) >= 4, "TEST 4 FAIL — harus >= 4 board ACTIVE"
slugs = {x["slug"] for x in b["boards"]}
assert "jobstreet" not in slugs and "glints" not in slugs, "TEST 4 source non-ACTIVE ikut?"
print(f"  PASS — default {len(slugs)} board ACTIVE: {sorted(slugs)}")

print("\nALL TESTS PASSED")
