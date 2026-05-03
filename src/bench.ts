import { readFileSync } from "node:fs";
import { complete, type Message } from "./providers.js";
import { costUsd, DEFAULTS } from "./pricing.js";
import { optimize } from "./optimizer.js";
import { classify } from "./router.js";
import { loadContext } from "./context.js";
import { record, newSessionId } from "./metrics.js";

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
  routedNano: number;
  routedFlagship: number;
}

function blank(label: string): RunStats {
  return { label, count: 0, inputTokens: 0, outputTokens: 0, cost: 0, ms: 0, routedNano: 0, routedFlagship: 0 };
}

async function runOne(opts: {
  prompt: string;
  systemContext: string | null;
  contextHash: string | null;
  useOptimizer: boolean;
  useRouter: boolean;
  forceModel: string;
  session: string;
}): Promise<{ inputTokens: number; outputTokens: number; cost: number; ms: number; tier: "nano" | "flagship" | null }> {
  const t0 = Date.now();

  let optimizedPrompt: string | null = null;
  let optExtraIn = 0, optExtraOut = 0, optMs = 0;
  if (opts.useOptimizer) {
    const o = await optimize(opts.prompt);
    optimizedPrompt = o.fallback ? null : o.optimizedPrompt;
    optExtraIn = o.optimizerInputTokens;
    optExtraOut = o.optimizerOutputTokens;
    optMs = o.optimizerMs;
  }

  const finalUserPrompt = optimizedPrompt ?? opts.prompt;
  const decision = opts.useRouter ? classify(finalUserPrompt) : null;
  const model = decision ? decision.model : opts.forceModel;

  const messages: Message[] = [];
  if (opts.systemContext) messages.push({ role: "system", content: opts.systemContext });
  messages.push({ role: "user", content: finalUserPrompt });

  const res = await complete({ model, messages, maxTokens: 2048 });
  const ms = Date.now() - t0;
  const callCost = costUsd(res.model, res.inputTokens, res.outputTokens);
  // Optimizer cost (Gemini Flash) — cheap but counted honestly
  const optCost = costUsd(DEFAULTS.optimizer, optExtraIn, optExtraOut);

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
    routed: opts.useRouter,
    routeTier: decision?.tier ?? null,
    contextHash: opts.contextHash,
    latencyMs: ms,
    session: opts.session,
  });

  return {
    inputTokens: res.inputTokens + optExtraIn,
    outputTokens: res.outputTokens + optExtraOut,
    cost: callCost + optCost,
    ms,
    tier: decision?.tier ?? null,
  };
}

async function runWorkload(workload: Workload, mode: "raw" | "sway", session: string): Promise<RunStats> {
  const ctx = mode === "sway" ? loadContext() : null;
  const stats = blank(mode === "raw" ? "Raw API" : "Sway");

  let consecutiveErrors = 0;
  let lastError: Error | null = null;
  for (const prompt of workload.prompts) {
    try {
      const r = await runOne({
        prompt,
        systemContext: ctx?.text ?? null,
        contextHash: ctx?.hash ?? null,
        useOptimizer: mode === "sway",
        useRouter: mode === "sway",
        forceModel: DEFAULTS.flagship,
        session,
      });
      stats.count += 1;
      stats.inputTokens += r.inputTokens;
      stats.outputTokens += r.outputTokens;
      stats.cost += r.cost;
      stats.ms += r.ms;
      if (r.tier === "nano") stats.routedNano += 1;
      else if (r.tier === "flagship") stats.routedFlagship += 1;
      consecutiveErrors = 0;
      process.stderr.write(".");
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
  console.log(`Note: each prompt is sent twice (raw, then sway). Estimated API calls: ${wl.prompts.length * 2 + wl.prompts.length}`);
  console.log("");

  const sessionRaw = newSessionId();
  const sessionSway = newSessionId();

  console.log("[1/2] Running RAW (all flagship, no optimizer, no context)...");
  const raw = await runWorkload(wl, "raw", sessionRaw);

  console.log("[2/2] Running SWAY (context + optimizer + router)...");
  const sway = await runWorkload(wl, "sway", sessionSway);

  console.log("");
  console.log(table(raw, sway));
  console.log("");
  console.log(`Routing breakdown: nano=${sway.routedNano}/${sway.count} flagship=${sway.routedFlagship}/${sway.count}`);
  console.log(`\nSession IDs (for \`sway compare\`):`);
  console.log(`  raw:  ${sessionRaw}`);
  console.log(`  sway: ${sessionSway}`);
  console.log(`\nNext: \`sway compare ${sessionRaw} ${sessionSway}\` to see outputs side-by-side.`);
}
