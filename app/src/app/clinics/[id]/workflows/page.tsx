"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { clientFetch } from "@/lib/client-fetch";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";

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
  state: { current: string };
  startDate: string;
  endDate?: string;
  taskRunList?: { taskId: string; state: { current: string } }[];
}

// ── Main Component ─────────────────────────────────────────────

export default function WorkflowsPage() {
  const { id: clinicId } = useParams();
  const [clinicName, setClinicName] = useState("");
  const [clinicSlug, setClinicSlug] = useState("");
  const [clinicNamespace, setClinicNamespace] = useState("");

  useEffect(() => {
    clientFetch(`/api/clinics/${clinicId}`).then(async (r) => {
      if (r.ok) {
        const c = await r.json();
        setClinicName(c.name);
        setClinicSlug(c.slug);
        setClinicNamespace(c.kestra_namespace);
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
        <div className="flex items-center gap-2">
          <Link href={`/portal/${clinicSlug}`} target="_blank">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
              Portal
            </Button>
          </Link>
          <Link href={`/clinics/${clinicId}/playbooks`}>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
              Playbooks
            </Button>
          </Link>
          <Link href={`/clinics/${clinicId}/patients`}>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
              Patient Log
            </Button>
          </Link>
          <Link href={`/clinics/${clinicId}/settings`}>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /></svg>
              Settings
            </Button>
          </Link>
        </div>
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

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

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
            <div className="rounded-full bg-blue-50 p-4 mb-4">
              <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
            </div>
            <h3 className="font-semibold text-lg">No workflows yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create your first automation to get started.</p>
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
                    {wf.description && <p className="text-sm text-muted-foreground">{wf.description}</p>}
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
                      <div className="overflow-x-auto">
                        <table className="text-xs w-full">
                          <thead>
                            <tr>{testResult.columns.map((c) => <th key={c} className="text-left px-2 py-1 border-b">{c}</th>)}</tr>
                          </thead>
                          <tbody>
                            {testResult.rows.slice(0, 3).map((row, i) => (
                              <tr key={i}>{testResult.columns.map((c) => <td key={c} className="px-2 py-1 border-b">{String(row[c] ?? "")}</td>)}</tr>
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
            <div className="overflow-x-auto max-h-96">
              <table className="text-xs w-full">
                <thead className="sticky top-0 bg-white">
                  <tr>{result.columns.map((c) => <th key={c} className="text-left px-2 py-1 border-b font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {result.columns.map((c) => <td key={c} className="px-2 py-1 border-b">{String(row[c] ?? "")}</td>)}
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

  if (loading) return <p className="text-muted-foreground pt-4">Loading...</p>;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-2">
        {["", "SUCCESS", "FAILED", "PAUSED", "RUNNING"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s || "All"}
          </Button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
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
                    {new Date(exec.startDate).toLocaleString()}
                    {exec.endDate && ` — ${new Date(exec.endDate).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusColor(exec.state?.current)}>{exec.state?.current}</Badge>
                  {exec.state?.current === "FAILED" && (
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleRetry(exec.id); }}>
                      Retry
                    </Button>
                  )}
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
