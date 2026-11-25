// Probe a Bedrock account/region to discover which model IDs actually respond.
// Useful when "The provided model identifier is invalid" — different accounts
// have different cross-region inference profile access.

const CANDIDATES = [
  // Direct model IDs (no inference profile prefix)
  "anthropic.claude-3-5-sonnet-20240620-v1:0",
  "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0",
  "anthropic.claude-3-haiku-20240307-v1:0",
  "anthropic.claude-3-sonnet-20240229-v1:0",

  // EU cross-region inference profiles
  "eu.anthropic.claude-3-5-sonnet-20240620-v1:0",
  "eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
  "eu.anthropic.claude-3-5-haiku-20241022-v1:0",
  "eu.anthropic.claude-3-haiku-20240307-v1:0",
  "eu.anthropic.claude-sonnet-4-20250514-v1:0",
  "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0",

  // US cross-region (in case region was misset)
  "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
  "us.anthropic.claude-3-5-haiku-20241022-v1:0",
];

interface ProbeResult {
  modelId: string;
  status: "ok" | "invalid" | "access-denied" | "throttled" | "other";
  httpStatus: number;
  hint?: string;
}

async function probeOne(modelId: string, region: string, key: string): Promise<ProbeResult> {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4,
    messages: [{ role: "user", content: "hi" }],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) return { modelId, status: "ok", httpStatus: res.status };
    if (res.status === 400 && /invalid/i.test(text))
      return { modelId, status: "invalid", httpStatus: 400, hint: "model id not recognized" };
    if (res.status === 403)
      return { modelId, status: "access-denied", httpStatus: 403, hint: "model exists but not granted to this account" };
    if (res.status === 429)
      return { modelId, status: "throttled", httpStatus: 429 };
    return { modelId, status: "other", httpStatus: res.status, hint: text.slice(0, 120) };
  } catch (e) {
    return { modelId, status: "other", httpStatus: 0, hint: (e as Error).message };
  }
}

export async function probe(): Promise<void> {
  const key = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!key) {
    console.error("AWS_BEARER_TOKEN_BEDROCK not set");
    process.exit(1);
  }
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

  console.log(`Probing Bedrock in region=${region} with ${CANDIDATES.length} candidate model IDs...`);
  console.log(`(each probe sends max_tokens=4 — total cost < $0.01)\n`);

  const ok: ProbeResult[] = [];
  const denied: ProbeResult[] = [];
  const invalid: ProbeResult[] = [];
  const other: ProbeResult[] = [];

  for (const id of CANDIDATES) {
    const r = await probeOne(id, region, key);
    const mark = r.status === "ok" ? "\x1b[32m✓\x1b[0m"
              : r.status === "access-denied" ? "\x1b[33m●\x1b[0m"
              : r.status === "invalid" ? "\x1b[2m·\x1b[0m"
              : "\x1b[31m✗\x1b[0m";
    console.log(`${mark} ${r.status.padEnd(14)} ${r.httpStatus.toString().padStart(3)}  ${id}${r.hint ? "  — " + r.hint : ""}`);
    if (r.status === "ok") ok.push(r);
    else if (r.status === "access-denied") denied.push(r);
    else if (r.status === "invalid") invalid.push(r);
    else other.push(r);
  }

  console.log("");
  console.log(`✓ Working:        ${ok.length}`);
  console.log(`● Access-denied:  ${denied.length}  (model exists in region but not enabled for your account)`);
  console.log(`· Invalid ID:     ${invalid.length}  (model ID format wrong or not in this region)`);
  console.log(`✗ Other errors:   ${other.length}`);

  if (ok.length > 0) {
    console.log("\n\x1b[32mWorking IDs. Use them with SWAY_PROVIDER=bedrock and SWAY_FLAGSHIP / SWAY_NANO / SWAY_OPTIMIZER (they must also appear in `sway models`).\x1b[0m\n");
    const sonnets = ok.filter(r => /sonnet/i.test(r.modelId));
    const haikus  = ok.filter(r => /haiku/i.test(r.modelId));
    if (sonnets.length) console.log(`  flagship: "${sonnets[0].modelId}"`);
    if (haikus.length)  console.log(`  nano:     "${haikus[0].modelId}"`);
    if (haikus.length)  console.log(`  optimizer:"${haikus[0].modelId}"`);
  } else if (denied.length > 0) {
    console.log("\n\x1b[33mModels exist in this region but your account isn't granted access.\x1b[0m");
    console.log("Open Bedrock console → Model access → request access for the models above.");
  } else {
    console.log("\n\x1b[31mNothing worked.\x1b[0m Check that AWS_BEARER_TOKEN_BEDROCK is valid and AWS_REGION matches the region your key was issued in.");
  }
}

// ---------- `sway probe`: check the active setup ----------

/** One tiny call per configured model plus one embedding, so a new user sees exactly what works. */
export async function checkSetup(): Promise<void> {
  const { DEFAULTS, KEY_VARS, hasKey } = await import("./pricing.js");
  const { complete } = await import("./providers.js");
  const { embed } = await import("./embeddings.js");
  const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
  const bad = (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
  const firstLine = (e: unknown) => String((e as Error).message ?? e).split("\n")[0].slice(0, 160);

  console.log("API keys found:");
  for (const [p, vars] of Object.entries(KEY_VARS)) {
    console.log(`  ${hasKey(p as keyof typeof KEY_VARS) ? "\x1b[32m✓\x1b[0m" : "\x1b[2m·\x1b[0m"} ${p.padEnd(10)} ${vars.join(" or ")}`);
  }
  console.log(`\nActive provider: ${DEFAULTS.provider}  (change with SWAY_PROVIDER, see \`sway models\`)\n`);

  let failures = 0;
  const seen = new Set<string>();
  for (const role of ["flagship", "nano", "optimizer", "judge"] as const) {
    const model = DEFAULTS[role];
    if (seen.has(model)) { ok(`${role.padEnd(9)} ${model} (checked above)`); continue; }
    seen.add(model);
    try {
      const t0 = Date.now();
      await complete({ model, messages: [{ role: "user", content: "Reply with OK." }], maxTokens: 16, temperature: 0 });
      ok(`${role.padEnd(9)} ${model}  ${Date.now() - t0}ms`);
    } catch (e) {
      failures++;
      bad(`${role.padEnd(9)} ${model}  ${firstLine(e)}`);
    }
  }
  try {
    await embed("sway setup check");
    ok(`embedding ${DEFAULTS.embedding}  (semantic cache, learned router, context retrieval)`);
  } catch (e) {
    bad(`embedding ${DEFAULTS.embedding}  ${firstLine(e)}`);
    console.log("    Without embeddings Sway still works; the semantic cache, context retrieval and learned router switch off.");
  }

  if (failures) {
    console.log(`\n\x1b[31m${failures} model(s) failed.\x1b[0m Fix the key above, or pick other models with SWAY_FLAGSHIP / SWAY_NANO / SWAY_OPTIMIZER.`);
    if (DEFAULTS.provider === "bedrock") console.log("On Bedrock, `sway probe --bedrock` finds which model IDs your account can use.");
    process.exit(1);
  }
  console.log("\n\x1b[32mReady.\x1b[0m Try: sway ask \"what is a closure in javascript\"");
}
