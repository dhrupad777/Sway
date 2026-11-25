// Storage for Phase 1 evaluation results (one row per item × config).
import { db } from "./metrics.js";

export interface EvalRow {
  run_id: string;
  ts: number;
  dataset: string;
  item_idx: number;
  category: string | null;
  prompt: string;
  config: string;
  model: string;
  tier: string | null;
  response: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  cache_hit: number;
  escalated: number;
  score: number | null;
  reason: string | null;
}

let _ready = false;
function table(): void {
  if (_ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS evals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      dataset TEXT,
      item_idx INTEGER,
      category TEXT,
      prompt TEXT,
      config TEXT,
      model TEXT,
      tier TEXT,
      response TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      latency_ms INTEGER,
      cache_hit INTEGER DEFAULT 0,
      escalated INTEGER DEFAULT 0,
      score REAL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_evals_run ON evals(run_id);
  `);
  _ready = true;
}

export function insertEval(r: EvalRow): void {
  table();
  db().prepare(`
    INSERT INTO evals (run_id, ts, dataset, item_idx, category, prompt, config, model, tier, response,
      input_tokens, output_tokens, cost_usd, latency_ms, cache_hit, escalated, score, reason)
    VALUES (@run_id, @ts, @dataset, @item_idx, @category, @prompt, @config, @model, @tier, @response,
      @input_tokens, @output_tokens, @cost_usd, @latency_ms, @cache_hit, @escalated, @score, @reason)
  `).run(r);
}

export function evalRows(runId: string): EvalRow[] {
  table();
  return db().prepare(`SELECT * FROM evals WHERE run_id = ? ORDER BY item_idx, config`).all(runId) as EvalRow[];
}

export function evalRuns(limit = 10): { run_id: string; dataset: string; n: number; configs: string; ts: number }[] {
  table();
  return db().prepare(`
    SELECT run_id, dataset, COUNT(*) as n, GROUP_CONCAT(DISTINCT config) as configs, MIN(ts) as ts
    FROM evals GROUP BY run_id ORDER BY ts DESC LIMIT ?
  `).all(limit) as { run_id: string; dataset: string; n: number; configs: string; ts: number }[];
}

/** Most recent run that has both `nano` and `flagship` configs (router training data). */
export function latestLabelRun(): string | null {
  table();
  const r = db().prepare(`
    SELECT run_id FROM evals GROUP BY run_id
    HAVING SUM(config='nano') > 0 AND SUM(config='flagship') > 0
    ORDER BY MIN(ts) DESC LIMIT 1
  `).get() as { run_id: string } | undefined;
  return r?.run_id ?? null;
}
