import { DEFAULTS } from "./pricing.js";

export interface RouteDecision {
  tier: "nano" | "flagship";
  model: string;
  score: number;
  signals: string[];
}

export const FLAGSHIP_KEYWORDS = [
  "refactor", "architect", "design", "debug", "trace", "optimize",
  "complex", "deep", "review", "audit", "migrate", "diagnose",
];

export function approxTokens(s: string): number {
  // rough: 1 token ~= 4 chars
  return Math.ceil(s.length / 4);
}

export function countCodeBlocks(s: string): number {
  return (s.match(/```/g)?.length ?? 0) >> 1;
}

export function hasFilePath(s: string): boolean {
  return /\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|md|json|yaml|yml|sh|sql)\b/.test(s);
}

export function classify(prompt: string, opts?: { nano?: string; flagship?: string }): RouteDecision {
  const tokens = approxTokens(prompt);
  const codeBlocks = countCodeBlocks(prompt);
  const lower = prompt.toLowerCase();
  const kwHits = FLAGSHIP_KEYWORDS.filter(k => lower.includes(k));
  const filePath = hasFilePath(prompt);

  let score = 0;
  const signals: string[] = [];

  if (tokens > 800) { score += 3; signals.push(`tokens=${tokens}`); }
  else if (tokens > 300) { score += 1; signals.push(`tokens=${tokens}`); }

  if (codeBlocks > 0) { score += 2; signals.push(`code_blocks=${codeBlocks}`); }
  if (filePath) { score += 1; signals.push("file_path"); }
  if (kwHits.length > 0) { score += kwHits.length; signals.push(`kw=${kwHits.join(",")}`); }

  const tier: "nano" | "flagship" = score >= 3 ? "flagship" : "nano";
  return {
    tier,
    model: tier === "flagship" ? (opts?.flagship ?? DEFAULTS.flagship) : (opts?.nano ?? DEFAULTS.nano),
    score,
    signals,
  };
}
