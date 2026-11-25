// Text embeddings via the Gemini REST API, memoized in SQLite so each distinct
// text is embedded once. Used by the semantic cache (Phase 3), the learned
// router (Phase 2) and context retrieval (Phase 5).
import { createHash } from "node:crypto";
import { db } from "./metrics.js";
import { DEFAULTS } from "./pricing.js";

export const EMBED_DIM = 768;

let _ready = false;
function table(): void {
  if (_ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      vec BLOB NOT NULL,
      PRIMARY KEY (hash, model)
    );
  `);
  _ready = true;
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function fromBlob(b: Buffer): Float32Array {
  // Copy: the Buffer may not be 4-byte aligned.
  const copy = new Uint8Array(b);
  return new Float32Array(copy.buffer);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function hashText(t: string): string {
  return createHash("sha256").update(t.trim().replace(/\s+/g, " ")).digest("hex");
}

async function callGemini(texts: string[], model: string): Promise<Float32Array[]> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (needed for embeddings)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map(t => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: EMBED_DIM,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Embedding ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json() as { embeddings: { values: number[] }[] };
  return json.embeddings.map(e => Float32Array.from(e.values));
}

/** Embed many texts. Cached ones come from SQLite; the rest are fetched in batches of 100. */
export async function embedMany(texts: string[], model = DEFAULTS.embedding): Promise<Float32Array[]> {
  table();
  const get = db().prepare(`SELECT vec FROM embeddings WHERE hash = ? AND model = ?`);
  const put = db().prepare(`INSERT OR REPLACE INTO embeddings (hash, model, vec) VALUES (?, ?, ?)`);
  const out: (Float32Array | null)[] = texts.map(t => {
    const row = get.get(hashText(t), model) as { vec: Buffer } | undefined;
    return row ? fromBlob(row.vec) : null;
  });
  const missing = out.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
  for (let s = 0; s < missing.length; s += 100) {
    const idx = missing.slice(s, s + 100);
    const vecs = await callGemini(idx.map(i => texts[i]), model);
    idx.forEach((i, k) => {
      out[i] = vecs[k];
      put.run(hashText(texts[i]), model, toBlob(vecs[k]));
    });
  }
  return out as Float32Array[];
}

export async function embed(text: string, model = DEFAULTS.embedding): Promise<Float32Array> {
  return (await embedMany([text], model))[0];
}
