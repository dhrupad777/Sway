import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface LoadedContext {
  text: string;
  hash: string;
  path: string;
  bytes: number;
}

export function loadContext(explicitPath?: string): LoadedContext | null {
  const candidates = explicitPath
    ? [explicitPath]
    : ["sway.md", "SWAY.md", ".sway.md"];

  for (const c of candidates) {
    const p = resolve(process.cwd(), c);
    if (existsSync(p)) {
      const text = readFileSync(p, "utf8");
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
      return { text, hash, path: p, bytes: Buffer.byteLength(text, "utf8") };
    }
  }
  return null;
}

export const STARTER_SWAY_MD = `# Project context

<!--
  Sway loads this file once and prepends it as a system message to every \`sway ask\`.
  Keep it tight: project description, conventions, vocabulary, key files.
  The shorter and more specific, the better the savings vs re-pasting context inline.
-->

## What I'm working on
(One paragraph: project, language, framework, domain.)

## Conventions
- (e.g., TypeScript strict mode)
- (e.g., functions over classes)

## Key files / vocabulary
- (e.g., \`src/providers.ts\` = LLM adapters)
`;

// ---------- Phase 5: context retrieval + history compression ----------

export interface ContextSection {
  heading: string; // "" for the preamble before the first "## "
  text: string;
}

/** Split markdown on level-2 headings. The preamble (title + intro) is section 0. */
export function splitSections(md: string): ContextSection[] {
  const out: ContextSection[] = [];
  let cur: ContextSection = { heading: "", text: "" };
  for (const line of md.split(/\r?\n/)) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (cur.text.trim()) out.push(cur);
      cur = { heading: m[1].trim(), text: line + "\n" };
    } else {
      cur.text += line + "\n";
    }
  }
  if (cur.text.trim()) out.push(cur);
  return out;
}

export interface SelectedContext {
  text: string;
  kept: string[];
  dropped: string[];
  fullTokens: number;
  sentTokens: number;
}

/**
 * Keep the preamble, then the sections most similar to the prompt.
 * Sections are kept if similarity >= minSim, always at least `minKeep` of them.
 * Embeddings are memoized, so after the first call this costs one prompt embedding.
 */
export async function selectContext(
  ctx: LoadedContext,
  prompt: string,
  opts: { minSim?: number; minKeep?: number } = {},
): Promise<SelectedContext> {
  const { embedMany, cosine } = await import("./embeddings.js");
  const minSim = opts.minSim ?? 0.55;
  const minKeep = opts.minKeep ?? 1;
  const tok = (s: string) => Math.ceil(s.length / 4);
  const secs = splitSections(ctx.text);
  const preamble = secs[0]?.heading === "" ? secs.shift()! : null;
  if (secs.length <= minKeep) {
    return { text: ctx.text, kept: secs.map(s => s.heading), dropped: [], fullTokens: tok(ctx.text), sentTokens: tok(ctx.text) };
  }
  const vecs = await embedMany([prompt, ...secs.map(s => s.text)]);
  const scored = secs.map((s, i) => ({ s, sim: cosine(vecs[0], vecs[i + 1]), i }))
    .sort((a, b) => b.sim - a.sim);
  const keep = new Set(scored.filter((x, rank) => rank < minKeep || x.sim >= minSim).map(x => x.i));
  const keptSecs = secs.filter((_, i) => keep.has(i)); // original order
  const text = [preamble?.text ?? "", ...keptSecs.map(s => s.text)].join("").trim() + "\n";
  return {
    text,
    kept: keptSecs.map(s => s.heading),
    dropped: secs.filter((_, i) => !keep.has(i)).map(s => s.heading),
    fullTokens: tok(ctx.text),
    sentTokens: tok(text),
  };
}

export interface ChatMsg { role: "system" | "user" | "assistant"; content: string }

const _summaries = new Map<string, string>();

/**
 * If the non-system conversation is longer than `maxChars`, replace everything
 * except the last `keepLast` messages with a one-time summary from a cheap model.
 */
export async function compressHistory(
  messages: ChatMsg[],
  summarize: (text: string) => Promise<string>,
  opts: { maxChars?: number; keepLast?: number } = {},
): Promise<{ messages: ChatMsg[]; compressed: boolean; savedChars: number }> {
  const maxChars = opts.maxChars ?? 12000;
  const keepLast = opts.keepLast ?? 4;
  const system = messages.filter(m => m.role === "system");
  const conv = messages.filter(m => m.role !== "system");
  const total = conv.reduce((n, m) => n + m.content.length, 0);
  if (total <= maxChars || conv.length <= keepLast + 1) return { messages, compressed: false, savedChars: 0 };
  const old = conv.slice(0, conv.length - keepLast);
  const recentMsgs = conv.slice(conv.length - keepLast);
  const transcript = old.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const key = createHash("sha256").update(transcript).digest("hex");
  let summary = _summaries.get(key);
  if (!summary) {
    summary = await summarize(transcript);
    _summaries.set(key, summary);
  }
  const summaryMsg: ChatMsg = { role: "system", content: `Summary of the earlier conversation:\n${summary}` };
  const out = [...system, summaryMsg, ...recentMsgs];
  const savedChars = transcript.length - summary.length;
  return { messages: out, compressed: true, savedChars };
}
