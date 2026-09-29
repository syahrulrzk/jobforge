"use client";

import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────
// useDynamicPageSize — pagination otomatis sesuai tinggi layar.
//
// Hitung berapa baris/kartu yang muat di viewport (tinggi window -
// tinggi UI lain di luar daftar), lalu kembalikan pageSize.
// Ikut re-compute saat window di-resize. Grid kartu: jumlah kolom
// mengikuti breakpoint (1 mobile / sm / lg).
// ─────────────────────────────────────────────────────────────

/** jumlah kolom grid kartu sesuai lebar layar (harus sinkron dgn class grid)
 *  diekspor — dipakai view yang mau pageSize = N baris × kolom aktif */
export function gridColumns(width: number, cols?: number[]): number {
  if (cols) {
    // cols = breakpoint columns [sm, lg, xl] — hitung dari lebar layar
    if (width >= 1280) return cols[2] ?? cols[1] ?? cols[0];
    if (width >= 1024) return cols[1] ?? cols[0];
    if (width >= 640) return cols[0];
    return 1;
  }
  if (width >= 1024) return 3; // lg:grid-cols-3
  if (width >= 640) return 2; // sm:grid-cols-2
  return 1;
}

/** skala font root (globals.css: html { font-size: 87.5% } → 0.875).
 *  Semua ukuran rem ikut skala ini, jadi estimasi tinggi baris/kartu px
 *  harus dikalikan biar pageSize tetap akurat di skala mana pun. */
function rootScale(): number {
  if (typeof window === "undefined") return 1;
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return fs > 0 ? fs / 16 : 1;
}

/** fungsi murni — dipakai lazy init & resize handler biar hasilnya konsisten */
function computePageSize(
  width: number,
  height: number,
  mode: "table" | "card-grid",
  reservedPx: number,
  min: number,
  max: number,
  gridCols?: number[],
  rowHOverride?: number,
): number {
  // tinggi dasar @skala 100%: row tabel ~44px (py-3 + border), card grid ~150px
  // (p-4 + avatar 40 + profil 2 baris + stats) — dikali skala root yang aktif.
  // Tabel baris-kompak (py-2, text-xs) bisa override tinggi barisnya via rowHOverride.
  const scale = rootScale();
  const rowH = (rowHOverride ?? (mode === "table" ? 44 : 150)) * scale;
  const cols = mode === "card-grid" ? gridColumns(width, gridCols) : 1;
  const available = Math.max(rowH, height - reservedPx * scale);
  const n = Math.floor(available / rowH) * cols;
  return Math.min(max, Math.max(min, n));
}

/**
 * @param mode        "table" (row ~44px) | "card-grid" (baris kartu ~150px)
 * @param reservedPx  perkiraan tinggi UI lain (header, toolbar, pagination)
 * @param min/max     batas pageSize
 * @param gridCols    opsi: kolom grid per breakpoint [sm, lg, xl]
 * @param rowHOverride opsi: tinggi baris dasar (px @skala 100%) — utk tabel kompak
 */
export function useDynamicPageSize(
  mode: "table" | "card-grid",
  reservedPx: number,
  min: number,
  max: number,
  gridCols?: number[],
  rowHOverride?: number,
): number {
  // array gridCols dibuat baru tiap render — pakai key stabil buat deps effect
  const colsKey = gridCols?.join(",") ?? "";

  // lazy init: fetch PERTAMA langsung pake pageSize yang pas —
  // gak ada "2 baris dulu lalu 3 baris" (nilai min cuma fallback SSR)
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return min;
    return computePageSize(window.innerWidth, window.innerHeight, mode, reservedPx, min, max, gridCols, rowHOverride);
  });

  useEffect(() => {
    const compute = () =>
      setPageSize(computePageSize(window.innerWidth, window.innerHeight, mode, reservedPx, min, max, gridCols, rowHOverride));
    compute(); // re-compute sekali lagi setelah mount (layout mungkin berubah)
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reservedPx, min, max, colsKey]);

  return pageSize;
}
