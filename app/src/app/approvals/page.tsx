"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo, fullTimestamp } from "@/lib/time-ago";
import { useNow } from "@/lib/use-now";
import { Loader2, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Types ──────────────────────────────────────────────────────────────

interface Approval {
  executionId: string;
  namespace: string;
  flowId: string;
  state: string;
  labels: Array<{ key: string; value: string }>;
  startedAt: string | null;
  taskRunId: string | null;
  recordPreview: Record<string, unknown> | null;
}

interface Clinic {
  id: string;
  name: string;
  kestra_namespace: string;
}

interface ActionPreview {
  type: string;
  title: string;
  details: Record<string, string>;
}

interface ApprovalDetail {
  recordData: Record<string, unknown> | null;
  actionPreviews: ActionPreview[];
}

interface Outcome {
  summary: "sent" | "failed" | "skipped" | "running" | "pending";
  detail: string;
  sentTo?: string | null;
  sentBody?: string | null;
  twilioSid?: string | null;
  twilioStatus?: string | null;
}


// ── Page ───────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<Record<string, ApprovalDetail>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  // Tracks which approval ids have already had a terminal-state toast
  // applied so the polling loop doesn't re-fire on every tick.
  const toastedFor = useRef<Set<string>>(new Set());
  // Per-approval Sonner toast id — `toast.loading()` returns an id we
  // later swap to `success`/`error` via `{ id }` so the SAME toast
  // morphs in place (the contract `toast.promise()` provides, but with
  // our polling-effect architecture intact).
  const toastIdFor = useRef<Map<string, string | number>>(new Map());

  async function load() {
    setLoading(true);
    const [aRes, cRes] = await Promise.all([
      clientFetch("/api/approvals"),
      clientFetch("/api/clinics"),
    ]);
    if (aRes.ok) setApprovals(await aRes.json());
    if (cRes.ok) {
      // /api/clinics is JWT-scoped — returns exactly the caller's clinic.
      // Phase 2 cleanup made the approval queue strictly tenant-local; no
      // cross-tenant filter is exposed in the UI anymore.
      const list = (await cRes.json()) as Clinic[];
      setClinic(list[0] ?? null);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function loadDetail(execId: string) {
    if (details[execId]) return;
    try {
      const res = await clientFetch(`/api/approvals/${execId}/detail`);
      if (!res.ok) return;
      const data = await res.json();
      setDetails((p) => ({
        ...p,
        [execId]: {
          recordData: data.recordData ?? null,
          actionPreviews: data.actionPreviews ?? [],
        },
      }));
    } catch { /* ignore */ }
  }

  async function fetchOutcome(execId: string): Promise<Outcome | null> {
    try {
      const res = await clientFetch(`/api/approvals/${execId}/outcome`);
      if (!res.ok) return null;
      return (await res.json()) as Outcome;
    } catch { return null; }
  }

  function applyOutcome(approval: Approval, o: Outcome) {
    setOutcomes((p) => ({ ...p, [approval.executionId]: o }));
    if (o.summary === "sent" || o.summary === "failed" || o.summary === "skipped") {
      if (toastedFor.current.has(approval.executionId)) return;
      toastedFor.current.add(approval.executionId);
      const who = displayName(approval.recordPreview ?? {});
      // If a `toast.loading` was opened on click, swap it in place.
      // Otherwise (page reload mid-poll) fire a fresh toast.
      const id = toastIdFor.current.get(approval.executionId);
      if (o.summary === "sent") {
        const lines: string[] = [];
        if (o.sentTo) lines.push(`To ${o.sentTo}`);
        if (o.sentBody) lines.push(o.sentBody);
        if (o.detail) lines.push(o.detail);
        toast.success(`SMS sent — ${who}`, {
          id, description: lines.join(" · ") || undefined, duration: 4000,
        });
      } else if (o.summary === "failed") {
        toast.error(`Send failed — ${who}`, {
          id, description: o.detail || "Click View logs for details.",
          duration: Infinity, // sticky until dismissed — failures matter
        });
      } else {
        toast(`Skipped — ${who}`, { id, description: "No SMS sent." });
      }
      toastIdFor.current.delete(approval.executionId);
    }
  }

  async function approve(approval: Approval) {
    const who = displayName(approval.recordPreview ?? {});
    setBusy((p) => ({ ...p, [approval.executionId]: true }));
    toastedFor.current.delete(approval.executionId);
    setOutcomes((p) => ({ ...p, [approval.executionId]: { summary: "running", detail: "Sending…" } }));
    // Open a single loading toast that applyOutcome will later morph
    // into success/error/info via `{ id }`. Replaces the previous
    // pattern of opening a fresh toast on each terminal state.
    const tId = toast.loading(`Sending SMS to ${who}…`);
    toastIdFor.current.set(approval.executionId, tId);
    try {
      await clientFetch(`/api/approvals/${approval.executionId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } finally {
      setBusy((p) => ({ ...p, [approval.executionId]: false }));
    }
  }

  async function skip(approval: Approval) {
    const who = displayName(approval.recordPreview ?? {});
    setBusy((p) => ({ ...p, [approval.executionId]: true }));
    toastedFor.current.delete(approval.executionId);
    setOutcomes((p) => ({ ...p, [approval.executionId]: { summary: "running", detail: "Skipping…" } }));
    const tId = toast.loading(`Skipping ${who}…`);
    toastIdFor.current.set(approval.executionId, tId);
    try {
      await clientFetch(`/api/approvals/${approval.executionId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill" }),
      });
    } finally {
      setBusy((p) => ({ ...p, [approval.executionId]: false }));
    }
  }

  // Approvals are already tenant-scoped at the API layer (/api/approvals
  // filters by JWT slug → namespace), so there's no cross-tenant view
  // to filter into. The previous "All clinics" dropdown was a leftover
  // from before Plan B. Now we just render the current tenant's name.
  const filtered = approvals;
  const tenantLabel = clinic?.name ?? "";

  return (
    <div className="space-y-6">
      {/* Toaster is mounted once at the root layout (Sonner). */}

      {/* Header sticks to the top while the queue scrolls. The
          AppShell already pins its own nav bar at top:0 / h-14, so we
          start at top-14 to sit flush below it. -mx-4 + px-4 lets the
          sticky bar's background span edge-to-edge of the content
          column instead of leaving stripes on the sides. */}
      <div className="sticky top-14 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-gray-50/95 backdrop-blur-sm border-b border-slate-200/60 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Approval Queue</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            {tenantLabel ? `${tenantLabel} · ` : ""}
            {filtered.length} pending approval{filtered.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        // Skeleton placeholders match the actual ApprovalCard layout
        // (title, subtitle, action preview, two action buttons) so the
        // page doesn't reflow when real data lands.
        <div className="space-y-3" data-testid="approvals-loading">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                  <Skeleton className="h-16 w-full mt-3" />
                </div>
                <div className="flex flex-col gap-2 min-w-[180px]">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="rounded-full bg-emerald-50 p-3 mb-3 ring-1 ring-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg">All clear</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-sm">
              No pending approvals right now. Trigger a workflow run from the
              Workflows tab to send a fresh batch to this queue.
            </p>
            <a
              href="/automation/workflows"
              className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Go to Workflows →
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((approval) => (
            <ApprovalCard
              key={approval.executionId}
              approval={approval}
              clinicLabel={tenantLabel}
              detail={details[approval.executionId]}
              outcome={outcomes[approval.executionId]}
              busy={!!busy[approval.executionId]}
              onMount={() => loadDetail(approval.executionId)}
              onApprove={() => approve(approval)}
              onSkip={() => skip(approval)}
              fetchOutcome={() => fetchOutcome(approval.executionId)}
              applyOutcome={(o) => applyOutcome(approval, o)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Approval card ─────────────────────────────────────────────────────

function ApprovalCard(props: {
  approval: Approval;
  clinicLabel: string;
  detail: ApprovalDetail | undefined;
  outcome: Outcome | undefined;
  busy: boolean;
  onMount: () => void;
  onApprove: () => void;
  onSkip: () => void;
  fetchOutcome: () => Promise<Outcome | null>;
  applyOutcome: (o: Outcome) => void;
}) {
  const { approval, clinicLabel, detail, outcome, busy, onMount, onApprove, onSkip,
    fetchOutcome, applyOutcome } = props;

  // Re-render every 30s so the "started 2 min ago" pill self-updates
  // without a queue refetch — staff can leave the tab open all day.
  const now = useNow();

  const [pendingAction, setPendingAction] = useState<"approve" | "skip" | null>(null);

  useEffect(() => {
    if (!detail) onMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval.executionId]);

  // Poll /outcome while chip is "running" — survives slow Kestra
  // workers and never gets garbage-collected mid-flight.
  const isRunning = outcome?.summary === "running";
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const o = await fetchOutcome();
      if (cancelled) return;
      if (o) {
        applyOutcome(o);
        if (o.summary === "sent" || o.summary === "failed" || o.summary === "skipped") return;
      }
      t = setTimeout(tick, 1000);
    };
    t = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, approval.executionId]);

  const record = detail?.recordData ?? approval.recordPreview ?? {};
  const title = displayName(record);
  const subtitle = displaySubtitle(record);
  const actionPreviews = detail?.actionPreviews ?? [];

  return (
    <Card
      className="p-4 transition-shadow transition-colors hover:shadow-md hover:border-slate-300"
      data-testid={`approval-card-${approval.executionId}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800" data-testid="approval-title">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
            <span>{clinicLabel}</span>
            {subtitle && <span>{subtitle}</span>}
            {approval.startedAt && (
              <span title={fullTimestamp(approval.startedAt)}>
                started {timeAgo(approval.startedAt, now)}
              </span>
            )}
          </div>
          {outcome && (
            <OutcomeChip
              outcome={outcome}
              executionId={approval.executionId}
            />
          )}
          {actionPreviews.length > 0 ? (
            <div className="mt-3 space-y-2">
              {actionPreviews.map((a, i) => (
                <ActionPreviewBlock key={i} action={a} />
              ))}
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-500 italic">
              No outbound action — this gate just records the decision.
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0 min-w-[180px]">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => setPendingAction("approve")}
            className="bg-emerald-600 hover:bg-emerald-700 whitespace-normal text-left h-auto py-2"
            data-testid="approve-btn"
            title={`Approve and send SMS for ${title}`}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sending…
              </span>
            ) : (
              `Approve · ${title}`
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setPendingAction("skip")}
            // Outline keeps it visibly a button (subtle ring, hover bg)
            // while staying secondary to the green Approve. Ghost was
            // too flat — read as a parent container instead of an action.
            className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 whitespace-normal text-left h-auto py-2"
            data-testid="skip-btn"
          >
            Skip · {title}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              {/* Initials avatar — gives the dialog a "you're acting on
                  THIS person" anchor, makes the about-to-text-someone
                  moment feel more deliberate. Uses tenant primary color
                  for the bg via the runtime CSS var, falling back to a
                  slate tint when no brand is loaded. */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--pulsar-primary, #475569)" }}
                aria-hidden
              >
                {initials(record)}
              </div>
              <AlertDialogTitle className="text-left">
                {pendingAction === "approve" ? `Send SMS to ${title}?` : `Skip ${title}?`}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {pendingAction === "approve" ? (
                <span className="block space-y-1">
                  <span className="block">
                    <span className="font-medium text-slate-700">Appointment:</span>{" "}
                    {(record.AptDateTime ?? record.AptDate ?? "—") as string}
                  </span>
                  <span className="block">
                    <span className="font-medium text-slate-700">Recipient (Twilio sandbox):</span>{" "}
                    +15198002773
                  </span>
                  <span className="block">
                    <span className="font-medium text-slate-700">Real phone on file:</span>{" "}
                    {(record.WirelessPhone ?? record.phone ?? "—") as string}
                  </span>
                </span>
              ) : (
                <>No SMS will be sent. This row's execution will be killed.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-action"
              className={
                pendingAction === "approve"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : ""
              }
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                if (action === "approve") onApprove();
                else if (action === "skip") onSkip();
              }}
            >
              {pendingAction === "approve" ? "Send SMS" : "Skip"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Display helpers ───────────────────────────────────────────────────

/** First-letter-of-each-word avatar text. "Sawyer Montgomery" → "SM",
 *  "Madonna" → "M". Used in the confirm dialog and anywhere else we
 *  need a compact human anchor. */
function initials(record: Record<string, unknown>): string {
  const f = String((record.FName ?? record.firstName ?? record.first_name ?? "") || "").trim();
  const l = String((record.LName ?? record.lastName ?? record.last_name ?? "") || "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || "?";
  const name = String(record.name ?? "").trim();
  return name ? name.charAt(0).toUpperCase() : "?";
}

function displayName(record: Record<string, unknown>): string {
  const f = (record.FName ?? record.firstName ?? record.first_name ?? "") as string;
  const l = (record.LName ?? record.lastName ?? record.last_name ?? "") as string;
  if (f || l) return `${f}${l ? " " + l : ""}`.trim();
  if (record.name) return String(record.name);
  return "(unnamed row)";
}

function displaySubtitle(record: Record<string, unknown>): string {
  const apt = record.AptDateTime ?? record.appt_date_time ?? record.AptDate;
  const phone = record.WirelessPhone ?? record.phone ?? record.HmPhone;
  const parts: string[] = [];
  if (apt) parts.push(String(apt));
  if (phone) parts.push(String(phone));
  return parts.join(" · ");
}

// ── OutcomeChip ───────────────────────────────────────────────────────

interface LogLine {
  timestamp: string | null;
  level: string;
  taskId: string | null;
  message: string;
}

export function OutcomeChip({
  outcome,
  executionId,
}: {
  outcome: Outcome;
  executionId: string;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  if (outcome.summary === "pending") return null;
  const styles: Record<Outcome["summary"], string> = {
    sent: "bg-emerald-50 text-emerald-800 border-emerald-200",
    failed: "bg-rose-50 text-rose-800 border-rose-200",
    skipped: "bg-slate-100 text-slate-700 border-slate-200",
    running: "bg-slate-50 text-slate-700 border-slate-200",
    pending: "",
  };
  const label: Record<Outcome["summary"], string> = {
    sent: "Sent", failed: "Failed", skipped: "Skipped", running: "Sending…", pending: "",
  };

  async function toggleLogs() {
    const next = !showLogs;
    setShowLogs(next);
    if (next && logs === null) {
      setLoadingLogs(true);
      try {
        const res = await clientFetch(`/api/approvals/${executionId}/logs?minLevel=INFO`);
        if (res.ok) {
          const data = (await res.json()) as { lines: LogLine[] };
          setLogs(data.lines);
        } else {
          setLogs([]);
        }
      } catch { setLogs([]); }
      finally { setLoadingLogs(false); }
    }
  }

  return (
    // `key={outcome.summary}` re-mounts the chip when the state name
    // changes, which lets `animate-in fade-in` re-fire on each
    // running → sent / failed / skipped transition. Without the key,
    // React diffs in place and the animation only plays on first mount.
    <div
      key={outcome.summary}
      className="mt-2 space-y-1 animate-in fade-in duration-300"
      data-testid="outcome-chip"
    >
      <div className="flex items-start gap-2 flex-wrap">
        <Badge className={`${styles[outcome.summary]} font-normal`}>
          {outcome.summary === "running" && (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          )}
          {label[outcome.summary]}
        </Badge>
        {outcome.detail && (
          <span className="text-xs text-slate-600 truncate max-w-[420px]" title={outcome.detail}>
            {outcome.detail}
          </span>
        )}
        {outcome.twilioSid && (
          // Render the Twilio sid as a chip — visually says "this is an
          // external resource id, click to inspect" — and links into
          // Twilio's console for that exact message.
          <a
            href={`https://console.twilio.com/us1/monitor/logs/sms?sid=${outcome.twilioSid}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${outcome.twilioSid} in Twilio console`}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800 hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
          >
            {outcome.twilioSid.slice(0, 12)}…
          </a>
        )}
        {(outcome.summary === "failed" || outcome.summary === "sent" || outcome.summary === "skipped") && (
          <button
            type="button"
            onClick={toggleLogs}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
            data-testid="view-logs"
          >
            {showLogs ? "Hide logs" : "View logs"}
          </button>
        )}
      </div>
      {outcome.summary === "sent" && (outcome.sentBody || outcome.sentTo) && (
        <div className="rounded border border-emerald-200 bg-emerald-50/60 p-2 text-xs" data-testid="sent-confirmation">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-800 mb-0.5">
            Sent to {outcome.sentTo ?? "?"}
          </div>
          {outcome.sentBody && (
            // line-clamp keeps the card height bounded for verbose Twilio
            // bodies; full text is in `title`. The Sonner toast also
            // shows the full body, so the staff member always has the
            // unabridged version available.
            <div
              className="text-emerald-900 whitespace-pre-wrap break-words line-clamp-3"
              title={outcome.sentBody}
            >
              {outcome.sentBody}
            </div>
          )}
        </div>
      )}
      {showLogs && (
        <div className="rounded border bg-slate-950 text-slate-100 text-[11px] font-mono p-2 max-h-56 overflow-auto">
          {loadingLogs && <div className="text-slate-400">Loading…</div>}
          {!loadingLogs && (logs?.length ?? 0) === 0 && (
            <div className="text-slate-400">No log lines.</div>
          )}
          {!loadingLogs && logs?.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">
              <span className={l.level === "ERROR" ? "text-rose-400" : l.level === "WARN" ? "text-amber-300" : "text-slate-400"}>[{l.level}]</span>{" "}
              <span className="text-sky-300">{l.taskId ?? "-"}</span>{" "}
              {l.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionPreviewBlock({ action }: { action: ActionPreview }) {
  if (action.type === "sms") {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-800 mb-1">
          SMS to {action.details.to}
        </div>
        <div className="text-slate-800 whitespace-pre-wrap" data-testid="sms-preview">
          {action.details.message}
        </div>
      </div>
    );
  }
  if (action.type === "email") {
    return (
      <div className="rounded border border-sky-200 bg-sky-50/40 p-3 text-sm">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-sky-800 mb-1">
          Email to {action.details.to}
        </div>
        {action.details.subject && (
          <div className="text-slate-800 font-medium">{action.details.subject}</div>
        )}
        <div className="text-slate-800 whitespace-pre-wrap mt-1">{action.details.body}</div>
      </div>
    );
  }
  return (
    <div className="rounded border bg-slate-50 p-3 text-sm">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-700 mb-1">
        {action.title}
      </div>
      <pre className="text-xs overflow-x-auto">{JSON.stringify(action.details, null, 2)}</pre>
    </div>
  );
}

// Toast UI lives in Sonner now (`@/components/ui/sonner`, mounted once
// in `src/app/layout.tsx`). Calls go through the `toast()` API.
