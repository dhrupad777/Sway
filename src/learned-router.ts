// Phase 2 — Learned router.
// Logistic regression predicting P(prompt needs the flagship model), trained on
// Phase 1 eval runs where every prompt was answered AND graded on both tiers.
// Pure TypeScript, no ML dependency. Model saved to ~/.sway/router.json.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULTS } from "./pricing.js";
import { approxTokens, countCodeBlocks, hasFilePath, FLAGSHIP_KEYWORDS, classify, type RouteDecision } from "./router.js";
import { embedMany } from "./embeddings.js";
import { evalRows, latestLabelRun, type EvalRow } from "./evalstore.js";

export const ROUTER_PATH = join(homedir(), ".sway", "router.json");

export const HAND_FEATURES = [
  "log_tokens", "code_blocks", "file_path", "kw_hits",
  "how_why", "multi_part", "imperative_build", "lines",
];

const BUILD_VERBS = ["write", "implement", "build", "create", "fix", "convert", "compare", "design"];

export function handFeatures(prompt: string): number[] {
  const lower = prompt.toLowerCase();
  return [
    Math.log1p(approxTokens(prompt)),
    countCodeBlocks(prompt),
    hasFilePath(prompt) ? 1 : 0,
    FLAGSHIP_KEYWORDS.filter(k => lower.includes(k)).length,
    /\b(how|why)\b/.test(lower) ? 1 : 0,
    (lower.match(/\b(and|also|then)\b/g)?.length ?? 0) + (lower.match(/\?/g)?.length ?? 0),
    BUILD_VERBS.some(v => new RegExp(`\\b${v}\\b`).test(lower)) ? 1 : 0,
    prompt.split("\n").length,
  ];
}

// ---------- logistic regression (pure) ----------

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function fitStandardizer(X: number[][]): { mean: number[]; std: number[] } {
  const d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

export function applyStandardizer(x: number[], s: { mean: number[]; std: number[] }): number[] {
  return x.map((v, j) => (v - s.mean[j]) / s.std[j]);
}

/** Full-batch gradient descent with L2 penalty. X must already be standardized. */
export function trainLR(X: number[][], y: number[], opts = { l2: 0.1, epochs: 600, lr: 0.1 }): { weights: number[]; bias: number } {
  const n = X.length, d = X[0]?.length ?? 0;
  const w = new Array(d).fill(0);
  let b = 0;
  // Class balance: weight positives so a skewed dataset doesn't collapse to one class.
  const pos = y.filter(v => v === 1).length;
  const wPos = pos > 0 ? n / (2 * pos) : 1;
  const wNeg = n - pos > 0 ? n / (2 * (n - pos)) : 1;
  for (let e = 0; e < opts.epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = (sigmoid(z) - y[i]) * (y[i] === 1 ? wPos : wNeg);
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= opts.lr * (gw[j] / n + opts.l2 * w[j]);
    b -= opts.lr * (gb / n);
  }
  return { weights: w, bias: b };
}

export function predictLR(x: number[], m: { weights: number[]; bias: number }): number {
  let z = m.bias;
  for (let j = 0; j < m.weights.length; j++) z += m.weights[j] * x[j];
  return sigmoid(z);
}

// ---------- saved model ----------

export interface RouterModel {
  version: 1;
  trainedAt: string;
  runId: string;
  variant: "hand" | "hand+embed";
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  threshold: number;
  metrics: Record<string, unknown>;
}

let _model: RouterModel | null | undefined;
export function loadRouterModel(): RouterModel | null {
  if (_model !== undefined) return _model;
  _model = existsSync(ROUTER_PATH) ? JSON.parse(readFileSync(ROUTER_PATH, "utf8")) as RouterModel : null;
  return _model;
}

async function featuresFor(prompts: string[], variant: RouterModel["variant"]): Promise<number[][]> {
  const hand = prompts.map(handFeatures);
  if (variant === "hand") return hand;
  const vecs = await embedMany(prompts);
  return hand.map((h, i) => [...h, ...Array.from(vecs[i])]);
}

export interface LearnedDecision extends RouteDecision {
  prob: number;
  learned: boolean;
}

/** Route with the learned model; falls back to v0.1 rules if no model is trained. */
export async function routeLearned(prompt: string): Promise<LearnedDecision> {
  const m = loadRouterModel();
  if (!m) return { ...classify(prompt), prob: -1, learned: false };
  const [x] = await featuresFor([prompt], m.variant);
  const prob = predictLR(applyStandardizer(x, m), m);
  const tier = prob >= m.threshold ? "flagship" : "nano";
  return {
    tier,
    model: tier === "flagship" ? DEFAULTS.flagship : DEFAULTS.nano,
    score: prob,
    signals: [`p_flagship=${prob.toFixed(2)}`, `threshold=${m.threshold}`, `variant=${m.variant}`],
    prob,
    learned: true,
  };
}

// ---------- training from eval runs ----------

interface Item {
  prompt: string;
  nanoScore: number;
  flagScore: number;
  nanoCost: number;
  flagCost: number;
  label: number; // 1 = needs flagship
}

/** Flagship is "needed" when it is clearly better, or the nano answer is poor and flagship beats it. */
export function needsFlagship(nano: number, flag: number): number {
  return nano + 1 < flag || (nano < 6 && flag > nano) ? 1 : 0;
}

function itemsFromRun(rows: EvalRow[]): Item[] {
  const byIdx = new Map<number, { nano?: EvalRow; flagship?: EvalRow }>();
  for (const r of rows) {
    if (r.config !== "nano" && r.config !== "flagship") continue;
    const e = byIdx.get(r.item_idx) ?? {};
    e[r.config as "nano" | "flagship"] = r;
    byIdx.set(r.item_idx, e);
  }
  const items: Item[] = [];
  for (const { nano, flagship } of byIdx.values()) {
    if (!nano || !flagship || nano.score == null || flagship.score == null) continue;
    items.push({
      prompt: nano.prompt,
      nanoScore: nano.score, flagScore: flagship.score,
      nanoCost: nano.cost_usd, flagCost: flagship.cost_usd,
      label: needsFlagship(nano.score, flagship.score),
    });
  }
  return items;
}

/** Simulated outcome of a routing decision per item, using the real graded answers. */
export function simulate(items: Item[], toFlagship: boolean[]): { quality: number; cost: number; nanoShare: number } {
  let q = 0, c = 0, nano = 0;
  items.forEach((it, i) => {
    if (toFlagship[i]) { q += it.flagScore; c += it.flagCost; }
    else { q += it.nanoScore; c += it.nanoCost; nano++; }
  });
  const n = items.length || 1;
  return { quality: q / n, cost: c, nanoShare: nano / n };
}

function folds(n: number, k: number): number[] {
  // Deterministic shuffle (LCG) so results are reproducible.
  const idx = Array.from({ length: n }, (_, i) => i);
  let s = 42;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const fold = new Array(n);
  idx.forEach((v, i) => { fold[v] = i % k; });
  return fold;
}

function crossValProbs(X: number[][], y: number[], l2: number, k = 5): number[] {
  const f = folds(X.length, k);
  const out = new Array(X.length).fill(0.5);
  for (let fi = 0; fi < k; fi++) {
    const tr = X.map((_, i) => i).filter(i => f[i] !== fi);
    const te = X.map((_, i) => i).filter(i => f[i] === fi);
    if (tr.length === 0 || te.length === 0) continue;
    const st = fitStandardizer(tr.map(i => X[i]));
    const m = trainLR(tr.map(i => applyStandardizer(X[i], st)), tr.map(i => y[i]), { l2, epochs: 600, lr: 0.1 });
    for (const i of te) out[i] = predictLR(applyStandardizer(X[i], st), m);
  }
  return out;
}

function accuracy(pred: boolean[], y: number[]): number {
  return pred.filter((p, i) => (p ? 1 : 0) === y[i]).length / (y.length || 1);
}

/** Pick the cheapest threshold whose simulated quality stays within `tol` of all-flagship. */
function pickThreshold(items: Item[], probs: number[], tol: number): number {
  const target = simulate(items, items.map(() => true)).quality - tol;
  let best = 0; // threshold 0 = everything to flagship (always meets target)
  let bestCost = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const s = simulate(items, probs.map(p => p >= t));
    if (s.quality >= target && s.cost < bestCost) { bestCost = s.cost; best = Math.round(t * 100) / 100; }
  }
  return best;
}

export async function trainRouter(opts: { runId?: string; tolerance: number }): Promise<void> {
  const runId = opts.runId ?? latestLabelRun();
  if (!runId) {
    console.error("No eval run with both `nano` and `flagship` configs. Run:\n  sway eval evals/cs101_eval.json --configs flagship,nano,sway-rules");
    process.exit(1);
  }
  const items = itemsFromRun(evalRows(runId));
  if (items.length < 10) {
    console.error(`Run ${runId} has only ${items.length} graded items with both tiers — need at least 10.`);
    process.exit(1);
  }
  const y = items.map(i => i.label);
  const prompts = items.map(i => i.prompt);
  console.log(`Training on run ${runId}: ${items.length} items, ${y.filter(v => v).length} labelled "needs flagship".`);
  console.log(`Quality tolerance: within ${opts.tolerance} points of all-flagship.\n`);

  const allFlag = simulate(items, items.map(() => true));
  const allNano = simulate(items, items.map(() => false));
  const rulesPred = prompts.map(p => classify(p).tier === "flagship");
  const rules = simulate(items, rulesPred);

  const variants: { variant: RouterModel["variant"]; l2: number }[] = [
    { variant: "hand", l2: 0.05 },
    { variant: "hand+embed", l2: 1.0 },
  ];
  const results: { variant: RouterModel["variant"]; l2: number; X: number[][]; threshold: number; acc: number; sim: ReturnType<typeof simulate> }[] = [];
  for (const v of variants) {
    let X: number[][];
    try { X = await featuresFor(prompts, v.variant); }
    catch (e) { console.error(`  skipping ${v.variant}: ${(e as Error).message}`); continue; }
    const probs = crossValProbs(X, y, v.l2);
    const threshold = pickThreshold(items, probs, opts.tolerance);
    const pred = probs.map(p => p >= threshold);
    results.push({ ...v, X, threshold, acc: accuracy(pred, y), sim: simulate(items, pred) });
  }

  const row = (name: string, acc: string, s: ReturnType<typeof simulate>) =>
    `${name.padEnd(26)} ${acc.padStart(8)} ${(s.nanoShare * 100).toFixed(0).padStart(6)}% ${s.quality.toFixed(2).padStart(8)} ${("$" + s.cost.toFixed(4)).padStart(10)} ${(allFlag.cost ? ((1 - s.cost / allFlag.cost) * 100).toFixed(1) + "%" : "n/a").padStart(8)}`;
  console.log(`${"Policy (5-fold CV)".padEnd(26)} ${"Accuracy".padStart(8)} ${"->nano".padStart(7)} ${"Quality".padStart(8)} ${"Cost".padStart(10)} ${"Saved".padStart(8)}`);
  console.log("-".repeat(74));
  console.log(row("All flagship", "-", allFlag));
  console.log(row("All nano", "-", allNano));
  console.log(row("v0.1 rules", (accuracy(rulesPred, y) * 100).toFixed(0) + "%", rules));
  for (const r of results) console.log(row(`learned (${r.variant}) t=${r.threshold}`, (r.acc * 100).toFixed(0) + "%", r.sim));

  if (results.length === 0) { console.error("No variant could be trained."); process.exit(1); }
  // Best = cheapest among those meeting the quality target; tie-break on accuracy.
  results.sort((a, b) => a.sim.cost - b.sim.cost || b.acc - a.acc);
  const best = results[0];
  const st = fitStandardizer(best.X);
  const m = trainLR(best.X.map(x => applyStandardizer(x, st)), y, { l2: best.l2, epochs: 600, lr: 0.1 });
  const model: RouterModel = {
    version: 1,
    trainedAt: new Date().toISOString(),
    runId,
    variant: best.variant,
    mean: st.mean, std: st.std,
    weights: m.weights, bias: m.bias,
    threshold: best.threshold,
    metrics: {
      items: items.length,
      cvAccuracy: best.acc,
      rulesAccuracy: accuracy(rulesPred, y),
      simulated: { learned: best.sim, rules, allFlagship: allFlag, allNano },
      tolerance: opts.tolerance,
    },
  };
  mkdirSync(join(homedir(), ".sway"), { recursive: true });
  writeFileSync(ROUTER_PATH, JSON.stringify(model, null, 2));
  _model = model;
  console.log(`\nSaved ${best.variant} model (threshold ${best.threshold}) to ${ROUTER_PATH}`);
  if (best.variant === "hand") {
    console.log("Top hand-feature weights:");
    HAND_FEATURES.map((n, i) => [n, m.weights[i]] as const)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .forEach(([n, w]) => console.log(`  ${n.padEnd(18)} ${w >= 0 ? "+" : ""}${w.toFixed(3)}`));
  }
}
