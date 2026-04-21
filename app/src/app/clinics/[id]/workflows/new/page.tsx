"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TriggerEvent } from "@/lib/trigger-library";
import type { WorkflowTemplate } from "@/lib/workflow-templates";

// ── Types ──────────────────────────────────────────────────────

interface Action {
  type: "sms" | "email" | "webhook" | "pause" | "approval" | "condition" | "create_commlog" | "update_appointment_status" | "ai_generate" | "lookup" | "voice_call";
  parallel?: boolean;
  to?: string;
  message?: string;
  emailTo?: string;
  subject?: string;
  body?: string;
  url?: string;
  method?: string;
  webhookBody?: string;
  duration?: string;
  label?: string;
  // Condition
  field?: string;
  operator?: string;
  value?: string;
  thenType?: string;
  // Commlog
  patNum?: string;
  note?: string;
  // Apt update
  aptNum?: string;
  status?: string;
  // Retry
  retryEnabled?: boolean;
  // Twilio Lookup / Voice
  lookupPhoneField?: string;
  voicePatientNameField?: string;
  voiceAptDateField?: string;
}

const FREQUENCY_OPTIONS = [
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 9 * * *", label: "Daily (9 AM)" },
  { value: "0 9 * * 1", label: "Weekly (Monday 9 AM)" },
];

// ── Component ──────────────────────────────────────────────────

export default function NewWorkflowPage() {
  const { id: clinicId } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<"opendental" | "manual" | "webhook">("opendental");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [customSql, setCustomSql] = useState("");
  const [concurrencyLimit, setConcurrencyLimit] = useState(10);
  const [timeoutDuration, setTimeoutDuration] = useState("");
  const [errorNotificationEmail, setErrorNotificationEmail] = useState("");
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [dedupField, setDedupField] = useState("patNum");
  const [triggerCron, setTriggerCron] = useState("0 9 * * *");
  const [actionMode, setActionMode] = useState<"immediate" | "on_approval" | "manual">("immediate");
  const [actions, setActions] = useState<Action[]>([]);
  const [placeholders, setPlaceholders] = useState<string[]>([]);

  // Task settings (for approval/manual modes)
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [taskAssignedTo, setTaskAssignedTo] = useState("");
  const [queueName, setQueueName] = useState("");

  // Libraries
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  useEffect(() => {
    import("@/lib/trigger-library").then((mod) => setTriggers(mod.TRIGGER_LIBRARY));
    import("@/lib/workflow-templates").then((mod) => setTemplates(mod.WORKFLOW_TEMPLATES));
  }, []);

  function applyTemplate(template: WorkflowTemplate) {
    setName(template.name);
    setDescription(template.description);
    setTriggerEvent(template.triggerEvent);
    setTriggerCron(template.triggerCron);
    setActionMode(template.actionMode);
    setActions(template.actions as Action[]);
    if (template.taskTitle) setTaskTitle(template.taskTitle);
    if (template.taskPriority) setTaskPriority(template.taskPriority);
  }

  // Update placeholders when trigger changes
  useEffect(() => {
    const sql = triggerEvent
      ? triggers.find((t) => t.event === triggerEvent)?.sql || ""
      : customSql;
    if (sql) {
      import("@/lib/trigger-library").then((mod) => {
        setPlaceholders(mod.extractPlaceholders(sql));
      });
    }
  }, [triggerEvent, customSql, triggers]);

  function addAction(type: Action["type"]) {
    const defaults: Record<string, Partial<Action>> = {
      sms: { type: "sms", to: "{{ taskrun.value.phone }}", message: "" },
      email: { type: "email", emailTo: "{{ taskrun.value.email }}", subject: "", body: "" },
      webhook: { type: "webhook", url: "", method: "POST", webhookBody: "{}" },
      pause: { type: "pause", duration: "P3D" },
      approval: { type: "approval" },
      condition: { type: "condition", field: "", operator: "is_not_empty", value: "" },
      create_commlog: { type: "create_commlog", patNum: "{{ taskrun.value.patNum }}", note: "" },
      update_appointment_status: { type: "update_appointment_status", aptNum: "{{ taskrun.value.aptNum }}", status: "confirmed" },
      ai_generate: { type: "ai_generate", message: "Draft a friendly dental recall reminder for patient {{ taskrun.value.patientName }}. Keep it under 160 characters." },
      lookup: { type: "lookup", lookupPhoneField: "phone" },
      voice_call: { type: "voice_call", to: "{{ taskrun.value.phone }}", voicePatientNameField: "patientName", voiceAptDateField: "aptDate" },
    };
    setActions([...actions, defaults[type] as Action]);
  }

  function updateAction(i: number, field: string, value: string | boolean) {
    const updated = [...actions];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[i] as any)[field] = value;
    setActions(updated);
  }

  function removeAction(i: number) {
    setActions(actions.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const sql = triggerEvent
      ? triggers.find((t) => t.event === triggerEvent)?.sql || customSql
      : customSql;

    const res = await clientFetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicId,
        name,
        description,
        triggerType,
        triggerCron: triggerType === "manual" ? null : triggerCron,
        triggerSql: sql,
        actionMode,
        actions,
        taskTitle,
        taskPriority,
        taskAssignedTo,
        queueName,
        concurrencyLimit,
        timeoutDuration: timeoutDuration || undefined,
        errorNotificationEmail: errorNotificationEmail || undefined,
        dedupEnabled,
        dedupField,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      setError(err.error || "Failed to create workflow");
      setLoading(false);
      return;
    }
    router.push(`/clinics/${clinicId}/workflows`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Create Workflow</h1>

      {/* Template Picker */}
      {templates.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Start from Template</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.slice(0, 6).map((t) => (
                <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                  className="text-left rounded-lg border p-3 hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                  <Badge variant="secondary" className="text-xs mt-1">{t.category}</Badge>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Pick a template to pre-fill, then customize below. Or start from scratch.</p>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basics */}
        <Card>
          <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Overdue Recall Reminders" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Send reminders to patients with overdue recalls" />
            </div>
          </CardContent>
        </Card>

        {/* Trigger */}
        <Card>
          <CardHeader><CardTitle>Trigger</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={triggerType === "opendental" ? "default" : "outline"} onClick={() => setTriggerType("opendental")}>Open Dental</Button>
              <Button type="button" size="sm" variant={triggerType === "webhook" ? "default" : "outline"} onClick={() => setTriggerType("webhook")}>Webhook</Button>
              <Button type="button" size="sm" variant={triggerType === "manual" ? "default" : "outline"} onClick={() => setTriggerType("manual")}>Manual Only</Button>
            </div>

            {triggerType === "opendental" && (
              <>
                <div className="space-y-2">
                  <Label>Trigger Event</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
                    <option value="">Custom SQL (write your own)</option>
                    {triggers.map((t) => (
                      <option key={t.event} value={t.event}>[{t.category}] {t.description}</option>
                    ))}
                  </select>
                </div>

                {!triggerEvent && (
                  <div className="space-y-2">
                    <Label>Custom SQL Query</Label>
                    <textarea className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[100px]" value={customSql} onChange={(e) => setCustomSql(e.target.value)} placeholder="SELECT p.PatNum AS patNum, p.FName AS firstName ... FROM patient p WHERE ..." />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Check Frequency</Label>
                  <div className="flex gap-2 flex-wrap">
                    {FREQUENCY_OPTIONS.map((f) => (
                      <Button key={f.value} type="button" size="sm" variant={triggerCron === f.value ? "default" : "outline"} onClick={() => setTriggerCron(f.value)}>
                        {f.label}
                      </Button>
                    ))}
                  </div>
                  <Input value={triggerCron} onChange={(e) => setTriggerCron(e.target.value)} className="font-mono text-sm" />
                </div>
              </>
            )}

            {triggerType === "webhook" && (
              <div className="bg-blue-50 p-3 rounded-md space-y-1">
                <p className="text-sm font-medium text-blue-800">Webhook Trigger</p>
                <p className="text-xs text-blue-700">External systems POST to a unique URL to trigger this workflow. The webhook URL will be shown after creation.</p>
                <p className="text-xs text-muted-foreground">You still need a SQL query to define what data to process.</p>
              </div>
            )}

            {triggerType === "manual" && (
              <p className="text-sm text-muted-foreground bg-blue-50 p-3 rounded-md">
                Manual workflows have no trigger. They are executed via the Kestra API or UI.
              </p>
            )}

            {placeholders.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Available Placeholders</Label>
                <div className="flex flex-wrap gap-1">
                  {placeholders.map((p) => (
                    <Badge key={p} variant="secondary" className="font-mono text-xs">{`{{${p}}}`}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Mode */}
        <Card>
          <CardHeader><CardTitle>When Triggered</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(["immediate", "on_approval", "manual"] as const).map((mode) => (
              <label key={mode} className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer ${actionMode === mode ? "border-blue-500 bg-blue-50" : ""}`}>
                <input type="radio" name="actionMode" checked={actionMode === mode} onChange={() => setActionMode(mode)} />
                <div>
                  <p className="text-sm font-medium">
                    {mode === "immediate" && "Execute immediately"}
                    {mode === "on_approval" && "Create task for approval"}
                    {mode === "manual" && "Create task (manual handling)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {mode === "immediate" && "Actions run automatically when trigger fires"}
                    {mode === "on_approval" && "Staff must approve before actions execute"}
                    {mode === "manual" && "Task created but actions are handled manually"}
                  </p>
                </div>
              </label>
            ))}

            {actionMode !== "immediate" && (
              <div className="border rounded-md p-3 space-y-3 mt-2">
                <p className="text-sm font-medium">Task Settings</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Task Title</Label>
                    <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Review: {{patientName}}" className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Priority</Label>
                    <select className="w-full rounded-md border px-3 py-2 text-sm" value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                      {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Assign To</Label>
                    <Input value={taskAssignedTo} onChange={(e) => setTaskAssignedTo(e.target.value)} placeholder="billing-team" className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Queue</Label>
                    <select className="w-full rounded-md border px-3 py-2 text-sm" value={queueName} onChange={(e) => setQueueName(e.target.value)}>
                      <option value="">No queue</option>
                      <option value="billing">Billing</option>
                      <option value="scheduling">Scheduling</option>
                      <option value="intake">Intake</option>
                      <option value="front-desk">Front Desk</option>
                      <option value="insurance">Insurance</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <p className="text-sm text-muted-foreground">What happens for each result row. Executed in order.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {actions.map((action, i) => (
              <div key={i} className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Step {i + 1}: {action.type.toUpperCase()}</span>
                    {action.label && <span className="text-xs text-muted-foreground">({action.label})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={!!action.retryEnabled} onChange={(e) => updateAction(i, "retryEnabled", e.target.checked)} />
                      Retry
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={!!action.parallel} onChange={(e) => updateAction(i, "parallel", e.target.checked)} />
                      Parallel
                    </label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeAction(i)}>Remove</Button>
                  </div>
                </div>

                {action.type === "sms" && (
                  <>
                    <div className="space-y-1"><Label className="text-xs">To</Label><Input value={action.to || ""} onChange={(e) => updateAction(i, "to", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Message</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={action.message || ""} onChange={(e) => updateAction(i, "message", e.target.value)} placeholder="Hi {{ taskrun.value.firstName }}, this is {{ kv('clinic_name') }}..." /></div>
                  </>
                )}
                {action.type === "email" && (
                  <>
                    <div className="space-y-1"><Label className="text-xs">To</Label><Input value={action.emailTo || ""} onChange={(e) => updateAction(i, "emailTo", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Subject</Label><Input value={action.subject || ""} onChange={(e) => updateAction(i, "subject", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Body</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={action.body || ""} onChange={(e) => updateAction(i, "body", e.target.value)} /></div>
                  </>
                )}
                {action.type === "webhook" && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1"><Label className="text-xs">URL</Label><Input value={action.url || ""} onChange={(e) => updateAction(i, "url", e.target.value)} className="text-sm" /></div>
                      <div className="space-y-1"><Label className="text-xs">Method</Label>
                        <select className="w-full rounded-md border px-3 py-2 text-sm" value={action.method || "POST"} onChange={(e) => updateAction(i, "method", e.target.value)}>
                          {["POST", "PUT", "GET", "DELETE"].map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Body</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[60px]" value={action.webhookBody || "{}"} onChange={(e) => updateAction(i, "webhookBody", e.target.value)} /></div>
                  </>
                )}
                {action.type === "pause" && (
                  <div className="space-y-1"><Label className="text-xs">Duration (ISO 8601)</Label><Input value={action.duration || ""} onChange={(e) => updateAction(i, "duration", e.target.value)} placeholder="P3D = 3 days, PT2H = 2 hours" className="text-sm" /></div>
                )}
                {action.type === "approval" && (
                  <p className="text-sm text-muted-foreground">Workflow pauses here until approved in the Approvals page.</p>
                )}
                {action.type === "condition" && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="space-y-1"><Label className="text-xs">Field</Label><Input value={action.field || ""} onChange={(e) => updateAction(i, "field", e.target.value)} placeholder="email" className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Operator</Label>
                      <select className="w-full rounded-md border px-3 py-2 text-sm" value={action.operator || "is_not_empty"} onChange={(e) => updateAction(i, "operator", e.target.value)}>
                        <option value="is_not_empty">is not empty</option>
                        <option value="is_empty">is empty</option>
                        <option value="equals">equals</option>
                        <option value="contains">contains</option>
                      </select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Value</Label><Input value={action.value || ""} onChange={(e) => updateAction(i, "value", e.target.value)} className="text-sm" placeholder="(for equals/contains)" /></div>
                  </div>
                )}
                {action.type === "create_commlog" && (
                  <>
                    <div className="space-y-1"><Label className="text-xs">Patient Number</Label><Input value={action.patNum || ""} onChange={(e) => updateAction(i, "patNum", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Note</Label><textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[60px]" value={action.note || ""} onChange={(e) => updateAction(i, "note", e.target.value)} placeholder="Contacted patient regarding..." /></div>
                  </>
                )}
                {action.type === "update_appointment_status" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Appointment Number</Label><Input value={action.aptNum || ""} onChange={(e) => updateAction(i, "aptNum", e.target.value)} className="text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Status</Label>
                      <select className="w-full rounded-md border px-3 py-2 text-sm" value={action.status || "confirmed"} onChange={(e) => updateAction(i, "status", e.target.value)}>
                        <option value="confirmed">Confirmed</option>
                        <option value="reminder_sent">Reminder Sent</option>
                        <option value="review_requested">Review Requested</option>
                      </select>
                    </div>
                  </div>
                )}
                {action.type === "ai_generate" && (
                  <div className="space-y-1">
                    <Label className="text-xs">AI Prompt (use placeholders)</Label>
                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[80px]" value={action.message || ""} onChange={(e) => updateAction(i, "message", e.target.value)} placeholder="Draft a friendly recall reminder for {{ taskrun.value.patientName }}..." />
                    <p className="text-xs text-muted-foreground">Calls OpenAI-compatible API. Configure ai_api_url and ai_api_key in clinic KV settings.</p>
                  </div>
                )}
                {action.type === "lookup" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Phone Field</Label>
                    <Input value={action.lookupPhoneField || "phone"} onChange={(e) => updateAction(i, "lookupPhoneField", e.target.value)} className="text-sm" placeholder="phone" />
                    <p className="text-xs text-muted-foreground">Validates the number, detects mobile vs landline. Result available at outputs.step_N_lookup.body. ~$0.005/lookup.</p>
                  </div>
                )}
                {action.type === "voice_call" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={action.to || ""} onChange={(e) => updateAction(i, "to", e.target.value)} className="text-sm" placeholder="{{ taskrun.value.phone }}" /></div>
                    <div className="space-y-1"><Label className="text-xs">Patient Name Field</Label><Input value={action.voicePatientNameField || ""} onChange={(e) => updateAction(i, "voicePatientNameField", e.target.value)} className="text-sm" placeholder="patientName" /></div>
                    <div className="space-y-1"><Label className="text-xs">Appointment Date Field</Label><Input value={action.voiceAptDateField || ""} onChange={(e) => updateAction(i, "voiceAptDateField", e.target.value)} className="text-sm" placeholder="aptDate" /></div>
                    <div className="space-y-1 sm:col-span-2"><p className="text-xs text-muted-foreground">Places an automated call. Patient hears &quot;Press 1 to confirm, 2 to reschedule, 3 for reception.&quot; DTMF digit posted back to a Kestra webhook flow &apos;voice-response&apos; in this namespace.</p></div>
                  </div>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("sms")}>+ SMS</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("email")}>+ Email</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("webhook")}>+ Webhook</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("pause")}>+ Delay</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("approval")}>+ Approval Gate</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("condition")}>+ Condition</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("create_commlog")}>+ Commlog</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("update_appointment_status")}>+ Apt Status</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("ai_generate")}>+ AI Generate</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("lookup")}>+ Phone Lookup</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addAction("voice_call")}>+ Voice Call</Button>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Settings */}
        <Card>
          <CardHeader><CardTitle>Advanced Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-xs">Max Concurrent Runs</Label>
                <Input type="number" value={concurrencyLimit} onChange={(e) => setConcurrencyLimit(parseInt(e.target.value) || 10)} className="text-sm" />
                <p className="text-xs text-muted-foreground">Prevents SMS storms. Default: 10</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Timeout</Label>
                <Input value={timeoutDuration} onChange={(e) => setTimeoutDuration(e.target.value)} placeholder="PT1H" className="text-sm" />
                <p className="text-xs text-muted-foreground">PT1H = 1 hour. Kill if exceeds.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Error Notification Email</Label>
                <Input type="email" value={errorNotificationEmail} onChange={(e) => setErrorNotificationEmail(e.target.value)} placeholder="admin@clinic.com" className="text-sm" />
                <p className="text-xs text-muted-foreground">Alert when workflow fails</p>
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2 border-t">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dedupEnabled} onChange={(e) => setDedupEnabled(e.target.checked)} />
                Dedup enabled
              </label>
              {dedupEnabled && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Dedup field:</Label>
                  <Input value={dedupField} onChange={(e) => setDedupField(e.target.value)} className="text-sm w-32" placeholder="patNum" />
                  <p className="text-xs text-muted-foreground">Skips if same entity processed in last 7 days</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create & Deploy"}</Button>
        </div>
      </form>
    </div>
  );
}
