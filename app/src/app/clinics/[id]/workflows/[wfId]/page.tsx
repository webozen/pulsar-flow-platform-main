"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TriggerEvent } from "@/lib/trigger-library";

interface Action {
  type: string;
  [key: string]: unknown;
}

const FREQUENCY_OPTIONS = [
  { value: "*/5 * * * *", label: "Every 5 min" },
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 9 * * *", label: "Daily 9AM" },
  { value: "0 9 * * 1", label: "Weekly Mon" },
];

const ACTION_DEFAULTS: Record<string, Partial<Action>> = {
  sms: { type: "sms", to: "{{ taskrun.value.phone }}", message: "" },
  email: { type: "email", emailTo: "{{ taskrun.value.email }}", subject: "", body: "" },
  webhook: { type: "webhook", url: "", method: "POST", webhookBody: "{}" },
  pause: { type: "pause", duration: "P3D" },
  approval: { type: "approval" },
  condition: { type: "condition", field: "", operator: "is_not_empty", value: "" },
  create_commlog: { type: "create_commlog", patNum: "{{ taskrun.value.patNum }}", note: "" },
  update_appointment_status: { type: "update_appointment_status", aptNum: "{{ taskrun.value.aptNum }}", status: "confirmed" },
  ai_generate: { type: "ai_generate", message: "" },
};

export default function EditWorkflowPage() {
  const { id: clinicId, wfId } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<"opendental" | "manual">("opendental");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [customSql, setCustomSql] = useState("");
  const [triggerCron, setTriggerCron] = useState("0 9 * * *");
  const [actionMode, setActionMode] = useState<"immediate" | "on_approval" | "manual">("immediate");
  const [actions, setActions] = useState<Action[]>([]);
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [taskAssignedTo, setTaskAssignedTo] = useState("");
  // Platform-managed flows (deployed by the Pulsar tenant-sync bridge from
  // YAML on disk) can't round-trip through the structured builder, so we
  // render a comprehensive read-only view instead. The full Kestra flow
  // JSON is what the read-only view renders against — no synthesis.
  // platform-managed flag controls the amber "edits get overwritten on
  // next provision" warning at the top of the page.
  const [platformManaged, setPlatformManaged] = useState(false);
  // Two-mode Edit: "builder" (default — same UI as Create with values
  // pre-filled) and "summary" (read-only structured view of every task
  // and label). Tab switcher at the top toggles between them.
  const [viewMode, setViewMode] = useState<"builder" | "summary">("builder");
  const [flowDefinition, setFlowDefinition] = useState<Record<string, unknown> | null>(null);
  const [flowJsonPretty, setFlowJsonPretty] = useState<string>("");
  const [rawYamlUrl, setRawYamlUrl] = useState<string>("");

  useEffect(() => {
    import("@/lib/trigger-library").then((mod) => setTriggers(mod.TRIGGER_LIBRARY));
  }, []);

  // Same stale-URL guard as the workflows list page — see comment there.
  useEffect(() => {
    clientFetch(`/api/auth/me`).then(async (r) => {
      if (!r.ok) return;
      const me = await r.json();
      if (me?.slug && me.slug !== String(clinicId ?? "")) {
        router.replace(`/clinics/${me.slug}/workflows`);
      }
    });
  }, [clinicId, router]);

  useEffect(() => {
    clientFetch(`/api/workflows/${wfId}`).then(async (res) => {
      if (res.ok) {
        const wf = await res.json();
        setName(wf.name || "");
        setDescription(wf.description || "");
        setTriggerCron(wf.trigger_cron || "0 9 * * *");
        setCustomSql(wf.trigger_sql || "");
        const acts = typeof wf.actions === "string" ? JSON.parse(wf.actions) : wf.actions;
        setActions(Array.isArray(acts) ? acts : []);
        // The "When Triggered" radio defaulted to "immediate" regardless of
        // what the API returned. Read action_mode (on_approval / immediate /
        // manual) from the response so the form reflects reality.
        if (wf.action_mode === "on_approval" || wf.action_mode === "immediate" || wf.action_mode === "manual") {
          setActionMode(wf.action_mode);
        }
        setPlatformManaged(!!wf.platform_managed);
        setFlowDefinition(wf.flow_definition ?? null);
        setFlowJsonPretty(wf.flow_json_pretty ?? "");
        setRawYamlUrl(wf.raw_yaml_url ?? "");
        // Try to match trigger event from library
        import("@/lib/trigger-library").then((mod) => {
          const match = mod.TRIGGER_LIBRARY.find((t) => t.sql === wf.trigger_sql);
          if (match) setTriggerEvent(match.event);
        });
      }
      setLoading(false);
    });
  }, [wfId]);

  useEffect(() => {
    const sql = triggerEvent ? triggers.find((t) => t.event === triggerEvent)?.sql || "" : customSql;
    if (sql) {
      import("@/lib/trigger-library").then((mod) => setPlaceholders(mod.extractPlaceholders(sql)));
    }
  }, [triggerEvent, customSql, triggers]);

  function addAction(type: string) {
    setActions([...actions, { ...ACTION_DEFAULTS[type] } as Action]);
  }
  function updateAction(i: number, field: string, value: unknown) {
    const updated = [...actions];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[i] as any)[field] = value;
    setActions(updated);
  }
  function removeAction(i: number) { setActions(actions.filter((_, idx) => idx !== i)); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const sql = triggerEvent ? triggers.find((t) => t.event === triggerEvent)?.sql || customSql : customSql;
    const res = await clientFetch(`/api/workflows/${wfId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, triggerCron, triggerSql: sql, actionMode, actions, taskTitle, taskPriority, taskAssignedTo }),
    });
    if (!res.ok) { setError("Failed to save"); setSaving(false); return; }
    router.push(`/clinics/${clinicId}/workflows`);
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  if (viewMode === "summary") {
    return (
      <>
        <ViewModeTabs viewMode={viewMode} setViewMode={setViewMode} platformManaged={platformManaged} />
        <ReadOnlyFlowView
          wfId={String(wfId ?? "")}
          name={name}
          description={description}
          triggerCron={triggerCron}
          customSql={customSql}
          flowDefinition={flowDefinition}
          flowJsonPretty={flowJsonPretty}
          rawYamlUrl={rawYamlUrl}
          clinicId={String(clinicId ?? "")}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ViewModeTabs viewMode={viewMode} setViewMode={setViewMode} platformManaged={platformManaged} />
      <h1 className="text-2xl font-bold">Edit Workflow</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Trigger</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={triggerType === "opendental" ? "default" : "outline"} onClick={() => setTriggerType("opendental")}>Open Dental</Button>
              <Button type="button" size="sm" variant={triggerType === "manual" ? "default" : "outline"} onClick={() => setTriggerType("manual")}>Manual</Button>
            </div>
            {triggerType === "opendental" && (
              <>
                <div className="space-y-2">
                  <Label>Trigger Event</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
                    <option value="">Custom SQL</option>
                    {triggers.map((t) => <option key={t.event} value={t.event}>[{t.category}] {t.description}</option>)}
                  </select>
                </div>
                {!triggerEvent && (
                  <div className="space-y-2"><Label>Custom SQL</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[100px]" value={customSql} onChange={(e) => setCustomSql(e.target.value)} /></div>
                )}
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <div className="flex gap-2 flex-wrap">
                    {FREQUENCY_OPTIONS.map((f) => <Button key={f.value} type="button" size="sm" variant={triggerCron === f.value ? "default" : "outline"} onClick={() => setTriggerCron(f.value)}>{f.label}</Button>)}
                  </div>
                  <Input value={triggerCron} onChange={(e) => setTriggerCron(e.target.value)} className="font-mono text-sm" />
                </div>
              </>
            )}
            {placeholders.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {placeholders.map((p) => <Badge key={p} variant="secondary" className="font-mono text-xs">{`{{${p}}}`}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>When Triggered</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(["immediate", "on_approval", "manual"] as const).map((mode) => (
              <label key={mode} className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer ${actionMode === mode ? "border-blue-500 bg-blue-50" : ""}`}>
                <input type="radio" name="actionMode" checked={actionMode === mode} onChange={() => setActionMode(mode)} />
                <div>
                  <p className="text-sm font-medium">{mode === "immediate" ? "Execute immediately" : mode === "on_approval" ? "Create task for approval" : "Create task (manual)"}</p>
                </div>
              </label>
            ))}
            {actionMode !== "immediate" && (
              <div className="border rounded-md p-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label className="text-xs">Task Title</Label><Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs">Priority</Label>
                    <select className="w-full rounded-md border px-3 py-2 text-sm" value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                      {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Assign To</Label><Input value={taskAssignedTo} onChange={(e) => setTaskAssignedTo(e.target.value)} className="text-sm" /></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {actions.map((action, i) => (
              <div key={i} className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Step {i + 1}: {action.type?.toString().toUpperCase()}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!action.retryEnabled} onChange={(e) => updateAction(i, "retryEnabled", e.target.checked)} />Retry</label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeAction(i)}>Remove</Button>
                  </div>
                </div>
                {action.type === "sms" && (<>
                  <div className="space-y-1"><Label className="text-xs">To</Label><Input value={(action.to as string) || ""} onChange={(e) => updateAction(i, "to", e.target.value)} className="text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs">Message</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={(action.message as string) || ""} onChange={(e) => updateAction(i, "message", e.target.value)} /></div>
                </>)}
                {action.type === "email" && (<>
                  <div className="space-y-1"><Label className="text-xs">To</Label><Input value={(action.emailTo as string) || ""} onChange={(e) => updateAction(i, "emailTo", e.target.value)} className="text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs">Subject</Label><Input value={(action.subject as string) || ""} onChange={(e) => updateAction(i, "subject", e.target.value)} className="text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs">Body</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={(action.body as string) || ""} onChange={(e) => updateAction(i, "body", e.target.value)} /></div>
                </>)}
                {action.type === "pause" && (<div className="space-y-1"><Label className="text-xs">Duration</Label><Input value={(action.duration as string) || ""} onChange={(e) => updateAction(i, "duration", e.target.value)} className="text-sm" /></div>)}
                {action.type === "approval" && (<p className="text-sm text-muted-foreground">Pauses until approved.</p>)}
                {action.type === "condition" && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="space-y-1"><Label className="text-xs">Field</Label><Input value={(action.field as string) || ""} onChange={(e) => updateAction(i, "field", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Operator</Label>
                      <select className="w-full rounded-md border px-3 py-2 text-sm" value={(action.operator as string) || "is_not_empty"} onChange={(e) => updateAction(i, "operator", e.target.value)}>
                        <option value="is_not_empty">is not empty</option><option value="is_empty">is empty</option><option value="equals">equals</option><option value="contains">contains</option>
                      </select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Value</Label><Input value={(action.value as string) || ""} onChange={(e) => updateAction(i, "value", e.target.value)} className="text-sm" /></div>
                  </div>
                )}
                {action.type === "ai_generate" && (<div className="space-y-1"><Label className="text-xs">AI Prompt</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={(action.message as string) || ""} onChange={(e) => updateAction(i, "message", e.target.value)} /></div>)}
                {action.type === "webhook" && (<>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">URL</Label><Input value={(action.url as string) || ""} onChange={(e) => updateAction(i, "url", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Method</Label><select className="w-full rounded-md border px-3 py-2 text-sm" value={(action.method as string) || "POST"} onChange={(e) => updateAction(i, "method", e.target.value)}><option>POST</option><option>PUT</option><option>GET</option></select></div>
                  </div>
                </>)}
                {action.type === "create_commlog" && (<>
                  <div className="space-y-1"><Label className="text-xs">Patient #</Label><Input value={(action.patNum as string) || ""} onChange={(e) => updateAction(i, "patNum", e.target.value)} className="text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs">Note</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={(action.note as string) || ""} onChange={(e) => updateAction(i, "note", e.target.value)} /></div>
                </>)}
                {action.type === "update_appointment_status" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Apt #</Label><Input value={(action.aptNum as string) || ""} onChange={(e) => updateAction(i, "aptNum", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Status</Label><select className="w-full rounded-md border px-3 py-2 text-sm" value={(action.status as string) || "confirmed"} onChange={(e) => updateAction(i, "status", e.target.value)}><option value="confirmed">Confirmed</option><option value="reminder_sent">Reminder Sent</option><option value="review_requested">Review Requested</option></select></div>
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {Object.keys(ACTION_DEFAULTS).map((type) => (
                <Button key={type} type="button" variant="outline" size="sm" onClick={() => addAction(type)}>+ {type.replace(/_/g, " ")}</Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save & Redeploy"}</Button>
        </div>
      </form>
    </div>
  );
}

/** Two-tab switcher at the top of the Edit page: Builder (default, looks
 *  like Create) and Summary (read-only structured view). */
function ViewModeTabs({
  viewMode, setViewMode, platformManaged,
}: {
  viewMode: "builder" | "summary"
  setViewMode: (m: "builder" | "summary") => void
  platformManaged: boolean
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="bg-slate-100 rounded-lg p-1 flex text-sm" data-testid="view-mode-tabs">
        <button
          type="button"
          onClick={() => setViewMode("builder")}
          className={`px-3 py-1.5 rounded-md transition ${viewMode === "builder" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          data-testid="tab-builder"
        >
          Builder
        </button>
        <button
          type="button"
          onClick={() => setViewMode("summary")}
          className={`px-3 py-1.5 rounded-md transition ${viewMode === "summary" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          data-testid="tab-summary"
        >
          Summary
        </button>
      </div>
      {platformManaged && (
        <span className="text-xs text-amber-700" data-testid="platform-managed-warning">
          Platform-managed flow — edits push to Kestra now, but the next tenant-sync provision will overwrite.
        </span>
      )}
    </div>
  )
}

/**
 * Comprehensive read-only view for platform-managed flows (deployed by
 * Pulsar tenant-sync from YAML on disk). Renders everything we know about
 * the flow against the live Kestra `flow_definition` so what's on screen
 * always matches what's actually running. No data is hidden, nothing is
 * synthesized.
 */
function ReadOnlyFlowView({
  wfId, name, description, triggerCron, customSql, flowDefinition, flowJsonPretty, rawYamlUrl, clinicId,
}: {
  wfId: string
  name: string
  description: string
  triggerCron: string
  customSql: string
  flowDefinition: Record<string, unknown> | null
  flowJsonPretty: string
  rawYamlUrl: string
  clinicId: string
}) {
  const def = flowDefinition ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = ((def as any).tasks ?? []) as Array<Record<string, unknown>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triggers = ((def as any).triggers ?? []) as Array<Record<string, unknown>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labels = ((def as any).labels ?? []) as Array<{ key: string; value: string }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disabled = !!(def as any).disabled

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="readonly-flow-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="flow-name">{name}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Platform-managed flow — read-only here. To change the YAML, open the Kestra editor.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge className={disabled ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800 border-emerald-200"}>
            {disabled ? "Disabled" : "Active"}
          </Badge>
          {rawYamlUrl && (
            <a href={rawYamlUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" data-testid="open-kestra-editor">Open in Kestra</Button>
            </a>
          )}
          <Link href={`/clinics/${clinicId}/workflows`}>
            <Button size="sm" variant="ghost">Back</Button>
          </Link>
        </div>
      </div>

      {description && (
        <Card>
          <CardHeader><CardTitle className="text-base">What this flow does</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 leading-relaxed" data-testid="flow-description">
              {humanizeDescription(description)}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">When it runs</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {triggers.length === 0 && <p className="text-sm" data-testid="trigger-manual">Manual only — staff hits Execute to start a run.</p>}
          {triggers.map((t, i) => (
            <div key={i} className="text-sm" data-testid={`trigger-${i}`}>
              <div className="font-medium text-slate-800">
                {t.cron ? humanizeCron(String(t.cron)) : "On event"}
                {t.timezone ? <span className="text-slate-500"> · {String(t.timezone)}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {summarizeTriggerType(String(t.type ?? ""))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Steps <span className="text-xs font-normal text-muted-foreground">({tasks.length} task{tasks.length === 1 ? "" : "s"})</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            What runs in order. Each <span className="font-medium text-amber-700">approval gate</span> below is what staff sees in the Approval Queue.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">No steps defined.</p>}
          {flattenSteps(tasks).map((step, i) => (
            <StepRow key={i} step={step} index={i} />
          ))}
        </CardContent>
      </Card>

      {customSql && (
        <Card>
          <CardHeader><CardTitle className="text-base">SQL it runs against OpenDental</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-slate-50 border rounded p-3 overflow-x-auto" data-testid="flow-sql">
              {customSql}
            </pre>
          </CardContent>
        </Card>
      )}

      {labels.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Labels</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {labels.map((l, i) => (
              <Badge key={i} className="bg-slate-100 text-slate-800 border border-slate-200" data-testid={`label-${i}`}>
                {l.key}: {l.value}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {flowJsonPretty && (
        <details className="rounded border bg-white">
          <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">
            Raw flow definition (JSON) — for debugging
          </summary>
          <pre className="text-[11px] font-mono bg-slate-900 text-slate-100 rounded-b p-3 overflow-auto max-h-96" data-testid="flow-json">
            {flowJsonPretty}
          </pre>
        </details>
      )}
    </div>
  )
}

// ── Plain-English helpers ───────────────────────────────────────────────

/** Strip the "Requirements per tenant" / "Reads OpenDental via..." dev
 *  notes that the YAML descriptions used to embed. Returns the first
 *  user-facing paragraph only. */
function humanizeDescription(raw: string): string {
  const trimmed = raw.trim()
  // Cut at first occurrence of dev-only markers.
  const cuts = ["\n\nReads ", "\n\nRequirements ", "\nRequirements ", "\n\n#", "\nsecrets:", "\nkv:"]
  let end = trimmed.length
  for (const c of cuts) {
    const idx = trimmed.indexOf(c)
    if (idx !== -1 && idx < end) end = idx
  }
  return trimmed.slice(0, end).replace(/\s+/g, " ").trim()
}

/** "0 7 * * *" → "Daily at 7:00 AM". Falls back to the raw cron string
 *  for expressions we don't recognise. */
function humanizeCron(cron: string): string {
  const m = cron.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/)
  if (!m) return cron
  const [, min, hr, dom, mon, dow] = m
  if (mon === "*" && dom === "*" && dow === "*" && /^\d+$/.test(min) && /^\d+$/.test(hr)) {
    const h = Number(hr), mi = Number(min)
    const ampm = h >= 12 ? "PM" : "AM"
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `Daily at ${h12}:${mi.toString().padStart(2, "0")} ${ampm}`
  }
  if (min === "*/5" && hr === "*") return "Every 5 minutes"
  if (min === "0" && hr === "*") return "Hourly"
  return `Cron: ${cron}`
}

function summarizeTriggerType(type: string): string {
  if (type.endsWith("Schedule")) return "Scheduled trigger"
  if (type.endsWith("Webhook")) return "Webhook trigger"
  if (type.endsWith("Trigger")) return "Polling trigger"
  return type || "Trigger"
}

// ── Step flattening + rendering ─────────────────────────────────────────

interface FlatStep {
  id: string
  type: string
  description?: string
  depth: number
  // Pretty role for the row's left badge.
  role: "fetch" | "approval" | "loop" | "condition" | "send-sms" | "send-email" | "log" | "task"
  // Headline string (used as the row's main label).
  headline: string
  // Optional secondary line.
  detail?: string
}

function flattenSteps(tasks: Array<Record<string, unknown>>, depth = 0): FlatStep[] {
  const out: FlatStep[] = []
  for (const t of tasks) {
    const id = String(t.id ?? "")
    const type = String(t.type ?? "")
    const description = (t.description ? String(t.description) : "").trim() || undefined
    const role = classifyStep(type, t)
    const headline = headlineFor(role, id, t)
    const detail = detailFor(role, t)
    out.push({ id, type, description, depth, role, headline, detail })
    // Recurse into nested task lists Kestra exposes (ForEach.tasks, If.then, Switch.cases, …)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (t as any).tasks ?? (t as any).then ?? null
    if (Array.isArray(child)) out.push(...flattenSteps(child, depth + 1))
  }
  return out
}

function classifyStep(type: string, t: Record<string, unknown>): FlatStep["role"] {
  if (type.includes("flow.Pause")) return "approval"
  if (type.includes("flow.ForEach")) return "loop"
  if (type.includes("flow.If") || type.includes("flow.Switch")) return "condition"
  if (type.includes("log.Log")) return "log"
  if (type.includes("http.Request")) {
    const uri = String((t as { uri?: unknown }).uri ?? "")
    if (/twilio\.com.*Messages/i.test(uri)) return "send-sms"
    if (/sendgrid|smtp/i.test(uri)) return "send-email"
    if (/opendental|ShortQuery/i.test(uri)) return "fetch"
    return "task"
  }
  if (type.includes("MailSend")) return "send-email"
  return "task"
}

function headlineFor(role: FlatStep["role"], id: string, t: Record<string, unknown>): string {
  switch (role) {
    case "fetch": return "Pull rows from OpenDental"
    case "approval": return "Wait for staff approval"
    case "loop": {
      const v = String((t as { values?: unknown }).values ?? "")
      const m = v.match(/outputs\.(\w+)\.body/)
      return m ? `For each row from "${m[1]}"…` : "For each row…"
    }
    case "condition": return "Check a condition"
    case "send-sms": return "Send SMS via Twilio"
    case "send-email": return "Send email"
    case "log": return "Record to log"
    default: return id || "Task"
  }
}

function detailFor(role: FlatStep["role"], t: Record<string, unknown>): string | undefined {
  if (role === "approval") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs = ((t as any).onResume ?? []) as Array<{ id?: string; type?: string }>
    if (inputs.length) return `Approver supplies: ${inputs.map((i) => `${i.id}:${i.type}`).join(", ")}`
  }
  if (role === "send-sms") {
    const body = String((t as { body?: unknown }).body ?? "")
    const m = body.match(/Body=([^&]+)/)
    if (m) {
      const txt = decodeURIComponent(m[1].replace(/\+/g, " "))
      return txt.length > 120 ? txt.slice(0, 117) + "…" : txt
    }
  }
  if (role === "fetch") {
    return "Read-only HTTPS PUT to /queries/ShortQuery"
  }
  return undefined
}

const ROLE_BADGE: Record<FlatStep["role"], { label: string; cls: string }> = {
  "fetch":      { label: "Fetch",     cls: "bg-sky-100 text-sky-800 border border-sky-200" },
  "approval":   { label: "Approval",  cls: "bg-amber-100 text-amber-800 border border-amber-200" },
  "loop":       { label: "Loop",      cls: "bg-slate-100 text-slate-700 border border-slate-200" },
  "condition":  { label: "If",        cls: "bg-slate-100 text-slate-700 border border-slate-200" },
  "send-sms":   { label: "SMS",       cls: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
  "send-email": { label: "Email",     cls: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
  "log":        { label: "Log",       cls: "bg-slate-100 text-slate-500 border border-slate-200" },
  "task":       { label: "Task",      cls: "bg-slate-100 text-slate-700 border border-slate-200" },
}

function StepRow({ step, index }: { step: FlatStep; index: number }) {
  const badge = ROLE_BADGE[step.role]
  return (
    <div className="flex items-start gap-3 text-sm" data-testid={`step-${index}`}>
      <div className="text-xs text-slate-400 font-mono mt-1 w-5 shrink-0 text-right">{index + 1}.</div>
      <div className="shrink-0" style={{ marginLeft: step.depth * 12 }}>
        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-800">
          {step.headline}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          <span className="text-slate-400">id:</span> <span className="font-mono">{step.id}</span>
        </div>
        {step.description && (
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.description}</div>
        )}
        {step.detail && (
          <div className="text-xs text-slate-500 mt-1 italic">"{step.detail}"</div>
        )}
      </div>
    </div>
  )
}
