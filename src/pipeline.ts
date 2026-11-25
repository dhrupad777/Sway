// v0.2 — the single Sway request pipeline, shared by `ask`, `eval` and `proxy`.
//
//   context (full | retrieve) → optimizer → semantic cache → router (rules | learned)
//   → provider call (stream or not) → escalation → record
//
// Every stage can be switched off, so each mechanism can be measured on its own.
import { complete, stream, type Message, type CompleteResult } from "./providers.js";
import { costUsd, DEFAULTS, PRICING, TOKEN_BUDGET, EMBED_PRICE_PER_M } from "./pricing.js";
import { loadContext, selectContext } from "./context.js";
import { optimize } from "./optimizer.js";
import { classify } from "./router.js";
import { routeLearned } from "./learned-router.js";
import { embed } from "./embeddings.js";
import { semLookup, semStore, DEFAULT_SIM_THRESHOLD } from "./semcache.js";
import { record } from "./metrics.js";

export interface PipelineOptions {
  context: "off" | "full" | "retrieve";
  contextPath?: string;
  optimize: boolean;
  router: "off" | "rules" | "learned";
  /** Force a model; skips routing and escalation. */
  model?: string;
  semanticCache: boolean;
  simThreshold?: number;
  /** Isolates cache entries (eval runs use a fresh namespace so earlier runs can't leak in). */
  cacheNamespace?: string;
  /** Retry on flagship if the nano answer looks weak (non-streaming only). */
  escalate: boolean;
  /** Use intent-aware output caps (TOKEN_BUDGET) when the optimizer classified the prompt. */
  tokenBudget: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Earlier turns of a conversation (proxy). Disables the semantic cache. */
  history?: Message[];
  /** Caller-supplied system text (proxy), added after sway.md. */
  extraSystem?: string;
  session: string;
  project?: string;
  onToken?: (t: string) => void;
  record?: boolean;
}

export interface PipelineResult {
  text: string;
  model: string;
  provider: string;
  tier: "nano" | "flagship" | "forced";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  /** Time spent inside Sway itself (excludes LLM, optimizer and embedding API calls). */
  overheadMs: number;
  cacheHit: boolean;
  cacheSimilarity: number | null;
  escalated: boolean;
  escalationReason: string | null;
  intent: string | null;
  optimizedPrompt: string | null;
  routeSignals: string[];
  routeProb: number | null;
  contextHash: string | null;
  contextTokensFull: number;
  contextTokensSent: number;
  contextDropped: string[];
}

const HEDGE = /^(\s*)(i'?m not sure|i do not know|i don'?t know|i cannot (answer|help)|i can'?t (answer|help)|as an ai)/i;

export function weakAnswer(res: CompleteResult, maxTokens: number): string | null {
  if (!res.text.trim()) return "empty";
  if (res.outputTokens >= maxTokens * 0.98) return "truncated";
  if (HEDGE.test(res.text)) return "hedged";
  return null;
}

export async function runPipeline(prompt: string, o: PipelineOptions): Promise<PipelineResult> {
  const t0 = Date.now();
  let externalMs = 0; // time waiting on remote APIs
  let extraCost = 0;  // optimizer + embeddings + failed first attempt
  let extraIn = 0, extraOut = 0;
  const timed = async <T>(p: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    try { return await p(); } finally { externalMs += Date.now() - s; }
  };

  // 1. Context
  const ctx = o.context === "off" ? null : loadContext(o.contextPath);
  let ctxText = ctx?.text ?? null;
  let ctxFull = ctx ? Math.ceil(ctx.text.length / 4) : 0;
  let ctxSent = ctxFull;
  let dropped: string[] = [];
  if (ctx && o.context === "retrieve") {
    try {
      const sel = await timed(() => selectContext(ctx, prompt));
      ctxText = sel.text; ctxFull = sel.fullTokens; ctxSent = sel.sentTokens; dropped = sel.dropped;
    } catch { /* fall back to full context */ }
  }

  // 2. Optimizer
  let finalPrompt = prompt;
  let intent: string | null = null;
  let optimizedPrompt: string | null = null;
  if (o.optimize) {
    const opt = await timed(() => optimize(prompt));
    extraCost += costUsd(DEFAULTS.optimizer, opt.optimizerInputTokens, opt.optimizerOutputTokens);
    extraIn += opt.optimizerInputTokens; extraOut += opt.optimizerOutputTokens;
    if (!opt.fallback) { finalPrompt = opt.optimizedPrompt; optimizedPrompt = opt.optimizedPrompt; intent = opt.intent; }
  }

  // 3. Routing
  let model: string;
  let tier: PipelineResult["tier"];
  let signals: string[] = [];
  let prob: number | null = null;
  if (o.model) {
    model = o.model; tier = "forced";
  } else if (o.router === "rules") {
    const d = classify(finalPrompt);
    model = d.model; tier = d.tier; signals = d.signals;
  } else if (o.router === "learned") {
    const d = await timed(() => routeLearned(prompt));
    model = d.model; tier = d.tier; signals = d.learned ? d.signals : ["no model trained: rules fallback", ...d.signals];
    prob = d.learned ? d.prob : null;
  } else {
    model = DEFAULTS.flagship; tier = "flagship";
  }
  if (!PRICING[model]) throw new Error(`Unknown model: ${model}. Try \`sway models\`.`);

  const maxTokens = o.tokenBudget && intent ? (TOKEN_BUDGET[intent] ?? 1200) : (o.maxTokens ?? 2048);
  const useCache = o.semanticCache && !(o.history && o.history.length);
  const scope = `${o.cacheNamespace ?? "default"}|${o.model ?? `auto:${o.router}`}`;

  const finish = (r: {
    text: string; model: string; provider: string; inTok: number; outTok: number; cost: number;
    cacheHit: boolean; sim: number | null; escalated: boolean; escReason: string | null;
  }): PipelineResult => {
    const latencyMs = Date.now() - t0;
    const result: PipelineResult = {
      text: r.text, model: r.model, provider: r.provider, tier,
      inputTokens: r.inTok, outputTokens: r.outTok, costUsd: r.cost,
      latencyMs, overheadMs: Math.max(0, latencyMs - externalMs),
      cacheHit: r.cacheHit, cacheSimilarity: r.sim,
      escalated: r.escalated, escalationReason: r.escReason,
      intent, optimizedPrompt, routeSignals: signals, routeProb: prob,
      contextHash: ctx?.hash ?? null, contextTokensFull: ctxFull, contextTokensSent: ctxSent, contextDropped: dropped,
    };
    if (o.record !== false) {
      record({
        rawPrompt: prompt, optimizedPrompt, responseText: r.text, model: r.model, provider: r.provider,
        inputTokens: r.inTok, outputTokens: r.outTok, costUsd: r.cost,
        optimized: optimizedPrompt !== null, routed: tier !== "forced" && o.router !== "off",
        routeTier: tier === "forced" ? null : tier, contextHash: ctx?.hash ?? null,
        latencyMs, session: o.session, cacheHit: r.cacheHit, cacheReadTokens: 0, cacheCreationTokens: 0,
        tokenBudget: maxTokens, escalated: r.escalated, cacheSimilarity: r.sim, routeProb: prob, project: o.project ?? null,
      });
    }
    return result;
  };

  // 4. Semantic cache
  let vec: Float32Array | null = null;
  let bestSim: number | null = null;
  if (useCache) {
    try {
      vec = await timed(() => embed(prompt));
      extraCost += (Math.ceil(prompt.length / 4) * EMBED_PRICE_PER_M) / 1_000_000;
      const hit = semLookup(vec, scope, ctx?.hash ?? null, o.simThreshold ?? DEFAULT_SIM_THRESHOLD);
      if (hit.hit) {
        o.onToken?.(hit.entry.response);
        return finish({
          text: hit.entry.response, model: hit.entry.model, provider: hit.entry.provider,
          inTok: extraIn, outTok: extraOut, cost: extraCost, cacheHit: true, sim: hit.similarity,
          escalated: false, escReason: null,
        });
      }
      bestSim = hit.bestSimilarity;
    } catch { vec = null; /* cache is best-effort */ }
  }

  // 5. Provider call
  const system = [ctxText, o.extraSystem].filter((s): s is string => !!s && !!s.trim()).join("\n\n");
  const messages: Message[] = [];
  if (system) messages.push({ role: "system", content: system });
  if (o.history) messages.push(...o.history);
  messages.push({ role: "user", content: finalPrompt });
  const args = { model, messages, maxTokens, temperature: o.temperature };
  let res = await timed(() => (o.onToken ? stream(args, o.onToken) : complete(args)));

  // 6. Escalation
  let escalated = false;
  let escReason: string | null = null;
  if (o.escalate && !o.onToken && tier === "nano") {
    escReason = weakAnswer(res, maxTokens);
    if (escReason) {
      extraCost += costUsd(res.model, res.inputTokens, res.outputTokens);
      extraIn += res.inputTokens; extraOut += res.outputTokens;
      res = await timed(() => complete({ ...args, model: DEFAULTS.flagship }));
      escalated = true;
      signals = [...signals, `escalated:${escReason}`];
    }
  }

  const cost = costUsd(res.model, res.inputTokens, res.outputTokens, { cacheReadTokens: res.cacheReadTokens }) + extraCost;
  if (useCache && vec && res.text.trim()) {
    semStore(vec, scope, ctx?.hash ?? null, {
      prompt, response: res.text, model: res.model, provider: res.provider,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
    });
  }
  return finish({
    text: res.text, model: res.model, provider: res.provider,
    inTok: res.inputTokens + extraIn, outTok: res.outputTokens + extraOut, cost,
    cacheHit: false, sim: bestSim, escalated, escReason,
  });
}
