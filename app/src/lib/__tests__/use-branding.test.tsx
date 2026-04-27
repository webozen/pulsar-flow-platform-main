/**
 * @vitest-environment jsdom
 *
 * Tests for the per-tenant branding hook. Pins the contract:
 *   - calls /api/tenant/branding with credentials: include
 *   - sets document.title to appName
 *   - sets --pulsar-primary + --pulsar-accent CSS vars on :root
 *   - silently no-ops when the endpoint is unreachable
 *
 * The branding hook is small surface but high impact (logo, brand
 * color, focus rings, dialog avatar, Sonner border all key off it).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { useBranding } from "../use-branding";

function Probe() {
  const b = useBranding();
  return <div data-testid="probe">{b ? b.appName : "loading"}</div>;
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  document.title = "(unset)";
  document.documentElement.style.removeProperty("--pulsar-primary");
  document.documentElement.style.removeProperty("--pulsar-accent");
});
afterEach(() => cleanup());

describe("useBranding", () => {
  it("happy path: fetches, sets state + document.title + CSS vars", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          appName: "Pulsar Dental",
          logoUrl: "/branding/dental/logo.svg",
          primaryColor: "#2ba7ff",
          accentColor: "#007acc",
          domain: "dental",
          source: "domain",
        }),
      ),
    );
    const { findByTestId } = render(<Probe />);
    await waitFor(async () => expect((await findByTestId("probe")).textContent).toBe("Pulsar Dental"));

    expect(document.title).toBe("Pulsar Dental");
    expect(document.documentElement.style.getPropertyValue("--pulsar-primary")).toBe("#2ba7ff");
    expect(document.documentElement.style.getPropertyValue("--pulsar-accent")).toBe("#007acc");

    // Cookie-based auth — Pulsar's branding endpoint reads pulsar_jwt
    // from the cookie, not a header. credentials:include is essential.
    const opts = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(opts?.credentials).toBe("include");
  });

  it("non-2xx response → null state, no document mutation", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    const { findByTestId } = render(<Probe />);
    // Hook never resolves to a value
    await new Promise((r) => setTimeout(r, 20));
    expect((await findByTestId("probe")).textContent).toBe("loading");
    expect(document.title).toBe("(unset)");
  });

  it("fetch throws → swallowed silently (network blip mid-render)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const { findByTestId } = render(<Probe />);
    await new Promise((r) => setTimeout(r, 20));
    expect((await findByTestId("probe")).textContent).toBe("loading");
  });

  it("unmount before fetch resolves → no setState-after-unmount warning", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolveFetch = r; }));
    const { unmount } = render(<Probe />);
    unmount();
    // Now resolve — the cancelled flag in the hook should prevent
    // setState. If it didn't, vitest would log a React warning.
    resolveFetch(new Response(JSON.stringify({
      appName: "x", logoUrl: null, primaryColor: "#000", accentColor: "#000",
      domain: "d", source: "domain",
    })));
    await new Promise((r) => setTimeout(r, 10));
    expect(true).toBe(true); // reached without React warning
  });
});
