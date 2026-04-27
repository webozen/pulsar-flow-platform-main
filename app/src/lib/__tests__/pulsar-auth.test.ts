/**
 * Direct tests for the auth contract.
 *
 * `validateToken` is the trust boundary for every API route; an
 * accidental change here grants cross-tenant access. These tests pin:
 *   - Slug must be present in the JWT — missing → AuthError.
 *   - Wrong-secret signatures → rejected.
 *   - Expired tokens → rejected.
 *   - Tampered payloads → rejected.
 *   - Both Authorization: Bearer and pulsar_jwt cookie are accepted.
 *   - Missing token → AuthError("Unauthorized").
 *
 * Module is imported with the dev sentinel secret already loaded (set
 * at module init) — we sign test tokens with the same value via
 * `process.env.PULSAR_JWT_SECRET`.
 */
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { validateToken, requireAuth } from "../pulsar-auth";

// Match the dev sentinel pulsar-auth defaults to. Tests only run in
// non-production, so the sentinel resolution is the path taken.
const DEV_SECRET = "dev-secret-change-me-please-32bytes-minimum-abcdefgh";

function sign(payload: Record<string, unknown>, opts: jwt.SignOptions = {}): string {
  return jwt.sign(payload, DEV_SECRET, { algorithm: "HS384", ...opts });
}

function reqWithCookie(token: string): Request {
  return new Request("http://localhost/x", { headers: { Cookie: `pulsar_jwt=${token}` } });
}
function reqWithBearer(token: string): Request {
  return new Request("http://localhost/x", { headers: { Authorization: `Bearer ${token}` } });
}

describe("validateToken", () => {
  it("returns claims when token is valid", () => {
    const t = sign({ slug: "acme-dental", email: "admin@acme.test", role: "tenant_user" });
    expect(validateToken(t)).toEqual({
      slug: "acme-dental",
      email: "admin@acme.test",
      role: "tenant_user",
    });
  });

  it("defaults role to tenant_user when missing", () => {
    const t = sign({ slug: "acme-dental" });
    expect(validateToken(t).role).toBe("tenant_user");
    expect(validateToken(t).email).toBe("");
  });

  it("rejects token without a slug claim", () => {
    const t = sign({ email: "x@x.com" });
    expect(() => validateToken(t)).toThrow(/Invalid or expired token/);
  });

  it("rejects token signed with a wrong secret", () => {
    const t = jwt.sign({ slug: "acme-dental" }, "different-secret-fffff", { algorithm: "HS384" });
    expect(() => validateToken(t)).toThrow(/Invalid or expired token/);
  });

  it("rejects expired tokens", () => {
    const t = sign({ slug: "acme-dental" }, { expiresIn: "-1s" });
    expect(() => validateToken(t)).toThrow(/Invalid or expired token/);
  });

  it("rejects tampered tokens", () => {
    const t = sign({ slug: "acme-dental" });
    const tampered = t.slice(0, -2) + "XX";
    expect(() => validateToken(tampered)).toThrow(/Invalid or expired token/);
  });

  it("accepts the whole HMAC family — HS256, HS384, HS512", () => {
    for (const alg of ["HS256", "HS384", "HS512"] as const) {
      const t = jwt.sign({ slug: "acme-dental" }, DEV_SECRET, { algorithm: alg });
      expect(validateToken(t).slug).toBe("acme-dental");
    }
  });

  it("rejects unsupported algorithms (no `alg: none` bypass)", () => {
    const noneToken =
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") +
      "." +
      Buffer.from(JSON.stringify({ slug: "acme-dental" })).toString("base64url") +
      ".";
    expect(() => validateToken(noneToken)).toThrow(/Invalid or expired token/);
  });
});

describe("requireAuth", () => {
  it("extracts JWT from the pulsar_jwt cookie", () => {
    const t = sign({ slug: "acme-dental" });
    expect(requireAuth(reqWithCookie(t)).slug).toBe("acme-dental");
  });

  it("extracts JWT from Authorization: Bearer header", () => {
    const t = sign({ slug: "beta-dental" });
    expect(requireAuth(reqWithBearer(t)).slug).toBe("beta-dental");
  });

  it("Bearer header takes precedence over cookie when both present", () => {
    const cookieT = sign({ slug: "acme-dental" });
    const bearerT = sign({ slug: "beta-dental" });
    const req = new Request("http://localhost/x", {
      headers: {
        Cookie: `pulsar_jwt=${cookieT}`,
        Authorization: `Bearer ${bearerT}`,
      },
    });
    expect(requireAuth(req).slug).toBe("beta-dental");
  });

  it("throws AuthError when no token is present", () => {
    const req = new Request("http://localhost/x");
    expect(() => requireAuth(req)).toThrow(/Unauthorized/);
  });

  it("throws AuthError when cookie has other unrelated keys but no pulsar_jwt", () => {
    const req = new Request("http://localhost/x", { headers: { Cookie: "session=abc; other=def" } });
    expect(() => requireAuth(req)).toThrow(/Unauthorized/);
  });
});
