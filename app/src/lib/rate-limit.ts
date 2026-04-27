/**
 * In-memory rate limiter for the approval-resume route.
 *
 * Each (slug, executionId) pair gets its own token bucket. Defaults
 * cap clicks at 5 per second sustained (refill rate) with a burst of
 * 10 — enough that a real human clicking quickly through a queue
 * never trips, but a runaway loop or a doubled-fired form does.
 *
 * Memory: one entry per resumed execution per ~minute. With Kestra's
 * exec lifecycle (resumed → success → moves out of paused), the buckets
 * for completed executions are reaped on next access. At 1000 active
 * tenants × 25 cards ≈ 25k entries worst-case, < 5 MB. Acceptable for
 * a single Next.js process. If we ever scale horizontally we'll move
 * this to Redis — not before.
 *
 * Why per-(slug, exec) rather than per-IP or per-slug:
 *   - per-IP: would block multiple staff in the same clinic NAT
 *   - per-slug: a busy clinic chewing through 25 cards in 30s could
 *     trip; we want to throttle PER decision not per session
 *   - per-(slug, exec): a stuck UI hammering the same exec is the
 *     bug we want to catch, while letting fast staff churn the queue
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const BURST = 10;
const REFILL_PER_SEC = 5;
const REFILL_INTERVAL_MS = 1000 / REFILL_PER_SEC; // 200 ms / token

// Cap on map size before we sweep. Reaping is O(n) but only fires
// once we hit the cap, and the predicate is cheap (one timestamp
// check per entry).
const REAP_THRESHOLD = 50_000;
const STALE_AFTER_MS = 5 * 60_000; // 5 min after last refill

const buckets = new Map<string, Bucket>();

function reapStale(now: number): void {
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > STALE_AFTER_MS) buckets.delete(k);
  }
}

export function checkResumeRateLimit(slug: string, execId: string, now: number = Date.now()): RateLimitResult {
  const key = `${slug}:${execId}`;
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= REAP_THRESHOLD) reapStale(now);
    b = { tokens: BURST, lastRefill: now };
    buckets.set(key, b);
  }

  // Refill at REFILL_PER_SEC since lastRefill, capped at BURST.
  const elapsed = now - b.lastRefill;
  if (elapsed > 0) {
    const refill = elapsed / REFILL_INTERVAL_MS;
    b.tokens = Math.min(BURST, b.tokens + refill);
    b.lastRefill = now;
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // No tokens — compute when one will be available.
  const needed = 1 - b.tokens;
  const retryAfterMs = Math.ceil(needed * REFILL_INTERVAL_MS);
  return { allowed: false, retryAfterMs };
}

/** Test-only — clears the bucket map between tests. */
export function _resetRateLimitState(): void {
  buckets.clear();
}
