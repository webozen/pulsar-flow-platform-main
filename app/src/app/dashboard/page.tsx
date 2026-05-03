import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { query, initDb } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateToken } from "@/lib/pulsar-auth";
import { KESTRA_URL } from "@/lib/kestra";
import { namespaceFor } from "@/lib/tenant-sync";
import { timeAgo, fullTimestamp } from "@/lib/time-ago";
import { AutomationFrame } from "@/components/nav/automation-frame";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Execution {
  id: string;
  namespace: string;
  flowId: string;
  state: { current: string; startDate?: string };
  startDate?: string;
}

/** Dashboard runs in the caller's tenant scope. Active Clinics tile was
 *  removed because the dashboard is already per-tenant via the JWT —
 *  there's no cross-tenant context here for a tenant user. Workflows
 *  count and Kestra executions are now both filtered to the caller's
 *  namespace; previously they read across all tenants. */
async function getStats(slug: string) {
  await initDb();
  const namespace = namespaceFor(slug);

  // Workflows count = enabled flows actually deployed in the tenant's
  // Kestra namespace. This includes platform-managed flows
  // (apt-reminder-demo, apt-reminder-row, etc.) which never get rows
  // in flowcore.workflows — they're deployed straight to Kestra by
  // tenant-sync. Counting flowcore.workflows alone showed 0 for fresh
  // tenants even though they have 4 flows live, which was misleading.
  let workflowCount = 0;
  try {
    const flowRes = await fetch(
      `${KESTRA_URL}/api/v1/flows/search?namespace=${encodeURIComponent(namespace)}&size=100`,
      { cache: "no-store" },
    );
    if (flowRes.ok) {
      const flows = (await flowRes.json()) as { results?: Array<{ disabled?: boolean }> };
      workflowCount = (flows.results ?? []).filter((f) => !f.disabled).length;
    }
  } catch {
    // Kestra not reachable — fall back to 0
  }

  let execStats = { total: 0, success: 0, failed: 0, paused: 0 };
  let recentExecutions: Execution[] = [];
  const workflowCounts: Record<string, { success: number; failed: number; total: number }> = {};

  try {
    const res = await fetch(
      `${KESTRA_URL}/api/v1/executions/search?namespace=${encodeURIComponent(namespace)}&size=100&page=1`,
      { cache: "no-store" },
    );
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

  return { workflowCount, execStats, recentExecutions, workflowCounts };
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
  // Resolve tenant from JWT cookie. Without a token the page redirects
  // to /login (handled at the layout level too, but enforced here so
  // the dashboard never renders cross-tenant data by accident).
  const cookieStore = await cookies();
  const token = cookieStore.get("pulsar_jwt")?.value;
  if (!token) redirect("/login");
  let slug: string;
  try {
    ({ slug } = validateToken(token));
  } catch {
    redirect("/login");
  }

  const { workflowCount, execStats, recentExecutions, workflowCounts } = await getStats(slug);

  return (
    <AutomationFrame active="dashboard">
      <div className="space-y-5">
      {/* Page-level title removed — AutomationFrame already provides
          "⚡ Automation" + tagline + tab strip; an inner Dashboard h1
          would duplicate hierarchy. Slug context is implicit per JWT. */}

      {/* Stats row — JWT-scoped to this tenant only. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Active Workflows" value={workflowCount} color="violet" />
        <StatCard title="Pending Approvals" value={execStats.paused} href="/approvals" color="amber" />
        <StatCard title="Failed Runs" value={execStats.failed} color="red" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-workflow breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Workflow Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(workflowCounts).length === 0 ? (
              <div className="flex flex-col items-center py-5 text-center">
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
              <div className="flex flex-col items-center py-5 text-center">
                <div className="rounded-full bg-gray-100 p-3 mb-3">
                  <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-muted-foreground">No executions yet.</p>
                <Link href="/clinics" className="text-xs hover:underline mt-1" style={{ color: 'var(--p-accent)' }}>Add a clinic to get started</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentExecutions.map((exec) => (
                  <div key={exec.id} className="flex items-center justify-between rounded-lg border px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{exec.flowId}</p>
                      <p
                        className="text-xs text-muted-foreground"
                        title={fullTimestamp(exec.state?.startDate ?? exec.startDate)}
                      >
                        {timeAgo(exec.state?.startDate ?? exec.startDate)}
                      </p>
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
    </AutomationFrame>
  );
}

function StatCard({ title, value, href, color }: { title: string; value: number; href?: string; color: string }) {
  // Per pulsar-frontend/design.md: ONE accent — all stat cards read
  // uniformly. The five-competing-accents pattern (blue/violet/amber/red
  // left-borders) bypassed the design system. Status colors now apply
  // ONLY when the value indicates a problem state (failed > 0, pending
  // > 0), and only on the value text — not the card chrome.
  const valueColor: Record<string, string> = {
    blue:   "text-slate-900",
    violet: "text-slate-900",
    amber:  value > 0 ? "text-amber-600" : "text-slate-900",
    red:    value > 0 ? "text-red-600"   : "text-slate-900",
  };

  const content = (
    <Card className={`transition-shadow ${href ? "hover:shadow-md cursor-pointer" : ""}`}>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
        <p className={`text-2xl font-bold mt-1 ${valueColor[color] || "text-slate-900"}`}>{value}</p>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

// `fmtExec` was a defensive Date formatter; replaced by `timeAgo` from
// `@/lib/time-ago` which is null-safe AND emits relative time pills.
