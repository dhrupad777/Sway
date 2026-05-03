# Sway — Implementation Plan with Checkpoints

**Project:** Sway — an intelligent LLM gateway shipped as an npm package
**Timeline:** ~3 weeks to demo (today 2026-04-16, presentation window 2026-05-04 → 2026-05-08)
**Team outcome:** working `npx sway start` proxy + dashboard + benchmark numbers + research paper

---

## 0. Read this first

This plan is split into **10 numbered sections**. Each section ends with a **Checkpoint** — a measurable, verifiable outcome. **If the checkpoint fails, stop and fix before moving on.** No "we'll come back to it." The entire plan is designed so that if you fall behind, you can ship at the end of any section from 5 onward and still have something to present.

Every section tells you:
- **Goal** — what this section produces
- **Prerequisites** — what *you* need ready before starting (accounts, keys, tools, decisions)
- **Tasks** — concrete work items
- **Checkpoint** — how to prove it worked, with a measurable target
- **If the checkpoint fails** — most likely cause

---

## Feasibility sanity-check (TELOS framework, abbreviated)

Before writing a line of code, confirm these are all green. If any is red, renegotiate scope *before* starting.

| Dimension | Question | Status to confirm |
|---|---|---|
| **Technical** | Can Node.js + Fastify + SQLite+vector + one embedding model actually do this on a student laptop? | ✅ Yes — each piece is a commodity off-the-shelf library |
| **Economic** | Total API cost of building + benchmarking? | Budget **$30–50 USD** for Gemini Flash + Haiku calls during dev. Your OpenAI/Anthropic keys = Bring Your Own Key for the proxy's end-users, not billed to you |
| **Legal** | Provider ToS risk? | ✅ BYOK model — Sway never resells keys. LiteLLM, Portkey operate identically |
| **Operational** | Can a student team maintain this post-submission? | ✅ Yes, if you keep the cut list honest and don't over-scope |
| **Scheduling** | 3 weeks realistic? | ✅ Only if you execute Sections 1–6 and are willing to drop Section 7 (Routing). Sections 8–10 are non-negotiable for the paper |

---

## Prerequisites you need BEFORE Section 1

Do these today. Each one is a blocker.

1. **Accounts & API keys** (BYOK, paid tiers — free tiers rate-limit too hard):
   - OpenAI API key with ~$20 credit
   - Anthropic API key with ~$10 credit
   - Google AI Studio (Gemini) key — for the cheap optimizer/judge calls
2. **Dev environment:**
   - Node.js 20 LTS installed (`node -v` → v20.x)
   - pnpm installed (`npm i -g pnpm`)
   - Git + a GitHub repo created (public or private, your call)
   - VS Code or Cursor installed (you'll need this to test the proxy end-to-end)
3. **Decisions to make now:**
   - **Package name on npm** — check `npm view sway` to see if taken; if yes, fall back to `sway-proxy` or `@yourhandle/sway`
   - **Who owns what** — if this is a team, assign 2 people to proxy+cache and 1 to dashboard+benchmarks
4. **One-time setup:**
   - Create `~/.sway/` directory (the proxy will use it for config)
   - Decide where you'll run the benchmark — you need at least 30 minutes of stable internet

If any of these isn't ready, **don't start Section 1.** You'll burn a day of rework.

---

## Section 1 — Walking Skeleton (Days 1–3)

### Goal
`npx sway start` launches a proxy on `localhost:8765`. A request sent to it comes back from OpenAI, unchanged.

### Prerequisites
- All items above complete
- Empty repo initialized (`git init`, `pnpm init`)

### Tasks
1. pnpm workspace with `packages/core`
2. TypeScript + Fastify scaffold (`pnpm add fastify @fastify/cors`)
3. One route: `POST /v1/chat/completions` — forwards the body to OpenAI, streams response back
4. `src/cli.ts` with `commander` — `sway start` command boots Fastify on port 8765
5. `bin` entry in `package.json` so `npx sway` works from a linked install

### Checkpoint 1
```bash
# Terminal 1
pnpm dev           # boots proxy

# Terminal 2
export OPENAI_BASE_URL=http://localhost:8765/v1
export OPENAI_API_KEY=sk-...your real key
curl $OPENAI_BASE_URL/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"say hi"}]}'
```

**✅ Pass if:** you get a real OpenAI completion back, streaming, and your Cursor editor (pointed at `http://localhost:8765/v1`) can still complete code normally.
**📊 Measurable target:** zero observable difference vs direct OpenAI — latency delta < 20ms, no errors in 20 consecutive requests.

### If the checkpoint fails
- SSE streaming broken → you're buffering the response; use Fastify's `reply.raw` and pipe the upstream body
- Cursor times out → auth header not forwarded; check `Authorization` is passed through verbatim

---

## Section 2 — Telemetry + Dashboard Shell (Days 4–5)

### Goal
Every request is logged to a local SQLite DB and visible on a web dashboard.

### Prerequisites
- Section 1 green
- Decision: dashboard is served from the same port as the proxy (`/dashboard`) — simpler, no CORS

### Tasks
1. `pnpm add better-sqlite3` — open DB at `~/.sway/metrics.db`
2. Schema: `requests(id, ts, provider, model, input_tokens, output_tokens, latency_ms, cached INTEGER DEFAULT 0, route_tier, raw_prompt, optimized_prompt)`
3. Write a row in a Fastify `onResponse` hook
4. Scaffold `packages/dashboard` with Vite + React; build output bundled as static files served at `/dashboard`
5. Dashboard shows three tiles: total requests, total cost (estimated), p50 latency
6. Add `/api/metrics` endpoint the dashboard polls every 5s

### Checkpoint 2
- Fire 10 requests through the proxy
- Open `http://localhost:8765/dashboard`
- **✅ Pass if:** all 10 appear, cost column non-zero, latency histogram populated

**📊 Measurable target:** dashboard updates within 5s of a request; no requests missing from the log.

### If the checkpoint fails
- Dashboard blank → static bundle path wrong in Fastify; check `@fastify/static` root
- Metrics missing tokens → provider response doesn't include usage; some streamed responses require parsing the final `[DONE]` event

---

## Section 3 — Semantic Cache, Naive (Days 6–8)

### Goal
Cache works on exact-hash first, then on embedding similarity (cosine threshold only, no judge yet). This is your **baseline** — deliberately naive, so you can measure the lift from the judge stage later.

### Prerequisites
- Section 2 green
- Decide: where does the cache live? → SQLite with `sqlite-vec` extension, in the same `metrics.db`

### Tasks
1. `pnpm add @xenova/transformers sqlite-vec` — embedding model `Xenova/all-MiniLM-L6-v2` runs in-process via ONNX
2. On first boot, download the model to `~/.sway/models/` (show progress in CLI)
3. `cache/normalize.ts` — canonicalize whitespace, drop volatile fields (request IDs, timestamps in user content)
4. `cache/store.ts` — wraps sqlite-vec for insert/ANN-search
5. Wire into proxy: on incoming request → hash → lookup → on miss, embed → ANN search → if cosine > 0.92, return cached response; else forward
6. On fresh completion, write `(embedding, optimized_prompt, response)` into the cache

### Checkpoint 3
Run this script (save as `benchmarks/check3.ts`):
```typescript
const prompts = [
  "What is the capital of France?",
  "What's the capital of France?",
  "Tell me the capital of France",
  "France's capital city is?",
  ...100 such variants across 10 intents
];
// Fire sequentially through Sway
// Assert: hit-rate > 40% (naive baseline)
```

**✅ Pass if:** cache hit-rate ≥ 40% on paraphrase-heavy input. Dashboard shows `cached=1` for hits.
**📊 Measurable target:** **≥ 40% cache hit-rate → expect ≥ 35% token reduction on this workload vs Section 2.**

### If the checkpoint fails
- Hit-rate too low → threshold too strict; lower to 0.88 temporarily and check whether you're getting semantically-wrong hits
- Hit-rate too high with wrong answers → that's expected at this stage; Section 4 fixes it

---

## Section 4 — Semantic Judge Stage (Days 9–11) — **RESEARCH CONTRIBUTION A**

### Goal
Add a second-stage LLM judge that validates candidate cache hits before serving them. This is your first paper-worthy contribution: **reduction in false-positive cache hits**.

### Prerequisites
- Section 3 green with measurable false-positive rate (you need a labeled set — see task 1)
- Gemini API key working

### Tasks
1. **Build a labeled set**: 200 query pairs, each labeled `same_intent: true | false` by a human (you). Half are tricky paraphrases, half are near-misses (same topic, different intent). Store as JSON in `benchmarks/judge-set.json`.
2. `cache/judge.ts` — takes (query, candidate_cached_query, candidate_response), sends to Gemini Flash with a "are these asking for the same thing?" prompt, parses JSON `{match: bool, confidence: float}`
3. Wire into pipeline: if ANN top-K returns candidates, run judge on top-3; serve only if judge approves
4. Add `judge_called`, `judge_verdict` columns to metrics
5. Run the labeled set through both **threshold-only** and **threshold+judge** pipelines; record precision/recall

### Checkpoint 4
On the 200-pair labeled set:
- **✅ Pass if:** threshold+judge achieves **precision ≥ 0.95** (false positives < 5%) while recall stays **≥ 0.70**
- If precision < 0.95, tune the judge prompt or raise the ANN threshold
- **📊 Measurable target:** **false-positive rate drops ≥ 50% vs Section 3**, at the cost of ~1 cheap LLM call per miss-candidate (~$0.0001 per check)

### If the checkpoint fails
- Judge too permissive → your judge prompt is vague; include explicit negative examples in the prompt
- Judge too strict → candidates never approved; check you're passing the candidate *response* too, not just the stored query

---

## Section 5 — Prompt Optimizer, Layer 0 (Days 12–13) — **RESEARCH CONTRIBUTION B (HEADLINE)**

### Goal
Before anything hits the cache, re-draft the user's prompt into a canonical "golden" form. Hypothesis: this collapses 10 messy variants into 1 cache entry, multiplying your hit-rate.

### Prerequisites
- Section 4 green
- Decide: default is **Transparent Mode** (auto-optimize, no user confirmation). Review Mode is a stretch goal.

### Tasks
1. `optimizer/intent.ts` — one Gemini Flash call: input = user prompt, output = JSON `{intent: "code"|"qa"|"refactor"|"explain"|"other", persona, expected_format}`
2. `optimizer/templates.ts` — 5 CO-STAR-style templates keyed by intent. Each template slot-fills `{persona, task, constraints, format}`
3. `optimizer/engine.ts` — orchestrates: intent classify → template select → second Gemini Flash call to rewrite prompt into the template → returns `optimized_prompt` + `clarity_score` (the LLM's self-rated 1–10)
4. Wire into proxy **before** the cache layer. Cache is now keyed on `optimized_prompt`, not raw.
5. Feature flag: `SWAY_OPTIMIZER=on|off` env var — **this is critical** for A/B benchmarking in Section 8
6. Add `optimizer_ms` column to metrics
7. Handle errors: if optimizer call fails or times out at 2s, fall through to raw prompt

### Checkpoint 5
Re-run the 100-variant / 10-intent paraphrase set from Section 3:

| Mode | Expected hit-rate |
|---|---|
| Optimizer OFF (Section 3 baseline) | ~40% |
| Optimizer ON | **≥ 70%** |

**✅ Pass if:** optimizer ON gives ≥ 70% hit-rate AND optimizer overhead p50 ≤ 300ms.
**📊 Measurable target:** **≥ 30-percentage-point hit-rate lift → translates to ≥ 50% token-cost reduction on paraphrase-heavy workloads.** *This is your headline number for the paper.*

### If the checkpoint fails
- Hit-rate lift < 15 points → templates are over-specific, still producing different outputs for same intent; relax the template or normalize output further
- Overhead > 500ms → collapse the two Gemini calls into one (do intent + rewrite in a single structured-output call)

---

## Section 6 — Dashboard: Prompt-Diff View (Day 14)

### Goal
The demo-winning feature. Show examiners the raw → optimized transformation live.

### Prerequisites
- Section 5 green
- `optimized_prompt` column populated in every request row

### Tasks
1. New dashboard page: `/dashboard/requests/:id`
2. Side-by-side diff: left panel = raw prompt, right panel = optimized. Use `diff` library for highlighting
3. Show per-request: `clarity_score`, `optimizer_ms`, `cached` badge, cost saved vs baseline
4. Add a "Cache-hit lift" chart on the main dashboard: rolling 1-hour hit-rate with optimizer ON vs OFF (requires you to toggle and log which mode ran)

### Checkpoint 6
**✅ Pass if:** you can live-demo: open Cursor, fire a messy request, watch the dashboard show raw vs optimized side-by-side within 3 seconds of the request landing.
**📊 Measurable target:** dashboard reflects every request's optimization within 5s; no blank fields.

### If the checkpoint fails
- Diff view renders raw text twice → you aren't storing `optimized_prompt`; check the metrics hook fires *after* optimizer, not before

---

## Section 7 — Complexity Router, Layer 2 (Days 15–16)

### Goal
On cache miss, pick the right model tier instead of always hitting flagship. Supporting feature — cuttable if behind schedule.

### Prerequisites
- Section 6 green
- Map of tiers per provider decided: e.g., `nano = gpt-4o-mini / haiku / gemini-flash`; `flagship = gpt-4o / opus / gemini-pro`

### Tasks
1. `router/classifier.ts` — rule-based scoring: input tokens, presence of tool/function schemas, code-block count, keyword heuristics ("refactor", "debug", "explain", "write a poem")
2. `router/policy.ts` — maps score to tier; handles fallback on 429/5xx
3. Respect explicit client-supplied `model` — only route when client uses a `sway:auto` sentinel model string (opt-in, non-breaking)
4. Add `route_tier` and `routed_from` columns to metrics

### Checkpoint 7
Run a mixed workload of 100 queries (50 simple Q&A, 50 complex code tasks) with `model: "sway:auto"`:
- **✅ Pass if:** ≥ 80% of simple queries route to nano; ≥ 80% of complex route to flagship
- **📊 Measurable target:** **total cost on this workload ≥ 40% lower than forcing all to flagship**, with no measurable quality regression on a 20-sample human eval

### If the checkpoint fails
- Everything routes to nano → classifier too lenient; add "if code block present, force mid-or-flagship"
- Fallback chain loops → you're re-classifying on fallback; fallback should skip classifier

---

## Section 8 — Benchmarks & Paper (Days 17–19)

### Goal
Produce the numbers that go into the paper. This is non-negotiable.

### Prerequisites
- Sections 1–5 green (Section 7 optional)
- ~$15 budget for benchmark API calls

### Tasks
1. **Workload**: `benchmarks/workload.json` — 500 queries structured as **50 intents × 10 paraphrases each**. Intents span code, Q&A, refactor, explain, write.
2. **`pnpm bench`** script — runs three modes back-to-back:
   - **(a)** Direct to OpenAI (bypass Sway)
   - **(b)** Sway, optimizer OFF
   - **(c)** Sway, optimizer ON
3. Record per-mode: total cost, cache-hit rate, latency p50/p95, quality score (use Gemini Flash as a judge on 50 random outputs, score 1–5 for answer quality)
4. Output a Markdown report: `benchmarks/results.md` with one headline table
5. **Write the paper** (6–8 pages): intro → related work (LiteLLM, Portkey, GPTCache, Cortex) → architecture → experiments → results table → discussion → future work

### Checkpoint 8
**✅ Pass if** the results table shows all three of:
1. Cost (c) ≤ 60% of cost (a) — **i.e., ≥ 40% total token cost reduction end-to-end**
2. Hit-rate (c) ≥ hit-rate (b) + 20 points
3. Quality (c) within 0.3 points of (a) on the 1–5 scale (no meaningful regression)

**📊 Measurable target: the benchmark report exists, numbers are reproducible by running `pnpm bench`, and the headline claim is defensible.**

### If the checkpoint fails
- Cost not dropping → optimizer's own token cost eating the savings; reduce optimizer model to Gemini Flash (cheapest)
- Quality regressed → optimizer is rewriting prompts *too* aggressively; soften templates, especially for "explain" and "write" intents

---

## Section 9 — Polish, Publish, Package (Day 20)

### Goal
`npx sway start` works on a fresh machine for an examiner.

### Prerequisites
- Section 8 green
- npm account created and logged in (`npm login`)

### Tasks
1. `sway --help` — clear help text, examples
2. `sway config` — interactive wizard that stores API keys via `keytar` (OS keychain), not plaintext
3. Good error messages — "OPENAI_API_KEY not set" not "undefined is not a function"
4. README with: install, one-paragraph what-is, config, one GIF of the prompt-diff dashboard, link to benchmark report
5. `npm publish --access public`
6. Tag `v0.1.0` on GitHub; push

### Checkpoint 9
**✅ Pass if:** on a clean Docker container / fresh VM:
```bash
npx sway@latest config   # wizard runs
npx sway@latest start    # boots, dashboard live
```
Completes without manual git clone or build.

**📊 Measurable target:** zero-to-working in under 2 minutes on a fresh machine.

### If the checkpoint fails
- `sqlite-vec` native module fails to install → ship prebuilt binaries via `@napi-rs` or document that users need build tools
- Dashboard 404s → static bundle not included in published package; check `files` field in `package.json`

---

## Section 10 — Demo Day Prep (Day 21+)

### Goal
A flawless 10-minute demo.

### Prerequisites
- Section 9 green
- Presentation slides drafted

### Tasks
1. **5-minute video** — live Cursor session through Sway, dashboard visible, raw→optimized diff updating in real-time
2. **Slides** — built around the hit-rate-lift chart from Section 8. Title slide, problem, architecture diagram, live demo, numbers, future work (Layer 3 agentic chunking), Q&A
3. **Rehearse `npx sway start`** on your *actual* demo laptop, from a fresh terminal, three times. Every time.
4. **Backup plan** — record the demo video AND have a pre-recorded version ready in case live demo fails
5. **Q&A prep** — expected questions: "How is this different from LiteLLM?" (answer: prompt canonicalization × semantic cache compounding), "Privacy?" (BYOK, local-only), "Accuracy regressions?" (Section 4 judge + Section 8 quality score)

### Checkpoint 10
**✅ Pass if:** you rehearse the full demo end-to-end in under 10 minutes, with no dead air, and someone outside the team can follow the pitch.

---

## Cut list — in order, if you fall behind

If you reach Day N and are behind schedule, drop in this order:

| Day behind | Drop |
|---|---|
| 1 day | Review Mode (stretch goal in Section 5) |
| 2 days | Section 7 entirely — position routing as "future work" in the paper |
| 3 days | Section 6 fancy diff view — ship raw JSON viewer instead |
| 4 days | Section 9 npm publish — demo from `pnpm dev` on your own laptop |
| 5+ days | Section 4 judge stage — ship Section 3 naive cache as the paper's contribution, drop "research contribution A" |

**Never drop:** Section 1 (proxy works), Section 5 (optimizer = your headline), Section 8 (benchmark numbers).

---

## Expected cumulative progress at each checkpoint

| After section | What works | Tokens saved vs baseline |
|---|---|---|
| 1 | Transparent proxy | 0% (no savings — passthrough only) |
| 2 | Observability | 0% |
| 3 | Naive cache | **~35% on repeated prompts** |
| 4 | Trustworthy cache | ~35% with **> 95% precision** (no more wrong cached answers) |
| 5 | Optimizer × cache | **~50–60% on paraphrase-heavy workload** |
| 6 | Demo-ready UI | same as 5 |
| 7 | Routing | **+ additional ~20–30% by using cheap models when appropriate** → cumulative ~60–70% cost reduction |
| 8 | Paper numbers | reproducible via `pnpm bench` |
| 9 | Published npm package | same savings, now installable by anyone |
| 10 | Demo rehearsed | shippable |

---

## File paths you will create (canonical)

- [packages/core/src/proxy/server.ts](packages/core/src/proxy/server.ts) — Fastify app
- [packages/core/src/proxy/streaming.ts](packages/core/src/proxy/streaming.ts) — SSE passthrough
- [packages/core/src/optimizer/intent.ts](packages/core/src/optimizer/intent.ts) — intent classifier
- [packages/core/src/optimizer/templates.ts](packages/core/src/optimizer/templates.ts) — golden templates
- [packages/core/src/optimizer/engine.ts](packages/core/src/optimizer/engine.ts) — rewrite pipeline
- [packages/core/src/cache/normalize.ts](packages/core/src/cache/normalize.ts) — canonicalize + hash
- [packages/core/src/cache/embed.ts](packages/core/src/cache/embed.ts) — `@xenova/transformers` wrapper
- [packages/core/src/cache/store.ts](packages/core/src/cache/store.ts) — sqlite-vec wrapper
- [packages/core/src/cache/judge.ts](packages/core/src/cache/judge.ts) — two-stage validation
- [packages/core/src/router/classifier.ts](packages/core/src/router/classifier.ts) — complexity scoring
- [packages/core/src/router/policy.ts](packages/core/src/router/policy.ts) — tier selection
- [packages/core/src/providers/openai.ts](packages/core/src/providers/openai.ts) · [anthropic.ts](packages/core/src/providers/anthropic.ts) · [gemini.ts](packages/core/src/providers/gemini.ts)
- [packages/core/src/telemetry/metrics.ts](packages/core/src/telemetry/metrics.ts) — DB writes
- [packages/core/src/cli.ts](packages/core/src/cli.ts) — commander CLI
- [packages/dashboard/src/](packages/dashboard/src/) — React app
- [benchmarks/workload.json](benchmarks/workload.json) — 500-query set
- [benchmarks/results.md](benchmarks/results.md) — Section 8 output
