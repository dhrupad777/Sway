import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Loads KEY=VALUE pairs from `.env` in cwd into process.env.
// Already-set env vars win (so `$env:GEMINI_API_KEY = "..."` overrides .env).
// Silent if no .env file exists.
export function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// Run on import: cli.ts imports this module first, so keys from .env are visible
// before pricing.ts picks default models from whichever key is present.
loadEnv();
