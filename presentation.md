# Sway: Intelligent LLM Gateway
**Presentation Outline**

> **Theme Guide for Slides:** 
> - **Primary Color:** White (Clean, modern backgrounds)
> - **Accent Color:** Electric Blue (Highlights, key metrics, technical function names)
> - **Secondary Accent/Text:** Black (For high contrast text, borders, and depth)

---

## Slide 1: The AI API Bill is Broken (The Problem)

**Bullet Points:**
* Developers are heavily reliant on LLM APIs, but current usage patterns are highly inefficient.
* **Repetitive Context:** Users constantly copy-paste the same project context, paying for redundant tokens on every request.
* **Wasted Output:** Unstructured, bloated prompts lead to rambling, unpredictable, and expensive LLM responses.
* **Overkill Routing:** Simple trivia questions are often sent to expensive "flagship" models when cheaper models would suffice.

**Speaker Notes:**
> "Good morning. We all know that LLMs have revolutionized development, but the way we interact with their APIs is fundamentally broken. Right now, developers are pasting the same massive files into prompts over and over again, paying for those tokens every single time. We write messy prompts that cause models to ramble, costing us even more in output tokens. And worst of all, we often send simple 'how-to' questions to the most expensive flagship models available. We are bleeding money and wasting compute on inefficiencies."

---

## Slide 2: Introducing Sway (The Solution)

**Bullet Points:**
* **Sway:** A Bring-Your-Own-Key (BYOK) CLI tool designed to drastically cut LLM API costs directly from the terminal.
* Intercepts and optimizes your prompts before they ever reach the provider.
* Entirely local and privacy-first: Credentials never leave your machine, and metrics are tracked locally via `~/.sway/metrics.db`.
* Empirically proven: Use the `sway bench` command to instantly benchmark cost savings against raw API calls.

**Speaker Notes:**
> "Enter Sway. Sway is an intelligent, local CLI gateway that sits between your terminal and the LLM provider. By bringing your own API keys, Sway intercepts your prompt and optimizes it *before* you pay for it. Because it's local, your keys and data are completely secure—we even track your savings in a local SQLite database at `~/.sway/metrics.db`. And we don't just promise savings; Sway includes a built-in `bench` command that runs your prompts side-by-side against the raw API to empirically prove exactly how much money and time you're saving."

---

## Slide 3: Mechanism 1 - Context Auto-Injection (How it Works)

**Bullet Points:**
* **The Tech:** The `loadContext()` function automatically reads a local `sway.md` file.
* **Stable Hashing:** Generates a stable 12-character SHA-256 hash of your project context.
* **The Result:** Enables robust server-side prompt caching across identical calls.
* **The Benefit:** Stop paying for repetitive tokens; let the provider cache the context and drop your input costs.

**Speaker Notes:**
> "Let's look under the hood at how Sway achieves this. The first mechanism is Context Auto-Injection. Instead of pasting your project context into every prompt, you drop a `sway.md` file in your repo. Sway's `loadContext()` function reads this and generates a stable SHA-256 hash. Because the hash remains stable until you edit the file, LLM providers can easily cache this context server-side. You stop paying the 'input tax' for repetitive boilerplate, and simply append your specific question to pre-cached data."

---

## Slide 4: Mechanism 2 - Structured Prompting (How it Works)

**Bullet Points:**
* **The Tech:** The `optimize(rawPrompt)` function utilizes a sub-second pre-call to a highly efficient model (e.g., Gemini Flash).
* **Intent Extraction:** Classifies the raw prompt into a specific `Intent` (code, qa, refactor, explain, other).
* **Template Mapping:** Maps the intent to canonical `TEMPLATES`, generating a strict, CO-STAR-style prompt.
* **The Benefit:** Tighter, highly targeted inputs guarantee concise outputs, eliminating wasted output tokens.

**Speaker Notes:**
> "The second mechanism is Structured Prompting. When you send a messy, raw prompt, Sway runs `optimize()`. This triggers a lightning-fast, ultra-cheap pre-call—using a model like Gemini Flash—to extract your specific intent. Are you asking for code, a refactor, or an explanation? Sway identifies this and maps it to a canonical template. By converting a vague request into a highly targeted, structured prompt, we force the LLM to give a precise, concise answer, completely eliminating the cost of rambling output tokens."

---

## Slide 5: Mechanism 3 - Intelligent Model Routing (How it Works)

**Bullet Points:**
* **The Tech:** The `classify(prompt)` function evaluates heuristic signals to calculate a complexity score.
* **Signal Analysis:** Evaluates `approxTokens`, `countCodeBlocks`, `hasFilePath`, and specific `FLAGSHIP_KEYWORDS` (e.g., 'architect').
* **Dynamic Tiering:** Returns a `RouteDecision`, funneling simple queries to 'nano' models and complex tasks to 'flagship' models.
* **The Benefit:** Ensures you only pay premium prices for premium problems.

**Speaker Notes:**
> "The final mechanism is Intelligent Model Routing. Not every prompt needs a massive, expensive flagship model. Sway's `classify()` function analyzes your prompt for heuristic signals—how many tokens is it? Does it contain code blocks or file paths? Does it use keywords like 'architect' or 'optimize'? Based on this, it generates a `RouteDecision`. Simple questions get routed to hyper-fast, cheap 'nano' models, while heavy architectural tasks are reserved for 'flagship' models. You stop using a sledgehammer to crack a nut."

---

## Slide 6: Global Impact on Server Loads (The Macro View)

**Bullet Points:**
* **Caching at Scale:** `loadContext`'s hashing drastically reduces redundant token ingestion across global data centers.
* **Compute Offloading:** `classify(prompt)` prevents wasteful resource allocation on flagship server clusters by offloading up to 70% of queries to efficient nano models.
* **Energy Reduction:** `optimize` creates tighter inputs and outputs, fundamentally reducing the required energy and compute cycles per request.
* **The Big Picture:** Sway makes the entire AI ecosystem more sustainable.

**Speaker Notes:**
> "But Sway isn't just about saving developers a few dollars; it has a massive impact on the global compute ecosystem. By leveraging server-side caching through our hashing mechanism, data centers spend vastly less energy ingesting redundant tokens. Furthermore, by actively routing traffic away from overloaded flagship models to highly efficient nano models, we relieve the immense computational queues at the provider level. Sway creates tighter inputs and outputs, meaning every single request requires fewer compute cycles and less electricity globally."

---

## Slide 7: Future Enterprise Implementation (Future Scopes)

**Bullet Points:**
* **Corporate API Gateways:** Enforce Sway’s `router.ts` tiering rules network-wide to cap internal API spending.
* **Developer Tooling:** Wrap internal CLI tools and IDE extensions with Sway to ensure all developer queries are optimized by default.
* **CI/CD Automation:** Mandate context-caching and structured prompting in autonomous agent pipelines and PR review bots.
* **The ROI:** Massive reduction in corporate cloud AI billing without sacrificing developer velocity.

**Speaker Notes:**
> "Looking to the future, Sway has immense potential at the enterprise level. Companies can deploy Sway's routing logic at the corporate API gateway level, ensuring that entire engineering organizations adhere to cost-efficient tiering rules. We can wrap internal developer tools with the Sway CLI so that optimization happens silently in the background. Furthermore, integrating these mechanisms into CI/CD pipelines—like PR review bots—will ensure that autonomous agents aren't bleeding API credits. It’s about maximizing AI ROI at scale."

---

## Slide 8: Honest Caveats & Conclusion

**Bullet Points:**
* **The Pre-call Overhead:** The `optimize` pre-call adds minor latency (~3000ms timeout) and costs ~$0.0001; it must mathematically pay for itself via output savings.
* **Dynamic Pricing:** API pricing fluctuates; the internal pricing tables require occasional updates to remain perfectly accurate.
* **Conclusion:** Sway is a pragmatic, transparent tool that leverages smart heuristics and caching to fundamentally reduce the cost and latency of using LLMs.

**Speaker Notes:**
> "To be completely transparent, Sway operates in the real world, which comes with caveats. The `optimize` pre-call does add a slight latency—we cap the timeout at 3 seconds—and it costs a fraction of a cent. Therefore, on very short, unique prompts, the optimizer has to mathematically pay for itself. Additionally, API pricing changes, so our internal tables require maintenance. However, the conclusion remains strong: Sway is a pragmatic, transparent, and highly technical solution that stops AI API waste at the source. Thank you."
