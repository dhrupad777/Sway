// Phase 4 — OpenAI-compatible gateway.
// Point any OpenAI SDK at http://localhost:8788/v1 and requests go through Sway.
//   model "sway-auto"      → full pipeline (learned router, cache, context, optimizer)
//   model "<known model>"  → that model, with semantic cache + context
// Streaming (stream: true) uses Server-Sent Events like the OpenAI API.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { runPipeline, type PipelineOptions } from "./pipeline.js";
import { complete, type Message } from "./providers.js";
import { DEFAULTS, PRICING } from "./pricing.js";
import { compressHistory } from "./context.js";
import { projectSpend } from "./metrics.js";

export interface ProxyOptions {
  port: number;
  budgetUsd: number | null; // per project per UTC day
  optimize: boolean;
  context: "off" | "full" | "retrieve";
  router: "rules" | "learned";
  semanticCache: boolean;
  simThreshold?: number;
}

type OAContent = string | Array<{ type: string; text?: string }> | null;
interface OAMessage { role: string; content: OAContent }
interface OARequest {
  model?: string;
  messages?: OAMessage[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
}

export function contentText(c: OAContent): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  return c.filter(p => p.type === "text").map(p => p.text ?? "").join("");
}

export function sseChunk(id: string, model: string, delta: { role?: string; content?: string }, finish: string | null, extra?: object): string {
  return `data: ${JSON.stringify({
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  })}\n\n`;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function oaError(res: ServerResponse, status: number, message: string, type = "invalid_request_error"): void {
  sendJson(res, status, { error: { message, type, code: status } });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function startOfUtcDay(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function handleChat(req: IncomingMessage, res: ServerResponse, o: ProxyOptions): Promise<void> {
  let body: OARequest;
  try { body = JSON.parse(await readBody(req)); }
  catch { return oaError(res, 400, "Body must be JSON"); }

  const requested = body.model ?? "sway-auto";
  const auto = requested === "sway-auto";
  if (!auto && !PRICING[requested]) {
    return oaError(res, 400, `Unknown model "${requested}". Use "sway-auto" or one of: ${Object.keys(PRICING).join(", ")}`);
  }
  const msgs = (body.messages ?? []).map(m => ({ role: m.role === "developer" ? "system" : m.role, content: contentText(m.content) }))
    .filter(m => m.role === "system" || m.role === "user" || m.role === "assistant") as Message[];
  const lastUser = [...msgs].reverse().findIndex(m => m.role === "user");
  if (lastUser < 0) return oaError(res, 400, "messages must contain at least one user message");
  const cut = msgs.length - 1 - lastUser;
  const prompt = msgs[cut].content;

  // Budget
  const project = (req.headers["x-sway-project"] as string | undefined)?.slice(0, 64) || "default";
  if (o.budgetUsd != null) {
    const spent = projectSpend(project, startOfUtcDay());
    if (spent >= o.budgetUsd) {
      return oaError(res, 429, `Daily budget for project "${project}" reached: $${spent.toFixed(4)} of $${o.budgetUsd}`, "budget_exceeded");
    }
  }

  // History: earlier turns (compressed if long); caller system messages are passed through.
  const before = msgs.slice(0, cut);
  const compressed = await compressHistory(before, async (transcript) => {
    const r = await complete({
      model: DEFAULTS.nano,
      messages: [
        { role: "system", content: "Summarize this conversation for the assistant's memory. Keep facts, decisions, code identifiers and open questions. Max 150 words." },
        { role: "user", content: transcript },
      ],
      maxTokens: 400,
      temperature: 0,
    });
    return r.text;
  });
  const extraSystem = compressed.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const history = compressed.messages.filter(m => m.role !== "system");

  const stream = body.stream === true;
  const id = `chatcmpl-sway-${randomUUID().slice(0, 12)}`;
  const opts: PipelineOptions = {
    context: o.context,
    optimize: auto && o.optimize,
    router: o.router,
    model: auto ? undefined : requested,
    semanticCache: o.semanticCache,
    simThreshold: o.simThreshold,
    escalate: auto && !stream,
    tokenBudget: auto && !(body.max_tokens ?? body.max_completion_tokens),
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? 2048,
    temperature: body.temperature,
    history,
    extraSystem: extraSystem || undefined,
    session: "proxy",
    project,
  };

  if (!stream) {
    const r = await runPipeline(prompt, opts);
    log(project, requested, r.model, r.costUsd, r.cacheHit, r.latencyMs, r.overheadMs, compressed.compressed);
    return sendJson(res, 200, {
      id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: r.model,
      choices: [{ index: 0, message: { role: "assistant", content: r.text }, finish_reason: r.truncated ? "length" : "stop" }],
      usage: { prompt_tokens: r.inputTokens, completion_tokens: r.outputTokens, total_tokens: r.inputTokens + r.outputTokens },
      sway: { cost_usd: r.costUsd, tier: r.tier, cache_hit: r.cacheHit, escalated: r.escalated, overhead_ms: r.overheadMs, history_compressed: compressed.compressed },
    }, {
      "x-sway-cost-usd": r.costUsd.toFixed(6),
      "x-sway-model": r.model,
      "x-sway-cache": r.cacheHit ? "hit" : "miss",
      "x-sway-overhead-ms": String(r.overheadMs),
      "x-sway-project": project,
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "x-sway-project": project,
  });
  res.write(sseChunk(id, requested, { role: "assistant" }, null));
  try {
    const r = await runPipeline(prompt, { ...opts, onToken: t => res.write(sseChunk(id, requested, { content: t }, null)) });
    res.write(sseChunk(id, r.model, {}, r.truncated ? "length" : "stop", {
      usage: { prompt_tokens: r.inputTokens, completion_tokens: r.outputTokens, total_tokens: r.inputTokens + r.outputTokens },
      sway: { cost_usd: r.costUsd, tier: r.tier, cache_hit: r.cacheHit, overhead_ms: r.overheadMs },
    }));
    log(project, requested, r.model, r.costUsd, r.cacheHit, r.latencyMs, r.overheadMs, compressed.compressed);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: { message: (e as Error).message } })}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function log(project: string, requested: string, model: string, cost: number, hit: boolean, ms: number, overhead: number, compressed: boolean): void {
  process.stderr.write(
    `[proxy] ${new Date().toISOString().slice(11, 19)} project=${project} req=${requested} -> ${model} ` +
    `$${cost.toFixed(6)} ${hit ? "CACHE " : ""}${ms}ms (sway overhead ${overhead}ms)${compressed ? " history-compressed" : ""}\n`
  );
}

export function startProxy(o: ProxyOptions): void {
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/v1/models") {
        return sendJson(res, 200, {
          object: "list",
          data: ["sway-auto", ...Object.keys(PRICING)].map(id => ({ id, object: "model", owned_by: id === "sway-auto" ? "sway" : PRICING[id].provider })),
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") return await handleChat(req, res, o);
      oaError(res, 404, `No route ${req.method} ${url.pathname}`);
    } catch (e) {
      if (!res.headersSent) oaError(res, 500, (e as Error).message, "server_error");
      else res.end();
    }
  });
  srv.listen(o.port, () => {
    console.log(`Sway gateway on http://localhost:${o.port}/v1  (OpenAI-compatible)`);
    console.log(`  model "sway-auto" = routed (${o.router}) · cache ${o.semanticCache ? "on" : "off"} · optimizer ${o.optimize ? "on" : "off"} · context ${o.context}`);
    console.log(`  budget: ${o.budgetUsd != null ? `$${o.budgetUsd}/project/day (header x-sway-project)` : "none"}`);
    console.log(`  try:  curl http://localhost:${o.port}/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"sway-auto","messages":[{"role":"user","content":"what is a tuple"}]}'`);
  });
}
