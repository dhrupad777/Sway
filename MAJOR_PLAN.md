# Sway v0.2 — Major Project Plan

Goal: move Sway from "it's cheaper" (v0.1) to **"it's X% cheaper at equal quality, and here is the evidence"**,
and from a CLI demo to a gateway any app can use.

Every phase has a **metric** — that is how progress over the mini-project is defined.

| # | Phase | New files | Command(s) | Progress metric |
|---|---|---|---|---|
| 1 | Quality evaluation harness | `src/judge.ts`, `src/eval.ts`, `src/pipeline.ts`, `evals/cs101_eval.json` | `sway eval` | Cost saved vs quality kept, per config (Pareto table) |
| 2 | Learned router + escalation | `src/learned-router.ts` | `sway train-router` | Holdout accuracy / % sent to cheap model at equal quality, vs v0.1 rules |
| 3 | Semantic cache | `src/embeddings.ts`, `src/semcache.ts`, `evals/cache_pairs.json` | `sway cache-eval` | Hit rate vs false-hit rate per similarity threshold |
| 4 | OpenAI-compatible gateway | `src/proxy.ts` (+ streaming in `providers.ts`) | `sway proxy` | Works with any OpenAI SDK client; gateway overhead (ms); per-project budgets |
| 5 | Context retrieval + history compression | `src/context.ts` (extended) | `sway ask --context-mode retrieve` | Input tokens saved at equal quality |

## Status

- [x] Phase 0 — plan written
- [x] Phase 1 — quality evaluation (code + 40-item dataset)
- [x] Phase 2 — learned router + escalation (code)
- [x] Phase 3 — semantic cache (code + 40-pair dataset)
- [x] Phase 4 — gateway / proxy (endpoints, errors, budget 429 and streaming verified locally)
- [x] Phase 5 — context retrieval + history compression (code)
- [x] Phase 6 — README + 12 unit tests (all passing), `npm run build` clean
- [ ] **Results** — blocked: the Gemini key's prepaid credits are depleted (HTTP 402).
      Top up, then run the "How to run the full evaluation" steps below and paste the tables into the report.

---

## Phase 1 — Quality evaluation harness

**Problem in v0.1:** savings were reported with no measure of answer quality. The Sway path also had a lower
output cap (1000–2048) than raw (4096), so part of the "savings" may be shorter, worse answers.

**Build:**
- `src/pipeline.ts` — one shared Sway pipeline (context → optimizer → semantic cache → router → call → escalation),
  used by `ask`, `eval` and `proxy`. Each stage is switchable for ablation.
- `src/judge.ts` — LLM-as-judge. Scores an answer 1–10 against an optional reference answer, returns JSON
  `{score, reason}`. Judge model configurable (`--judge`), default = flagship.
- `src/eval.ts` — `sway eval <dataset> [--configs flagship,nano,sway-v01,sway-learned,sway-full]`.
  Runs every item through every config, judges each answer, stores rows in a new `evals` SQLite table,
  prints a table and writes `reports/eval_<run>.md` + `.csv`.
- `evals/cs101_eval.json` — 40 prompts (easy + hard) with reference answers.

**Metric:** for each config: avg cost, avg quality, cost saved vs flagship, quality change vs flagship.
Headline claim format: *"sway-learned: 71% cheaper, quality 8.4 vs 8.6 (−0.2)"*.

**Known limitation:** the judge is itself an LLM (possible self-preference bias). Mitigation: reference answers,
temperature 0, and `--judge` lets you use a different model family.

## Phase 2 — Learned router + escalation

**Problem in v0.1:** keyword rules (`refactor`, `debug`, …) decide the model. Not measured, not learned.

**Build:**
- Training labels come free from Phase 1: for each eval item we have both nano and flagship answers graded.
  Label = `1 (needs flagship)` if `nano_score < flagship_score − 1` or `nano_score < 7`.
- Features: v0.1 hand features (length, code blocks, file path, keyword hits, question words) + prompt embedding.
- Model: logistic regression with L2, trained in pure TypeScript (no ML dependency). Saved to `~/.sway/router.json`.
- `sway train-router [--run <evalRunId>]` prints holdout accuracy for **rules vs learned**.
- Threshold chosen to keep quality — prompts with P(needs flagship) ≥ threshold go to flagship.
- **Escalation:** if the nano answer is empty, truncated, or hedges ("I'm not sure…"), retry on flagship.
  Recorded as `escalated` in metrics.

**Metric:** routing accuracy (learned vs rules), % traffic on nano, quality at that split (re-run `sway eval`).

## Phase 3 — Semantic cache

**Problem in v0.1:** exact-text cache only, in memory, lost when the process exits.

**Build:**
- `src/embeddings.ts` — Gemini embeddings, memoized in SQLite (`embeddings` table) so a prompt is embedded once.
- `src/semcache.ts` — persistent cache in SQLite (`sem_cache` table). Lookup = cosine similarity over stored
  prompt vectors, filtered by context hash and TTL (24h). Threshold default 0.92, `--sim` to change.
- `evals/cache_pairs.json` — 40 labelled prompt pairs (same intent / different intent, including tricky
  near-misses like "loop vs recursion" vs "what is recursion").
- `sway cache-eval` — sweeps thresholds 0.80→0.98, prints hit rate, false-hit rate, precision.

**Metric:** the threshold sweep table; chosen threshold must keep false-hit rate ≤ 5%.

## Phase 4 — OpenAI-compatible gateway

**Problem in v0.1:** only usable through the CLI or the dashboard.

**Build:**
- `sway proxy --port 8788` — `POST /v1/chat/completions`, `GET /v1/models`, `GET /health`.
  - `model: "sway-auto"` → full pipeline (routing etc.). Any model in the pricing table → that model, with cache.
  - `stream: true` → Server-Sent Events, real token streaming (Gemini, OpenAI, Anthropic; Bedrock = one chunk).
  - Per-project daily budget: project = `x-sway-project` header (default `default`), limit via `--budget <usd>`.
    Over budget → HTTP 429.
  - Response headers: `x-sway-cost-usd`, `x-sway-model`, `x-sway-cache`, `x-sway-overhead-ms`.
- Usage: point any OpenAI SDK at `http://localhost:8788/v1` — no app code changes.

**Metric:** gateway overhead in ms (target < 50 ms excluding LLM calls), works with the official `openai` client.

## Phase 5 — Context retrieval + history compression

**Problem in v0.1:** the whole `sway.md` is sent on every call, even sections irrelevant to the prompt.

**Build:**
- `sway.md` is split on `## ` headings. Preamble is always kept; other sections are ranked by embedding similarity
  to the prompt and only the top ones are sent (`--context-mode retrieve`).
- Proxy: when a conversation is long, older turns are summarised once by the cheap model and replaced by the summary.

**Metric:** context tokens sent (full vs retrieve) and quality (eval config `sway-retrieve`).

## Phase 6 — Wrap-up

- `npm test` — unit tests for the pure parts (logistic regression, cosine, section split, features, SSE format).
- README updated with new commands and the evaluation method.

## How to run the full evaluation (after the code is done)

```bash
npm run build
sway eval evals/cs101_eval.json --configs flagship,nano,sway-v01     # baseline + labels  (roughly $2–4 with a Pro judge)
sway train-router                                                    # learn from that run
sway eval evals/cs101_eval.json --configs flagship,sway-v01,sway-learned,sway-full
sway cache-eval evals/cache_pairs.json
sway proxy --budget 1   # then point an OpenAI client at http://localhost:8788/v1
```
