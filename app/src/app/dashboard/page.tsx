import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { query, initDb } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Execution {
  id: string;
  namespace: string;
  flowId: string;
  state: { current: string; startDate?: string };
  startDate?: string;
}

async function getStats() {
  await initDb();
  const clinicRows = await query<{ cnt: number }>("SELECT count(*)::int as cnt FROM flowcore.clinics WHERE is_active = true");
  const clinicCount: number = clinicRows[0]?.cnt ?? 0;
  const workflowRows = await query<{ cnt: number }>("SELECT count(*)::int as cnt FROM flowcore.workflows WHERE is_enabled = true");
  const workflowCount: number = workflowRows[0]?.cnt ?? 0;

  let execStats = { total: 0, success: 0, failed: 0, paused: 0 };
  let recentExecutions: Execution[] = [];
  const workflowCounts: Record<string, { success: number; failed: number; total: number }> = {};

  try {
    const kestraUrl = process.env.KESTRA_API_URL || "http://localhost:8080";
    const res = await fetch(`${kestraUrl}/api/v1/executions/search?size=100&page=1`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const results: Execution[] = data.results || [];
      execStats.total = data.total || results.length;
      execStats.success = results.filter((e) => e.state?.current === "SUCCESS").length;
      execStats.failed = results.filter((e) => e.state?.current === "FAILED").length;
      execStats.paused = results.filter((e) => e.state?.current === "PAUSED").length;
      recentExecutions = results.slice(0, 8);
      for (const exec of results) {
        const flow = exec.flowId;
        if (!workflowCounts[flow]) workflowCounts[flow] = { success: 0, failed: 0, total: 0 };
        workflowCounts[flow].total++;
        if (exec.state?.current === "SUCCESS") workflowCounts[flow].success++;
        if (exec.state?.current === "FAILED") workflowCounts[flow].failed++;
      }
    }
  } catch {
    // Kestra not available
  }

  return { clinicCount, workflowCount, execStats, recentExecutions, workflowCounts };
}

function statusColor(status: string) {
  switch (status) {
    case "SUCCESS": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "FAILED": return "bg-red-100 text-red-800 border-red-200";
    case "PAUSED": return "bg-amber-100 text-amber-800 border-amber-200";
    case "RUNNING": return "bg-blue-100 text-blue-800 border-blue-200";
    default: return "";
  }
}

export default async function DashboardPage() {
  const { clinicCount, workflowCount, execStats, recentExecutions, workflowCounts } = await getStats();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-[13px] text-slate-500 mt-1">Pulsar Flow dental automation overview</p>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Clinics" value={clinicCount} href="/clinics" color="blue" />
        <StatCard title="Active Workflows" value={workflowCount} color="violet" />
        <StatCard title="Pending Approvals" value={execStats.paused} href="/approvals" color="amber" />
        <StatCard title="Failed Runs" value={execStats.failed} color="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Per-workflow breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Workflow Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(workflowCounts).length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="rounded-full bg-gray-100 p-3 mb-3">
                  <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <p className="text-sm text-muted-foreground">No workflow data yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Create workflows in a clinic to see performance here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(workflowCounts).map(([flow, counts]) => (
                  <div key={flow} className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <span className="text-sm font-medium truncate mr-4">{flow}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{counts.success}</Badge>
                      {counts.failed > 0 && <Badge className="bg-red-100 text-red-800 border-red-200">{counts.failed}</Badge>}
                      <span className="text-xs text-muted-foreground w-12 text-right">{counts.total} total</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent executions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Recent Executions</CardTitle>
          </CardHeader>
          <CardContent>
            {recentExecutions.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="rounded-full bg-gray-100 p-3 mb-3">
                  <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-muted-foreground">No executions yet.</p>
                <Link href="/clinics" className="text-xs text-blue-600 hover:underline mt-1">Add a clinic to get started</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentExecutions.map((exec) => (
                  <div key={exec.id} className="flex items-center justify-between rounded-lg border px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{exec.flowId}</p>
                      <p className="text-xs text-muted-foreground">{new Date(exec.startDate || exec.state?.startDate || "").toLocaleString()}</p>
                    </div>
                    <Badge className={`shrink-0 ${statusColor(exec.state?.current)}`}>
                      {exec.state?.current}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, href, color }: { title: string; value: number; href?: string; color: string }) {
  const borderColor: Record<string, string> = {
    blue: "border-l-blue-500",
    violet: "border-l-violet-500",
    amber: "border-l-amber-500",
    red: "border-l-red-500",
  };
  const valueColor: Record<string, string> = {
    blue: "text-slate-900",
    violet: "text-slate-900",
    amber: "text-amber-600",
    red: "text-red-600",
  };

  const content = (
    <Card className={`transition-shadow border-l-4 ${borderColor[color] || ""} ${href ? "hover:shadow-md cursor-pointer" : ""}`}>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
        <p className={`text-3xl font-bold mt-1 ${valueColor[color] || ""}`}>{value}</p>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
