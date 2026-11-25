// Phase 3 — Persistent semantic response cache.
// A new prompt hits the cache when its embedding's cosine similarity to a stored
// prompt is >= threshold, AND it was answered under the same context (sway.md hash)
// and the same scope (requested model, or "auto" for routed calls). Survives restarts.
import { db } from "./metrics.js";
import { cosine, fromBlob, toBlob } from "./embeddings.js";

export const DEFAULT_SIM_THRESHOLD = 0.92;
const TTL_MS = 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 5000;

export interface SemEntry {
  id: number;
  prompt: string;
  response: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  ts: number;
}

export type SemLookup =
  | { hit: true; entry: SemEntry; similarity: number }
  | { hit: false; bestSimilarity: number };

let _ready = false;
function table(): void {
  if (_ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS sem_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      scope TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      prompt TEXT NOT NULL,
      vec BLOB NOT NULL,
      response TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sem_scope ON sem_cache(scope, context_hash, ts);
  `);
  _ready = true;
}

export function semLookup(vec: Float32Array, scope: string, contextHash: string | null, threshold = DEFAULT_SIM_THRESHOLD): SemLookup {
  table();
  const rows = db().prepare(`
    SELECT * FROM sem_cache WHERE scope = ? AND context_hash = ? AND ts >= ?
    ORDER BY ts DESC LIMIT ?
  `).all(scope, contextHash ?? "", Date.now() - TTL_MS, SCAN_LIMIT) as Array<{
    id: number; ts: number; prompt: string; vec: Buffer; response: string;
    model: string; provider: string; input_tokens: number; output_tokens: number;
  }>;
  let best = -1;
  let bestRow: (typeof rows)[number] | null = null;
  for (const r of rows) {
    const s = cosine(vec, fromBlob(r.vec));
    if (s > best) { best = s; bestRow = r; }
  }
  if (bestRow && best >= threshold) {
    return {
      hit: true,
      similarity: best,
      entry: {
        id: bestRow.id, prompt: bestRow.prompt, response: bestRow.response,
        model: bestRow.model, provider: bestRow.provider,
        inputTokens: bestRow.input_tokens, outputTokens: bestRow.output_tokens, ts: bestRow.ts,
      },
    };
  }
  return { hit: false, bestSimilarity: Math.max(best, 0) };
}

export function semStore(vec: Float32Array, scope: string, contextHash: string | null, e: Omit<SemEntry, "id" | "ts">): void {
  table();
  db().prepare(`
    INSERT INTO sem_cache (ts, scope, context_hash, prompt, vec, response, model, provider, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Date.now(), scope, contextHash ?? "", e.prompt, toBlob(vec), e.response, e.model, e.provider, e.inputTokens, e.outputTokens);
}

export function semCount(): number {
  table();
  return (db().prepare(`SELECT COUNT(*) as n FROM sem_cache WHERE ts >= ?`).get(Date.now() - TTL_MS) as { n: number }).n;
}

export function semClear(): number {
  table();
  return db().prepare(`DELETE FROM sem_cache`).run().changes;
}

// ---------- cache-eval: threshold sweep over labelled pairs ----------

export interface CachePair { a: string; b: string; same: boolean }

export interface SweepRow { threshold: number; hitRate: number; falseHitRate: number; precision: number }

/** Pure: given similarities and labels, compute hit / false-hit rates for each threshold. */
export function sweep(sims: number[], same: boolean[], thresholds: number[]): SweepRow[] {
  const pos = same.filter(Boolean).length || 1;
  const neg = same.filter(s => !s).length || 1;
  return thresholds.map(t => {
    let tp = 0, fp = 0;
    sims.forEach((s, i) => { if (s >= t) { if (same[i]) tp++; else fp++; } });
    return { threshold: t, hitRate: tp / pos, falseHitRate: fp / neg, precision: tp + fp ? tp / (tp + fp) : 1 };
  });
}

export interface CacheSweepResult {
  name: string;
  pairs: CachePair[];
  sims: number[];
  rows: SweepRow[];
  /** Highest-recall threshold whose false-hit rate stays within the limit. */
  best: SweepRow | null;
}

/** Embed every labelled pair and sweep thresholds 0.80–0.98 (used by the CLI and the dashboard). */
export async function computeCacheSweep(path: string, maxFalseHit = 0.05): Promise<CacheSweepResult> {
  const { readFileSync } = await import("node:fs");
  const { embedMany } = await import("./embeddings.js");
  const ds = JSON.parse(readFileSync(path, "utf8")) as { name: string; pairs: CachePair[] };
  const vecs = await embedMany(ds.pairs.flatMap(p => [p.a, p.b]));
  const sims = ds.pairs.map((_, i) => cosine(vecs[2 * i], vecs[2 * i + 1]));
  const ts = Array.from({ length: 19 }, (_, i) => Math.round((0.80 + i * 0.01) * 100) / 100);
  const rows = sweep(sims, ds.pairs.map(p => p.same), ts);
  const best = rows.filter(r => r.falseHitRate <= maxFalseHit)
    .sort((a, b) => b.hitRate - a.hitRate || a.threshold - b.threshold)[0] ?? null;
  return { name: ds.name, pairs: ds.pairs, sims, rows, best };
}

export async function cacheEval(path: string, maxFalseHit = 0.05): Promise<void> {
  const { name, pairs, sims, rows, best } = await computeCacheSweep(path, maxFalseHit);
  const ds = { name, pairs };
  const same = pairs.map(p => p.same);

  console.log(`Dataset ${ds.name}: ${same.filter(Boolean).length} same-intent pairs, ${same.filter(s => !s).length} near-miss pairs\n`);
  console.log(`${"Threshold".padEnd(10)} ${"Hit rate".padStart(9)} ${"False hits".padStart(11)} ${"Precision".padStart(10)}`);
  console.log("-".repeat(43));
  for (const r of rows) {
    const mark = r.threshold === DEFAULT_SIM_THRESHOLD ? "  <- current default" : "";
    console.log(`${r.threshold.toFixed(2).padEnd(10)} ${(r.hitRate * 100).toFixed(0).padStart(8)}% ${(r.falseHitRate * 100).toFixed(0).padStart(10)}% ${(r.precision * 100).toFixed(0).padStart(9)}%${mark}`);
  }
  if (best) {
    console.log(`\nBest threshold with false-hit rate <= ${(maxFalseHit * 100).toFixed(0)}%: ${best.threshold.toFixed(2)} ` +
      `(hit rate ${(best.hitRate * 100).toFixed(0)}%). Use it with --sim ${best.threshold.toFixed(2)}.`);
  } else {
    console.log(`\nNo threshold in 0.80–0.98 keeps false hits <= ${(maxFalseHit * 100).toFixed(0)}%.`);
  }
  console.log("\nHardest near-misses (highest similarity, must NOT hit):");
  ds.pairs.map((p, i) => ({ p, s: sims[i] })).filter(x => !x.p.same).sort((a, b) => b.s - a.s).slice(0, 5)
    .forEach(x => console.log(`  ${x.s.toFixed(3)}  "${x.p.a}"  vs  "${x.p.b}"`));
}
