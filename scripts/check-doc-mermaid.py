#!/usr/bin/env python3
# Validasi render semua blok mermaid di dokumen JobForge
import re, subprocess, sys, pathlib, tempfile

DOC = pathlib.Path("/home/z/my-project/download/JobForge-Dokumentasi-Implementasi-Production.md")
blocks = re.findall(r"```mermaid\n(.*?)```", DOC.read_text(), re.S)
print(f"{len(blocks)} blok mermaid ditemukan")
ok = True
for i, b in enumerate(blocks, 1):
    with tempfile.NamedTemporaryFile("w", suffix=".mmd", delete=False) as f:
        f.write(b)
        path = f.name
    out = f"/tmp/mermaid-check-{i}.svg"
    r = subprocess.run(
        ["mmdc", "-i", path, "-o", out, "-p", "/home/z/my-project/puppeteer-config.json"],
        capture_output=True, text=True, timeout=90,
    )
    if r.returncode == 0:
        print(f"  blok {i}: OK -> {out}")
    else:
        ok = False
        print(f"  blok {i}: GAGAL\n{r.stderr[:600]}")
sys.exit(0 if ok else 1)
