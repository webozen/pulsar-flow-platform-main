"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { clientFetch } from "@/lib/client-fetch";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo, fullTimestamp } from "@/lib/time-ago";
import { RefreshCw } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  trigger_cron: string;
  trigger_sql: string;
  actions: unknown[];
  is_enabled: boolean;
  kestra_flow_id: string | null;
}

interface TriggerEvent {
  event: string;
  description: string;
  category: string;
  sql: string;
}

interface TriggerTestResult {
  columns: string[];
  placeholders: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface Execution {
  id: string;
  namespace: string;
  flowId: string;
  // Kestra returns startDate/endDate under state, NOT at the top level.
  // Top-level startDate is left optional only because some legacy
  // mocks/seed data set it; runtime data has it nested.
  state: { current: string; startDate?: string; endDate?: string };
  startDate?: string;
  endDate?: string;
  taskRunList?: { taskId: string; state: { current: string } }[];
}

// ── Main Component ─────────────────────────────────────────────

export default function WorkflowsPage() {
  const { id: clinicId } = useParams();
  const router = useRouter();
  const slugFromUrl = String(clinicId ?? "");
  const [clinicName, setClinicName] = useState(slugFromUrl);
  const [clinicSlug, setClinicSlug] = useState(slugFromUrl);
  const [clinicNamespace, setClinicNamespace] = useState(slugFromUrl ? `dental.${slugFromUrl}` : "");

  // Guard against stale URLs: bookmarks or browser history from before the
  // Plan B slug-keyed refactor still point at `/clinics/<old-uuid>/...`.
  // Fetch the JWT's actual slug and redirect if the URL is wrong; otherwise
  // the page would render an empty Kestra namespace (`dental.<uuid>`) and
  // show "no workflows / no actions".
  useEffect(() => {
    clientFetch(`/api/auth/me`).then(async (r) => {
      if (!r.ok) return;
      const me = await r.json();
      if (me?.slug && me.slug !== slugFromUrl) {
        router.replace(`/clinics/${me.slug}/workflows`);
      }
    });
  }, [slugFromUrl, router]);

  useEffect(() => {
    clientFetch(`/api/clinics/${clinicId}`).then(async (r) => {
      if (r.ok) {
        const c = await r.json();
        if (c?.name) setClinicName(c.name);
        if (c?.slug) setClinicSlug(c.slug);
        if (c?.kestra_namespace) setClinicNamespace(c.kestra_namespace);
      }
    });
  }, [clinicId]);

  return (
    <div className="space-y-6">
      {/* Clinic header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white text-lg font-bold shadow-sm">
            {clinicName.charAt(0).toUpperCase() || "?"}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{clinicName || "Loading..."}</h1>
            <p className="text-xs text-muted-foreground">{clinicNamespace}</p>
          </div>
        </div>
        {/* Quick-links removed — Portal/Playbooks/Patient Log/Settings pages
            still live in the legacy app/src/app/clinics/[id]/* tree but they
            depend on flowcore.* tables we're phasing out (Plan B). Surface
            them again once they're ported to slug-keyed routes against the
            Kestra namespace. */}
      </div>

      <Tabs defaultValue="workflows">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="workflows" className="data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-slate-900">Workflows</TabsTrigger>
          <TabsTrigger value="triggers" className="data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-slate-900">Triggers</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-slate-900">Reports</TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-slate-900">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows">
          <WorkflowsTab clinicId={clinicId as string} />
        </TabsContent>
        <TabsContent value="triggers">
          <TriggersTab clinicId={clinicId as string} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab clinicId={clinicId as string} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab namespace={clinicNamespace} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Tab 1: Workflows ───────────────────────────────────────────

/** Description fields imported from YAML can run multiple paragraphs.
 *  Surface only the first non-empty line in the card; full text is one
 *  click away in the Kestra editor. */
function firstLine(s: string): string {
  const trimmed = (s || "").trim();
  const idx = trimmed.indexOf("\n");
  return idx === -1 ? trimmed : trimmed.slice(0, idx).trim();
}

function modeBadge(mode?: string) {
  switch (mode) {
    case "immediate": return <Badge className="bg-green-100 text-green-800 border-green-200">Immediate</Badge>;
    case "on_approval": return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Approval</Badge>;
    case "manual": return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Manual</Badge>;
    default: return <Badge className="bg-green-100 text-green-800 border-green-200">Immediate</Badge>;
  }
}

function WorkflowsTab({ clinicId }: { clinicId: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [FlowPreview, setFlowPreview] = useState<any>(null);

  useEffect(() => {
    import("@/components/workflows/flow-preview").then((mod) => {
      setFlowPreview(() => mod.FlowPreview);
    });
  }, []);

  async function load() {
    setLoading(true);
    const res = await clientFetch(`/api/workflows?clinicId=${clinicId}`);
    if (res.ok) setWorkflows(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [clinicId]);

  async function handleToggle(wfId: string) {
    await clientFetch(`/api/workflows/${wfId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    load();
  }

  async function handleDelete(wfId: string) {
    if (!confirm("Delete this workflow?")) return;
    await clientFetch(`/api/workflows/${wfId}`, { method: "DELETE" });
    load();
  }

  if (loading) {
    return (
      // Skeletons match the shape of the workflow list rows (icon + name
      // + meta + actions). Bounded count so the placeholder doesn't
      // dominate the page when the real list is shorter.
      <div className="space-y-3 pt-4" data-testid="workflows-loading">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end gap-2">
        <a href="http://localhost:8080" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
            Kestra UI
          </Button>
        </a>
        <Link href={`/clinics/${clinicId}/workflows/new`}>
          <Button className="bg-blue-600 hover:bg-blue-700">
            <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Create Workflow
          </Button>
        </Link>
      </div>

      {workflows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="rounded-full bg-blue-50 p-4 mb-4 ring-1 ring-blue-100">
              <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </div>
            <h3 className="font-semibold text-lg">No workflows yet</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-sm">
              Create your first automation, or trigger a platform-managed workflow from Kestra to populate this list.
            </p>
            <Link href={`/clinics/${clinicId}/workflows/new`}>
              <Button size="sm">+ Create workflow</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        workflows.map((wf) => {
          const acts = Array.isArray(wf.actions) ? wf.actions : [];
          return (
            <Card key={wf.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{wf.name}</p>
                      {modeBadge((wf as any).action_mode as string)}
                      <Badge variant={wf.is_enabled ? "default" : "secondary"} className="text-xs">
                        {wf.is_enabled ? "Active" : "Disabled"}
                      </Badge>
                    </div>
                    {wf.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 max-w-3xl">
                        {firstLine(wf.description)}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {wf.trigger_cron}
                      </span>
                      <span>{acts.length} action{acts.length !== 1 ? "s" : ""}</span>
                      {wf.kestra_flow_id && <span>Flow: {wf.kestra_flow_id}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-4">
                    <Button size="sm" variant="ghost" title="Test run"
                      onClick={async () => {
                        const res = await clientFetch(`/api/workflows/${wf.id}/trigger`, { method: "POST" });
                        const data = await res.json();
                        alert(data.success ? `Triggered! Execution: ${data.executionId || "started"}` : `Failed: ${data.error}`);
                      }}>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPreviewId(previewId === wf.id ? null : wf.id)} title="Preview flow">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
                    </Button>
                    {/* Edit opens the same custom builder that Create uses,
                        keyed on the Kestra flow id (was a flowcore.workflows
                        UUID pre-Plan B). */}
                    <Link href={`/clinics/${clinicId}/workflows/${wf.id}`}>
                      <Button size="sm" variant="outline">Edit</Button>
                    </Link>
                    <Button size="sm" variant="outline" onClick={() => handleToggle(wf.id)}>
                      {wf.is_enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(wf.id)}>
                      Delete
                    </Button>
                  </div>
                </div>

                {previewId === wf.id && FlowPreview && (
                  <div className="mt-4">
                    <FlowPreview
                      name={wf.name}
                      triggerCron={wf.trigger_cron}
                      actions={acts}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ── Tab 2: Triggers ────────────────────────────────────────────

function TriggersTab({ clinicId }: { clinicId: string }) {
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TriggerTestResult | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    // Load trigger library (client-side import)
    import("@/lib/trigger-library").then((mod) => {
      setTriggers(mod.TRIGGER_LIBRARY);
    });
  }, []);

  async function handleTest(trigger: TriggerEvent) {
    setTesting(trigger.event);
    setTestResult(null);
    const res = await clientFetch("/api/triggers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, sql: trigger.sql }),
    });
    if (res.ok) {
      setTestResult(await res.json());
    }
    setTesting(null);
  }

  const filtered = search
    ? triggers.filter((t) =>
        t.event.includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        t.category.toLowerCase().includes(search.toLowerCase())
      )
    : triggers;

  // Group by category
  const grouped: Record<string, TriggerEvent[]> = {};
  for (const t of filtered) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  return (
    <div className="space-y-4 pt-4">
      <Input
        placeholder="Search triggers..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {Object.entries(grouped).map(([category, items]) => (
        <Card key={category}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((t) => (
              <div key={t.event} className="rounded border">
                <div
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpanded(expanded === t.event ? null : t.event)}
                >
                  <div>
                    <p className="text-sm font-medium">{t.event}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); handleTest(t); }}
                    disabled={testing === t.event}
                  >
                    {testing === t.event ? "Testing..." : "Test"}
                  </Button>
                </div>

                {expanded === t.event && (
                  <div className="border-t px-3 py-2 bg-gray-50">
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{t.sql}</pre>
                  </div>
                )}

                {testResult && testing === null && expanded === t.event && (
                  <div className="border-t px-3 py-2">
                    <p className="text-xs font-medium mb-1">
                      {testResult.rowCount} rows &middot; Placeholders: {testResult.placeholders.join(", ")}
                    </p>
                    {testResult.rows.length > 0 && (
                      <div className="overflow-auto max-h-72 rounded border">
                        <table className="text-xs w-full">
                          <thead className="sticky top-0 z-10 bg-slate-50 shadow-[inset_0_-1px_0_var(--border)]">
                            <tr>{testResult.columns.map((c) => (
                              <th key={c} className="text-left px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{c}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {testResult.rows.slice(0, 3).map((row, i) => (
                              <tr key={i} className="even:bg-slate-50/40 hover:bg-slate-50">
                                {testResult.columns.map((c) => (
                                  <td key={c} className="px-2 py-1 border-t border-slate-100 max-w-xs truncate" title={String(row[c] ?? "")}>
                                    {String(row[c] ?? "")}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Tab 3: Reports ─────────────────────────────────────────────

function ReportsTab({ clinicId }: { clinicId: string }) {
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [selectedTrigger, setSelectedTrigger] = useState("");
  const [reportTitle, setReportTitle] = useState("");
  const [result, setResult] = useState<TriggerTestResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    import("@/lib/trigger-library").then((mod) => setTriggers(mod.TRIGGER_LIBRARY));
  }, []);

  async function runReport() {
    if (!selectedTrigger) return;
    setRunning(true);
    setResult(null);
    const trigger = triggers.find((t) => t.event === selectedTrigger);
    if (!trigger) return;

    // Run with higher limit for reports
    const sql = trigger.sql.replace(/LIMIT \d+/i, "LIMIT 100");
    const res = await clientFetch("/api/triggers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, sql }),
    });
    if (res.ok) setResult(await res.json());
    setRunning(false);
  }

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={selectedTrigger}
            onChange={(e) => setSelectedTrigger(e.target.value)}
          >
            <option value="">Select a trigger event...</option>
            {triggers.map((t) => (
              <option key={t.event} value={t.event}>{t.category}: {t.description}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input
              placeholder="Report title (optional)"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
            />
            <Button onClick={runReport} disabled={!selectedTrigger || running}>
              {running ? "Running..." : "Run Report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {reportTitle || selectedTrigger} ({result.rowCount} rows)
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => {
                // CSV export
                if (!result.rows.length) return;
                const csv = [result.columns.join(","), ...result.rows.map((r) =>
                  result.columns.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")
                )].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${reportTitle || selectedTrigger}.csv`;
                a.click();
              }}>
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-96 rounded border">
              <table className="text-xs w-full">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[inset_0_-1px_0_var(--border)]">
                  <tr>{result.columns.map((c) => (
                    <th key={c} className="text-left px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{c}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="even:bg-slate-50/40 hover:bg-slate-50">
                      {result.columns.map((c) => (
                        <td key={c} className="px-2 py-1 border-t border-slate-100 max-w-xs truncate" title={String(row[c] ?? "")}>
                          {String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab 4: Audit Log (reads from Kestra) ───────────────────────

function AuditTab({ namespace }: { namespace: string }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    if (!namespace) return;
    setLoading(true);
    const res = await clientFetch(`/api/approvals`); // reads all executions
    if (res.ok) {
      // Also get successful/failed executions from the portal API
      const portalRes = await clientFetch(`/api/portal/${namespace.split(".").pop()}/executions`);
      if (portalRes.ok) {
        const data = await portalRes.json();
        setExecutions(data.executions || []);
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [namespace]);

  async function handleRetry(execId: string) {
    // Kestra replay API
    await clientFetch(`/api/approvals/${execId}/resume`, { method: "POST" });
    load();
  }

  const filtered = statusFilter
    ? executions.filter((e) => e.state?.current === statusFilter)
    : executions;

  function statusColor(s: string) {
    switch (s) {
      case "SUCCESS": return "default" as const;
      case "FAILED": return "destructive" as const;
      case "PAUSED": return "outline" as const;
      default: return "secondary" as const;
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 pt-4" data-testid="audit-loading">
        {[0, 1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-2 flex-wrap">
        {(() => {
          // Pre-compute counts so each filter chip can show how many
          // executions match it. "All" reports the unfiltered total.
          const counts: Record<string, number> = { "": executions.length };
          for (const e of executions) {
            const s = e.state?.current ?? "";
            counts[s] = (counts[s] ?? 0) + 1;
          }
          return ["", "SUCCESS", "FAILED", "PAUSED", "RUNNING"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              className="gap-1.5"
            >
              {s || "All"}
              <span className="rounded-full bg-black/10 dark:bg-white/15 px-1.5 text-[10px] font-medium tabular-nums">
                {counts[s] ?? 0}
              </span>
            </Button>
          ));
        })()}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No executions yet. Workflow runs will appear here once triggered.
          </CardContent>
        </Card>
      ) : (
        filtered.map((exec) => (
          <Card key={exec.id} className="cursor-pointer" onClick={() => setExpanded(expanded === exec.id ? null : exec.id)}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{exec.flowId}</p>
                  <p className="text-xs text-muted-foreground">
                    {/* Kestra returns timestamps under state.startDate /
                        state.endDate. Reading exec.startDate directly
                        produced "Invalid Date" in the audit log. */}
                    {(() => {
                      const start = exec.state?.startDate ?? (exec as { startDate?: string }).startDate;
                      const end = exec.state?.endDate;
                      return (
                        <span title={fullTimestamp(start) + (end ? ` → ${fullTimestamp(end)}` : "")}>
                          {timeAgo(start)}{end ? ` · ran for ${duration(start, end)}` : ""}
                        </span>
                      );
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusColor(exec.state?.current)}>{exec.state?.current}</Badge>
                  {exec.state?.current === "FAILED" && (
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleRetry(exec.id); }}>
                      Retry
                    </Button>
                  )}
                  {/* Deep-link into the Kestra UI for power users — clicking
                      opens that execution's task tree in Kestra's own
                      console (full logs, replay, inputs/outputs, gantt). */}
                  <a
                    href={`http://localhost:8080/ui/executions/${namespace}/${exec.flowId}/${exec.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-slate-400 hover:text-slate-700 transition-colors"
                    title="Open in Kestra"
                    aria-label="Open in Kestra"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5L10 14M5 5h4v2H7v10h10v-2h2v4H5z" />
                    </svg>
                  </a>
                </div>
              </div>

              {expanded === exec.id && exec.taskRunList && (
                <div className="mt-3 border-t pt-3 space-y-1">
                  {exec.taskRunList.map((task, i) => (
                    <div key={i} className="flex items-center justify-between text-xs rounded border px-2 py-1">
                      <span className="font-mono">{task.taskId}</span>
                      <Badge variant={statusColor(task.state?.current)} className="text-xs">{task.state?.current}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">ID: {exec.id}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// `fmtAuditDate` was a defensive "—" fallback formatter; replaced by
// `timeAgo` from `@/lib/time-ago` which handles the same null/parse
// edge cases AND returns relative time pills.

/** Compact "ran for 12s" duration pill for completed executions. */
function duration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
