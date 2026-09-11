import { ensureSeed } from "./seed";
import { ensureEngine } from "./engine";

const g = globalThis as unknown as { __jobforgeBootstrap?: Promise<void> };

/**
 * Called by every API route: seeds initial data once and starts
 * the worker engine singleton. Safe to call concurrently.
 */
export function ensureBootstrap(): Promise<void> {
  if (!g.__jobforgeBootstrap) {
    g.__jobforgeBootstrap = (async () => {
      await ensureSeed();
      await ensureEngine();
    })().catch((err) => {
      g.__jobforgeBootstrap = undefined;
      throw err;
    });
  }
  return g.__jobforgeBootstrap;
}
