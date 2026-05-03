import { writeFileSync } from "node:fs";
import { bySession, recentSessions, type StatsRow } from "./metrics.js";

function pairBy(rows: StatsRow[], key: (r: StatsRow) => string): Map<string, StatsRow> {
  const m = new Map<string, StatsRow>();
  for (const r of rows) m.set(key(r), r);
  return m;
}

function trim(s: string | null, n: number): string {
  if (!s) return "(no response)";
  const single = s.replace(/\r/g, "");
  return single.length <= n ? single : single.slice(0, n) + "…";
}

function header(text: string, color: string): string {
  return `\x1b[${color}m━━━ ${text} ━━━\x1b[0m`;
}

export interface CompareOpts {
  rawSession: string;
  swaySession: string;
  limit?: number;
  full?: boolean;
  out?: string;
}

export function compare(opts: CompareOpts): void {
  const rawRows = bySession(opts.rawSession);
  const swayRows = bySession(opts.swaySession);
  if (rawRows.length === 0) { console.error(`No rows for session ${opts.rawSession}`); process.exit(1); }
  if (swayRows.length === 0) { console.error(`No rows for session ${opts.swaySession}`); process.exit(1); }

  const swayByPrompt = pairBy(swayRows, r => r.raw_prompt);
  const limit = opts.limit ?? rawRows.length;
  const previewLen = opts.full ? Number.MAX_SAFE_INTEGER : 800;

  const blocks: string[] = [];
  let shown = 0;
  for (const raw of rawRows) {
    if (shown >= limit) break;
    const sway = swayByPrompt.get(raw.raw_prompt);
    if (!sway) continue;
    shown += 1;

    const lines: string[] = [];
    lines.push(`\n${header(`#${shown}  ${trim(raw.raw_prompt, 100)}`, "1;36")}`);
    lines.push(`Raw:  model=${raw.model.padEnd(45)} in=${String(raw.input_tokens).padStart(5)} out=${String(raw.output_tokens).padStart(4)} cost=$${raw.cost_usd.toFixed(5)}`);
    lines.push(`Sway: model=${sway.model.padEnd(45)} in=${String(sway.input_tokens).padStart(5)} out=${String(sway.output_tokens).padStart(4)} cost=$${sway.cost_usd.toFixed(5)}  tier=${sway.route_tier ?? "-"}  optimized=${sway.optimized ? "Y" : "n"}`);
    if (sway.optimized_prompt) {
      lines.push(`\n\x1b[2mOptimized prompt:\x1b[0m ${trim(sway.optimized_prompt, 300)}`);
    }
    lines.push(`\n\x1b[33m── Raw response ──\x1b[0m`);
    lines.push(trim(raw.response_text, previewLen));
    lines.push(`\n\x1b[32m── Sway response ──\x1b[0m`);
    lines.push(trim(sway.response_text, previewLen));
    blocks.push(lines.join("\n"));
  }

  const out = blocks.join("\n");
  if (opts.out) {
    // Strip ANSI codes for file output
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    writeFileSync(opts.out, `# sway compare\n\nraw session: ${opts.rawSession}\nsway session: ${opts.swaySession}\n\n${plain}\n`, "utf8");
    console.log(`Wrote ${opts.out} (${shown} pairs)`);
  } else {
    console.log(out);
    console.log(`\n${shown} pairs shown. Use --full for untrimmed output, --out file.md to save.`);
  }
}

export function listSessions(): void {
  const s = recentSessions(20);
  if (s.length === 0) {
    console.log("No bench sessions found. Run `sway bench` first.");
    return;
  }
  console.log("Recent bench sessions:");
  for (const r of s) {
    console.log(`  ${new Date(r.first_ts).toISOString().slice(0, 19)}  ${r.session.padEnd(20)}  count=${r.count}  cost=$${(r.cost ?? 0).toFixed(4)}`);
  }
}
