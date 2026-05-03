# **The Sway Architecture: A Systemic Reconstruction of Large Language Model Gateways for Compute Efficiency and Hallucination Mitigation**

The rapid integration of Large Language Models (LLMs) into the global industrial fabric by early 2026 has precipitated a transition from exploratory generative applications toward the necessity of operational efficiency and systemic reliability. As autonomous agents move beyond simple conversational tasks to complex, multi-step reasoning loops, the associated computational overhead, token expenditures, and the persistence of non-deterministic errors—specifically hallucinations—have emerged as prohibitive barriers to enterprise-grade deployment.1 The Sway Project, conceived as an AUM Mini Project for the Spring 2026 semester, addresses these challenges through a specialized tripartite gateway architecture. By functioning as an "intelligent LLM gateway," Sway seeks to rectify the inherent waste in AI compute by synthesizing semantic caching, complexity-aware routing, and agentic data chunking into a unified middleware layer.

The core motivation for Sway arises from the observation that current LLM interactions are plagued by redundant processing. Research suggests that approximately 30% of incoming queries in enterprise environments exhibit high degrees of semantic similarity, yet traditional exact-match caching systems are unable to recognize this overlap, leading to unnecessary recomputation and escalated API costs.3 Furthermore, for agentic workflows where models frequently interact with remote knowledge sources, the latency floor created by Wide-Area Network (WAN) RTT and tool-calling overhead constitutes nearly 40% to 50% of total execution time.3 The Sway architecture is designed to intercept these interactions at the request level, optimizing the data flow before it reaches the model provider.

## **Layer 01: Semantic Caching and Position-Independent Knowledge Reuse**

The foundational layer of the Sway architecture is the Semantic Caching layer, designated as the Zero Cost Layer. Its primary objective is to transform the stochastic nature of natural language queries into a deterministic retrieval problem, thereby bypassing the expensive forward pass of a model whenever possible.3 Unlike legacy caching mechanisms that rely on literal string matching or token-prefix identity, Sway leverages high-dimensional vector embeddings to identify intent-level equivalence.

### **Theoretical Foundations of Semantic Utility and Combinatorial Bandit Frameworks**

The implementation of Layer 01 is grounded in the Combinatorial Multi-Armed Bandit (CMAB) framework, which provides a principled method for managing cache eviction under uncertainty.3 The system models the caching problem by balancing a mismatch cost—representing the utility loss when a semantically similar but non-identical response is served—against the serving cost associated with a fresh model inference.3 The expected loss for a semantic cache ![][image1] is mathematically formalized as:

![][image2]  
In this formulation, ![][image3] denotes the probability of a query ![][image4] arriving, ![][image5] represents the serving cost, and ![][image6] signifies the semantic distance to the closest entry already residing in the cache.3 Analysis indicates that finding the absolute optimal set of ![][image7] query-response pairs to minimize this loss is an NP-hard problem, equivalent to the maximum vertex cover problem on bipartite graphs.3 To overcome this computational barrier, Sway adopts a Reverse Greedy algorithm. This algorithm begins by assuming all previous interactions are cached and iteratively removes the items that contribute the least to the reduction of the total loss until the cache capacity is reached.3

A critical advancement in Sway’s semantic caching is its ability to handle uncertainty through three distinct operational modes: the oracle setting, the offline learning setting, and the online adaptive setting.3 In the online adaptive setting, the gateway utilizes a stage-based switching mechanism to control the frequency of cache updates, thereby minimizing the switching costs associated with populating the cache.3 This is achieved through the use of Lower Confidence Bounds (LCBs), which provide optimistic estimates of serving costs. This approach encourages the system to explore queries with limited feedback, accelerating the convergence toward an optimal caching policy.3

### **Position-Independent Caching and the EPIC Framework**

Standard prompt caching is often limited by its dependence on exact prefix matches. Even minor variations in the system prompt or the reordering of documents in a Retrieval-Augmented Generation (RAG) pipeline can invalidate cached Key-Value (KV) vectors, requiring a full recomputation of the context.3 Sway incorporates the Efficient Position-Independent Caching (EPIC) framework to address this limitation.3 EPIC formalizes Position-Independent Caching (PIC) into a modular two-step framework analogous to the compilation and linking process in traditional software engineering.3

| Phase | Technical Mechanism | Strategic Objective |
| :---- | :---- | :---- |
| **Compile Step** | Individual chunks (documents, instructions) are encoded with position IDs starting from zero. | Generate relocatable KV vectors that are stored as independent modules. |
| **Link Step** | Cached KV modules are retrieved and concatenated for a new request. | Reuse KV vectors regardless of their position in the final prompt sequence. |

Source: 3

The implementation of the link step presents a significant challenge known as the "attention sink" effect. Tokens at the beginning of each independent chunk tend to disproportionately absorb attention scores, which impedes subsequent tokens from attending to the relevant context across the entire sequence.3 Sway utilizes the LegoLink algorithm to mitigate this phenomenon. LegoLink recomputes only a small constant ![][image7] (typically ![][image8]) of initial tokens for each chunk except the first one.3 This limited recomputation allows these tokens to recognize their non-initial status within the global sequence, neutralizing their attention-sink properties. This reduces the recomputation complexity from the standard quadratic ![][image9] to a near-linear ![][image10], enabling up to an 8x reduction in Time-To-First-Token (TTFT) and a 7x gain in throughput.3

### **The Two-Stage Semantic Retrieval Pipeline**

To ensure the integrity of cached responses, Sway implements a dual-stage retrieval pipeline similar to the Cortex architecture.3 The first stage involves a high-recall candidate selection using Approximate Nearest Neighbor (ANN) search through vector similarity.3 However, because surface-level vector proximity does not guarantee semantic equivalence, the system introduces a second stage: the Semantic Judge.3

The Semantic Judge is a lightweight model (typically 1B parameters or smaller) that scrutinizes the candidate matches for true contextual relevance.3 This stage is essential for preventing false positives, such as matching a query about "Apple nutrition facts" with a cached result for "Apple stock prices".3 The system minimizes latency by co-locating the Semantic Judge with the primary agent model on the same hardware using NVIDIA’s Multi-Process Service (MPS).3 By allocating approximately 80% of compute resources to the primary model and 20% to the judge, Sway maintains a high hit rate (over 85% on skewed workloads) while preserving accuracy that is virtually identical to non-cached baselines.3

## **Layer 02: Intelligent Routing and the Multi-Model Nexus**

The second layer of the Sway gateway provides the "Core Intelligence" required to manage the proliferation of model providers and the volatility of token pricing. By 2026, the AI market has fragmented into a multi-provider ecosystem where different models excel at specific tasks, necessitating a governance layer that can route traffic based on cost, latency, and reasoning complexity.1

### **Complexity-Aware Routing Heuristics**

Layer 02 functions by classifying incoming requests into tiers of complexity using heuristics such as token count, the presence of specific keywords, and the requirement for tool calls.5 This tiered execution strategy allows Sway to optimize expenditures by directing simple tasks to budget models while reserving high-cost reasoning models for difficult logic problems.6

| Complexity Tier | Model Characteristics | Example Models (2026) | Economic Impact |
| :---- | :---- | :---- | :---- |
| **Simple** | Ultra-budget, high speed, low parameter count. | Haiku 4.5, GPT-5.4 Nano | Up to 50% cost reduction. |
| **Moderate** | Balanced reasoning and performance. | Sonnet 4.6, Llama 3.1 8B | Stable operational baseline. |
| **Complex** | Flagship models with extended thinking capabilities. | Claude Opus 4.6, o3, o1 | Preserves accuracy for high-stakes tasks. |

Source: 6

Sway's routing layer also implements "Model Fallback Chains." If a primary provider experiences a rate limit or a service degradation, the gateway automatically falls back to an equivalent model from a different provider, ensuring continuous availability for autonomous agents.9 Adaptive load balancing further enhances this by downweighting providers that exhibit rising latency or error rates.10

### **Market Landscape of LLM Gateways and Middleware**

An analysis of existing gateway solutions reveals a highly competitive market, where Sway’s unique proposition lies in the integration of its three specialized layers. Currently, tools like Bifrost and LiteLLM provide the infrastructure for unified API access, but they often lack the deep semantic validation and position-independent caching proposed by Sway.4

Bifrost is distinguished as the highest-performance open-source gateway, written in Go to achieve a latency overhead of only 11 microseconds at 5,000 requests per second.9 LiteLLM offers the broadest provider support, enabling access to over 100 models through a consistent OpenAI-compatible interface.12 Other platforms, such as Helicone and Portkey, focus on observability and session tracing, which are crucial for debugging long-running agentic workflows where context might be lost across multiple turns.1 Sway differentiates itself from these tools by not merely proxying requests, but by proactively modifying the requests to trigger provider-side optimizations. For example, Sway can inject cache\_control headers into Anthropic requests to leverage the 90% prompt caching discount, even if the developer's original code did not include such instructions.7

### **Corporate Compliance and Bring Your Own Key (BYOK) Models**

The regulatory and legal landscape of 2026 has introduced significant constraints on how gateways can interact with model providers. Major companies like OpenAI and Anthropic have updated their terms of service to restrict the resale and redistribution of API access.15 Anthropic's commercial terms specifically prohibit the use of a single subscription to authenticate access for third-party end users, a move designed to collapse simple "wrapper SaaS" models.15

Sway navigates these restrictions by adopting the Bring Your Own Key (BYOK) architecture.15 In this model, the gateway does not provide the API keys; rather, the user or organization provides their own credentials, which Sway manages through a secure, encrypted vault.15 This ensures that all traffic is authenticated against the user's direct relationship with the provider, maintaining compliance with service bureau restrictions.15 Furthermore, by utilizing official provider features like prompt caching and batch APIs—which offer up to 50% discounts for non-real-time tasks—Sway maximizes efficiency within the sanctioned frameworks of the providers.6

## **Layer 03: Agentic Chunking and Hallucination Suppression**

The third layer of Sway addresses the most critical failure mode of large language models: hallucinations. As models are tasked with analyzing massive datasets or executing multi-step plans, their tendency to "drift" or "wander" from the provided context increases.20 Layer 03, the Anti-Hallucination layer, focuses on "Agentic Chunking" to improve the quality of context provided to the model.

### **The Superiority of Meaning-Aware Segmentation**

Traditional chunking methods, such as fixed-size token splitting or recursive paragraph division, often sever the semantic relationships between ideas. When a crucial fact is split across two chunks, the model's ability to retrieve and synthesize that information is severely compromised, leading to gaps that the model typically fills with hallucinated details.21 Agentic Chunking treats the segmentation of data as a reasoning step rather than a formatting chore.23

Sway's implementation of agentic chunking follows a propositional decomposition strategy. The document is first broken into "propositions"—atomic facts or logical statements that preserve coherence.22 An LLM then groups these propositions into chunks based on their semantic relationship rather than an arbitrary character count.22

| Strategy | Coherence | Computational Cost | Best For |
| :---- | :---- | :---- | :---- |
| **Fixed-Size** | Low | Near-Zero | Simple FAQs, small meeting notes. |
| **Recursive** | Medium | Low | Technical guides with clear headers. |
| **Semantic** | High | Medium-High | Narrative documents, novels. |
| **Agentic (Sway)** | **Maximum** | **High (Optimized by Layer 01\)** | **Legal contracts, medical records, RAG.** |

Source: 21

While agentic chunking is computationally more intensive—requiring an LLM call for the chunking decision itself—Sway mitigates this cost by using Layer 01 to cache the results of the chunking process.25 Once a document has been agentically segmented, its propositional boundaries and associated metadata are stored locally, making all future retrievals from that document "Zero Cost" in terms of chunking reasoning.25

### **Deterministic Pipelines and Smart Contexts**

Research into high-stakes AI applications, such as clinical diagnostics, demonstrates that reliability is often a function of architectural design rather than model intelligence alone.20 When models are asked to "guess" where clues are hidden in massive patient records, they often fail due to noise and stochasticity.20 Sway's Layer 03 implements a "Problem-First" design that separates the reasoning process into two distinct stages:

1. **Evidence Gathering (Deterministic):** The system uses fuzzy matching, token-set matching, and proposition IDs to gather relevant information from agentically chunked data without LLM intervention.20  
2. **Synthesis and Reasoning (Stochastic):** The LLM is provided with a "smart context" containing only the gathered evidence, reducing the surface area for errors and preventing the model from wandering through irrelevant noise.20

This separation of concerns ensures that the model operates as a reasoning engine rather than a retrieval engine, which significantly suppresses the likelihood of hallucinations in complex, data-intensive tasks.20

## **Technical Implementation: The Distributable Node.js Package**

Sway is designed to be delivered as a distributable Node.js package that developers can install on their terminals to solve compute waste globally across their local development environment.17 The implementation utilizes a local proxy architecture that intercepts all outgoing LLM API requests.

### **Interception Logic and Terminal Integration**

The Node.js package acts as a MITM (Man-In-The-Middle) proxy, exposing a local endpoint (typically http://localhost:8765) that mirrors the OpenAI and Anthropic API shapes.27 By setting environment variables like OPENAI\_BASE\_URL or ANTHROPIC\_BASE\_URL to point to the local proxy, developers can route traffic from any AI-powered tool—such as aider, Claude Code, or Cursor CLI—through Sway without modifying a single line of their source code.17

The core proxy logic is built using express and http-proxy-middleware, which allows for the dynamic injection of headers and the redirection of requests based on the caching and routing logic of Layers 01 and 02\.31

JavaScript

// Conceptual logic for the Sway Proxy Interceptor  
const express \= require('express');  
const { createProxyMiddleware } \= require('http-proxy-middleware');

const app \= express();  
app.use('/v1/chat/completions', async (req, res, next) \=\> {  
    // 1\. Check Layer 01: Semantic Cache  
    const cachedResponse \= await checkSwayCache(req.body);  
    if (cachedResponse) return res.send(cachedResponse);

    // 2\. Check Layer 02: Intelligent Routing  
    const targetModel \= determineRoutingTier(req.body);  
    req.body.model \= targetModel;

    // 3\. Inject Optimization Headers (e.g., prompt caching)  
    req.headers\['Helicone-Cache-Enabled'\] \= 'true';  
    next();  
}, createProxyMiddleware({ target: 'https://api.openai.com', changeOrigin: true }));

This implementation allows the package to track every request, show "where the money goes" through a local dashboard, and offer configurable task-aware routing entirely for free on the user's local machine.5

### **Data Persistence and Local Vector Stores**

For the semantic caching layer to function locally, the Node.js package includes a lightweight vector store, such as Chroma or a specialized SQLite extension for vector search.32 These local databases store "Semantic Elements" (SE), which encapsulate the query, the model's action, and the retrieved response along with performance metadata like latency and cost.3 This allows the gateway to maintain "Context Cache Ratios" (CCR) of over 90% for repetitive development tasks, such as bug fixing or project scaffolding, while ensuring that sensitive data never leaves the developer's infrastructure.3

## **Implementation as an Extension and IDE Compatibility**

Beyond the standalone terminal package, Sway can be implemented as a browser or IDE extension. Modern AI-first development environments, such as Cursor, Windsurf, and VS Code, provide several pathways for this integration, each with its own set of capabilities and limitations.

### **Integration with Cursor and Windsurf**

Cursor is a fork of VS Code that has integrated AI deeply into its editor functions.34 It natively supports "Override OpenAI Base URL" in its settings, which is the primary mechanism for integrating with Sway.35 However, developers must ensure that the Sway proxy perfectly mimics the response shapes expected by Cursor, as discrepancies can cause the editor's planning agents to hang.36

Windsurf takes a more modular approach by utilizing the Model Context Protocol (MCP).2 MCP allows agents to communicate with external tools and context servers through a standardized JSON format.37 Sway can be implemented as a remote MCP server that the Windsurf "Cascade" agent calls whenever it needs to perform a high-stakes action or retrieve large amounts of data.37 This allows Sway to provide "agent-aware" context management directly within the IDE's reasoning loop.

### **The VS Code Language Model API**

For a native VS Code extension, Sway can leverage the LanguageModelChatProvider API introduced in late 2025\.40 This API allows an extension to contribute its own language model providers to the editor's chat interface.40

| Feature | VS Code API Mechanism | Sway Utility |
| :---- | :---- | :---- |
| **Model Discovery** | provideLanguageModelChatInformation | Expose Sway’s routed tiers as virtual models. |
| **Request Handling** | provideLanguageModelChatResponse | Apply Layer 01 and Layer 03 logic to chat queries. |
| **Token Tracking** | provideTokenCount | Provide accurate cost metrics back to the IDE UI. |

Source: 40

Furthermore, the languageModelTools contribution point allows Sway to register itself as a tool that the IDE’s agents can invoke.42 This ensures that when an agent like GitHub Copilot or Claude Code is running terminal commands, it uses Sway’s "smart contexts" to avoid processing unnecessary project files.42

## **Feasibility and Performance Breakdown**

The technical feasibility of the Sway project is supported by benchmarks from its constituent technologies. The EPIC framework’s LegoLink algorithm demonstrates that recomputing only the first 32 tokens of a document chunk is sufficient to restore 93% of the model’s accuracy while reducing the computational complexity from ![][image9] to ![][image11].3 For a context window of 50,000 tokens, this linear scaling prevents the Out-Of-Memory (OOM) errors that plague traditional quadratic attention mechanisms at high context lengths.3

### **GPU Efficiency and Resource Sharing**

Sway’s use of GPU co-location is a critical efficiency metric. In the Cortex architecture, co-locating the Agent and the Semantic Judge on a single H100 GPU via MPS (80/20 split) retains 94% of the throughput of a dedicated 2-GPU setup.3 This demonstrates that the gateway’s intelligence layer can be run with a minimal hardware footprint.

| Configuration | Throughput (req/s) | p99 Latency (ms) | Total Cost ($) |
| :---- | :---- | :---- | :---- |
| Vanilla (No Gateway) | 0.87 | High (Throttled) | 82.50 |
| Gateway (2-GPU) | 4.74 | 6601 | 158.50 |
| **Sway (Co-located)** | **4.89** | **7230** | **76.64** |

Source: 3

The analysis shows that Sway is fundamentally more economical, delivering 6x more throughput per dollar than a vanilla system.3 This advantage is primarily driven by the 90% reduction in API fees through the high hit rate of the semantic cache and the sidestepping of provider-side rate limits.3

## **Regulatory Outlook: 2026 and Beyond**

As the Sway project moves into the Spring 2026 development cycle, it must remain sensitive to the evolving privacy and security standards of the major AI labs. OpenAI's 2026 updates to its privacy policy establish that data deleted from accounts is removed from systems within 30 days, yet "Temporary Chats" and "Zero Data Retention" (ZDR) modes are increasingly prioritized for enterprise customers.43

A significant trend is the shift toward "Workspace-Level Isolation" for prompt caches. Starting in February 2026, caches are isolated per workspace to ensure data separation even within the same organization.14 Sway's Layer 01 must implement similar isolation boundaries to ensure that one user's cached "Semantic Elements" are not accessible to another user, preventing potential prompt injection or data leakage across organizational silos.3

## **Causality and Ripple Effects in the AI Ecosystem**

The implementation of intelligent gateways like Sway triggers several second-order effects across the developer and provider ecosystem.

### **The Shift from Token-Centric to Context-Centric Pricing**

The economic value of AI is shifting from "raw intelligence per token" toward "context engineering".6 As prompt caching becomes standard (with 90% discounts ubiquitous across flagship models), the ability to maximize cache hit rates becomes the primary driver of cost-competitiveness. Sway’s ability to use position-independent reuse (Layer 01\) and agentic chunking (Layer 03\) positions it as a critical infrastructure for this new economic paradigm.

### **The Emergence of the "Execution Firewall"**

The rise of agent gateways marks the obsolescence of simple API wrappers. Gateways must now function as "Execution Firewalls," filtering hallucinated commands and governing the tool-use trajectories of autonomous agents.1 This increases the complexity of gateway implementation but provides the necessary guardrails for AI to move into high-stakes production environments, such as financial services, healthcare, and law enforcement.2

### **Integration with "Infinite Conversation" APIs**

Emerging technologies such as the "Compaction API" for Claude Opus 4.6 provide server-side context summarization for effectively infinite conversations.7 Sway can act as a local management layer for these APIs, deciding *when* to trigger compaction based on its local semantic metrics, further reducing the token load of long-horizon tasks.7

## **Future Directions for the Sway Project**

The trajectory for Sway involves moving toward a fully autonomous entity that incorporates cross-model validation (Multi-LLM consensus).46 In this future state, Sway’s Layer 02 will send the same question to three different models, and the gateway will serve as the final verifier, flagging contradictions to eliminate hallucinations entirely.46

Furthermore, as "Serverless LLMs" gain traction, the need for intelligent cold-start mitigation will grow. Sway’s Layer 01 can evolve into a "KV-cache-centric" architecture where KV vectors are treated as first-class citizens and stored in distributed elastic memory pools, making LLM inference feel as instantaneous as traditional database lookups.3

The Sway Project represent a comprehensive architectural solution to the most pressing challenges in LLM deployment. By synthesizing the technical rigor of position-independent caching with the practical intelligence of agentic chunking and complexity-based routing, Sway eliminates compute waste and provides a deterministic foundation for the next generation of autonomous AI systems. The feasibility analysis confirms that this architecture can be effectively delivered as a Node.js package, ensuring broad accessibility and seamless integration with the modern AI developer’s workflow.

## **Summary Table of Gateway Competitive Advantages**

| Feature Category | Standard LLM Gateway | Sway Project Gateway | Impact on Compute Waste |
| :---- | :---- | :---- | :---- |
| **Caching Mechanism** | Prefix-Based (Exact) | Position-Independent (LegoLink) | 85% higher reuse in RAG.3 |
| **Routing Logic** | Weighted Round-Robin | Complexity-Aware Tiering | 30%–50% reduction in token cost.6 |
| **Data Segmentation** | Fixed/Recursive | Agentic (Propositional) | \>20% better RAG accuracy.23 |
| **Hallucination Control** | Basic Filters | Deterministic Synthesis Pipelines | Suppresses plan-level errors.20 |
| **Deployment** | Cloud Proxy | Local Proxy \+ IDE MCP Server | Enhanced data privacy and lower latency.27 |
| **Provider Compatibility** | Static BaseURL | Dynamic Header & Cache Injection | Maximizes provider-side discounts.14 |

Source: 1

The Sway Project provides a systematic reconstruction of the LLM gateway paradigm, moving from a simple proxy to a sophisticated orchestration layer that is both economically viable and technically robust for the 2026 AI landscape.

#### **Works cited**

1. Top Agent Gateways 2025 \- TrueFoundry, accessed on March 23, 2026, [https://www.truefoundry.com/blog/top-agent-gateways](https://www.truefoundry.com/blog/top-agent-gateways)  
2. Managing the Chaos: How AI Gateways Enable Scalable AI Connectivity \- Kong Inc., accessed on March 23, 2026, [https://konghq.com/blog/enterprise/ai-gateways-for-scalable-ai-connectivity](https://konghq.com/blog/enterprise/ai-gateways-for-scalable-ai-connectivity)  
3. 2nd.pdf  
4. Top 5 leading LLM Gateways solutions for 2025 \- ai agents, accessed on March 23, 2026, [https://aiagentsdirectory.com/blog/top-5-leading-llm-gateways-solutions-for-2026](https://aiagentsdirectory.com/blog/top-5-leading-llm-gateways-solutions-for-2026)  
5. @relayplane/proxy \- npm, accessed on March 23, 2026, [https://www.npmjs.com/package/@relayplane/proxy](https://www.npmjs.com/package/@relayplane/proxy)  
6. OpenAI vs Anthropic API Pricing Comparison (2026): Which LLM Is Actually Cheaper?, accessed on March 23, 2026, [https://www.finout.io/blog/openai-vs-anthropic-api-pricing-comparison](https://www.finout.io/blog/openai-vs-anthropic-api-pricing-comparison)  
7. Claude Platform \- Claude API Docs, accessed on March 23, 2026, [https://platform.claude.com/docs/en/release-notes/overview](https://platform.claude.com/docs/en/release-notes/overview)  
8. Anthropic vs OpenAI \- Lil Big Things, accessed on March 23, 2026, [https://www.lilbigthings.com/post/anthropic-vs-openai](https://www.lilbigthings.com/post/anthropic-vs-openai)  
9. Top AI Gateways with Semantic Caching and Dynamic Routing (2026 Guide), accessed on March 23, 2026, [https://dev.to/kuldeep\_paul/top-ai-gateways-with-semantic-caching-and-dynamic-routing-2026-guide-4a0g](https://dev.to/kuldeep_paul/top-ai-gateways-with-semantic-caching-and-dynamic-routing-2026-guide-4a0g)  
10. We Evaluated 13 LLM Gateways for Production. Here's What We Found \- DEV Community, accessed on March 23, 2026, [https://dev.to/debmckinney/we-evaluated-13-llm-gateways-for-production-heres-what-we-found-2dkm](https://dev.to/debmckinney/we-evaluated-13-llm-gateways-for-production-heres-what-we-found-2dkm)  
11. Top 5 LLM Gateways for 2026: A Comprehensive Comparison \- Maxim AI, accessed on March 23, 2026, [https://www.getmaxim.ai/articles/top-5-llm-gateways-for-2026-a-comprehensive-comparison/](https://www.getmaxim.ai/articles/top-5-llm-gateways-for-2026-a-comprehensive-comparison/)  
12. Top LLM Gateways 2025 \- Agenta.ai, accessed on March 23, 2026, [https://agenta.ai/blog/top-llm-gateways](https://agenta.ai/blog/top-llm-gateways)  
13. Best LLM Observability Tools in 2026 \- Firecrawl, accessed on March 23, 2026, [https://www.firecrawl.dev/blog/best-llm-observability-tools](https://www.firecrawl.dev/blog/best-llm-observability-tools)  
14. Prompt caching \- Claude API Docs, accessed on March 23, 2026, [https://platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)  
15. The End of the 'Wrapper' Era? Anthropic's New API Terms \- SitePoint, accessed on March 23, 2026, [https://www.sitepoint.com/end-wrapper-era-anthropic-api-terms-saas/](https://www.sitepoint.com/end-wrapper-era-anthropic-api-terms-saas/)  
16. Terms of Use \- OpenAI, accessed on March 23, 2026, [https://openai.com/policies/row-terms-of-use/](https://openai.com/policies/row-terms-of-use/)  
17. Connecting Claude Code to GitHub Copilot Models | by Rafael Medeiros | Feb, 2026, accessed on March 23, 2026, [https://rafaelmedeiros94.medium.com/connecting-claude-code-to-github-copilot-models-32f42cfbfefb](https://rafaelmedeiros94.medium.com/connecting-claude-code-to-github-copilot-models-32f42cfbfefb)  
18. Show HN: enveil – hide your .env secrets from prAIng eyes | Hacker News, accessed on March 23, 2026, [https://news.ycombinator.com/item?id=47133055](https://news.ycombinator.com/item?id=47133055)  
19. Production best practices | OpenAI API, accessed on March 23, 2026, [https://developers.openai.com/api/docs/guides/production-best-practices](https://developers.openai.com/api/docs/guides/production-best-practices)  
20. When Deterministic Pipelines Outperform Agentic Wandering \- Brain Co., accessed on March 23, 2026, [https://brain.co/blog/when-deterministic-pipelines-outperform-agentic-wandering](https://brain.co/blog/when-deterministic-pipelines-outperform-agentic-wandering)  
21. Chunking Strategies to Improve LLM RAG Pipeline Performance \- Weaviate, accessed on March 23, 2026, [https://weaviate.io/blog/chunking-strategies-for-rag](https://weaviate.io/blog/chunking-strategies-for-rag)  
22. Agentic Chunking \- Rusiru Abhisheak, accessed on March 23, 2026, [https://rusiruavb.medium.com/agentic-chunking-in-langchain-c9e4cf833196](https://rusiruavb.medium.com/agentic-chunking-in-langchain-c9e4cf833196)  
23. What Is Agentic Chunking? How It Works & Common Pitfalls | Deepchecks, accessed on March 23, 2026, [https://deepchecks.com/glossary/agentic-chunking/](https://deepchecks.com/glossary/agentic-chunking/)  
24. What Is Agentic Chunking? \- IBM, accessed on March 23, 2026, [https://www.ibm.com/think/topics/agentic-chunking](https://www.ibm.com/think/topics/agentic-chunking)  
25. Nexla Open Sources its Agentic Chunking Technology to Improve AI Accuracy for All, accessed on March 23, 2026, [https://nexla.com/blog/nexla-open-source-agentic-chunking-technology-to-improve-ai-accuracy/](https://nexla.com/blog/nexla-open-source-agentic-chunking-technology-to-improve-ai-accuracy/)  
26. Agentic AI Independence, Dynamic Data, and Hallucinations: AI in 2025 \- Confluent, accessed on March 23, 2026, [https://www.confluent.io/blog/three-ai-trends-developers-need-to-know-in-2025/](https://www.confluent.io/blog/three-ai-trends-developers-need-to-know-in-2025/)  
27. I built an OpenAI-compatible local proxy to expose Cursor CLI models to any LLM client, accessed on March 23, 2026, [https://www.reddit.com/r/LocalLLM/comments/1rdye8q/i\_built\_an\_openaicompatible\_local\_proxy\_to\_expose/](https://www.reddit.com/r/LocalLLM/comments/1rdye8q/i_built_an_openaicompatible_local_proxy_to_expose/)  
28. ericc-ch/copilot-api: Turn GitHub Copilot into OpenAI/Anthropic API compatible server. Usable with Claude Code\!, accessed on March 23, 2026, [https://github.com/ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api)  
29. GitHub \- chouzz/llm-interceptor: A MITM proxy tool to intercept, analyze and log AI coding assistant (Claude Code, Cursor, etc.) communications with LLM APIs, accessed on March 23, 2026, [https://github.com/chouzz/llm-interceptor](https://github.com/chouzz/llm-interceptor)  
30. \[OLD PROXY \[NEW proxy here\](./simple\_proxy)\] Local LiteLLM ..., accessed on March 23, 2026, [https://docs.litellm.ai/docs/proxy\_server](https://docs.litellm.ai/docs/proxy_server)  
31. How to Build a Node.js Proxy Server ? \- GeeksforGeeks, accessed on March 23, 2026, [https://www.geeksforgeeks.org/node-js/how-to-build-a-node-js-proxy-server/](https://www.geeksforgeeks.org/node-js/how-to-build-a-node-js-proxy-server/)  
32. nazdridoy/llm-proxy: A robust, transparent REST API proxy service for LLM APIs with profile-based configuration and comprehensive logging. \- GitHub, accessed on March 23, 2026, [https://github.com/nazdridoy/llm-proxy](https://github.com/nazdridoy/llm-proxy)  
33. Implement agentic chunking to optimize LLM inputs with Langchain and watsonx.ai \- IBM, accessed on March 23, 2026, [https://www.ibm.com/think/tutorials/use-agentic-chunking-to-optimize-llm-inputs-with-langchain-watsonx-ai](https://www.ibm.com/think/tutorials/use-agentic-chunking-to-optimize-llm-inputs-with-langchain-watsonx-ai)  
34. Cursor Docs, accessed on March 23, 2026, [https://cursor.com/docs](https://cursor.com/docs)  
35. Cursor Integration \- LLM Gateway, accessed on March 23, 2026, [https://docs.llmgateway.io/guides/cursor](https://docs.llmgateway.io/guides/cursor)  
36. Bug: Default models hang at “Planning next step” after setting custom OpenAI API, while Auto mode and custom models work normally \- Cursor \- Community Forum, accessed on March 23, 2026, [https://forum.cursor.com/t/bug-default-models-hang-at-planning-next-step-after-setting-custom-openai-api-while-auto-mode-and-custom-models-work-normally/147016](https://forum.cursor.com/t/bug-default-models-hang-at-planning-next-step-after-setting-custom-openai-api-while-auto-mode-and-custom-models-work-normally/147016)  
37. Windsurf IDE MCP Setup Guide \- Cequence AI Gateway, accessed on March 23, 2026, [https://docs.aigateway.cequence.ai/docs/client-config/windsurf/](https://docs.aigateway.cequence.ai/docs/client-config/windsurf/)  
38. Configuring network settings for GitHub Copilot, accessed on March 23, 2026, [https://docs.github.com/copilot/configuring-github-copilot/configuring-network-settings-for-github-copilot](https://docs.github.com/copilot/configuring-github-copilot/configuring-network-settings-for-github-copilot)  
39. Windsurf \- The best AI for Coding, accessed on March 23, 2026, [https://windsurf.com/](https://windsurf.com/)  
40. Language Model Chat Provider API \- Visual Studio Code, accessed on March 23, 2026, [https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)  
41. Language Model API \- Visual Studio Code, accessed on March 23, 2026, [https://code.visualstudio.com/api/extension-guides/ai/language-model](https://code.visualstudio.com/api/extension-guides/ai/language-model)  
42. Language Model Tool API \- Visual Studio Code, accessed on March 23, 2026, [https://code.visualstudio.com/api/extension-guides/ai/tools](https://code.visualstudio.com/api/extension-guides/ai/tools)  
43. OpenAI's Privacy Policy Update and ChatGPT Ads Expansion: The Complete 2026 Guide for Users, Marketers, and Businesses | ALM Corp, accessed on March 23, 2026, [https://almcorp.com/blog/openai-privacy-policy-update-chatgpt-ads-2026/](https://almcorp.com/blog/openai-privacy-policy-update-chatgpt-ads-2026/)  
44. Data controls in the OpenAI platform, accessed on March 23, 2026, [https://developers.openai.com/api/docs/guides/your-data](https://developers.openai.com/api/docs/guides/your-data)  
45. Usage Policy Update \- Anthropic, accessed on March 23, 2026, [https://www.anthropic.com/news/usage-policy-update](https://www.anthropic.com/news/usage-policy-update)  
46. AI Hallucinations Are Getting Smarter — Here's How to Catch Them in Real-Time (Even in Agentic AI Systems, 2026\) | by Yash Mishra | Feb, 2026 | Medium, accessed on March 23, 2026, [https://medium.com/@yash.mishra0501/ai-hallucinations-are-getting-smarter-heres-how-to-catch-them-in-real-time-even-in-agentic-3d75a9fc1ab3](https://medium.com/@yash.mishra0501/ai-hallucinations-are-getting-smarter-heres-how-to-catch-them-in-real-time-even-in-agentic-3d75a9fc1ab3)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAACFElEQVR4Xn1TvWqUURC9UyysuIVCSLAN26SxCbovsE2KJZ2NnVVqQX2ChWAl20VsJPgEsmBhkS6QrdPYCcJWKVIoiLDrOXP/5/vunjDfnZ8zM3cmd50rIZWVIPqXrZKoWjKjUhXqVi3LBUdHLRmpSacR1XatyhF5uUGH2UaXmquWBe1liCHkDeQvZAvad5wPYzDdKs3oRuRBu4d8hn4OeRToEanNNeQX5Bayl8IWIq+cNndzzbW3rGxxF/guoaxxHlqG12QMhcU2MKaGY8srXjo/zm/IsYkRA+ShoHuG9DVEG/dWCuAOjyDvnB9tRmd9T5nh4OjkLcX/LzJ6qrPrY8fbirDo6zII/j6OD5CR+Il44zbC45iGTtOwr4UhvIVM/IXdQtI+M6lP9Z1Fd8mdfinCE6dF9VFxmpUL+0xQZv1ah3BeBs8TBH/CvhL/Hikcm+Mzmfu8Y073V1Ta4k5gfgw6l7/EycQX6P0e+sDT9cu1bGK+LVs65jC4/Oj8BPkH9Qb2ONM4uqxw8h3nAvXUajyF/ICcFoH4rM4KH+m6b2R9q/w+pngO+QOLv3UWoBwwKP6NfoU8CCl8XpHD3/wWJE6zA9qlsx1nfX2MJtpkRoqo7s760ifELWFHeY/4iAyvlZb9RZr2FD1beRF1vLCqQG+V+rlrz6hUKL2J1YPkL7gJNthCb9je06Lj846wQoPsbJcV9x/gpEBk6HzrWwAAAABJRU5ErkJggg==>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAZCAYAAABU+vysAAADC0lEQVR4Xq1WO2hVQRCdIUYSjEVQkKAiL4gQEBTEQrBUsNEibewfWCpRbOQ1FjYWggiiiEUaSSsKWgiCjYUKSkAQFAIBIQQEbUTjOTu7dz93330JeMLJ7s6c2Ts7d/YmIh3Q0lDBME3dvh2rQ4er9FWlVeP/R/6Y+kO1bu7CdiMa/XHwBpY7cvNQ7ARvisV5+KAytlx34C14tlmpxXbGRyfjGD8C2Y7VjFn1JxjHS0d7bSisiHPx5VMqi270wHOlMWJLO10Ae6ZM9LXGKtNNJAvg/rg0BD/HLZyQ8Qs1H017HJ1TpzDMYDJViNmYy35so8lCZ5SxhnHMd0WRwwS4pCFN/wzFzyLmLzD/DnL+HONjcBW8RI3X7gU/2bQNaCbBW5g+FGvIRfAjOJ+pDPRPp+YehgfgbrHTXgfHvLsPbkBz1K9nwTU/d2i2tSa8D372du7Lg6yDc4kuYBWiA6md76oPutNqLCkxj/Wm0xhOgD/drL3zFfAPHOH0PNhrDSfP9G7BfbhfAz6Y7+wk/L+KJ/ADxERYGbp8IlHjZ/vAFUd1c9rnxKpxJ2gLtBJhEPd7BK4laYTX8EGtkYlYEcnSuSaW8OXGJMoEfoDH/Dq6bL3uk80QmvBlYrsI8V91YwPepG/JWvwDWLFNTM97I6v8SsqGTKHyRaySWY52UpUVbzskVup7YtcvgNfQJ+utNrCZNyT20kCsQrwEklejmT8FJ8o69dUCl8Su7VdxzadpEgEsORvRwyn4i9ecN4Hxz8Q3eSveDKzSILMD/EYwAfbDrLpyKa8iXYnK/1I5I/E6l2DT8/WN6A/3Bk6FRfA2/aHtL2AGH8D3P0jtAfR7Tby2JUwwwGQyLEMip8Hf4q5qmnmY+zE/FL+WBzNLDt4s1x+tWrg4fZdZnEjduyTxMZI3maC2jWEA3pYgiLIjatUNe74HDzde+yfqLni1sZk9H7cJ/hmYVv6l2hqo46sac7PAOJSIZl+xzFZH2LGmq9k8gr5DEtGIwiQdKztUTEOMDsM9DvVMhzy6A6PVQfEPMrFq44bkJ78AAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAaCAYAAABl03YlAAABRUlEQVR4Xo2SvUpEMRCFExZBUVFQ2N5asNLCepst9DVsrBXs9y0EKytrQUFQsfEFxFZEsFOwsHJXv/m7SfAHJ3cyZ86czJ1cbkpi2b2zOmmwJ03IlUaxrUqh51qxx/DOoqiCciwqleAnq3mdVRv8Q928pX7rHzaFaNFxD5+vTuUeeJcZHkiuyUfEc/xAiqpg7RFfABvEBfJb4oTqwKbPaRsfQ+5HW9Yx8RlfkWwGcIa/UluVQzzL4Du4U1pMC7GG8g3iJsmQdr118DtI5tLOWwg/AYdxefYddrg8dFEaQE6o+DzSKR+lmMetj9+naG2ff8x2QTLrGmWHbE8kJ/gV+AMf2S8Wm9yILw3og+cgZUabxzR6G086usxTarovES+zdZGbPUJv2jnVlDatOd91al9pFrn+tnX1d2Fk1YSl6tGxdf3OfwFFGCd55DwpQAAAAABJRU5ErkJggg==>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAZCAYAAAC/zUevAAAC9ElEQVR4Xp1VOWhVQRSdQSORRKMYXEBxwUYsRCRgoSCioAgW2qSxjoWlIGijiJWdmCZgYaWFoAEDIim+KC5YWaigWFilEkE0heJyztyZeXeW9/6PB86fmXOXd9+dmfeNaYMtJtVlQJBbzINDEpRpSoWoqwVa3KpyVWwBfXXBdinBGi6ub3C1yUPgJXCvs3RWEG1rwBvg5sb2v5Ccs+BKta63IkpWdc6cBWe1dyWyL3Yi6GCzrKeIXVbF+dk68GW1w/VUCo3DZRO6sARk+S+AY6mUu4S1VRaZrAVfB6mME8Qu5FqDfeCBVIqQvTPSsk1Y8zA53YOBX8OiA4zj4WXkSJirSsbBi3GVgW6HwR6mMxifgVdUQ6YwWYieEdFjG45AD+MT8Dmk8xjfm/JGLAfv+VEgZ4e/9hz4w8u7wAWInzBu8J7XjKwT+P5tBT9gNoPlEDiJ+V9oc+BwEiB4Cq7KxaPgb/AqF0hwCMMv8KZpKr4N9kITZHS/o+Bj8CO4xZsnYFrEyMLTxsnqs3Fb3oCn/RFM6ILloUnBGGlXUoTCMfCPkYKDecprR7ioxEgRTW5z3Ejr+JAEWTDtbKMGu8DCvmHco/zfgvPgiM6R2ce1MgEuWt5fmzguA/ebcLqN5f3mG8gLiIj9ttx36Da217quciuy12gwb+XmRLi3Ae+b+ECzGpwGryuNHatdURxod4h3+GduNNJZ+nskxYxa+R8pwNvwzrDd1j6w8lE6kTbG+XyRaZJ0DMu7GN8Y2bIXNhTlQF/lb6nbSZHKTlHhh4qVNkrjN4z5HAsrQkXgR2q9kSvtzoPyiGkwnsSwXdvaCqoCbqeMS5AFpEucMfdN8UiMvO53ctFDa36uJDXFdXYHVKHIR7s6D0a78BPAm5GC9qQbRc4Cr8Ddbpb6ngG/WzmUP8Fb4Ipote4CPARPF4+IQqykcPFIdCbk9azZauB1579wt2Oartu3htaIDkNmqnla1Z3BkHoOHmfqzjWNaNNz9PcL95zDP4gUWMWgn5urAAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEIAAAAZCAYAAACFHfjcAAAE6klEQVR4Xr1XXahnUxRfuxlFZhImY0TTeFATJU0m8zBvFIkHHnyXkkieyKiZaNA8IREp3dJNyFCSzwcP18eDeBaJMiWShggvmuH322vvffZea59zz517r9/M+p+z18fea6+91trniqwWwTIUnk2O587CCZr1UE+14mnnG4T4rxrOwBylVbm/nlhDZ+JUJ7LRpDeh3hPZ5Rodb+A5A4rsXNDjGG6uhIopc4ewQv2EFdpA/TI8HgadZGXj0LDdgZ/3Qf+C3gWdnESn4PEW6O5GvTsYA5Wy4iyD+0T9OGQFowjyPX4vrRlS+T66au1aBU70t7QO3Ar6DHRmZnTsCjSmTecwGCSqW4YVUxaDOZBlsB10BLTNTgfsBX1tmREdZUmhuQs/x0GXVwIG4d5q7NGfcHn07Vh6n4gG4jvQ1r6aZPvTQB+ClkCbKmnGpqCy2diIid/A8yc8z6/4P4N2VeP1Btf+EvSDaHZW6U40YWHqL4ge3mItUBTdB0GnVwKLqLhVNO3PEnWgSUdofCHTkxDZfkMcaUPV9+JM71w9D5yr8DiMl+dFs4JZqpIWbIIvgL4BPSe6WYdkxQw3AY0I/E9HmfKM5Eeg90D/SNMfAgPCLNk48By4wDug10Fvgx6TmIphs/XdbYXwTK7Pzd8iGogXW3EErfaBfgXtBi2AcV2rUkEznPMVRgaj+YRwosgLrDP2guOh7Q/MBKZeg8r33RjQmcw6KOr8M0Ujw2+4B673Aegi0E4YHRXNUovrQX+lJw+LWdw78bzuNtD+VqC4FnRMhnRim39Z2B+0RjM4QTflRL8rvpKqEaVTYSCq6A9wsXAM2SOagax9NL6wJJqlihD/X423o3i5QTmlue4seh5soovxrVozn/5vopEntoROf5DRQMTZWFbcdLpRIo+ZwFOccmoKLIv6huKYa2SwDJjFLIu8JfgYjujToux6CESFa0QnX6gUWZPksVGxbBgsopNS0YZ8Lh6vtyTg5hkEV0qK4ShCeq0Oh7gR9Iq0/WiL6AEdBP0i2hztlyJvNJZJ7+rM4DyuXNkDeN0MZcGGFEpZsGweSLImknkDkh0Mzd0Nu9AriwtAZxueBUuBjfbKlh0XpJ+cl804H1ANDURQP0xwM3hw/FptwBNkbefb4XbRfrEk2qx4FaWSidPyY+XUMtJf/jwrw9XKbGB2/AG6OKopaEf7V6V/86DPhNfwvEc0EAyIBXvRS5J86CBnxDnw6gwxsUgD6uglYCLFEuAHC6N8AHQT6HfRK/RJaZ2mHp2xIO9T0Ub1sWipDN8cXFC/tB8RDYZJ3ehRKtNwDKMrnHQYbbCcaszA8wA4x/21oAKzdIdlStJlraX6jmM6yg8jO9GPklPWSpRDmwul7g9e7ylxgYhgKX4udgPG3gSlGYnu407QeVYQdfUw+C3Sy8gKbl4Hbm4stTMmr03gaWlWWn5Rj45Nh0UUtr7sAH07otpi6m9F0dPGZ2zYNaHFiNv+kMET2+ttPadgQjSNriGb7WHLnAGdLN4Q8TX+3IzfN6VuZsOaj4pmA+lPsB8qEsVtMuJhg2GtljULo3aXiPax7Ya/KnAeNsL0x9T/iDk78Dr8MCx9yYs9x/A6Ch1WwagsjMsif0y4Rljn6WfCeOGccowJULfV71n3eGsLt4JjdFwdwzytBs7EMaT+5J2L/wAGELJdD6VZzAAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAZCAYAAADnstS2AAABPElEQVR4XoWSvUpDQRCFZ0EhRSBCihTpfIFUWsUuthY2PoDPIIHgC9jaiGVsbFJq5YNoI9xOsLcKqN/sznr3L3hg/s6cnR3uXXECevcXIoqyR9bYqTK0xDWXrpGhtVPgTgkPxC+I96wfs6wQmRI64qZ5W1EusG/YZSjTbjGZfIXbks/j5OyCpBhgz1gHMbX2ATYOZ/LJh7gPCD2gB+/hnoivcJfFwm7h/L6i+47oHcFdk/+QL8tdVqJiJxfEO+vcYJ/YLF3D7+t0SmgemzhBP9l/MhdWUJzA3ZpkgBumYt1pSzk3YhbEXnBFODOd7OE2ZJ3oH4zicMsYW2OTKJ7geAvuUcJBxT72hr1QnicbeDfCqSAFU93Q+gF9ERnL0zJy/6E9rEQqiHlxeVXU82qmIW6NKlDvvHOKPX7LfwFXmyXnY3yNkAAAAABJRU5ErkJggg==>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAAZCAYAAABkdu2NAAADvklEQVR4XrVWTYhOURh+T0ONjPxGg9LYjTSzEDao0aiRSFhYioXSrKb8pFnayEKRZFJiIxEbJBYKSVgKqSkjUiRRFkyM5znn/pxzzzn355uZp5577n3f5/y+7znnilhQ1jOOgD9gqovyqq63XJvD1/mWanh1CobG/hLU1FbKHEHyYduqGqjyp6irc5HWUi3WD6JZU1F11GGjlkjDU3qGMLaAV8BR6JcUndUI9RKyyYKiISyT5eA18BP4FXwCbqLDkiu8b0b5Cq8TKP+Cq4wnF9lYBt4AZ6QGrcsfrYKVe/C4g3Jl0RkANU9RbU3yPRMcATkJG7vB+2AX2CYmSH/A7ZnCHjbe+1EctUzBaYVsEVC6HnwkZnI91bW1fwgFJ3MLbE8c/fD8Q7ko+V4IvgRPgLMTG0HNM3CuZctwHB1syD/d6UeH5kRYl1zNbeBz8JKYFW6CA2KixUXJJihm8J1JT73gz0S3NdEQH8FfYBr9DGyIDTJNU8wTs1IqPMGQTfaC78BzYGfBV0CgtgEXaLHkkyMGRU9GpdunA7wrZn/2WmMZQzmO0gqUhmLef0bZrhhyJRfwfRt8I2ZFA3AGOAvcD54SsygRxCYVs2usgJ+LRhrE5Yweo9hVFKUpwNwdgW8tymExKaD3ZbxNGQC/gcdcc0kNDTcDAuqd4FsxB8d1MVG14GUQPyfwOJK8Oz7sPz3B8/B0J8aTeP8iJt/jUFn0RsWJnj2AYn8WSlxi0pTj4UHFPV2GdWJOW566DtCI4v5jtCgq75IIK9gw7qTy/RebtPPlh3Y1+F10ugZBO7cTF9tDmp5IRbUR5W/wTNIyV5Ab2kV4gmI5+FK4IuK1LHQoc7e595nIHPCx6HGl0M3xiriI90GlDdp2GuQWy8A9Nq7MyWOOX5U1dBjckSklPsqInWb+XfAHgpP1ZdqSma3jXw3lYsWMGAMPZiZkDPxnUe6jwGjVfDxuojn+CWnw2GXn78VcEWkHnDT302Vp6dctiC6wr2gsgCl2D3wILrVWY0CZLEsPGnwqHibcVg7heIGSE9Xg4Hk4XFVmsulvEU+vB+CuVNgIfpxcJFGLyLrheC0mJQ+JPs3VD9G/bxnsi77I/Hcz6YdXg33y0Mzo+XuvEpEhS8jjWyzwsufpuSch39uyOnbVgKkZWq9ZgWlreDIIDqpPzB7+UIPUtoRgzx5Cd2+jEFepAv5G7TfB1LdYwLR3UAk9grrDKNeFvNFTcGrRqJNG4pqoarPg9+SeIUXU0RC12pl8tPz6vsVFlb8a/wEBoIrHzQeLIgAAAABJRU5ErkJggg==>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAAZCAYAAABkdu2NAAAEDklEQVR4Xs1XS4iOURh+TygTGrdcQoydSylTSrEzYjEWQ1EjG4uxUMpGWWhKQkmalGgiSQqJpGYxi5FCrJTLQopSspqVQpnxPuc95//ec/ku/6A89fzfOe/tnO+c97zn+4n+O5hYkBVVoca8Rt0AbUeod5jBXMfcFCumBD1e2q6fjUVDszpwmJX8uMrsZ55m9v2d0JkoGVEOJ5jTc8YZUYAS/SXmOdZ2GDH5zOxSxruZA9RyT7ck7q5lvnDcypzpeID5jdlZMpFFzJdJUMFc5hnmTeYk8xZhEUIcJPH/yc/7HGZfpPd4z1wRDePGpp5ACmTe8TtzkCTvYyAAVjSeHBb3JD9vR/I4/gbmuOP6UGUxh2RRy4Bz2BcLBWY//zwvuoVGg7fbIM+neUFkN5s5btLJdTE/MHegUxIbwDm6SNhFYxcxxmrmvFjogLP4OBYqLCM7h9LRDSoUVnaBkhXNAkgx5LwGJv6RZJDUywrsD3Z/M/MH+bPUUlnsbLU0DC3h3wvMVSSVFM8YiHKNfHZFk+hgPjQy+QDJZMXmmDStFgHvOsapq4GduUcy1gi7Is7hQm1jnSr6LVkn8zxJei5lXibZaa/XwMIvj4UAUmuCZFWrgGKjXtBiIY/zhuLJJWPb83fDtVFAEAdnBi8AzGLecW0Pvytsa2APopi4NE4G2eJYwJkMMSeN7EIVFpMMgpT0wGp+YR5VshzgcxwjGonzjmRR7bklifPAGwdI3qMU3ZQpQqhcT0gmXjfJbeQrYDFoN7dxffR6Ucl8+C6z/h6DFF4ZOH84Z1OGkRTW2WUB4SeSwXpDVTBVY6QC4irQVwhWzb6gksXw50+fD1RifWUgxfvdDmeRyhOJfcFYinP1iCRFi+0NrbDCqIBYhNjfvaBJUkPBpmfsSHLnoaLicn9K+orIGDfAGuZAzvUQyeSxQzFgv5f5i3nFCxR8BiSp4QBz+On09MDn1wjJ2EO5iaUyJ9GPwgiLHV41TodKNmok1TRw4R8hWeGzpFOzCIrqN8ocbkkKwGoj/77lZ086WQtfUVsZUGKXRWSLY4JdjBTSmU9yvq6TDMoVz17ez0i+Tx3CkK6HKoxChYLlgR2bMDJ5S26/iv0JFdXQGPmJVSDxpESGcxx+K2ecsAp7mNtZq75qKoGX+Ur6Ey4T+F9ADYPPyLGi+6cIX8AHH4wV7aPc32sSCxHgExDfw1oWIpWlkrzMAv80XqNRatEIzrtRkJYtqvww9/CPpgx1Eev01mDQPVsi24lcyyLl5Dn/DHaRXHWdTYwV9KWbc8zJ7F2WVQRILLyg/KLPwcjxwF2eR8MVUmjLuA3k4uZkIWotSg0SRSIoEKmKboVPgqa2GTsnymhCeINaw8aoSLdShUYjo0qz348mkDEuYe3GAAAAAElFTkSuQmCC>

[image10]: <data:image/png;base64,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>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAAEc0lEQVR4XtVYO6hVRxTdgzEoRkJUfIgJaLBRhAgPrV6sVBTRwgQUntiImE4QkmCqC0HERlAMoghiGvHTiWBhkfAgkVjY+GsEFVGSRggoGjHJWrNnznzPuee+V7lgc87Z/z2z53OvSAGTM2aOVpdtghq/xkthNbrUSlnJyVE4HWbiDIKafxtm6NBTbSR0+8yk3coVzNy+v4nX7W8xXawBfdAdp1M4XXwIOgzXjN8bq5DKH6L0JWiOoz2gl6DLka5Cc18MugXamAk24vGzqO1D0FgQVbEMwuN4/gv6DzTIdJnLISd7AboI+fpIzvjMg/mkqDTXa2EAkdmpyIKO3glnLoZ2zY+gS3ir2S0FPQJdEWvbXmkkugd6A7ovfoCIIP8NHyuarwDGvySaTye+Ah2Bv1m5wOEj0C+g1Z7hYi8XnbXNnp/AyAbRmfreM9JnFftA10VncBcZVjuYsFvSQQ/YDnrCl7YI68S2hVmYCzKcB+33H87ZpOjMcQYjNKF+AL3F10QklPZUZB5opWiRLPYm6OMgtnYHw3cB30kRQqy5oKuijiPEyTTvLNbNkAVHF+1prhg30lkJXGPXpBwMDKppq/Zz0HzI2b5sY3ZF3DWMM1FECphjNGZVgY7o8Gkjr6gZJm6sk7gdF4HuCnfCGMGeiT8XDc7COWunRYvY22il2BK9D8ROgrlgB1P9chDGqkkGMJ9PciZxQnRWuYF0gUG4NicrxVTbCmrxemUrngGtFY0Xd4hC/cYDtxo87rokv1dwORTrNSudvj9NWWwXI1OiwQ8WJkRg+cSbDQoYFz1Wttmv0pzrlTY7QadE1yLxF+gLr0Q4U87+uYjNoi6IP4YUbQMbg/kwtwRLQI9FnWnCddDXSVG9+HgZhyQUm0LXq7E2LI6bYDkcDk7ATuHREQPLzHDA2PqcLe7Ew1At1m8gTGhHJvPg6HJWqPNdJvMzu6NSRdTCVspLCs9OLhvG5VHWVOkebGGXR+Jxt2j8f0Rn2qIS04MnxspE7j6+EXXEmctBFbbgO6PrLbk0mNAZ5fpT3lsJRw7b9m/RYr8Fbc+SZfG8oflWj8H94r52iWmOvg4wNm0KcOO4YXSGFJoFLxcHREfzqNRvVfOgewPPsxnfHUk4ckxz5Phimch5SZNhrK2gB1IvlhiAXiE5bnAZijmmf3ZPFQtE1wqVeJhzY3kE+h1+VkV6pVudqSljz8YGLIQ7N1vO75wcLHYHCwpLxtiWY2cFMvZin4Mb46+ix11AnJC+88jh/ThFJfFt4H2N5yaxB38XGmusTfOnpLs0wY7JuwFGQ29pMwX3kWc5sx8qI5LB35kHDaewyRiFPIOVl1PWhUhjIHojTDHcRQtKQ/4iugP6zH6NlmfAKLoe6cAw/m2jO38bvPIo0RJdfgxAx2LmMAQPo8RtBa+TP4kej30c9tHpxCxTdVJhVXkOHaIW0IIbk/15Orq5VIzqlfRC0QetqAvrXOkQTAc1ZzUe4fmxvE23FbUR7fmHWy+l9wDddQwfjP8Bwump0rxZTC0AAAAASUVORK5CYII=>