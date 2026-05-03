# Sway Project Deep Research Report on Building an Intelligent LLM Gateway

## Executive summary

Sway’s core idea—an “intelligent LLM gateway” that reduces waste via (1) semantic caching, (2) intelligent routing, and (3) agentic chunking—is directionally aligned with where the market has already moved: most production teams now treat “LLM access” as an infrastructure layer (a gateway) rather than a raw SDK call. This is visible in the rise of LLM proxies/gateways that sit between apps and multiple LLM providers, offering routing, caching, and governance in a single place. citeturn0search12turn1search11turn3search30

However, several “hard truths” emerge from market and research evidence:

Provider-native “prompt caching” (KV/prefix caching) already knocks out a meaningful chunk of redundant compute for long, repeated prefixes—often automatically—and can materially reduce latency and input costs for repeated prompt prefixes. citeturn0search10turn3search1turn0search3  
The remaining waste that Sway targets (semantic duplicates, overpowered model selection, and hallucinations in complex jobs) requires application-layer intelligence and careful correctness controls (validation/judging, scoped caching, TTL, and deterministic orchestration), or you will trade “compute waste” for “wrong answers at scale.” Research on semantic caching explicitly frames this as a mismatch-cost tradeoff and highlights that eviction/selection is non-trivial under uncertainty. fileciteturn2file1

A Node-installable gateway is feasible and already proven as a distribution pattern: the market already uses “install and run a local gateway/proxy, then point your clients/IDEs to its base URL.” This works best when the gateway implements an OpenAI-compatible API surface, because many tools/IDEs can already target OpenAI-compatible endpoints by switching the base URL. citeturn4search33turn4search9turn4search8

The strongest “differentiation” path for Sway is not reinventing a proxy, but innovating in a few high-leverage places: robust semantic cache correctness (judge/verification), policy-driven routing based on measurable complexity, and agentic decomposition that enforces schema-validated steps and evaluation hooks. fileciteturn2file2 citeturn5search3turn2search3turn2search4

## Problem landscape: where compute waste actually happens

Sway’s problem statement maps well onto observed bottlenecks in both provider-side serving and agentic application patterns:

Repeated long prompt prefixes are a major waste vector in modern prompts (system prompts, tool schemas, repeated context). “Prefix-based context caching” (prompt caching) exists because many prompts contain repeated immutable chunks, but classic prefix caching requires exact prefix matches and breaks if prefixes vary. fileciteturn2file0  
For long prompts that repeat, major providers now offer native prompt caching. OpenAI describes automatically caching the longest previously computed prefix beginning at 1,024 tokens, exposing `cached_tokens` to help measure cache hits. citeturn0search10turn0search2  
entity["company","Anthropic","llm provider"] provides prompt caching via request annotations (`cache_control`) and explicitly says its caching stores KV cache representations and cryptographic hashes, not raw prompt/response text—positioning it as compatible with zero-data-retention style requirements in some contexts. citeturn0search3turn3search2

Semantic duplicates (different wording, same intent) are not solved by provider prompt caching because the prefix differs; this is where semantic response caching helps. The attached semantic caching paper notes prior work finding that a non-trivial fraction of LLM queries are semantically similar, and frames semantic caching as retrieval based on semantic similarity rather than exact matching. fileciteturn2file1

Agentic workloads add another major waste channel: repeated remote tool calls (search, RAG backends, APIs). The attached Cortex paper argues that external knowledge/tool access can dominate latency/cost and that naive embedding-only caches struggle because “near in embedding space” does not guarantee semantic equivalence or freshness. fileciteturn2file2

Finally, hallucinations and reasoning failures on complex tasks are increasingly mitigated by moving from single-shot prompting to structured multi-step workflows with tool schemas, validation, and orchestration frameworks. OpenAI’s own guidance treats tool calling as a multi-step interaction loop, and both OpenAI and Anthropic now support schema validation / “strict mode” behavior to enforce structured outputs. citeturn2search11turn5search3turn2search4

## Market landscape: current tools similar to Sway’s three layers

The market already contains most of the primitives Sway describes, but they are fragmented across different products. This is useful: it tells you what is feasible, what is commoditized, and where you must differentiate.

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["LLM gateway proxy architecture diagram","semantic caching vector database diagram","prompt caching KV cache diagram","agent orchestration LangGraph diagram"],"num_per_query":1}

### Semantic caching and response reuse

“Semantic caching” solutions generally combine an embedding model + vector store + similarity threshold, then reuse a stored response on a cache hit.

entity["organization","GPTCache","semantic cache library"] is an open-source semantic cache library that supports multiple vector stores (for example, Milvus, Zilliz Cloud, FAISS) to retrieve semantically similar prior requests. citeturn1search0turn1search3  
entity["organization","LangChain","llm framework"] documents caching integrations (including semantic caching options) and the ecosystem includes Redis-backed semantic cache patterns. citeturn1search14turn1search29  
entity["company","Redis","database company"] frames semantic caching as intent-based retrieval, contrasting it with literal key-based caching. citeturn1search26

Key market takeaway: semantic caching is common, but correctness is the differentiator. The Cortex paper argues that embedding similarity alone can produce false positives and proposes a two-stage pipeline (ANN candidates → lightweight “semantic judge” model validation) to make cache hits reliable. fileciteturn2file2

### Routing, fallbacks, and model multiplexing

Routing tools aim to select the “right” model (capability vs cost/latency) and handle failover.

entity["organization","LiteLLM","llm proxy project"] positions itself as an OpenAI-compatible proxy/gateway supporting many providers and includes both routing and caching capabilities. citeturn0search12turn0search31turn0search8  
entity["company","OpenRouter","llm routing api"] provides unified access to models through an OpenAI-compatible schema and explicitly supports provider routing and selection controls. citeturn1search8turn1search20  
entity["company","Portkey","ai gateway company"] documents an “AI Gateway” with conditional routing, fallbacks, and both “simple and semantic caching,” indicating that “gateway + routing + caching” is already a mainstream product shape. citeturn0search13turn0search9

Key market takeaway: “intelligent routing” is already offered in gateways; Sway’s uniqueness must come from *how* it classifies complexity and enforces consistent quality, not from the presence of routing alone.

### Agentic orchestration and hallucination reduction

“Agentic chunking” is closest to what orchestration frameworks already do: turn a complex job into a structured workflow with retries, guardrails, and validation.

entity["organization","LangGraph","agent orchestration framework"] is explicitly positioned as an “agent orchestration” framework designed for reliable handling of complex tasks via graph-based workflows and control. citeturn2search8  
OpenAI provides an Agents guide and an Agents SDK emphasizing orchestration patterns (“LLM decides” vs “code orchestrates”), which maps directly onto Sway’s “agentic chunking with deterministic pipelines.” citeturn2search0turn2search3turn2search13  
entity["organization","AutoGen","multi-agent framework"] is a multi-agent conversation framework aimed at composable agent behavior and tool use, reflecting a common path to reduce reasoning failures via multi-agent decomposition and verification. citeturn2search2turn2search27  
OpenAI Structured Outputs and strict function calling are designed to force schema adherence, reducing “invalid JSON / made-up fields” failure modes in pipelines (a practical hallucination class). citeturn5search0turn5search3turn5search4  
Anthropic’s tool use docs similarly describe schema validation (`strict: true`) to ensure tool inputs follow schema, supporting deterministic pipeline execution. citeturn2search4

Key market takeaway: hallucination reduction is increasingly treated as an *engineering discipline*: schemas + validators + multi-step plans + eval/telemetry. A gateway can help, but only if it can reliably identify “complex tasks” and trigger structured workflows without breaking developers’ expectations.

## Sway’s three-layer architecture mapped to implementable systems

This section translates Sway’s conceptual layers into concrete, buildable components—also highlighting where “API gateway constraints” limit what you can do unless you control the serving stack.

### Semantic caching as an application-layer “zero cost” layer is not truly zero cost

Sway’s Layer 1 is described as “Zero Cost,” but in real deployments semantic caching has costs and risks:

Embedding cost/latency: every request still requires embedding, unless you implement cheaper heuristics first (hashes, exact match, normalization). The semantic caching paper models this as a serving-cost vs mismatch-cost tradeoff and treats cache decision-making as non-trivial under uncertainty. fileciteturn2file1  
Mismatch risk: serving a semantically “similar” cached answer can be wrong (different time, different constraints, subtle wording). This is exactly why Cortex adds a semantic judge stage before declaring a cache hit. fileciteturn2file2

A robust Sway Layer 1 in 2026 typically looks like:

Request normalization + exact cache → semantic candidate retrieval → semantic judge/validator → return cached answer or continue.

This aligns with Cortex’s two-stage retrieval pipeline (ANN candidate selection + lightweight LLM judge). fileciteturn2file2

### Intelligent routing as policy + measurement, not “model guessing”

Routing becomes production-grade when it can justify decisions using measurable signals:

Gateways like LiteLLM and Portkey already support routing/fallbacks; therefore, Sway’s advantage must be in its “complexity categorizer” and policy controls rather than basic routing. citeturn0search8turn0search13  
Modern gateways also translate “reasoning knobs” to provider-specific parameters; for example, entity["company","Vercel","developer platform"] describes an AI Gateway that maps reasoning parameters to each provider’s native format, indicating that “capability scaling” is becoming standardized infrastructure. citeturn4search19turn4search8

A credible routing core typically combines:

Static rule routing (regex/classification) + cheap model classifier (“router model”) + dynamic signals (latency, rate limits, error rates, budget use) + fallback tree.

OpenRouter’s provider routing documentation shows routing can also include provider selection controls beyond just model choice. citeturn1search20

### Agentic chunking as deterministic orchestration with enforcement hooks

Sway’s Layer 3 claims to reduce hallucinations by decomposing requests into “deterministic, multi-step agent pipelines.” In market terms, this is:

Graph-based or code-based orchestration + tool schemas + output validation + retries + partial caching.

OpenAI’s tool calling flow is explicitly multi-step (model → tool call → app executes → model consumes results → final answer). citeturn2search11  
OpenAI recommends strict function calling (schema-enforced) to ensure tool-call arguments adhere to schema. citeturn5search3  
Anthropic similarly supports strict tool schemas. citeturn2search4  
OpenAI’s Agents SDK explicitly distinguishes “LLM decides” vs “code orchestrates,” and your description strongly implies “code orchestrates” for determinism. citeturn2search3turn2search13

Where Sway can go beyond typical orchestration:

Use Layer 1 caching *inside* pipelines (cache sub-steps, tool calls, retrieval results), similar to Cortex’s “semantic element” caching at the tool boundary. fileciteturn2file2  
Treat routing as a per-step decision (cheap model for extraction/summary; strong model for final synthesis), not a single decision for the whole request.

## Can Sway be a Node package that “everyone installs” and uses as a terminal gateway?

Yes—technically and distribution-wise, this is realistic. The proven pattern is:

Run a local gateway → point clients/IDEs/apps to its base URL → the gateway forwards to upstream providers.

Why this works:

Many modern LLM clients already support “OpenAI-compatible” endpoints (base URL override). For example, vLLM documents an OpenAI-compatible server and shows using the official OpenAI client by setting `base_url` to the local server. citeturn4search33  
Developer tools and gateways frequently advertise “point your existing client to the gateway base URL.” Vercel’s AI Gateway explicitly states you can point existing clients/tools to the gateway base URL to use OpenAI Chat Completions-style APIs. citeturn4search8

A Node-distributed Sway can therefore ship as:

A local HTTP server exposing `/v1/chat/completions` and/or `/v1/responses` in OpenAI-compatible schema, forwarding to upstream providers while applying caching/routing/pipelines.

This “install then run” shape is already market-proven: Promptfoo’s docs show a Node-based UX for running a local gateway instance (via `npx`) for an AI gateway that can sit in front of providers. citeturn1search32

Practical constraints you must solve for a “universal install” experience:

Streaming fidelity: a gateway must preserve streaming semantics (SSE/chunked transfer) and not break token accounting. (This is why gateways emphasize being “AI-aware forward proxies.”) citeturn1search19turn1search11  
Key management: a local tool needs a secure way to store upstream API keys (env vars, OS keychain, encrypted config).  
Multi-language compatibility: a Node proxy helps Python/Go/Java too, as long as they can target the OpenAI-compatible HTTP endpoint.

The “tell it like it is” part: building a **toy** Node proxy is easy; building a **trusted production gateway** is hard because you must get correctness, privacy, and compatibility right across providers and SDK behaviors.

## Other implementation formats beyond a Node terminal package

### Middleware/library integration

Instead of a proxy, provide a drop-in library that wraps the OpenAI/Anthropic SDK methods and applies caching/routing before calling upstream.

Pros: simpler deployment; direct access to request context and user identity.  
Cons: language-specific; fragmented adoption; harder to support IDE tools.

### Self-hosted team gateway

This is the “enterprise” form of Sway: deploy once (Kubernetes/Docker) and route org traffic through it.

This exactly mirrors how LiteLLM and Portkey position themselves: centralized gateway with routing, caching, budgets, and observability. citeturn0search12turn0search13turn0search5

### IDE extensions and “OpenAI-compatible provider” hooks

In 2026, many IDE assistants can connect to OpenAI-compatible endpoints (or can be configured to do so):

entity["organization","Continue","vscode extension"] documents configuration for OpenAI and “OpenAI API compatible providers” by changing `apiBase`, explicitly listing OpenAI-compatible backends (including LiteLLM and vLLM). citeturn4search9  
VS Code has publicly discussed “bring your own key” support and specifically mentions configuring an “OpenAI Compatible” provider for any OpenAI-compatible endpoint (in Insiders). citeturn4search25  
The VS Code extension “Cline” advertises support for OpenAI-compatible APIs and a large set of providers, implying a gateway endpoint can be slotted in without special integration. citeturn4search16

This means a Sway gateway can become an “extension-compatible backend” without building an extension at all—*if* the tool supports base URL override.

Reality check: some commercial IDEs have partial/buggy support for custom gateways (community threads show friction and edge cases). citeturn4search1turn4search14  
So Sway may need **compatibility modes** (Chat Completions vs Responses, tool schema quirks, etc.) if you want “it just works” in multiple IDEs.

## Do major providers allow gateway tools like Sway, and do they support the needed capabilities?

At a protocol and product level, yes: the ecosystem is already built on the assumption that clients may route through gateways and that caching/routing layers exist. The practical question is which parts of Sway can be implemented *purely externally* vs require provider cooperation or self-hosting.

### Capabilities providers already expose that help Sway

Prompt caching (provider-native):  
OpenAI describes prompt caching that automatically benefits prompts >= 1,024 tokens and reports `cached_tokens`. citeturn0search2turn0search10  
Anthropic documents prompt caching controls (`cache_control`) and explicitly states it does not store raw prompt/response text in prompt caching; it stores KV cache representations and hashes. citeturn0search3turn3search2  
Major cloud platforms also document prompt caching (Azure OpenAI and Amazon Bedrock), which matters because many teams access models through them rather than direct provider endpoints. citeturn0search14turn0search19

Tool use + structured outputs:  
OpenAI supports strict tool calling and Structured Outputs (JSON Schema adherence), supporting deterministic agent pipelines. citeturn5search3turn5search0  
Anthropic supports schema validation for tool inputs (`strict: true`). citeturn2search4

These features directly strengthen Sway’s Layer 3 (agentic chunking) because they reduce “format hallucinations” and make pipelines enforceable.

### Policy and data retention considerations for a gateway

A gateway intrinsically touches prompts and outputs, so you need to design for privacy operations even if providers have their own retention controls.

OpenAI’s “Your data” guide states that abuse monitoring logs may contain prompts/responses and are retained up to 30 days by default, and also documents how `store` affects Responses API retention behavior. citeturn3search0turn5search2  
That same data-controls guidance notes prompt caching uses application state (KV tensors) and can affect Zero Data Retention eligibility in certain cases (especially extended caching behavior). citeturn5search2  
Anthropic documents standard retention timelines and a Zero Data Retention option for certain endpoints/agreements. citeturn3search3turn3search28

Practical implication for Sway:

If you implement semantic caching (Layer 1) by storing prompts/embeddings/responses, then **your gateway becomes the primary data retention surface**, even if the upstream provider offers ZDR. Provider-side “prompt caching” can be ZDR-friendly because it may avoid storing raw text (Anthropic’s positioning), but your *own* cache may store raw content unless you design otherwise. citeturn3search2turn3search3

So Sway must include: per-tenant cache partitioning, encryption at rest, configurable TTL, and controls to disable caching for sensitive routes.

## Research foundations from the attached papers and how they inform Sway

Your uploaded papers describe three complementary lines of research that map surprisingly well to Sway’s layers (and also warn where naive implementations fail).

### Position-independent prompt/KV caching as a “next-level” future for Sway

The EPIC paper explains why classic prefix-based prompt caching requires exact prefix matches and breaks when immutable content is preceded by varying prefixes, and proposes Position-Independent Caching (PIC) to modularly reuse KV vectors regardless of prefix. fileciteturn2file0  
It formalizes PIC as a compile step (precompute/cache KV for immutable chunks) and a link step (concatenate cached KVs and recompute a subset to preserve accuracy). fileciteturn2file0  
EPIC reports large TTFT and throughput improvements (up to 8× TTFT improvement and 7× throughput gains in its experiments) and highlights LegoLink’s approach of recomputing only a small number of “attention sink” initial tokens per chunk to restore accuracy with low overhead. fileciteturn1file7turn2file0

How this informs Sway:

If Sway is purely an **API gateway** in front of closed providers, you cannot implement EPIC-style PIC because you do not control internal KV caches. But if Sway also supports a “self-hosted backend mode” (vLLM/OpenAI-compatible inference server), then EPIC/PIC becomes a powerful Layer-0 optimization below semantic caching—especially for RAG and tool-heavy prompts.

### Semantic caching needs formal treatment of mismatch cost and eviction under uncertainty

The semantic caching paper frames semantic caching as optimizing a loss that trades off fresh LLM cost vs mismatch cost when serving a similar cached response. fileciteturn2file1  
It emphasizes that query arrival probabilities and serving costs are often unknown and must be learned, proposing offline and online learning variants with theoretical guarantees, rather than ad-hoc heuristics. fileciteturn2file1

How this informs Sway:

Your Layer 1 cannot just be “vector similarity > threshold ⇒ cache hit.” A serious Sway implementation needs:

A mismatch-aware policy (thresholds by route/task, confidence calibration)  
An eviction strategy that accounts for cost and uncertainty (not just LRU)  
Telemetry feedback loops to continuously tune thresholds and cache admission.

### Tool-boundary caching is crucial for agentic systems

Cortex focuses on caching at the knowledge/tool boundary for LLM agents (not just caching final LLM outputs). It introduces “Semantic Elements” with embeddings plus performance metadata, and a semantic retrieval index that combines ANN search with a lightweight semantic judge to validate equivalence. fileciteturn2file2  
It argues naive semantic caches are prone to correctness loss without validation. fileciteturn2file2

How this informs Sway:

Agentic chunking (Layer 3) will create repeated sub-steps (search queries, retrieval calls, extraction prompts). Caching these sub-steps can produce larger savings than caching only the final response—especially when tool calls are expensive or rate-limited. Cortex’s architecture provides a blueprint for “cache the pipeline, not just the answer.” fileciteturn2file2

## Sway MVP scope that is both credible and buildable

To convert Sway from a concept into a strong mini-project (and potentially a real open-source tool), the most defensible MVP is:

An OpenAI-compatible local proxy (Node CLI) with:
Semantic cache with two-stage validation (vector search + mini-judge) inspired by Cortex fileciteturn2file2  
Routing policies that can pick between “small/cheap” and “large/strong” models, with transparent logging/metrics like major gateways citeturn0search13turn0search5  
A “complexity triggers pipeline” mode that uses strict structured outputs and schema-validated tools rather than free-form prompting, using provider capabilities that already exist citeturn5search3turn2search4  
IDE compatibility documentation targeting tools that support OpenAI-compatible base URLs (Continue, VS Code Insiders “OpenAI Compatible,” Cline). citeturn4search9turn4search25turn4search16

If you want a “research-forward extension” goal:

Add an optional self-hosted backend mode that can exploit deeper serving-side caching ideas (prompt caching, and eventually PIC concepts like EPIC) when routing to a local OpenAI-compatible inference server. fileciteturn2file0 citeturn4search33