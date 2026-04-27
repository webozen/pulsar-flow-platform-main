/**
 * @vitest-environment jsdom
 *
 * Component tests for OutcomeChip. These render variants are exercised
 * in Playwright already, but having them in vitest makes the chip's
 * state-shape contract enforceable on every PR — including the failure
 * detail and "View logs" toggle behaviour that's easy to miss in e2e
 * flake. The hand-rolled ToastStack was replaced by Sonner (mounted in
 * the root layout); its render variants are now covered by Sonner's
 * own test suite, so they were removed here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { OutcomeChip } from "../page";

// clientFetch is used inside OutcomeChip's logs toggle.
vi.mock("@/lib/client-fetch", () => ({
  clientFetch: vi.fn(),
}));
import { clientFetch } from "@/lib/client-fetch";

beforeEach(() => {
  (clientFetch as ReturnType<typeof vi.fn>).mockReset();
});
afterEach(() => {
  cleanup();
});

describe("OutcomeChip", () => {
  it("renders nothing when summary is pending (gate untouched)", () => {
    const { container } = render(
      <OutcomeChip outcome={{ summary: "pending", detail: "" }} executionId="x" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Sending… badge with spinner when running", () => {
    render(<OutcomeChip outcome={{ summary: "running", detail: "" }} executionId="x" />);
    expect(screen.getByTestId("outcome-chip")).toBeInTheDocument();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    // Spinner SVG renders inside the badge in the running variant.
    expect(screen.getByTestId("outcome-chip").querySelector("svg")).toBeTruthy();
  });

  it("renders Sent + sentTo + sentBody confirmation block on sent", () => {
    render(
      <OutcomeChip
        executionId="x"
        outcome={{
          summary: "sent",
          detail: "Twilio sid SM123",
          sentTo: "+15198002773",
          sentBody: "Hi Sawyer, this is Acme Dental. Reminder: 2026-04-27 11:30",
        }}
      />,
    );
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText(/Twilio sid SM123/)).toBeInTheDocument();
    const conf = screen.getByTestId("sent-confirmation");
    expect(conf).toHaveTextContent("Sent to +15198002773");
    expect(conf).toHaveTextContent("Hi Sawyer");
  });

  it("renders Failed badge + detail (no sent-confirmation block)", () => {
    render(
      <OutcomeChip
        executionId="x"
        outcome={{ summary: "failed", detail: "Twilio 21608: number unverified" }}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/21608/)).toBeInTheDocument();
    expect(screen.queryByTestId("sent-confirmation")).toBeNull();
  });

  it("renders Skipped badge", () => {
    render(<OutcomeChip executionId="x" outcome={{ summary: "skipped", detail: "Killed by user" }} />);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("View logs toggles, fetches /logs once, renders ERROR lines in rose", async () => {
    (clientFetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({
        lines: [
          { timestamp: null, level: "INFO",  taskId: "send_sms", message: "POST 200" },
          { timestamp: null, level: "ERROR", taskId: "send_sms", message: "Twilio 21608" },
        ],
      })),
    );
    render(
      <OutcomeChip
        executionId="exec-x"
        outcome={{ summary: "failed", detail: "boom" }}
      />,
    );
    fireEvent.click(screen.getByTestId("view-logs"));
    await waitFor(() => expect(screen.getByText(/Twilio 21608/)).toBeInTheDocument());
    expect(clientFetch).toHaveBeenCalledTimes(1);
    const url = (clientFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/api/approvals/exec-x/logs");
    // Toggling again hides without re-fetching
    fireEvent.click(screen.getByTestId("view-logs"));
    expect(screen.queryByText(/Twilio 21608/)).toBeNull();
    expect(clientFetch).toHaveBeenCalledTimes(1);
  });
});

// ToastStack removed — Sonner replaced it. See ../page.tsx Toaster mount.
