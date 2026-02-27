/**
 * Simple in-memory token bucket rate limiter.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/** Maximum number of tracked keys to prevent unbounded memory growth */
const BUCKETS_MAP_CAP = 50_000;

/** Stale bucket cleanup interval in ms (5 minutes) */
const CLEANUP_INTERVAL_MS = 300_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  /**
   * @param maxPerMinute Maximum requests per minute
   */
  constructor(maxPerMinute: number) {
    if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) {
      throw new RangeError('maxPerMinute must be a positive finite number');
    }
    this.maxTokens = maxPerMinute;
    this.refillRate = maxPerMinute / 60_000; // tokens per ms

    // Cleanup stale buckets every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.lastRefill > CLEANUP_INTERVAL_MS) {
          this.buckets.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  /** Returns true if the request is allowed, false if rate-limited */
  allow(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      // Evict oldest entry if map is at capacity
      if (this.buckets.size >= BUCKETS_MAP_CAP) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey);
        }
      }
      bucket = { tokens: this.maxTokens - 1, lastRefill: now };
      this.buckets.set(key, bucket);
      return true;
    }

    // Refill tokens based on elapsed time (clamp to non-negative to guard against clock drift)
    const elapsed = Math.min(Math.max(0, now - bucket.lastRefill), 120_000); // cap at 2 minutes
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.buckets.clear();
  }
}
