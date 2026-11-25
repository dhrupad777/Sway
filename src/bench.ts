import { readFileSync } from "node:fs";
import { complete, type Message } from "./providers.js";
import { costUsd, DEFAULTS, TOKEN_BUDGET } from "./pricing.js";
import { optimize } from "./optimizer.js";
import { loadContext } from "./context.js";
import { record, newSessionId } from "./metrics.js";
import { responseCache } from "./cache.js";

interface Workload {
  name: string;
  description?: string;
  prompts: string[];
}

interface RunStats {
  label: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  ms: number;
  cacheHits: number;
}

function blank(label: string): RunStats {
  return { label, count: 0, inputTokens: 0, outputTokens: 0, cost: 0, ms: 0, cacheHits: 0 };
}

async function runOne(opts: {
  prompt: string;
  systemContext: string | null;
  contextHash: string | null;
  useOptimizer: boolean;
  tokenBudget: number;
  session: string;
}): Promise<{ inputTokens: number; outputTokens: number; cost: number; ms: number; cacheHit: boolean }> {
  const t0 = Date.now();

  let optimizedPrompt: string | null = null;
  let optExtraIn = 0, optExtraOut = 0;
  let intent = "other";
  if (opts.useOptimizer) {
    const o = await optimize(opts.prompt);
    if (!o.fallback) {
      optimizedPrompt = o.optimizedPrompt;
      intent = o.intent;
    }
    optExtraIn = o.optimizerInputTokens;
    optExtraOut = o.optimizerOutputTokens;
  }

  // Apply intent-aware token budget (overrides the caller's default).
  const effectiveBudget = opts.useOptimizer
    ? (TOKEN_BUDGET[intent] ?? 1200)
    : opts.tokenBudget;

  const finalUserPrompt = optimizedPrompt ?? opts.prompt;

  // Check response cache (only active in sway mode via useOptimizer flag)
  if (opts.useOptimizer) {
    const cached = responseCache.get(finalUserPrompt);
    if (cached.hit) {
      const ms = Date.now() - t0;
      const optCost = costUsd(DEFAULTS.optimizer, optExtraIn, optExtraOut);
      record({
        rawPrompt: opts.prompt,
        optimizedPrompt,
        responseText: cached.entry.text,
        model: cached.entry.model,
        provider: cached.entry.provider,
        inputTokens: optExtraIn,
        outputTokens: optExtraOut,
        costUsd: optCost,
        optimized: true,
        routed: false,
        routeTier: null,
        contextHash: opts.contextHash,
        latencyMs: ms,
        session: opts.session,
        cacheHit: true,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        tokenBudget: null,
      });
      return { inputTokens: optExtraIn, outputTokens: optExtraOut, cost: optCost, ms, cacheHit: true };
    }
  }

  const systemParts: string[] = [];
  if (opts.useOptimizer) {
    systemParts.push("Be concise and specific. Answer exactly what is asked — nothing more. Do not add background context, caveats, disclaimers, or tangential details. If the user wants more depth on any part, they will ask a follow-up.");
  }
  if (opts.systemContext) systemParts.push(opts.systemContext);
  const messages: Message[] = [];
  if (systemParts.length > 0) messages.push({ role: "system", content: systemParts.join("\n\n") });
  messages.push({ role: "user", content: finalUserPrompt });

  const res = await complete({ model: DEFAULTS.flagship, messages, maxTokens: effectiveBudget });
  const ms = Date.now() - t0;
  const callCost = costUsd(res.model, res.inputTokens, res.outputTokens, { cacheReadTokens: res.cacheReadTokens });
  const optCost = costUsd(DEFAULTS.optimizer, optExtraIn, optExtraOut);

  if (opts.useOptimizer) {
    responseCache.set(finalUserPrompt, {
      text: res.text,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      model: res.model,
      provider: res.provider,
    });
  }

  record({
    rawPrompt: opts.prompt,
    optimizedPrompt,
    responseText: res.text,
    model: res.model,
    provider: res.provider,
    inputTokens: res.inputTokens + optExtraIn,
    outputTokens: res.outputTokens + optExtraOut,
    costUsd: callCost + optCost,
    optimized: opts.useOptimizer,
    routed: false,
    routeTier: null,
    contextHash: opts.contextHash,
    latencyMs: ms,
    session: opts.session,
    cacheHit: false,
    cacheReadTokens: res.cacheReadTokens,
    cacheCreationTokens: res.cacheCreationTokens,
    tokenBudget: opts.useOptimizer ? effectiveBudget : null,
  });

  return {
    inputTokens: res.inputTokens + optExtraIn,
    outputTokens: res.outputTokens + optExtraOut,
    cost: callCost + optCost,
    ms,
    cacheHit: false,
  };
}

async function runWorkload(workload: Workload, mode: "raw" | "sway", session: string): Promise<RunStats> {
  const ctx = mode === "sway" ? loadContext() : null;
  const stats = blank(mode === "raw" ? `Raw API  (${DEFAULTS.flagship}, maxTokens=4096)` : `Sway     (${DEFAULTS.flagship}, optimizer + token budget + response cache)`);

  let consecutiveErrors = 0;
  let lastError: Error | null = null;
  for (const prompt of workload.prompts) {
    try {
      // For sway mode we apply token budget after optimization; for raw always 4096.
      // We pass 4096 here for raw, and let runOne pick the budget for sway.
      // runOne always calls optimize() when useOptimizer=true, which gives us the intent.
      // We use TOKEN_BUDGET with a default of 1200 when not sway.
      const tokenBudget = mode === "sway" ? 1200 : 4096;  // runOne overrides this via optimizer
      const r = await runOne({
        prompt,
        systemContext: ctx?.text ?? null,
        contextHash: ctx?.hash ?? null,
        useOptimizer: mode === "sway",
        tokenBudget,
        session,
      });
      stats.count += 1;
      stats.inputTokens += r.inputTokens;
      stats.outputTokens += r.outputTokens;
      stats.cost += r.cost;
      stats.ms += r.ms;
      if (r.cacheHit) stats.cacheHits += 1;
      consecutiveErrors = 0;
      process.stderr.write(r.cacheHit ? "C" : ".");
    } catch (e) {
      consecutiveErrors += 1;
      lastError = e as Error;
      process.stderr.write("x");
      if (consecutiveErrors >= 3) {
        process.stderr.write("\n");
        throw new Error(`Aborting bench: ${consecutiveErrors} consecutive errors. Last: ${lastError.message}`);
      }
    }
  }
  process.stderr.write("\n");
  return stats;
}

function pct(numer: number, denom: number): string {
  if (denom === 0) return "n/a";
  return `${(((denom - numer) / denom) * 100).toFixed(1)}%`;
}

function fmt$(n: number): string {
  return `$${n.toFixed(4)}`;
}

function table(raw: RunStats, sway: RunStats): string {
  const rows = [
    ["", "Raw API", "Sway", "Savings"],
    ["Total cost", fmt$(raw.cost), fmt$(sway.cost), pct(sway.cost, raw.cost)],
    ["Input tokens", String(raw.inputTokens), String(sway.inputTokens), pct(sway.inputTokens, raw.inputTokens)],
    ["Output tokens", String(raw.outputTokens), String(sway.outputTokens), pct(sway.outputTokens, raw.outputTokens)],
    ["Calls", String(raw.count), String(sway.count), ""],
    ["Cache hits", "0", String(sway.cacheHits), sway.count > 0 ? `${((sway.cacheHits / sway.count) * 100).toFixed(0)}% hit rate` : ""],
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  return rows.map((r, ri) => {
    const line = r.map((c, i) => c.padEnd(widths[i])).join("  ");
    return ri === 0 ? line + "\n" + widths.map(w => "-".repeat(w)).join("  ") : line;
  }).join("\n");
}

export async function bench(workloadPath: string): Promise<void> {
  const wl = JSON.parse(readFileSync(workloadPath, "utf8")) as Workload;
  console.log(`Workload: ${wl.name} — ${wl.prompts.length} prompts`);
  console.log(`Both runs use ${DEFAULTS.flagship}. Sway savings come from optimizer + token budget + response cache.`);
  console.log(`Estimated API calls: ${wl.prompts.length * 2} + optimizer calls`);
  console.log(`Legend: . = API call   C = cache hit (free)`);
  console.log("");

  const sessionRaw = newSessionId();
  const sessionSway = newSessionId();

  console.log("[1/2] Running RAW (flagship model, no optimization, maxTokens=4096)...");
  const raw = await runWorkload(wl, "raw", sessionRaw);

  console.log("[2/2] Running SWAY (same model, optimizer + token budget + response cache)...");
  const sway = await runWorkload(wl, "sway", sessionSway);

  console.log("");
  console.log(table(raw, sway));
  console.log("");
  console.log(`Mechanism breakdown:`);
  console.log(`  Response cache : ${sway.cacheHits}/${sway.count} hits (${sway.count > 0 ? ((sway.cacheHits / sway.count) * 100).toFixed(0) : 0}% — each hit costs $0.00000)`);
  console.log(`  Token budget   : QA/explain=${TOKEN_BUDGET.qa}, code/refactor=${TOKEN_BUDGET.code}, other=${TOKEN_BUDGET.other} (raw used 4096)`);
  console.log(`  Provider cache : active for Gemini/Anthropic providers (see cache_read_tokens in DB)`);
  console.log(`\nSession IDs (for \`sway compare\`):`);
  console.log(`  raw:  ${sessionRaw}`);
  console.log(`  sway: ${sessionSway}`);
  console.log(`\nNext: \`sway compare ${sessionRaw} ${sessionSway}\` to see outputs side-by-side.`);
}
