import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface LoadedContext {
  text: string;
  hash: string;
  path: string;
  bytes: number;
}

export function loadContext(explicitPath?: string): LoadedContext | null {
  const candidates = explicitPath
    ? [explicitPath]
    : ["sway.md", "SWAY.md", ".sway.md"];

  for (const c of candidates) {
    const p = resolve(process.cwd(), c);
    if (existsSync(p)) {
      const text = readFileSync(p, "utf8");
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
      return { text, hash, path: p, bytes: Buffer.byteLength(text, "utf8") };
    }
  }
  return null;
}

export const STARTER_SWAY_MD = `# Project context

<!--
  Sway loads this file once and prepends it as a system message to every \`sway ask\`.
  Keep it tight: project description, conventions, vocabulary, key files.
  The shorter and more specific, the better the savings vs re-pasting context inline.
-->

## What I'm working on
(One paragraph: project, language, framework, domain.)

## Conventions
- (e.g., TypeScript strict mode)
- (e.g., functions over classes)

## Key files / vocabulary
- (e.g., \`src/providers.ts\` = LLM adapters)
`;
