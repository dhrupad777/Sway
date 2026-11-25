// $/Mtok pricing snapshot (2026-05). Refresh before demo day.
// All values are USD per 1 million tokens.

export interface ModelPrice {
  input: number;
  output: number;
  tier: "nano" | "flagship";
  provider: "anthropic" | "openai" | "gemini" | "bedrock";
}

// Fraction of normal input token price charged for cache reads.
// Gemini Context Cache: 25% of input rate after first creation.
// Anthropic Prompt Caching: 10% of input rate (ephemeral cache).
export const CACHE_DISCOUNT: Partial<Record<ModelPrice["provider"], { read: number }>> = {
  gemini:    { read: 0.25 },
  anthropic: { read: 0.10 },
};

// Intent-aware output token caps for Sway. Raw always uses 4096.
// Drives the single biggest same-model cost lever.
export const TOKEN_BUDGET: Record<string, number> = {
  qa:       1000,
  explain:  1000,
  code:     2048,
  refactor: 2048,
  other:    1200,
};

export const PRICING: Record<string, ModelPrice> = {
  // Anthropic direct
  "claude-haiku-4-5":     { input: 1.00, output: 5.00,  tier: "nano",     provider: "anthropic" },
  "claude-sonnet-4-6":    { input: 3.00, output: 15.00, tier: "flagship", provider: "anthropic" },
  "claude-opus-4-7":      { input: 15.00, output: 75.00, tier: "flagship", provider: "anthropic" },

  // OpenAI
  "gpt-4o-mini":          { input: 0.15, output: 0.60,  tier: "nano",     provider: "openai" },
  "gpt-4o":               { input: 2.50, output: 10.00, tier: "flagship", provider: "openai" },

  // Gemini (paid pricing — free tier returns same model with daily quota)
  "gemini-1.5-flash":     { input: 0.075, output: 0.30, tier: "nano",     provider: "gemini" },
  "gemini-1.5-pro":       { input: 1.25, output: 5.00,  tier: "flagship", provider: "gemini" },
  "gemini-2.5-flash-lite":{ input: 0.10, output: 0.40,  tier: "nano",     provider: "gemini" },
  "gemini-2.5-flash":     { input: 0.30, output: 2.50,  tier: "nano",     provider: "gemini" },
  "gemini-2.5-pro":       { input: 1.25, output: 10.00, tier: "flagship", provider: "gemini" },

  // Amazon Bedrock — EU cross-region inference profile IDs (eu- prefix, eu-north-1).
  // Verified working 2026-05-03 via `sway probe`.
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0":  { input: 1.00, output: 5.00,  tier: "nano",     provider: "bedrock" },
  "eu.anthropic.claude-sonnet-4-5-20250929-v1:0": { input: 3.00, output: 15.00, tier: "flagship", provider: "bedrock" },
};

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  opts?: { cacheReadTokens?: number },
): number {
  const p = PRICING[model];
  if (!p) return 0;
  const base = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  if (!opts?.cacheReadTokens) return base;
  const discount = CACHE_DISCOUNT[p.provider];
  if (!discount) return base;
  // Cache reads replace normal input tokens at a discounted rate.
  const saved = (opts.cacheReadTokens * p.input * (1 - discount.read)) / 1_000_000;
  return base - saved;
}

export function tierFor(model: string): "nano" | "flagship" | "unknown" {
  return PRICING[model]?.tier ?? "unknown";
}

export type Provider = ModelPrice["provider"];

// Model roles per provider: flagship (quality), nano (cheap), optimizer (cheapest; rewrites prompts).
export const PRESETS: Record<Provider, { flagship: string; nano: string; optimizer: string }> = {
  gemini:    { flagship: "gemini-2.5-pro", nano: "gemini-2.5-flash", optimizer: "gemini-2.5-flash-lite" },
  openai:    { flagship: "gpt-4o", nano: "gpt-4o-mini", optimizer: "gpt-4o-mini" },
  anthropic: { flagship: "claude-sonnet-4-6", nano: "claude-haiku-4-5", optimizer: "claude-haiku-4-5" },
  bedrock:   {
    flagship: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    nano: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    optimizer: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  },
};

export const KEY_VARS: Record<Provider, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  bedrock: ["AWS_BEARER_TOKEN_BEDROCK"],
};

export function hasKey(p: Provider): boolean {
  return KEY_VARS[p].some(v => !!process.env[v]);
}

function fail(msg: string): never {
  console.error(`\x1b[31m[sway] ${msg}\x1b[0m`);
  process.exit(1);
}

/** SWAY_PROVIDER if set, otherwise the first provider with an API key (Gemini first), otherwise Gemini. */
function detectProvider(): Provider {
  const forced = process.env.SWAY_PROVIDER?.trim().toLowerCase();
  if (forced) {
    if (!(forced in PRESETS)) fail(`SWAY_PROVIDER=${forced} is not one of: ${Object.keys(PRESETS).join(", ")}`);
    return forced as Provider;
  }
  return (["gemini", "openai", "anthropic", "bedrock"] as Provider[]).find(hasKey) ?? "gemini";
}

/** A model from an env override (validated), or the provider preset. */
function role(envVar: string, fallback: string): string {
  const v = process.env[envVar]?.trim();
  if (!v) return fallback;
  if (!PRICING[v]) fail(`${envVar}=${v} is not a known model. Run \`sway models\` to see the options.`);
  return v;
}

const provider = detectProvider();
const preset = PRESETS[provider];
const flagship = role("SWAY_FLAGSHIP", preset.flagship);

// Resolved once at startup. Override any role with SWAY_FLAGSHIP / SWAY_NANO / SWAY_OPTIMIZER / SWAY_JUDGE.
export const DEFAULTS = {
  provider,
  flagship,
  nano:      role("SWAY_NANO", preset.nano),
  optimizer: role("SWAY_OPTIMIZER", preset.optimizer),
  judge:     role("SWAY_JUDGE", flagship),
  // Embeddings (semantic cache, learned router, context retrieval) always use Gemini.
  // Without a Gemini key those features switch themselves off.
  embedding: "gemini-embedding-001",
};

// gemini-embedding-001 input price, USD per 1M tokens. Embeddings are memoized,
// so this is an upper bound when charged per call.
export const EMBED_PRICE_PER_M = 0.15;
