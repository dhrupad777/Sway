# Sway — Feasibility, Showcase Format & Build Plan

## Context

You asked whether **Sway** — an intelligent LLM gateway that reduces compute waste — is feasible as a mini-project, and specifically whether it can be shipped as an **npm package**. Both research reports (GPT and Gemini) converge: the idea aligns with where the market has moved (LiteLLM, Portkey, OpenRouter, Bifrost), the distribution pattern (local OpenAI-compatible proxy at `localhost:8765`) is proven, and the hard problems are **correctness**, not plumbing.

**Scope revision (your call):** drop Layer 3 (Agentic Chunker) and add **Layer 0: Prompt Optimizer** at the front of the pipeline. Rationale: the optimizer *canonicalizes* messy user prompts into a "golden" form, which (hypothesis) dramatically boosts the semantic cache's hit-rate — turning two separate features into one compounding research finding. This is the headline research angle for your paper.

**Final three-layer stack:**
- **Layer 0 — Prompt Optimizer** (new): re-drafts prompts into instruction-dense canonical form before anything else
- **Layer 1 — Semantic Cache**: two-stage retrieval with semantic-judge validation
- **Layer 2 — Complexity Router**: tier selection + fallback

This plan answers feasibility, picks a showcase format, defines the architecture, and gives you a step-by-step path from empty repo to demo day.

---

## 1. Is it feasible? — Short answer: **Yes, with scope discipline.**

| Concern | Verdict | Evidence |
|---|---|---|
| Can a student team build a working LLM gateway in ~8 weeks? | Yes | LiteLLM-style proxies are ~2k LOC for core routing; you have prior art to study, not clone |
| Is the "local proxy + base-URL override" pattern real? | Yes, mainstream | Cursor, Aider, Claude Code, VS Code all support base-URL override; this is how LiteLLM, Portkey distribute |
| Will the three layers *all* work at research-grade? | **No — pick depth over breadth** | Semantic-judge caching alone is a strong paper; trying to ship all 3 at production quality in 8 weeks produces 3 shallow demos |
| Provider ToS risk? | Manageable via **BYOK** | User supplies their own API keys; Sway never proxies keys it owns. This is how LiteLLM operates |
| Does it deliver novelty for the research-paper component (20 marks)? | Yes, if you focus on **semantic-judge correctness** or **complexity-aware routing with measured signals** — both are active research areas (Cortex, CMAB papers cited in reports) |

**The honest risk**: the market already has LiteLLM, Portkey, Bifrost, OpenRouter. Your differentiation *cannot* be "we built a gateway." Your differentiation is:

> **Prompt canonicalization as a cache-hit multiplier** — Sway rewrites every incoming prompt into a golden-template form *before* it touches the semantic cache, so 10 messy variants of the same intent collapse into 1 cache entry. Layers 0 and 1 compound: the optimizer feeds the cache, and we measure the lift.

Supporting features: complexity-aware routing (Layer 2), dashboard with prompt-diff view, benchmark harness.

---

## 2. Showcase format — **npm package is the right call, with nuance**

### Recommended primary form: **npm-installable CLI that launches a local proxy**

```bash
npx sway start                 # boots proxy on localhost:8765
export OPENAI_BASE_URL=http://localhost:8765/v1
# now Cursor, Aider, Claude Code, any OpenAI SDK routes through Sway
```

**Why npm specifically:**
- Node.js has the best ecosystem for HTTP proxies (`express`, `http-proxy-middleware`, `undici`)
- `npx` means zero-install demos — huge for your presentation
- Publishing to npm is free, gives you a real artifact examiners can `npx sway` live
- TypeScript types ship for free, which matters if you also expose a programmatic API

**What to also ship alongside the package:**
1. **Local dashboard** at `localhost:8765/dashboard` (React/HTML) showing cache-hit rate, cost saved, routing decisions. This is your *visual* demo — far more compelling than terminal logs.
2. **A one-page benchmark report** with before/after numbers on a fixed workload (e.g., 1000-query RAG set). This is your research evidence.
3. **A 5-minute demo video** where you run a real Cursor/Aider session through Sway with the dashboard visible.

### What NOT to do
- **Don't** ship language-specific SDK wrappers (Python, Go). Fragmentation risk, and the base-URL pattern makes them unnecessary.
- **Don't** try to ship a hosted SaaS. Violates Anthropic's 2026 wrapper-reseller clause and adds ops burden.
- **Don't** ship as a VS Code extension *only* — too narrow, and the proxy pattern already works in VS Code via settings.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (Cursor, Aider, Claude Code, OpenAI SDK, curl)          │
│  OPENAI_BASE_URL=http://localhost:8765/v1                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /v1/chat/completions
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Sway Proxy (Node.js + TypeScript, Fastify)                     │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Request Normalizer                                         │  │
│  │   - canonicalize whitespace, strip volatile fields         │  │
│  │   - compute exact-hash on raw prompt (pre-opt cache key)   │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Layer 0: Prompt Optimizer  ◀── THE HEADLINE LAYER          │  │
│  │   a. Intent classifier (cheap LLM): code / Q&A / refactor  │  │
│  │   b. Template selector (CO-STAR / Persona / CoT)           │  │
│  │   c. Rewrite via Gemini Flash or Haiku:                    │  │
│  │      raw → {persona, task, constraints, format, examples}  │  │
│  │   d. Store (raw_prompt, optimized_prompt) pair for diff    │  │
│  │   Transparent Mode (default): auto-dispatch                │  │
│  │   Review Mode (opt-in):       hold via SSE, await approval │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Layer 1: Semantic Cache   (keyed on OPTIMIZED prompt)      │  │
│  │   a. Exact hash on optimized prompt → return               │  │
│  │   b. Embed via all-MiniLM-L6-v2 (onnxruntime)              │  │
│  │   c. ANN lookup in SQLite + sqlite-vec                     │  │
│  │   d. Top-K → semantic judge (Gemini Flash / Haiku)         │  │
│  │   e. Judge approves → return cached response               │  │
│  │   ** hit-rate lift vs raw-prompt keying = research result **│  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          ▼ (cache miss)                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Layer 2: Complexity Router                                 │  │
│  │   Signals: token count, tool/schema presence, code blocks  │  │
│  │   Output: tier ∈ {nano, mid, flagship} + fallback chain    │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Upstream Dispatcher (openai / anthropic / gemini)          │  │
│  │   - Streams SSE back to client verbatim                    │  │
│  │   - Writes (optimized_prompt, response) to cache           │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Telemetry → SQLite → Dashboard                             │  │
│  │   raw_prompt | optimized_prompt | tokens | cost | cached   │  │
│  │   Diff View · Clarity Score · Cache-hit lift chart         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Technology choices (concrete)

| Component | Choice | Why |
|---|---|---|
| Runtime | **Node.js 20 + TypeScript** | Matches report decision; best proxy ecosystem |
| HTTP framework | **Fastify** | Faster than Express, better streaming, first-class TS |
| Embeddings | **`@xenova/transformers` (all-MiniLM-L6-v2)** | Runs in-process via ONNX, no Python required |
| Vector store | **SQLite + `sqlite-vec`** | Zero-install, single file, ships inside the npm package |
| Semantic judge | **Gemini Flash / Haiku via API** (cheap) with opt-in local 1B model | Local 1B is great in papers, painful to ship via npm |
| Config | **`~/.sway/config.yaml`** + env overrides | Standard pattern (like `~/.aws/credentials`) |
| Key storage | **OS keychain via `keytar`** | Don't write API keys to disk in plaintext |
| Dashboard | **Vite + React**, served as static bundle by proxy | Small, familiar, no separate server |
| Tests | **Vitest** | Fast, TS-native, works with Fastify |
| Package mgr | **pnpm** | Monorepo-friendly if you split `core` + `dashboard` |

---

## 4. Repo layout

```
sway/
├── packages/
│   ├── core/                     # the npm package: `sway`
│   │   ├── src/
│   │   │   ├── proxy/            # HTTP server, OpenAI-compat routes
│   │   │   ├── optimizer/        # Layer 0: intent class, rewriter, templates
│   │   │   ├── cache/            # Layer 1: normalize, embed, ANN, judge
│   │   │   ├── router/           # Layer 2: complexity classifier
│   │   │   ├── providers/        # upstream: openai, anthropic, gemini
│   │   │   ├── telemetry/        # metrics DB + event bus
│   │   │   ├── config/           # config loader, keychain
│   │   │   └── cli.ts            # `sway start|status|config|stats`
│   │   └── package.json
│   └── dashboard/                # React app, bundled into core at build
│       └── src/
├── benchmarks/                   # workloads + eval scripts for paper
├── docs/                         # architecture, ADRs
└── examples/                     # cursor-integration, aider-integration
```

---

## 5. Step-by-step execution plan (Week 1 → Demo Day)

Calibrated against your academic timeline (abstracts due **2026-03-17**, final paper/presentation **2026-05-04 to 2026-05-08**). Today is **2026-04-16**, so you have ~3 weeks. This plan is aggressive — stay ruthless about scope.

### Step 1 — Walking skeleton (Days 1–3)
- `pnpm init`, TypeScript + Fastify scaffold
- Implement passthrough proxy: `POST /v1/chat/completions` → OpenAI/Anthropic, stream response back unchanged
- `npx sway start` boots it
- **Milestone**: Cursor with `OPENAI_BASE_URL=http://localhost:8765/v1` works end-to-end, indistinguishable from direct

### Step 2 — Telemetry + dashboard shell (Days 4–5)
- SQLite metrics table: `requests(id, ts, provider, model, input_tokens, output_tokens, latency_ms, cached, route_tier)`
- Minimal dashboard at `/dashboard`: total requests, total cost, latency histogram
- **Milestone**: Every request visible with cost + latency

### Step 3 — Layer 1, naive (Days 6–8)
- Exact-hash cache first (easy win, big hit rate on repeated prompts)
- Add `@xenova/transformers` embedding on cache miss
- SQLite + `sqlite-vec` for ANN
- Cosine threshold only (no judge yet) — deliberately naive baseline
- **Milestone**: Cache-hit rate measurable on a fixed workload

### Step 4 — Layer 1, judge stage (Days 9–11) ← **your research contribution**
- Implement two-stage: ANN top-5 → semantic judge (Gemini Flash) validates each
- A/B compare threshold-only vs judge: **measure false-positive rate on a labeled set**
- This gives you the numbers for your paper
- **Milestone**: Judge reduces false positives by X% at Y% recall — these are your headline numbers

### Step 5 — Layer 0, Prompt Optimizer (Days 12–13) ← **the headline**
- `packages/core/src/optimizer/engine.ts`
- Intent classifier: one cheap Gemini-Flash call returns `{intent: code|qa|refactor|explain, persona, expected_format}`
- Template selector: CO-STAR-style golden template per intent
- Rewriter: second cheap LLM call produces canonical optimized prompt
- **Hash both** raw and optimized; store in telemetry with `optimization_ms` timing
- Feature-flag via `SWAY_OPTIMIZER=on|off` so you can A/B at runtime
- **Milestone**: every request logs (raw, optimized) pair; optimizer overhead < 300ms p50

### Step 6 — Telemetry + Dashboard Diff View (Day 14)
- Extend metrics table: `raw_prompt, optimized_prompt, clarity_score, optimizer_ms`
- Dashboard "Prompt Diff" page: left = raw, right = optimized, with a simple diff highlight
- Add "Cache-hit lift" chart: hit-rate with optimizer ON vs OFF over time
- Review Mode toggle (stretch): if ON, SSE holds the request, dashboard glows, user approves in browser before dispatch

### Step 7 — Layer 2, routing (Days 15–16)
- Rule-based classifier: tokens < 500 + no tools → nano tier; else flagship
- Add signals: tool-schema presence, code-block count, keyword heuristics
- Fallback chain on 429/5xx
- **Milestone**: cost-per-query drops measurably with no quality regression

### Step 8 — Benchmarks + paper writing (Days 17–19)
- Fixed workload: 500 real queries including **deliberate paraphrase clusters** (10 variants of the same intent ×50 intents) — this is where the optimizer+cache compounding shows up
- Three runs per workload: **(a)** direct to OpenAI, **(b)** Sway with optimizer OFF, **(c)** Sway with optimizer ON
- Record per run: cost, latency p50/p95, cache-hit rate, quality (LLM-judge eval)
- Headline number for paper: **cache hit-rate lift from canonicalization (c vs b)**
- Write the 6–8 page paper around these numbers

### Step 9 — Polish + npm publish (Day 20)
- `sway --help`, config wizard, good errors
- README with GIF of the prompt-diff dashboard
- `npm publish --access public`, tag v0.1.0 on GitHub

### Step 10 — Demo prep (Day 21+)
- 5-min video: live Cursor session through Sway, dashboard in split-screen showing raw→optimized diff in real time
- Slides built around the hit-rate-lift chart
- Rehearse `npx sway start` live — and rehearse toggling Review Mode on for the "wow" moment

### Cut list (if behind schedule)
1. Drop Review Mode (keep transparent-only) — saves 1 day
2. Drop Layer 2 routing, keep it as "future work" — saves 2 days, paper still strong (Layers 0+1 are the contribution)
3. Drop local dashboard, ship CLI `sway stats` instead — last resort, hurts demo

---

## 6. Maintenance model (post-submission)

Even as a student project, if you publish to npm:

- **Versioning**: SemVer. 0.x until architecture stabilizes.
- **Provider API drift**: OpenAI/Anthropic break request/response shapes ~quarterly. Pin provider SDK versions; use contract tests against recorded fixtures.
- **Config migrations**: `~/.sway/config.yaml` must be forward-compatible. Add a `version:` field from day one.
- **Cache schema**: SQLite migrations via `better-sqlite3` + a migrations folder. Never silently invalidate user cache.
- **Telemetry opt-out**: If you ever add analytics, make it opt-*in*. Respect `DO_NOT_TRACK=1`.
- **CI**: GitHub Actions — lint, typecheck, vitest, build dashboard. Block PRs without tests.
- **Issue triage**: Template: "what client did you use, what was `OPENAI_BASE_URL`, what did the request look like, what error." 80% of bug reports will be client-compatibility issues.

---

## 7. Critical files & functions to build (reference for implementation)

These are all *new* — you have no existing code yet. But call out the canonical file paths so the team agrees up front:

- `packages/core/src/proxy/server.ts` — Fastify app, OpenAI-compat routes
- `packages/core/src/proxy/streaming.ts` — SSE passthrough preserving token accounting
- `packages/core/src/optimizer/intent.ts` — **research surface A** — cheap-LLM intent classifier
- `packages/core/src/optimizer/templates.ts` — CO-STAR / Persona / CoT golden templates per intent
- `packages/core/src/optimizer/engine.ts` — **research surface B** — rewrite pipeline, clarity score
- `packages/core/src/optimizer/reviewMode.ts` — SSE hold/approve flow (stretch)
- `packages/core/src/cache/normalize.ts` — canonicalization + exact hash
- `packages/core/src/cache/embed.ts` — `@xenova/transformers` wrapper
- `packages/core/src/cache/store.ts` — sqlite-vec ANN wrapper
- `packages/core/src/cache/judge.ts` — two-stage validation
- `packages/core/src/router/classifier.ts` — complexity scoring
- `packages/core/src/router/policy.ts` — tier selection + fallback
- `packages/core/src/providers/{openai,anthropic,gemini}.ts` — upstream adapters
- `packages/core/src/telemetry/metrics.ts` — writes `(raw, optimized, cost, cached, ms)` per request
- `packages/core/src/cli.ts` — commander-based CLI

---

## 8. Verification — how to prove it works

1. **Unit**: `pnpm test` — vitest covers normalize, embed, intent classifier, templates, policy in isolation
2. **Integration**: recorded-fixture tests for each provider adapter (no live API calls in CI)
3. **Optimizer correctness**: golden-file tests — for 20 curated raw prompts, snapshot the optimized output and fail CI if a template change silently drifts it
4. **End-to-end, paraphrase set**: boot proxy, fire 10 paraphrases of each of 50 intents; assert cache-hit rate with optimizer ON ≫ with optimizer OFF. This is the paper's core claim automated as a test.
5. **End-to-end, real tool**: point Cursor at `http://localhost:8765/v1`, use for 30 minutes, confirm zero visible regressions + dashboard shows the raw→optimized diff live
6. **Benchmark**: the 500-query workload from Step 8, reproduced by `pnpm bench` — numbers go straight into the paper
7. **Publish smoke test**: `npx sway@latest start` on a clean Docker container before demo day

---

## 9. Research question & examiner framing

**Research question for the paper:**
> Does pre-dispatch prompt optimization increase semantic-cache hit-rates by canonicalizing user intent, and does that lift outweigh the optimizer's added latency and token cost?

**Hypothesis:** users ask for the same thing N different messy ways. If Sway rewrites each into one canonical prompt, cache hits on the 2nd…Nth variant instead of missing. Net compute spend drops despite the optimizer's per-request overhead.

**Headline pitch (what to say to examiners):**
- "Sway is an OpenAI-compatible local proxy. Our contribution is Layer 0 — a prompt optimizer that canonicalizes intent before caching."
- "Our benchmark shows optimizer-ON cache hit-rate is X% vs Y% with optimizer-OFF, on a paraphrase-heavy workload."
- "Routing is a supporting feature. Agentic decomposition is future work."
- "Artifact: published on npm, reproducible `pnpm bench`, live demo via `npx sway start`."

Honest scope beats overclaiming. The reports warn that shipping all layers at production quality trades "compute waste for wrong answers at scale" — examiners will respect the discipline, and the Layer 0 × Layer 1 compounding story is a cleaner research contribution than any one layer alone.
