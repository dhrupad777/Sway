// Phase 1 — LLM-as-judge. Scores an answer 1–10, optionally against a reference answer.
import { complete } from "./providers.js";
import { costUsd, DEFAULTS } from "./pricing.js";

export interface Judgement {
  score: number;
  reason: string;
  costUsd: number;
}

const SYSTEM = `You are a strict grader of answers given by an AI tutor to programming students.
Score the ANSWER to the QUESTION from 1 to 10:
- 9-10: fully correct, complete for what was asked, clear, well-pitched to the asker
- 7-8: correct, minor omissions or clarity issues
- 5-6: partially correct or missing an important part of the question
- 3-4: significant errors or mostly unhelpful
- 1-2: wrong, empty, cut off mid-answer, or off-topic
If a REFERENCE is given, use it to check correctness — the answer need not match its wording or length.
Do not reward length for its own sake. An answer that stops mid-sentence is at most 4.
Return ONLY JSON: {"score": <integer 1-10>, "reason": "<one sentence>"}`;

export async function judge(question: string, answer: string, reference?: string, model = DEFAULTS.judge): Promise<Judgement> {
  const user = [
    `QUESTION:\n${question}`,
    reference ? `REFERENCE:\n${reference}` : null,
    `ANSWER:\n${answer || "(empty)"}`,
  ].filter(Boolean).join("\n\n");
  const res = await complete({
    model,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    maxTokens: 800,
    temperature: 0,
  });
  const cost = costUsd(res.model, res.inputTokens, res.outputTokens);
  const parsed = parseJudgement(res.text);
  if (!parsed) throw new Error(`Judge returned unparseable output: ${res.text.slice(0, 200)}`);
  return { ...parsed, costUsd: cost };
}

export function parseJudgement(text: string): { score: number; reason: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const score = Number(o.score);
    if (!Number.isFinite(score) || score < 1 || score > 10) return null;
    return { score: Math.round(score), reason: String(o.reason ?? "") };
  } catch { return null; }
}
