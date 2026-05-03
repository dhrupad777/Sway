# sway-llm

Cut LLM costs from your terminal. BYOK. One npm install away.

Sway wraps your prompts with three compounding cost-reduction mechanisms and
shows you the savings as a number you can defend.

```
npx sway-llm ask "explain closures in JavaScript"
```

## The three mechanisms

1. **Context auto-injection** — drop a `sway.md` in your repo. Sway prepends it
   to every call so you stop pasting the same context inline. The file is
   hashed; identical context across calls means providers can cache it server-side.
2. **Structured prompting** — a cheap pre-call (Gemini Flash, ~$0.075/M input)
   classifies intent and rewrites your raw prompt into a CO-STAR-style template.
   Tighter prompts → fewer wasted output tokens → cheaper, better answers.
3. **Model routing** — a rules-based classifier picks `nano` vs `flagship` per
   request. Trivia goes to Haiku; refactors go to Sonnet. You stop overpaying
   for simple questions.

Each mechanism is independently togglable so you can ablate (and benchmark) them.

## Install

```bash
npm i -g sway-llm
# or one-shot
npx sway-llm <command>
```

You need keys for at least one provider. Sway supports four:

- **Amazon Bedrock (default)** — long-term API key (bearer token) via
  `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` (default `us-east-1`). Uses Claude
  models on Bedrock; ideal if you have AWS credits.
- **Anthropic direct** — `ANTHROPIC_API_KEY`
- **OpenAI** — `OPENAI_API_KEY`
- **Gemini** — `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Cheapest option for the
  optimizer pre-call.

You can either export these in your shell, **or** drop a `.env` file in the
project root with `KEY=VALUE` lines (one per env var). Sway reads `.env`
automatically on every command. Shell-set env vars take precedence over
`.env` if both are present. `.env` is gitignored by default.

The default config (see `src/pricing.ts` → `DEFAULTS`) uses Bedrock for all
three roles (flagship, nano, optimizer). Switch to a different provider by
overriding `DEFAULTS.flagship`/`nano`/`optimizer` to any model in the `PRICING`
table.

## Quick start

```bash
sway init                                     # creates a starter sway.md
sway ask "what is the capital of France?"     # runs through all 3 mechanisms
sway ask --no-optimize "..."                  # ablate mechanism 2
sway ask --no-route "..."                     # ablate mechanism 3
sway ask --no-context "..."                   # ablate mechanism 1
sway ask -m claude-haiku-4-5 "..."            # force a specific model
sway stats                                    # see recent calls + totals
sway stats --verbose                          # also show optimized prompts
sway models                                   # known models + pricing
```

## Benchmark (the demo)

```bash
sway bench workloads/default.json
```

Sends every prompt **twice**: once direct to the flagship model with no Sway
mechanisms (raw API), once through Sway. Prints a table:

```
                Raw API    Sway       Savings
Total cost      $0.4821    $0.1183    75.4%
Input tokens    284,310    62,840     77.9%
Output tokens   31,200     29,810     4.5%
Calls           30         30
Routing breakdown: nano=22/30 flagship=8/30
```

The default workload is paraphrase-heavy on purpose — that's where context
reuse + structured prompting compound most. For a more conservative number,
write your own workload JSON with diverse tasks.

## Files

- `src/cli.ts` — `sway ask | init | stats | models | bench`
- `src/context.ts` — sway.md loader + hash
- `src/optimizer.ts` — Gemini Flash rewriter
- `src/router.ts` — rule-based tier picker
- `src/providers.ts` — anthropic / openai / gemini adapters
- `src/metrics.ts` — SQLite logger at `~/.sway/metrics.db`
- `src/pricing.ts` — `$/Mtok` table (refresh me)
- `src/bench.ts` — workload runner + diff printer

## Honest caveats

- Pricing in `src/pricing.ts` is a snapshot — providers update prices quietly.
  Refresh before reporting numbers in a paper.
- The optimizer adds one cheap LLM call per request (~$0.0001). On
  paraphrase-heavy workloads it pays for itself many times over. On a workload
  of 30 unique-intent prompts, it can cost more than it saves — measure both.
- BYOK: Sway never sees keys you don't put in your environment, and never
  proxies them anywhere. Storage is local SQLite at `~/.sway/metrics.db`.

## License

MIT.
