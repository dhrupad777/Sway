// Phase 1 — Quality evaluation harness.
// Runs every dataset item through several configurations, grades every answer with
// the judge, stores rows in the `evals` table and writes a markdown + CSV report.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline, type PipelineOptions } from "./pipeline.js";
import { judge } from "./judge.js";
import { DEFAULTS } from "./pricing.js";
import { insertEval, evalRows, type EvalRow } from "./evalstore.js";
import { newSessionId } from "./metrics.js";

export interface EvalItem {
  prompt: string;
  reference?: string;
  category?: string;
}

interface Dataset {
  name: string;
  description?: string;
  items: EvalItem[];
}

type ConfigOpts = Omit<PipelineOptions, "session" | "onToken">;

/** A dataset path missing from the cwd falls back to the copy shipped in the package (evals/, workloads/). */
export function bundled(p: string): string {
  if (existsSync(p)) return p;
  const shipped = fileURLToPath(new URL("../" + p, import.meta.url));
  return existsSync(shipped) ? shipped : p;
}

// The baselines mimic "Raw API" in v0.1: no context, no optimizer, 4096-token cap.
export const CONFIGS: Record<string, { label: string; opts: ConfigOpts }> = {
  flagship: {
    label: `Raw flagship (${DEFAULTS.flagship})`,
    opts: { context: "off", optimize: false, router: "off", model: DEFAULTS.flagship, semanticCache: false, escalate: false, tokenBudget: false, maxTokens: 4096 },
  },
  nano: {
    label: `Raw nano (${DEFAULTS.nano})`,
    opts: { context: "off", optimize: false, router: "off", model: DEFAULTS.nano, semanticCache: false, escalate: false, tokenBudget: false, maxTokens: 4096 },
  },
  "sway-v01": {
    label: "Sway v0.1 (context + optimizer + rules router + token budget)",
    opts: { context: "full", optimize: true, router: "rules", semanticCache: false, escalate: false, tokenBudget: true },
  },
  "sway-learned": {
    label: "v0.1 + learned router + escalation",
    opts: { context: "full", optimize: true, router: "learned", semanticCache: false, escalate: true, tokenBudget: true },
  },
  "sway-full": {
    label: "v0.2 full (learned router + escalation + semantic cache + context retrieval)",
    opts: { context: "retrieve", optimize: true, router: "learned", semanticCache: true, escalate: true, tokenBudget: true },
  },
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = (e as Error).message ?? "";
      if (!/429|500|503|overloaded|unavailable|timeout|fetch failed|RESOURCE_EXHAUSTED/i.test(msg)) throw e;
      await sleep(2000 * 2 ** i);
    }
  }
  throw last;
}

export async function runEval(datasetPath: string, opts: { configs: string[]; limit?: number; concurrency: number; judgeModel?: string }): Promise<string> {
  const ds = JSON.parse(readFileSync(datasetPath, "utf8")) as Dataset;
  const unknown = opts.configs.filter(c => !CONFIGS[c]);
  if (unknown.length) throw new Error(`Unknown config(s): ${unknown.join(", ")}. Known: ${Object.keys(CONFIGS).join(", ")}`);
  const items = ds.items.slice(0, opts.limit ?? ds.items.length);
  const runId = `eval_${newSessionId().slice(2)}`;
  const judgeModel = opts.judgeModel ?? DEFAULTS.judge;

  console.log(`Eval run ${runId} — dataset "${ds.name}", ${items.length} items × ${opts.configs.length} configs`);
  console.log(`Judge: ${judgeModel}. Configs:`);
  for (const c of opts.configs) console.log(`  ${c.padEnd(13)} ${CONFIGS[c].label}`);
  console.log(`Legend: one char per answer — digit = judge score (0 = 10), C = cache hit, E = escalated, x = error\n`);

  let judgeCost = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      const it = items[idx];
      for (const cfg of opts.configs) {
        try {
          const r = await withRetry(() => runPipeline(it.prompt, {
            ...CONFIGS[cfg].opts,
            session: `${runId}:${cfg}`,
            cacheNamespace: `${runId}:${cfg}`,
          }));
          const j = await withRetry(() => judge(it.prompt, r.text, it.reference, judgeModel));
          judgeCost += j.costUsd;
          const row: EvalRow = {
            run_id: runId, ts: Date.now(), dataset: ds.name, item_idx: idx, category: it.category ?? null,
            prompt: it.prompt, config: cfg, model: r.model, tier: r.tier, response: r.text,
            input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd, latency_ms: r.latencyMs,
            cache_hit: r.cacheHit ? 1 : 0, escalated: r.escalated ? 1 : 0, score: j.score, reason: j.reason,
          };
          insertEval(row);
          process.stderr.write(r.cacheHit ? "C" : r.escalated ? "E" : String(j.score % 10));
        } catch (e) {
          process.stderr.write("x");
          insertEval({
            run_id: runId, ts: Date.now(), dataset: ds.name, item_idx: idx, category: it.category ?? null,
            prompt: it.prompt, config: cfg, model: "", tier: null, response: `ERROR: ${(e as Error).message}`,
            input_tokens: 0, output_tokens: 0, cost_usd: 0, latency_ms: 0, cache_hit: 0, escalated: 0, score: null, reason: null,
          });
        }
      }
      process.stderr.write(" ");
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  process.stderr.write("\n\n");

  const report = summarize(runId, opts.configs);
  console.log(report.table);
  console.log(`\nJudge cost (not included above): $${judgeCost.toFixed(4)}`);
  mkdirSync("reports", { recursive: true });
  const md = join("reports", `${runId}.md`);
  const csv = join("reports", `${runId}.csv`);
  writeFileSync(md, report.markdown(ds, judgeModel, judgeCost));
  writeFileSync(csv, toCsv(evalRows(runId)));
  console.log(`Report: ${md}\nRows:   ${csv}`);
  console.log(`\nNext: \`sway train-router --run ${runId}\` (needs flagship + nano configs)`);
  return runId;
}

interface ConfigSummary {
  config: string;
  n: number;
  errors: number;
  quality: number;
  cost: number;
  latency: number;
  inTok: number;
  outTok: number;
  nanoShare: number;
  cacheHits: number;
  escalations: number;
}

export function summarizeRows(rows: EvalRow[], configs: string[]): ConfigSummary[] {
  return configs.map(c => {
    const all = rows.filter(r => r.config === c);
    const ok = all.filter(r => r.score != null);
    const n = ok.length || 1;
    return {
      config: c,
      n: ok.length,
      errors: all.length - ok.length,
      quality: ok.reduce((s, r) => s + (r.score ?? 0), 0) / n,
      cost: ok.reduce((s, r) => s + r.cost_usd, 0),
      latency: ok.reduce((s, r) => s + r.latency_ms, 0) / n,
      inTok: ok.reduce((s, r) => s + r.input_tokens, 0),
      outTok: ok.reduce((s, r) => s + r.output_tokens, 0),
      nanoShare: ok.filter(r => r.model === DEFAULTS.nano).length / n,
      cacheHits: ok.filter(r => r.cache_hit).length,
      escalations: ok.filter(r => r.escalated).length,
    };
  });
}

function summarize(runId: string, configs: string[]) {
  const rows = evalRows(runId);
  const s = summarizeRows(rows, configs);
  const base = s.find(x => x.config === "flagship");
  const saved = (x: ConfigSummary) => (base && base.cost > 0 ? `${((1 - x.cost / base.cost) * 100).toFixed(1)}%` : "-");
  const dq = (x: ConfigSummary) => (base ? `${x.quality - base.quality >= 0 ? "+" : ""}${(x.quality - base.quality).toFixed(2)}` : "-");
  const head = ["Config", "N", "Quality", "ΔQ vs raw", "Cost", "Saved", "→nano", "Cache", "Escal.", "In tok", "Out tok", "Avg ms"];
  const body = s.map(x => [
    x.config, String(x.n) + (x.errors ? ` (+${x.errors} err)` : ""), x.quality.toFixed(2), dq(x),
    `$${x.cost.toFixed(4)}`, saved(x), `${(x.nanoShare * 100).toFixed(0)}%`, String(x.cacheHits), String(x.escalations),
    String(x.inTok), String(x.outTok), x.latency.toFixed(0),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const table = [head, widths.map(w => "-".repeat(w)), ...body].map(r => r.map((c, i) => c.padEnd(widths[i])).join("  ")).join("\n");

  const markdown = (ds: Dataset, judgeModel: string, judgeCost: number) => {
    const cats = [...new Set(rows.map(r => r.category ?? "-"))];
    const catTable = [
      `| Category | ${configs.join(" | ")} |`,
      `|---|${configs.map(() => "---").join("|")}|`,
      ...cats.map(cat => `| ${cat} | ${configs.map(c => {
        const rs = rows.filter(r => r.config === c && (r.category ?? "-") === cat && r.score != null);
        return rs.length ? (rs.reduce((a, r) => a + (r.score ?? 0), 0) / rs.length).toFixed(2) : "-";
      }).join(" | ")} |`),
    ].join("\n");
    const worst = rows
      .filter(r => r.config !== "flagship" && r.score != null && r.score <= 5)
      .slice(0, 10)
      .map(r => `- **${r.config}** (${r.score}/10) — "${r.prompt.slice(0, 80)}" — ${r.reason}`)
      .join("\n") || "- none";
    return `# Sway evaluation — ${runId}

- Dataset: **${ds.name}** (${s[0]?.n ?? 0} items) — ${ds.description ?? ""}
- Judge: \`${judgeModel}\` (temperature 0, reference answers), judge cost $${judgeCost.toFixed(4)} (not counted below)
- Date: ${new Date().toISOString()}
- Flagship: \`${DEFAULTS.flagship}\`, nano: \`${DEFAULTS.nano}\`, optimizer: \`${DEFAULTS.optimizer}\`

## Configurations
${configs.map(c => `- \`${c}\` — ${CONFIGS[c].label}`).join("\n")}

## Results

| ${head.join(" | ")} |
|${head.map(() => "---").join("|")}|
${body.map(b => `| ${b.join(" | ")} |`).join("\n")}

Quality = mean judge score (1–10). Saved = cost reduction vs \`flagship\`. Cost includes optimizer and embedding calls.

## Quality by category

${catTable}

## Low-scoring answers (≤ 5) outside the baseline

${worst}
`;
  };
  return { table, markdown };
}

function toCsv(rows: EvalRow[]): string {
  const cols: (keyof EvalRow)[] = ["run_id", "item_idx", "category", "config", "model", "tier", "score", "cost_usd", "input_tokens", "output_tokens", "latency_ms", "cache_hit", "escalated", "prompt", "reason"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n") + "\n";
}

/** Re-print the summary of an earlier run. */
export function showEval(runId: string): void {
  const rows = evalRows(runId);
  if (!rows.length) { console.error(`No rows for ${runId}`); process.exit(1); }
  const configs = [...new Set(rows.map(r => r.config))];
  console.log(summarize(runId, configs).table);
}
