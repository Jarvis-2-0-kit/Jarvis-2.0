/**
 * Simple in-memory token bucket rate limiter.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private cleanupInterval: ReturnType<typeof setInterval>;

  /**
   * @param maxPerMinute Maximum requests per minute
   */
  constructor(maxPerMinute: number) {
    this.maxTokens = maxPerMinute;
    this.refillRate = maxPerMinute / 60_000; // tokens per ms

    // Cleanup stale buckets every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.lastRefill > 300_000) {
          this.buckets.delete(key);
        }
      }
    }, 300_000);
  }

  /** Returns true if the request is allowed, false if rate-limited */
  allow(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens - 1, lastRefill: now };
      this.buckets.set(key, bucket);
      return true;
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
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
