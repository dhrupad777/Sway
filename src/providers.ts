import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PRICING } from "./pricing.js";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteArgs {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: "anthropic" | "openai" | "gemini" | "bedrock";
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const KEY_HELP: Record<string, string> = {
  GEMINI_API_KEY: "https://aistudio.google.com/apikey",
  OPENAI_API_KEY: "https://platform.openai.com/api-keys",
  ANTHROPIC_API_KEY: "https://console.anthropic.com/settings/keys",
  AWS_BEARER_TOKEN_BEDROCK: "the Bedrock console (API keys), plus AWS_REGION",
};

/** An error that tells a new user exactly where to get the key and where to put it. */
export function missingKey(name: string, why?: string): Error {
  return new Error(
    `${name} is not set${why ? ` — ${why}` : ""}.\n` +
    `  Get a key at ${KEY_HELP[name] ?? "your provider's console"}, then either\n` +
    `  - add a line ${name}=<your key> to a .env file in this folder, or\n` +
    `  - export ${name}=<your key> in your shell.\n` +
    `  Sway uses whichever provider you have a key for (Gemini, OpenAI, Anthropic or Bedrock); run \`sway probe\` to check your setup.`,
  );
}

export async function complete(args: CompleteArgs): Promise<CompleteResult> {
  const meta = PRICING[args.model];
  if (!meta) throw new Error(`Unknown model: ${args.model}. Run \`sway models\` to see the options.`);

  switch (meta.provider) {
    case "anthropic": return anthropicComplete(args);
    case "openai":    return openaiComplete(args);
    case "gemini":    return geminiComplete(args);
    case "bedrock":   return bedrockComplete(args);
  }
}

async function bedrockComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!key) throw missingKey("AWS_BEARER_TOKEN_BEDROCK");
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const conv = args.messages.filter(m => m.role !== "system").map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    ...(system ? { system } : {}),
    messages: conv,
  };

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(args.model)}/invoke`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bedrock ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = await res.json() as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  const text = json.content.map(b => (b.type === "text" ? b.text ?? "" : "")).join("");
  return {
    text,
    inputTokens: json.usage.input_tokens,
    outputTokens: json.usage.output_tokens,
    model: args.model,
    provider: "bedrock",
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

async function anthropicComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw missingKey("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });

  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const conv = args.messages.filter(m => m.role !== "system").map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Ephemeral prompt caching: cached reads billed at 10% of normal input rate.
  const systemParam = system
    ? [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }]
    : undefined;

  const res = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    system: systemParam,
    messages: conv,
  });

  const u = res.usage as unknown as Record<string, number>;
  const text = res.content.map(b => (b.type === "text" ? b.text : "")).join("");
  return {
    text,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    model: args.model,
    provider: "anthropic",
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
  };
}

async function openaiComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw missingKey("OPENAI_API_KEY");
  const client = new OpenAI({ apiKey: key });

  const res = await client.chat.completions.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    messages: args.messages.map(m => ({ role: m.role, content: m.content })),
  });

  return {
    text: res.choices[0]?.message?.content ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
    model: args.model,
    provider: "openai",
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

async function geminiComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw missingKey("GEMINI_API_KEY");
  const genai = new GoogleGenerativeAI(key);

  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  // Gemini Context Cache (GoogleAICacheManager) requires 32k+ tokens and a separate
  // SDK import not available in @google/generative-ai ^0.21.0. The response cache
  // in cache.ts covers the same use-case for our workloads. Provider-level cache
  // savings show as cacheReadTokens > 0 in usageMetadata when Gemini auto-caches.
  const model = genai.getGenerativeModel({
    model: args.model,
    systemInstruction: system || undefined,
  });

  const history = args.messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const last = history.pop();
  if (!last) throw new Error("No user message to send");

  // Gemini 2.5 are thinking models — internal reasoning eats output budget.
  // Cap thinking so visible output has room.
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: args.maxTokens ?? 4096,
    temperature: args.temperature ?? 0.7,
  };
  if (args.model.includes("2.5")) {
    if (args.model.includes("flash")) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (args.model.includes("pro")) {
      // Minimum allowed thinking budget. Keeps internal reasoning cheap
      // so the visible output has room within the token budget.
      generationConfig.thinkingConfig = { thinkingBudget: 128 };
    }
  }

  const chat = model.startChat({ history, generationConfig });
  const res = await chat.sendMessage(last.parts[0].text);
  const usage = res.response.usageMetadata;

  // Robust text extraction: text() can return empty if finish_reason is non-STOP
  // (e.g. MAX_TOKENS) or if parts include thought-only items. Fall back to parts.
  let text = "";
  try { text = res.response.text() ?? ""; } catch { /* swallow */ }
  if (!text) {
    const parts = (res.response.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
    text = parts
      .filter(p => !p.thought)
      .map(p => p.text ?? "")
      .join("");
  }

  // cachedContentTokenCount is present when Gemini auto-caches repeated system prompts.
  const cacheReadTokens = (usage as { cachedContentTokenCount?: number } | undefined)?.cachedContentTokenCount ?? 0;

  return {
    text,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    model: args.model,
    provider: "gemini",
    cacheReadTokens,
    cacheCreationTokens: 0,
  };
}

// ---------- Phase 4: streaming ----------

/**
 * Same as complete(), but calls onToken with each text chunk as it arrives.
 * Gemini, OpenAI and Anthropic stream natively; Bedrock returns one chunk.
 */
export async function stream(args: CompleteArgs, onToken: (t: string) => void): Promise<CompleteResult> {
  const meta = PRICING[args.model];
  if (!meta) throw new Error(`Unknown model: ${args.model}. Run \`sway models\` to see the options.`);
  switch (meta.provider) {
    case "gemini": return geminiStream(args, onToken);
    case "openai": return openaiStream(args, onToken);
    case "anthropic": return anthropicStream(args, onToken);
    case "bedrock": {
      const r = await bedrockComplete(args);
      if (r.text) onToken(r.text);
      return r;
    }
  }
}

async function geminiStream(args: CompleteArgs, onToken: (t: string) => void): Promise<CompleteResult> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw missingKey("GEMINI_API_KEY");
  const genai = new GoogleGenerativeAI(key);
  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const model = genai.getGenerativeModel({ model: args.model, systemInstruction: system || undefined });
  const history = args.messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const last = history.pop();
  if (!last) throw new Error("No user message to send");
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: args.maxTokens ?? 4096,
    temperature: args.temperature ?? 0.7,
  };
  if (args.model.includes("2.5")) {
    generationConfig.thinkingConfig = { thinkingBudget: args.model.includes("flash") ? 0 : 128 };
  }
  const chat = model.startChat({ history, generationConfig });
  const res = await chat.sendMessageStream(last.parts[0].text);
  let text = "";
  for await (const chunk of res.stream) {
    let t = "";
    try { t = chunk.text(); } catch { /* thought-only chunk */ }
    if (t) { text += t; onToken(t); }
  }
  const usage = (await res.response).usageMetadata as
    { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } | undefined;
  return {
    text,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    model: args.model,
    provider: "gemini",
    cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
    cacheCreationTokens: 0,
  };
}

async function openaiStream(args: CompleteArgs, onToken: (t: string) => void): Promise<CompleteResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw missingKey("OPENAI_API_KEY");
  const client = new OpenAI({ apiKey: key });
  const s = await client.chat.completions.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    messages: args.messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
    stream_options: { include_usage: true },
  });
  let text = "", inTok = 0, outTok = 0;
  for await (const chunk of s) {
    const t = chunk.choices[0]?.delta?.content ?? "";
    if (t) { text += t; onToken(t); }
    if (chunk.usage) { inTok = chunk.usage.prompt_tokens; outTok = chunk.usage.completion_tokens; }
  }
  return { text, inputTokens: inTok, outputTokens: outTok, model: args.model, provider: "openai", cacheReadTokens: 0, cacheCreationTokens: 0 };
}

async function anthropicStream(args: CompleteArgs, onToken: (t: string) => void): Promise<CompleteResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw missingKey("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const conv = args.messages.filter(m => m.role !== "system").map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  const s = client.messages.stream({
    model: args.model,
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    system: system || undefined,
    messages: conv,
  });
  s.on("text", (t: string) => onToken(t));
  const msg = await s.finalMessage();
  const text = msg.content.map(b => (b.type === "text" ? b.text : "")).join("");
  return {
    text,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    model: args.model,
    provider: "anthropic",
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}
