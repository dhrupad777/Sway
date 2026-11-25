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

// Defaults: all-Gemini 2.5 family. Works in India with free tier or UPI billing
// via Google Cloud. flagship vs nano gives ~10x price spread for routing demo.
export const DEFAULTS = {
  nano:      "gemini-2.5-flash",
  flagship:  "gemini-2.5-pro",
  optimizer: "gemini-2.5-flash-lite",
  // v0.2
  judge:     "gemini-2.5-pro",
  embedding: "gemini-embedding-001",
};

// gemini-embedding-001 input price, USD per 1M tokens. Embeddings are memoized,
// so this is an upper bound when charged per call.
export const EMBED_PRICE_PER_M = 0.15;
