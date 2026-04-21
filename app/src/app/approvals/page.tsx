"use client";

import { useEffect, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlaybookChatWidget } from "@/components/playbook/chat-widget";

interface TaskRun {
  id: string;
  taskId: string;
  state: { current: string };
  outputs?: { body?: string | unknown[]; [key: string]: unknown };
}

interface Execution {
  id: string;
  namespace: string;
  flowId: string;
  state: { current: string };
  labels?: { key: string; value: string }[];
  taskRunList?: TaskRun[];
}

interface Clinic {
  id: string;
  name: string;
  kestra_namespace: string;
}

export default function ApprovalsPage() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [filterNamespace, setFilterNamespace] = useState("");
  const [filterQueue, setFilterQueue] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  interface ActionPreview { type: string; title: string; details: Record<string, string>; }
  const [detailData, setDetailData] = useState<Record<string, { queryResults: unknown[]; pendingActions: string[]; actionPreviews: ActionPreview[]; recordData: Record<string, unknown> | null }>>({});

  async function loadData() {
    setLoading(true);
    const [approvalsRes, clinicsRes] = await Promise.all([
      clientFetch("/api/approvals"),
      clientFetch("/api/clinics"),
    ]);
    if (approvalsRes.ok) setExecutions(await approvalsRes.json());
    if (clinicsRes.ok) setClinics(await clinicsRes.json());
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function loadDetail(execId: string) {
    if (detailData[execId]) return;
    try {
      const res = await clientFetch(`/api/approvals/${execId}/detail`);
      if (res.ok) {
        const data = await res.json();
        setDetailData((prev) => ({
          ...prev,
          [execId]: {
            queryResults: data.queryResults || [],
            pendingActions: data.pendingActions || [],
            actionPreviews: data.actionPreviews || [],
            recordData: data.recordData || null,
          },
        }));
      }
    } catch { /* ignore */ }
  }

  async function handleExpand(execId: string) {
    if (expandedId === execId) {
      setExpandedId(null);
    } else {
      setExpandedId(execId);
      await loadDetail(execId);
    }
  }

  async function handleResume(id: string) {
    await clientFetch(`/api/approvals/${id}/resume`, { method: "POST" });
    loadData();
  }

  async function handleReject(id: string) {
    await clientFetch(`/api/approvals/${id}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kill" }),
    });
    loadData();
  }

  let filtered = filterNamespace
    ? executions.filter((e) => e.namespace === filterNamespace)
    : executions;
  if (filterQueue) {
    filtered = filtered.filter((e) => e.labels?.find((l) => l.key === "queue-name")?.value === filterQueue);
  }

  const clinicName = (ns: string) =>
    clinics.find((c) => c.kestra_namespace === ns)?.name || ns;

  function getLabel(exec: Execution, key: string): string | undefined {
    return exec.labels?.find((l) => l.key === key)?.value;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Approval Queue</h1>
          <p className="text-[13px] text-slate-500 mt-1">{filtered.length} pending approval{filtered.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded-md border px-3 py-2 text-sm" value={filterNamespace} onChange={(e) => setFilterNamespace(e.target.value)}>
            <option value="">All clinics</option>
            {clinics.map((c) => <option key={c.id} value={c.kestra_namespace}>{c.name}</option>)}
          </select>
          <select className="rounded-md border px-3 py-2 text-sm" value={filterQueue} onChange={(e) => setFilterQueue(e.target.value)}>
            <option value="">All queues</option>
            <option value="billing">Billing</option>
            <option value="scheduling">Scheduling</option>
            <option value="intake">Intake</option>
            <option value="front-desk">Front Desk</option>
            <option value="insurance">Insurance</option>
          </select>
          <Button variant="outline" onClick={loadData} disabled={loading}>Refresh</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="rounded-full bg-emerald-50 p-4 mb-4">
              <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 className="font-semibold text-lg">All clear</h3>
            <p className="text-sm text-muted-foreground mt-1">No pending approvals right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((exec) => {
            const priority = getLabel(exec, "task-priority");
            const title = getLabel(exec, "task-title");
            const assignedTo = getLabel(exec, "task-assigned-to");
            const detail = detailData[exec.id];
            const results = detail?.queryResults || [];
            const pendingActions = detail?.pendingActions || [];
            const actionPreviews = detail?.actionPreviews || [];
            const recordData = detail?.recordData;

            return (
              <Card key={exec.id} className="overflow-hidden">
                <CardHeader className="pb-2 cursor-pointer" onClick={() => handleExpand(exec.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {title || exec.flowId}
                        {priority && (
                          <Badge className={
                            priority === "URGENT" ? "bg-red-100 text-red-800 border-red-200" :
                            priority === "HIGH" ? "bg-amber-100 text-amber-800 border-amber-200" :
                            "bg-gray-100 text-gray-600"
                          }>{priority}</Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span>{clinicName(exec.namespace)}</span>
                        {assignedTo && <span>Assigned: {assignedTo}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">PAUSED</Badge>
                      <svg className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === exec.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                </CardHeader>

                {expandedId === exec.id && (
                  <CardContent className="border-t pt-4 space-y-4">
                    {/* Query results */}
                    {results.length > 0 ? (
                      <div>
                        <p className="text-sm font-medium mb-2">Data to Review ({results.length} records)</p>
                        <div className="overflow-x-auto rounded-lg border">
                          <table className="text-xs w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                {Object.keys(results[0] as Record<string, unknown>).map((col) => (
                                  <th key={col} className="text-left px-3 py-2 font-medium">{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(results as Record<string, unknown>[]).map((row, i) => (
                                <tr key={i} className="border-t hover:bg-gray-50">
                                  {Object.values(row).map((val, j) => (
                                    <td key={j} className="px-3 py-2">{String(val ?? "")}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Loading query results...</p>
                    )}

                    {/* Task runs */}
                    {exec.taskRunList && (
                      <div>
                        <p className="text-sm font-medium mb-1">Execution Steps</p>
                        <div className="space-y-1">
                          {exec.taskRunList.map((tr, i) => (
                            <div key={i} className="flex items-center justify-between rounded border px-3 py-1.5 text-xs">
                              <span className="font-mono">{tr.taskId}</span>
                              <Badge className={
                                tr.state.current === "SUCCESS" ? "bg-emerald-100 text-emerald-800" :
                                tr.state.current === "PAUSED" ? "bg-amber-100 text-amber-800" :
                                "bg-gray-100 text-gray-600"
                              }>{tr.state.current}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action previews — exactly what will fire on approval */}
                    {actionPreviews.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Actions that will execute on approval:</p>
                        <div className="space-y-3">
                          {actionPreviews.map((action, i) => (
                            <div key={i} className="rounded-lg border overflow-hidden">
                              <div className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${
                                action.type === "sms" ? "bg-green-50 text-green-800" :
                                action.type === "email" ? "bg-blue-50 text-blue-800" :
                                action.type === "delay" ? "bg-violet-50 text-violet-800" :
                                "bg-gray-50 text-gray-800"
                              }`}>
                                {action.type === "sms" && <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>}
                                {action.type === "email" && <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>}
                                {action.title}
                              </div>
                              <div className="px-4 py-3 text-sm space-y-1.5 bg-white">
                                {action.type === "sms" && (
                                  <>
                                    <div><span className="text-muted-foreground">To:</span> <span className="font-mono">{action.details.to}</span></div>
                                    <div className="rounded-md bg-gray-50 border p-3 text-sm whitespace-pre-wrap">{action.details.message}</div>
                                  </>
                                )}
                                {action.type === "email" && (
                                  <>
                                    <div><span className="text-muted-foreground">To:</span> {action.details.to}</div>
                                    <div><span className="text-muted-foreground">Subject:</span> {action.details.subject}</div>
                                    <div className="rounded-md bg-gray-50 border p-3 text-sm whitespace-pre-wrap">{action.details.body}</div>
                                  </>
                                )}
                                {action.type === "delay" && (
                                  <div className="text-muted-foreground">Pause for {action.details.duration}</div>
                                )}
                                {action.type !== "sms" && action.type !== "email" && action.type !== "delay" && (
                                  <pre className="text-xs overflow-x-auto">{JSON.stringify(action.details, null, 2)}</pre>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {actionPreviews.length === 0 && pendingActions.length === 0 && results.length > 0 && (
                      <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                        <p className="text-sm text-amber-800">No further actions configured. Approving will mark this as complete.</p>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>ID: {exec.id}</span>
                      <a href={`http://localhost:8080/ui/executions/${exec.namespace}/${exec.flowId}/${exec.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                        View in Kestra
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                      </a>
                    </div>

                    {/* Playbook AI chat */}
                    <PlaybookChatWidget
                      workspaceSlug={exec.namespace.split(".").pop() || ""}
                      context={recordData || undefined}
                    />

                    <div className="flex gap-2 pt-2 border-t">
                      <Button onClick={() => handleResume(exec.id)} className="bg-emerald-600 hover:bg-emerald-700">
                        Approve & Continue
                      </Button>
                      <Button variant="destructive" onClick={() => handleReject(exec.id)}>
                        Reject (Skip)
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
