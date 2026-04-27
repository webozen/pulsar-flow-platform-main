/**
 * Token-bucket rate limiter tests. The behaviour we care about:
 *   - First N requests within burst window pass.
 *   - N+1 within burst window is denied with a sensible retryAfterMs.
 *   - Tokens refill at the configured rate when time advances.
 *   - Buckets are isolated per (slug, execId).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkResumeRateLimit, _resetRateLimitState } from "../rate-limit";

beforeEach(() => _resetRateLimitState());

describe("checkResumeRateLimit", () => {
  it("first request through allows; bucket starts at full burst (10)", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(checkResumeRateLimit("acme-dental", "EX1", t0).allowed, `call ${i + 1}/10`).toBe(true);
    }
  });

  it("11th call within the same instant is denied with retryAfterMs ~200", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) checkResumeRateLimit("acme-dental", "EX1", t0);
    const r = checkResumeRateLimit("acme-dental", "EX1", t0);
    expect(r.allowed).toBe(false);
    // Refill rate = 5/sec → one token every 200 ms. We need 1 full token
    // after consuming the 10th (bucket sits at 0 after the 10th).
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(250);
  });

  it("after enough time, tokens refill and a denied call now succeeds", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) checkResumeRateLimit("acme-dental", "EX1", t0);
    expect(checkResumeRateLimit("acme-dental", "EX1", t0).allowed).toBe(false);
    // 1 second later → 5 tokens refilled → next call passes.
    const t1 = t0 + 1000;
    expect(checkResumeRateLimit("acme-dental", "EX1", t1).allowed).toBe(true);
  });

  it("buckets are isolated per (slug, execId)", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) checkResumeRateLimit("acme-dental", "EX1", t0);
    // Same slug, different exec → fresh bucket
    expect(checkResumeRateLimit("acme-dental", "EX2", t0).allowed).toBe(true);
    // Different slug, same exec id → fresh bucket
    expect(checkResumeRateLimit("beta-dental", "EX1", t0).allowed).toBe(true);
  });

  it("tokens cap at burst — sitting idle for an hour doesn't grant 18000 tokens", () => {
    const t0 = 1_000_000;
    checkResumeRateLimit("acme-dental", "EX1", t0); // creates bucket at burst-1=9
    const tHourLater = t0 + 60 * 60_000;
    // Drain — should allow 10 (burst cap), not the theoretical refill of 18000.
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      if (checkResumeRateLimit("acme-dental", "EX1", tHourLater).allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });
});
