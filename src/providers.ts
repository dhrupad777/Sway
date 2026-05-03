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
}

export async function complete(args: CompleteArgs): Promise<CompleteResult> {
  const meta = PRICING[args.model];
  if (!meta) throw new Error(`Unknown model: ${args.model}. Add it to src/pricing.ts.`);

  switch (meta.provider) {
    case "anthropic": return anthropicComplete(args);
    case "openai":    return openaiComplete(args);
    case "gemini":    return geminiComplete(args);
    case "bedrock":   return bedrockComplete(args);
  }
}

async function bedrockComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!key) throw new Error("AWS_BEARER_TOKEN_BEDROCK not set (Bedrock long-term API key)");
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
  };
}

async function anthropicComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey: key });

  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const conv = args.messages.filter(m => m.role !== "system").map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const res = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.7,
    system: system || undefined,
    messages: conv,
  });

  const text = res.content.map(b => (b.type === "text" ? b.text : "")).join("");
  return {
    text,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    model: args.model,
    provider: "anthropic",
  };
}

async function openaiComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
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
  };
}

async function geminiComplete(args: CompleteArgs): Promise<CompleteResult> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const genai = new GoogleGenerativeAI(key);

  const system = args.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
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
      // Flash 2.5: disable thinking entirely. Short answers don't need it.
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (args.model.includes("pro")) {
      // Pro 2.5: cap thinking. Min allowed is 128.
      generationConfig.thinkingConfig = { thinkingBudget: 512 };
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

  return {
    text,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    model: args.model,
    provider: "gemini",
  };
}
