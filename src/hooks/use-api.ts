"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Lightweight polling data hook (SWR-ish) for live dashboards
export function useApi<T>(url: string | null, opts?: { intervalMs?: number | null }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!url || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [url]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const interval = opts?.intervalMs;
    if (!interval) return;
    const t = setInterval(() => void load(), interval);
    return () => clearInterval(t);
  }, [load, opts?.intervalMs]);

  return { data, loading, error, reload: load };
}
