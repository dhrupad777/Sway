#!/usr/bin/env node
import { loadEnv } from "./env.js";
loadEnv();
import { Command } from "commander";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PRICING } from "./pricing.js";
import { STARTER_SWAY_MD } from "./context.js";
import { recent, summary } from "./metrics.js";
import { runPipeline } from "./pipeline.js";
import { runEval, showEval, CONFIGS, bundled } from "./eval.js";
import { evalRuns } from "./evalstore.js";
import { trainRouter } from "./learned-router.js";
import { cacheEval, semClear } from "./semcache.js";
import { startProxy } from "./proxy.js";
import { bench } from "./bench.js";
import { probe } from "./probe.js";
import { compare, listSessions } from "./compare.js";
import { serve } from "./server.js";

const program = new Command();

program
  .name("sway")
  .description("Cut LLM costs from your terminal: context.md + structured prompts + smart routing")
  .version("0.2.0");

interface AskOpts {
  model?: string;
  optimize: boolean;
  route: boolean;
  context: boolean | string;
  maxTokens: string;
  verbose?: boolean;
  // v0.2
  router?: string;
  contextMode?: string;
  cache?: boolean;
  sim?: string;
  escalate?: boolean;
}

async function runAsk(prompt: string, opts: AskOpts): Promise<void> {
    const ctxMode = opts.context === false ? "off" : (opts.contextMode === "retrieve" ? "retrieve" : "full");
    const router = !opts.route ? "off" : (opts.router === "rules" ? "rules" : "learned");
    if (opts.model && !PRICING[opts.model]) {
      console.error(`Unknown model: ${opts.model}. Try \`sway models\`.`);
      process.exit(1);
    }
    const r = await runPipeline(prompt, {
      context: ctxMode,
      contextPath: typeof opts.context === "string" ? opts.context : undefined,
      optimize: opts.optimize,
      router,
      model: opts.model,
      semanticCache: opts.cache !== false,
      simThreshold: opts.sim ? parseFloat(opts.sim) : undefined,
      escalate: opts.escalate !== false,
      tokenBudget: false,
      maxTokens: parseInt(opts.maxTokens, 10),
      session: "ask",
    });

    if (opts.verbose) {
      const dim = (t: string) => process.stderr.write(`\x1b[2m${t}\x1b[0m\n`);
      if (r.intent) dim(`[optimizer] intent=${r.intent}`);
      if (r.contextHash) dim(`[context] mode=${ctxMode} tokens sent=${r.contextTokensSent}/${r.contextTokensFull}${r.contextDropped.length ? ` dropped=[${r.contextDropped.join("|")}]` : ""}`);
      dim(`[cache] ${r.cacheHit ? "HIT" : "miss"}${r.cacheSimilarity != null ? ` similarity=${r.cacheSimilarity.toFixed(3)}` : ""}`);
      dim(`[router] mode=${router} tier=${r.tier} signals=[${r.routeSignals.join("|")}]`);
      if (r.escalated) dim(`[escalation] nano answer ${r.escalationReason} -> retried on flagship`);
    }

    process.stdout.write(r.text);
    if (!r.text.endsWith("\n")) process.stdout.write("\n");

    const ctxNote = r.contextHash ? ` ctx=${r.contextHash}(${r.contextTokensSent}tok)` : "";
    const routeNote = r.tier !== "forced" ? ` route=${r.tier}` : "";
    const optNote = opts.optimize ? ` opt=${r.optimizedPrompt ? "on" : "fallback"}` : "";
    const cacheNote = r.cacheHit ? ` cache=HIT(${r.cacheSimilarity?.toFixed(3)})` : "";
    const escNote = r.escalated ? " escalated" : "";
    process.stderr.write(
      `\n\x1b[2m[sway] model=${r.model} in=${r.inputTokens} out=${r.outputTokens} cost=$${r.costUsd.toFixed(6)} ${r.latencyMs}ms${ctxNote}${routeNote}${optNote}${cacheNote}${escNote}\x1b[0m\n`
    );
}

program
  .command("ask")
  .description("Send a prompt through Sway")
  .argument("<prompt>", "the user prompt")
  .option("-m, --model <model>", "force a specific model (skips routing)")
  .option("--no-optimize", "skip the prompt optimizer (Mechanism 2)")
  .option("--no-route", "skip the model router (Mechanism 3)")
  .option("--no-context", "skip context.md auto-injection (Mechanism 1)")
  .option("--context <path>", "explicit context.md path")
  .option("--max-tokens <n>", "max output tokens", "2048")
  .option("--verbose", "print mechanism details to stderr")
  .option("--router <mode>", "rules | learned (learned falls back to rules if untrained)", "learned")
  .option("--context-mode <mode>", "full | retrieve (only relevant sway.md sections)", "full")
  .option("--no-cache", "skip the semantic cache")
  .option("--sim <threshold>", "semantic cache similarity threshold (default 0.92)")
  .option("--no-escalate", "don't retry weak nano answers on the flagship")
  .action(runAsk);

program
  .command("init")
  .description("Create a starter sway.md in the current directory")
  .option("--force", "overwrite if exists")
  .action((opts: { force?: boolean }) => {
    const p = resolve(process.cwd(), "sway.md");
    if (existsSync(p) && !opts.force) {
      console.error(`sway.md already exists at ${p}. Pass --force to overwrite.`);
      process.exit(1);
    }
    writeFileSync(p, STARTER_SWAY_MD, "utf8");
    console.log(`Wrote ${p}`);
  });

program
  .command("stats")
  .description("Show recent calls and totals")
  .option("-n, --limit <n>", "rows to show", "20")
  .option("--verbose", "include raw and optimized prompts")
  .action((opts: { limit: string; verbose?: boolean }) => {
    const rows = recent(parseInt(opts.limit, 10));
    if (rows.length === 0) {
      console.log("No calls yet. Run `sway ask \"...\"` first.");
      return;
    }
    const s = summary();
    console.log(`Total: ${s.count} calls  cost=$${s.totalCost.toFixed(4)}  in=${s.totalIn}  out=${s.totalOut}`);
    console.log(`Routing: nano=${s.routedNano}  flagship=${s.routedFlagship}`);
    console.log("");
    for (const r of rows.reverse()) {
      const when = new Date(r.ts).toISOString().slice(11, 19);
      const tier = r.route_tier ?? "-";
      const opt = r.optimized ? "Y" : "n";
      const ctx = r.context_hash ? r.context_hash.slice(0, 6) : "-";
      const preview = r.raw_prompt.replace(/\s+/g, " ").slice(0, 60);
      console.log(`${when} ${r.model.padEnd(22)} tier=${tier.padEnd(8)} opt=${opt} ctx=${ctx} in=${String(r.input_tokens).padStart(5)} out=${String(r.output_tokens).padStart(4)} $${r.cost_usd.toFixed(5)}  ${preview}`);
      if (opts.verbose && r.optimized_prompt) {
        console.log(`  └─ optimized: ${r.optimized_prompt.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
  });

program
  .command("models")
  .description("List known models and prices")
  .action(() => {
    for (const [name, p] of Object.entries(PRICING)) {
      console.log(`${name.padEnd(24)} ${p.tier.padEnd(9)} in=$${p.input}/M  out=$${p.output}/M  (${p.provider})`);
    }
  });

program
  .command("bench")
  .description("Run a workload twice (raw vs sway) and print savings table")
  .argument("[workload]", "path to workload JSON", "workloads/default.json")
  .action(async (workload: string) => {
    await bench(bundled(workload));
  });

program
  .command("probe")
  .description("Probe Bedrock with several candidate model IDs to find which work for your account")
  .action(async () => {
    await probe();
  });

program
  .command("compare")
  .description("Show raw vs sway responses side-by-side for two bench sessions")
  .argument("[rawSession]", "raw session id (omit to list sessions)")
  .argument("[swaySession]", "sway session id")
  .option("-n, --limit <n>", "max pairs to show", "5")
  .option("--full", "untrimmed output (long)")
  .option("-o, --out <path>", "write to a markdown file instead of stdout")
  .action((rawSession: string | undefined, swaySession: string | undefined, opts: { limit: string; full?: boolean; out?: string }) => {
    if (!rawSession || !swaySession) {
      listSessions();
      return;
    }
    compare({ rawSession, swaySession, limit: parseInt(opts.limit, 10), full: opts.full, out: opts.out });
  });

program
  .command("serve")
  .description("Launch a local dashboard at http://localhost:8787 to compare bench sessions visually")
  .option("-p, --port <n>", "port", "8787")
  .action((opts: { port: string }) => {
    serve(parseInt(opts.port, 10));
  });

// ---------- v0.2 commands ----------

program
  .command("eval")
  .description("Phase 1: run a dataset through several configs and grade every answer with an LLM judge")
  .argument("[dataset]", "path to eval dataset JSON", "evals/cs101_eval.json")
  .option("-c, --configs <list>", `comma-separated configs: ${Object.keys(CONFIGS).join(",")}`, "flagship,nano,sway-v01")
  .option("-n, --limit <n>", "only the first n items (quick smoke test)")
  .option("-j, --concurrency <n>", "items evaluated in parallel", "4")
  .option("--judge <model>", "judge model (default: flagship)")
  .option("--show <runId>", "re-print the results of an earlier run")
  .option("--list", "list recent eval runs")
  .action(async (dataset: string, opts: { configs: string; limit?: string; concurrency: string; judge?: string; show?: string; list?: boolean }) => {
    if (opts.list) {
      for (const r of evalRuns(20)) console.log(`${r.run_id}  ${new Date(r.ts).toISOString().slice(0, 16)}  ${r.dataset}  rows=${r.n}  configs=${r.configs}`);
      return;
    }
    if (opts.show) return showEval(opts.show);
    await runEval(bundled(dataset), {
      configs: opts.configs.split(",").map(c => c.trim()).filter(Boolean),
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      concurrency: parseInt(opts.concurrency, 10),
      judgeModel: opts.judge,
    });
  });

program
  .command("train-router")
  .description("Phase 2: train the learned router from an eval run that has flagship + nano configs")
  .option("--run <runId>", "eval run to learn from (default: latest suitable run)")
  .option("--tolerance <points>", "max quality drop vs all-flagship when picking the threshold", "0.3")
  .action(async (opts: { run?: string; tolerance: string }) => {
    await trainRouter({ runId: opts.run, tolerance: parseFloat(opts.tolerance) });
  });

program
  .command("cache-eval")
  .description("Phase 3: sweep semantic-cache thresholds over labelled prompt pairs")
  .argument("[pairs]", "path to pairs JSON", "evals/cache_pairs.json")
  .option("--max-false-hit <rate>", "acceptable false-hit rate when recommending a threshold", "0.05")
  .action(async (pairs: string, opts: { maxFalseHit: string }) => {
    await cacheEval(bundled(pairs), parseFloat(opts.maxFalseHit));
  });

program
  .command("cache-clear")
  .description("Delete all semantic cache entries")
  .action(() => { console.log(`Removed ${semClear()} cache entries.`); });

program
  .command("proxy")
  .description("Phase 4: OpenAI-compatible gateway at http://localhost:8788/v1")
  .option("-p, --port <n>", "port", "8788")
  .option("--budget <usd>", "daily spend limit per project (header x-sway-project)")
  .option("--router <mode>", "rules | learned", "learned")
  .option("--context-mode <mode>", "off | full | retrieve", "full")
  .option("--no-optimize", "don't rewrite prompts")
  .option("--no-cache", "disable the semantic cache")
  .option("--sim <threshold>", "semantic cache similarity threshold")
  .action((opts: { port: string; budget?: string; router: string; contextMode: string; optimize: boolean; cache: boolean; sim?: string }) => {
    startProxy({
      port: parseInt(opts.port, 10),
      budgetUsd: opts.budget ? parseFloat(opts.budget) : null,
      router: opts.router === "rules" ? "rules" : "learned",
      context: opts.contextMode === "off" ? "off" : opts.contextMode === "retrieve" ? "retrieve" : "full",
      optimize: opts.optimize,
      semanticCache: opts.cache,
      simThreshold: opts.sim ? parseFloat(opts.sim) : undefined,
    });
  });

program
  .command("demo")
  .description("Run one realistic, complex prompt through Sway with --verbose for live demos")
  .action(async () => {
    const complexPrompt = `i have this react component that i think rerenders too much can you help me figure out why and fix it also tell me if im using useEffect wrong here

\`\`\`jsx
function ProductList({ category }) {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState({ minPrice: 0, maxPrice: 1000 });

  useEffect(() => {
    fetch(\`/api/products?cat=\${category}\`)
      .then(r => r.json())
      .then(setProducts);
  });

  const visible = products.filter(p =>
    p.price >= filter.minPrice && p.price <= filter.maxPrice
  );

  return (
    <div>
      <input onChange={e => setFilter({ ...filter, minPrice: +e.target.value })} />
      {visible.map(p => <Product key={p.id} {...p} onClick={() => console.log(p)} />)}
    </div>
  );
}
\`\`\`

also explain what im doing wrong like im a junior dev`;
    await runAsk(complexPrompt, {
      optimize: true,
      route: true,
      context: true,
      maxTokens: "1024",
      verbose: true,
    });
  });

program.parseAsync().catch((err: Error) => {
  console.error(`\x1b[31m[sway] ${err.message}\x1b[0m`);
  process.exit(1);
});
