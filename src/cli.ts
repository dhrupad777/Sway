#!/usr/bin/env node
import { loadEnv } from "./env.js";
loadEnv();
import { Command } from "commander";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { complete, type Message } from "./providers.js";
import { costUsd, DEFAULTS, PRICING } from "./pricing.js";
import { loadContext, STARTER_SWAY_MD } from "./context.js";
import { record, recent, summary } from "./metrics.js";
import { optimize } from "./optimizer.js";
import { classify } from "./router.js";
import { bench } from "./bench.js";
import { probe } from "./probe.js";
import { compare, listSessions } from "./compare.js";
import { serve } from "./server.js";

const program = new Command();

program
  .name("sway")
  .description("Cut LLM costs from your terminal: context.md + structured prompts + smart routing")
  .version("0.1.0");

interface AskOpts {
  model?: string;
  optimize: boolean;
  route: boolean;
  context: boolean | string;
  maxTokens: string;
  verbose?: boolean;
}

async function runAsk(prompt: string, opts: AskOpts): Promise<void> {
    const useContext = opts.context !== false;
    const ctxPath = typeof opts.context === "string" ? opts.context : undefined;
    const ctx = useContext ? loadContext(ctxPath) : null;

    let optimizedPrompt: string | null = null;
    let optInTok = 0, optOutTok = 0, optMs = 0;
    if (opts.optimize) {
      const o = await optimize(prompt);
      optimizedPrompt = o.fallback ? null : o.optimizedPrompt;
      optInTok = o.optimizerInputTokens;
      optOutTok = o.optimizerOutputTokens;
      optMs = o.optimizerMs;
      if (opts.verbose) {
        process.stderr.write(`\x1b[2m[optimizer] intent=${o.intent} ms=${o.optimizerMs} fallback=${o.fallback}\x1b[0m\n`);
      }
    }

    const finalPrompt = optimizedPrompt ?? prompt;
    let model = opts.model;
    let routed = false;
    let routeTier: "nano" | "flagship" | null = null;
    if (!model && opts.route) {
      const d = classify(finalPrompt);
      model = d.model;
      routed = true;
      routeTier = d.tier;
      if (opts.verbose) {
        process.stderr.write(`\x1b[2m[router] tier=${d.tier} score=${d.score} model=${d.model} signals=[${d.signals.join("|")}]\x1b[0m\n`);
      }
    }
    if (!model) model = DEFAULTS.flagship;
    if (!PRICING[model]) {
      console.error(`Unknown model: ${model}. Try \`sway models\`.`);
      process.exit(1);
    }

    const messages: Message[] = [];
    if (ctx) messages.push({ role: "system", content: ctx.text });
    messages.push({ role: "user", content: finalPrompt });

    const t0 = Date.now();
    const res = await complete({ model, messages, maxTokens: parseInt(opts.maxTokens, 10) });
    const ms = Date.now() - t0;
    const mainCost = costUsd(res.model, res.inputTokens, res.outputTokens);
    const optCost = costUsd(DEFAULTS.optimizer, optInTok, optOutTok);
    const totalCost = mainCost + optCost;

    process.stdout.write(res.text);
    if (!res.text.endsWith("\n")) process.stdout.write("\n");

    record({
      rawPrompt: prompt,
      optimizedPrompt,
      responseText: res.text,
      model: res.model,
      provider: res.provider,
      inputTokens: res.inputTokens + optInTok,
      outputTokens: res.outputTokens + optOutTok,
      costUsd: totalCost,
      optimized: opts.optimize && optimizedPrompt !== null,
      routed,
      routeTier,
      contextHash: ctx?.hash ?? null,
      latencyMs: ms + optMs,
      session: "ask",
    });

    const ctxNote = ctx ? ` ctx=${ctx.hash}(${ctx.bytes}B)` : "";
    const routeNote = routed ? ` route=${routeTier}` : "";
    const optNote = opts.optimize ? ` opt=${optimizedPrompt ? "on" : "fallback"}` : "";
    process.stderr.write(
      `\n\x1b[2m[sway] model=${res.model} in=${res.inputTokens + optInTok} out=${res.outputTokens + optOutTok} cost=$${totalCost.toFixed(6)} ${ms + optMs}ms${ctxNote}${routeNote}${optNote}\x1b[0m\n`
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
    await bench(workload);
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
