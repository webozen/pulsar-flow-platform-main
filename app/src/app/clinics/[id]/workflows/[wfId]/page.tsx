"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

  useEffect(() => {
    import("@/lib/trigger-library").then((mod) => setTriggers(mod.TRIGGER_LIBRARY));
  }, []);

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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
