/**
 * Vitest setup file (runs once per test worker, before any test imports
 * the system-under-test). Wired in `vitest.config.ts` via `setupFiles`.
 *
 * Purpose: replace the global `fetch` with a guard that throws if a
 * test forgets to mock it. Every API route in this codebase makes
 * outbound HTTP calls (Kestra, Twilio, OpenDental). A test that
 * neglects to stub `fetch` would silently hit production endpoints —
 * exactly the worry that prompted this guard.
 *
 * Tests stub fetch via `vi.stubGlobal("fetch", fetchMock)` per-test;
 * `vi.unstubAllGlobals()` (or vitest's auto-restore on `restoreMocks`)
 * pops the stub between tests, at which point this guard takes over
 * again. So the guard is the *fallback*; real test code is unaffected.
 *
 * Network calls deliberately allowed:
 *   - Loopback addresses (localhost / 127.0.0.1) when explicitly
 *     opted-in via the env var below — for the rare integration
 *     test that wants to hit a local Kestra. Default: deny.
 */

const ALLOW_LOCALHOST = process.env.VITEST_ALLOW_LOCALHOST === "1";

const guardedFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input
    : input instanceof URL ? input.toString()
    : input.url;

  if (ALLOW_LOCALHOST && /^https?:\/\/(localhost|127\.0\.0\.1)\b/.test(url)) {
    // Pass through to the real fetch implementation (bound on globalThis
    // BEFORE this setup ran — vitest preserves it as `globalThis.fetch`
    // until something stubs it).
    throw new Error(
      `[test-setup] localhost passthrough requested for ${url} — but the` +
      ` original fetch was already replaced. Mock fetch in your test instead.`,
    );
  }

  throw new Error(
    `[test-setup] Unmocked fetch() to ${url} — tests must stub fetch via` +
    ` vi.stubGlobal("fetch", fetchMock). Outbound network calls are blocked` +
    ` to keep tests deterministic and prevent hitting prod APIs (Kestra,` +
    ` Twilio, OpenDental, Pulsar).`,
  );
};

// Replace globally. Per-test `vi.stubGlobal("fetch", ...)` overrides this.
globalThis.fetch = guardedFetch as typeof fetch;
