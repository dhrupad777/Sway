// In-session response cache. Key = canonical optimized prompt (normalized).
// LRU with capacity 200, TTL 15 minutes.
// A cache hit costs $0 — the API is never called.

export interface CacheEntry {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  createdAt: number;
}

export type CacheResult =
  | { hit: true; entry: CacheEntry; ageMs: number }
  | { hit: false };

const CAPACITY = 200;
const TTL_MS = 15 * 60 * 1000;

class LRUCache {
  private map = new Map<string, CacheEntry>();

  private normalize(key: string): string {
    return key.trim().toLowerCase().replace(/\s+/g, " ");
  }

  get(key: string): CacheResult {
    const k = this.normalize(key);
    const entry = this.map.get(k);
    if (!entry) return { hit: false };
    const ageMs = Date.now() - entry.createdAt;
    if (ageMs > TTL_MS) {
      this.map.delete(k);
      return { hit: false };
    }
    // Move to end (most-recently-used)
    this.map.delete(k);
    this.map.set(k, entry);
    return { hit: true, entry, ageMs };
  }

  set(key: string, entry: Omit<CacheEntry, "createdAt">): void {
    const k = this.normalize(key);
    if (this.map.size >= CAPACITY) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, { ...entry, createdAt: Date.now() });
  }

  size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}

export const responseCache = new LRUCache();
