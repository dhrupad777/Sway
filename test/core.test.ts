// Unit tests for the pure (no network) parts of v0.2. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, toBlob, fromBlob } from "../src/embeddings.js";
import { sweep } from "../src/semcache.js";
import {
  trainLR, predictLR, fitStandardizer, applyStandardizer, handFeatures, needsFlagship, simulate,
} from "../src/learned-router.js";
import { splitSections, compressHistory } from "../src/context.js";
import { parseJudgement } from "../src/judge.js";
import { weakAnswer } from "../src/pipeline.js";
import { contentText, sseChunk } from "../src/proxy.js";
import { summarizeRows } from "../src/eval.js";

test("cosine similarity", () => {
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1);
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
  assert.ok(Math.abs(cosine(Float32Array.from([1, 1]), Float32Array.from([1, 0])) - Math.SQRT1_2) < 1e-6);
  assert.equal(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 0])), 0);
});

test("embedding blob round-trip", () => {
  const v = Float32Array.from([0.1, -2.5, 3e-4]);
  assert.deepEqual(Array.from(fromBlob(toBlob(v))), Array.from(v));
});

test("cache threshold sweep", () => {
  const rows = sweep([0.95, 0.90, 0.93, 0.80], [true, true, false, false], [0.85, 0.94]);
  assert.deepEqual(rows[0], { threshold: 0.85, hitRate: 1, falseHitRate: 0.5, precision: 2 / 3 });
  assert.deepEqual(rows[1], { threshold: 0.94, hitRate: 0.5, falseHitRate: 0, precision: 1 });
});

test("logistic regression learns a separable rule", () => {
  const X: number[][] = [], y: number[] = [];
  for (let i = 0; i < 40; i++) { const x = i / 4; X.push([x, (i * 7) % 5]); y.push(x > 5 ? 1 : 0); }
  const st = fitStandardizer(X);
  const m = trainLR(X.map(x => applyStandardizer(x, st)), y, { l2: 0.01, epochs: 1500, lr: 0.5 });
  const acc = X.filter((x, i) => (predictLR(applyStandardizer(x, st), m) >= 0.5 ? 1 : 0) === y[i]).length / X.length;
  assert.ok(acc >= 0.9, `accuracy ${acc}`);
  assert.ok(m.weights[0] > 0, "feature 0 should get a positive weight");
});

test("hand features detect code, paths and keywords", () => {
  const simple = handFeatures("what is a tuple");
  const hard = handFeatures("debug this in app.py\n```python\nx = 1\n```\nand also refactor it?");
  assert.equal(simple[1], 0);
  assert.equal(hard[1], 1);       // code block
  assert.equal(hard[2], 1);       // file path
  assert.ok(hard[3] >= 2);        // debug + refactor
  assert.ok(hard[0] > simple[0]); // longer
});

test("router labels and simulation", () => {
  assert.equal(needsFlagship(9, 9), 0);
  assert.equal(needsFlagship(6, 9), 1);
  assert.equal(needsFlagship(5, 6), 1);
  assert.equal(needsFlagship(5, 5), 0);
  const items = [
    { prompt: "a", nanoScore: 9, flagScore: 9, nanoCost: 1, flagCost: 10, label: 0 },
    { prompt: "b", nanoScore: 4, flagScore: 9, nanoCost: 1, flagCost: 10, label: 1 },
  ];
  assert.deepEqual(simulate(items, [false, true]), { quality: 9, cost: 11, nanoShare: 0.5 });
});

test("sway.md section split keeps preamble first", () => {
  const s = splitSections("# Title\nintro\n\n## Audience\nstudents\n## Style\nshort\n");
  assert.deepEqual(s.map(x => x.heading), ["", "Audience", "Style"]);
  assert.match(s[0].text, /intro/);
  assert.match(s[2].text, /short/);
});

test("history compression only when long", async () => {
  const short = [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: "hello" }];
  const r1 = await compressHistory(short, async () => "SUM");
  assert.equal(r1.compressed, false);
  const long = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: "x".repeat(2000) }));
  let calls = 0;
  const r2 = await compressHistory([{ role: "system", content: "sys" }, ...long], async () => { calls++; return "SUM"; });
  assert.equal(r2.compressed, true);
  assert.equal(r2.messages.length, 1 + 1 + 4); // system + summary + last 4
  assert.match(r2.messages[1].content, /SUM/);
  await compressHistory([{ role: "system", content: "sys" }, ...long], async () => { calls++; return "SUM"; });
  assert.equal(calls, 1, "summary is memoized");
});

test("judge output parsing", () => {
  assert.deepEqual(parseJudgement('```json\n{"score": 8, "reason": "ok"}\n```'), { score: 8, reason: "ok" });
  assert.equal(parseJudgement('{"score": 11}'), null);
  assert.equal(parseJudgement("no json"), null);
});

test("weak-answer detection for escalation", () => {
  const base = { model: "m", provider: "gemini" as const, inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 };
  assert.equal(weakAnswer({ ...base, text: "", outputTokens: 0 }, 100), "empty");
  assert.equal(weakAnswer({ ...base, text: "long...", outputTokens: 100 }, 100), "truncated");
  assert.equal(weakAnswer({ ...base, text: "I'm not sure, but", outputTokens: 5 }, 100), "hedged");
  assert.equal(weakAnswer({ ...base, text: "A tuple is immutable.", outputTokens: 5 }, 100), null);
});

test("OpenAI message content and SSE format", () => {
  assert.equal(contentText("hi"), "hi");
  assert.equal(contentText([{ type: "text", text: "a" }, { type: "image_url" }, { type: "text", text: "b" }]), "ab");
  const line = sseChunk("id1", "sway-auto", { content: "x" }, null);
  assert.ok(line.startsWith("data: ") && line.endsWith("\n\n"));
  const obj = JSON.parse(line.slice(6));
  assert.equal(obj.object, "chat.completion.chunk");
  assert.equal(obj.choices[0].delta.content, "x");
});

test("eval summary aggregates per config", () => {
  const row = (config: string, score: number | null, cost: number) => ({
    run_id: "r", ts: 0, dataset: "d", item_idx: 0, category: null, prompt: "p", config, model: "gemini-2.5-flash",
    tier: null, response: "", input_tokens: 10, output_tokens: 5, cost_usd: cost, latency_ms: 100,
    cache_hit: 0, escalated: 0, score, reason: null,
  });
  const [s] = summarizeRows([row("a", 8, 0.1), row("a", 6, 0.3), row("a", null, 0)], ["a"]);
  assert.equal(s.n, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.quality, 7);
  assert.ok(Math.abs(s.cost - 0.4) < 1e-9);
  assert.equal(s.nanoShare, 1);
});
