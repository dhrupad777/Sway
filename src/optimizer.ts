import { complete } from "./providers.js";
import { DEFAULTS } from "./pricing.js";

export type Intent = "code" | "qa" | "refactor" | "explain" | "other";

export interface Optimized {
  intent: Intent;
  optimizedPrompt: string;
  optimizerInputTokens: number;
  optimizerOutputTokens: number;
  optimizerMs: number;
  fallback: boolean;
}

// Templates canonicalize intent for cache/clarity. They do NOT cap output —
// savings come from the cheap model, not artificial brevity.
const TEMPLATES: Record<Intent, string> = {
  code: `You are a senior engineer. Implement what's asked with correct, idiomatic code and a brief explanation of how it works. Use realistic, useful examples (not just hello-world). Skip preamble.

Task: {task}`,
  qa: `Answer this clearly and helpfully. Match depth to the question — concise for simple Qs, thorough for complex ones. Skip preamble.

Question: {task}`,
  refactor: `Refactor while preserving behavior. Show the revised code and explain the changes briefly.

Task: {task}`,
  explain: `Explain this so a working developer can use the answer. Include a concrete example or short snippet where it helps. Skip preamble like "Great question!".

Topic: {task}`,
  other: `{task}`,
};

const SYSTEM = `You are a prompt optimizer. Read the user's raw prompt and return ONLY a JSON object:
{"intent": "code" | "qa" | "refactor" | "explain" | "other",
 "task": "<concise restatement of the user's task in one sentence>"}
No prose, no markdown fences, just the JSON.`;

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("optimizer timeout")), ms);
    p.then(v => { clearTimeout(t); resolve(v); },
           e => { clearTimeout(t); reject(e); });
  });
}

function extractJson(s: string): { intent: Intent; task: string } | null {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (typeof o.task !== "string") return null;
    const intent = ["code", "qa", "refactor", "explain", "other"].includes(o.intent) ? o.intent : "other";
    return { intent, task: o.task };
  } catch { return null; }
}

/**
 * The one-sentence restatement is enough for a short question, but it cannot carry pasted
 * code, error messages or data. Whenever the raw prompt has any of that, keep it verbatim.
 */
export function buildPrompt(intent: Intent, task: string, rawPrompt: string): string {
  const prompt = TEMPLATES[intent].replace("{task}", task);
  const hasDetail = rawPrompt.includes("```") || rawPrompt.trim().includes("\n") || rawPrompt.length > 300;
  return hasDetail ? `${prompt}\n\nThe user's full message (use every detail in it):\n${rawPrompt}` : prompt;
}

export async function optimize(rawPrompt: string): Promise<Optimized> {
  const t0 = Date.now();
  try {
    const res = await timeout(complete({
      model: DEFAULTS.optimizer,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: rawPrompt },
      ],
      maxTokens: 200,
      temperature: 0,
    }), 3000);

    const parsed = extractJson(res.text);
    if (!parsed) {
      return {
        intent: "other",
        optimizedPrompt: rawPrompt,
        optimizerInputTokens: res.inputTokens,
        optimizerOutputTokens: res.outputTokens,
        optimizerMs: Date.now() - t0,
        fallback: true,
      };
    }
    return {
      intent: parsed.intent,
      optimizedPrompt: buildPrompt(parsed.intent, parsed.task, rawPrompt),
      optimizerInputTokens: res.inputTokens,
      optimizerOutputTokens: res.outputTokens,
      optimizerMs: Date.now() - t0,
      fallback: false,
    };
  } catch {
    return {
      intent: "other",
      optimizedPrompt: rawPrompt,
      optimizerInputTokens: 0,
      optimizerOutputTokens: 0,
      optimizerMs: Date.now() - t0,
      fallback: true,
    };
  }
}
