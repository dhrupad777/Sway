import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  const dir = join(homedir(), ".sway");
  mkdirSync(dir, { recursive: true });
  const d = new Database(join(dir, "metrics.db"));
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      raw_prompt TEXT,
      optimized_prompt TEXT,
      response_text TEXT,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      optimized INTEGER DEFAULT 0,
      routed INTEGER DEFAULT 0,
      route_tier TEXT,
      context_hash TEXT,
      latency_ms INTEGER,
      session TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calls_ts ON calls(ts);
    CREATE INDEX IF NOT EXISTS idx_calls_session ON calls(session);
  `);
  // Migration: add response_text if upgrading from v0.1.0 schema
  try { d.exec(`ALTER TABLE calls ADD COLUMN response_text TEXT`); } catch { /* already exists */ }
  _db = d;
  return d;
}

export interface CallRow {
  rawPrompt: string;
  optimizedPrompt: string | null;
  responseText: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  optimized: boolean;
  routed: boolean;
  routeTier: string | null;
  contextHash: string | null;
  latencyMs: number;
  session: string;
}

export function record(row: CallRow): void {
  db().prepare(`
    INSERT INTO calls (ts, raw_prompt, optimized_prompt, response_text, model, provider,
      input_tokens, output_tokens, cost_usd, optimized, routed, route_tier,
      context_hash, latency_ms, session)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(),
    row.rawPrompt,
    row.optimizedPrompt,
    row.responseText,
    row.model,
    row.provider,
    row.inputTokens,
    row.outputTokens,
    row.costUsd,
    row.optimized ? 1 : 0,
    row.routed ? 1 : 0,
    row.routeTier,
    row.contextHash,
    row.latencyMs,
    row.session,
  );
}

export function bySession(session: string): StatsRow[] {
  return db().prepare(`SELECT * FROM calls WHERE session = ? ORDER BY id ASC`).all(session) as StatsRow[];
}

export interface PromptPair {
  prompt: string;
  ts: number;
  raw: StatsRow;
  sway: StatsRow;
  savingsPct: number;
}

// Returns prompts that have BOTH a raw row (routed=0) and a sway row (routed=1).
// For each prompt, pairs the most-recent of each. Newest pairs first.
export function pairs(limit = 50): PromptPair[] {
  const heads = db().prepare(`
    SELECT raw_prompt as prompt, MAX(ts) as ts
    FROM calls
    WHERE raw_prompt IS NOT NULL
    GROUP BY raw_prompt
    HAVING SUM(CASE WHEN routed = 0 THEN 1 ELSE 0 END) > 0
       AND SUM(CASE WHEN routed = 1 THEN 1 ELSE 0 END) > 0
    ORDER BY ts DESC
    LIMIT ?
  `).all(limit) as { prompt: string; ts: number }[];

  const out: PromptPair[] = [];
  const getRaw  = db().prepare(`SELECT * FROM calls WHERE raw_prompt = ? AND routed = 0 ORDER BY ts DESC LIMIT 1`);
  const getSway = db().prepare(`SELECT * FROM calls WHERE raw_prompt = ? AND routed = 1 ORDER BY ts DESC LIMIT 1`);
  for (const h of heads) {
    const raw = getRaw.get(h.prompt) as StatsRow | undefined;
    const sway = getSway.get(h.prompt) as StatsRow | undefined;
    if (!raw || !sway) continue;
    const savingsPct = raw.cost_usd === 0 ? 0 : ((raw.cost_usd - sway.cost_usd) / raw.cost_usd) * 100;
    out.push({ prompt: h.prompt, ts: h.ts, raw, sway, savingsPct });
  }
  return out;
}

export function recentSessions(limit = 10): { session: string; count: number; cost: number; first_ts: number }[] {
  return db().prepare(`
    SELECT session, COUNT(*) as count, SUM(cost_usd) as cost, MIN(ts) as first_ts
    FROM calls WHERE session IS NOT NULL AND session != 'ask'
    GROUP BY session ORDER BY first_ts DESC LIMIT ?
  `).all(limit) as { session: string; count: number; cost: number; first_ts: number }[];
}

export interface StatsRow {
  id: number;
  ts: number;
  raw_prompt: string;
  optimized_prompt: string | null;
  response_text: string | null;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  optimized: number;
  routed: number;
  route_tier: string | null;
  context_hash: string | null;
  latency_ms: number;
  session: string;
}

export function recent(limit = 50): StatsRow[] {
  return db().prepare(`SELECT * FROM calls ORDER BY id DESC LIMIT ?`).all(limit) as StatsRow[];
}

export function summary(sinceMs?: number): {
  count: number;
  totalCost: number;
  totalIn: number;
  totalOut: number;
  routedNano: number;
  routedFlagship: number;
} {
  const since = sinceMs ?? 0;
  const r = db().prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(cost_usd),0) as totalCost,
      COALESCE(SUM(input_tokens),0) as totalIn,
      COALESCE(SUM(output_tokens),0) as totalOut,
      COALESCE(SUM(CASE WHEN route_tier='nano' THEN 1 ELSE 0 END),0) as routedNano,
      COALESCE(SUM(CASE WHEN route_tier='flagship' THEN 1 ELSE 0 END),0) as routedFlagship
    FROM calls WHERE ts >= ?
  `).get(since) as {
    count: number; totalCost: number; totalIn: number; totalOut: number;
    routedNano: number; routedFlagship: number;
  };
  return r;
}

export function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
