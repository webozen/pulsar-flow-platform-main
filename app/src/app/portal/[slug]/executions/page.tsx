"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo, fullTimestamp } from "@/lib/time-ago";

interface Execution {
  id: string;
  namespace: string;
  flowId: string;
  // Kestra returns timestamps under `state.startDate`/`state.endDate`,
  // not at the top level. Top-level fields are kept optional only for
  // legacy mocks/seed data.
  state: {
    current: string;
    startDate?: string;
    endDate?: string;
    histories?: { date: string; state: { current: string } }[];
  };
  trigger?: { variables?: Record<string, unknown> };
  startDate?: string;
  endDate?: string;
  duration?: string;
  taskRunList?: { id: string; taskId: string; state: { current: string }; startDate?: string; outputs?: Record<string, unknown> }[];
}

// `fmtExecDate` was a defensive Date formatter; replaced by `timeAgo`.

function statusColor(status: string) {
  switch (status) {
    case "SUCCESS": return "default" as const;
    case "FAILED": return "destructive" as const;
    case "PAUSED": return "outline" as const;
    case "RUNNING": return "secondary" as const;
    default: return "secondary" as const;
  }
}

export default function ExecutionsPage() {
  const { slug } = useParams();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/portal/${slug}/executions`);
    if (res.ok) {
      const data = await res.json();
      setExecutions(data.executions || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [slug]);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Execution History</h1>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>

      {executions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No executions yet. Workflows will appear here once they run.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {executions.map((exec) => (
            <Card key={exec.id} className="cursor-pointer" onClick={() => setExpanded(expanded === exec.id ? null : exec.id)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{exec.flowId}</CardTitle>
                    <p
                      className="text-xs text-muted-foreground"
                      title={fullTimestamp(exec.state?.startDate ?? exec.startDate)}
                    >
                      {timeAgo(exec.state?.startDate ?? exec.startDate)}
                    </p>
                  </div>
                  <Badge variant={statusColor(exec.state?.current)}>
                    {exec.state?.current}
                  </Badge>
                </div>
              </CardHeader>

              {expanded === exec.id && (
                <CardContent className="border-t pt-4 space-y-4">
                  {exec.trigger?.variables && (
                    <div>
                      <p className="text-sm font-medium mb-1">Trigger Data</p>
                      <pre className="rounded-md bg-gray-50 p-3 text-xs overflow-x-auto">
                        {JSON.stringify(exec.trigger.variables, null, 2)}
                      </pre>
                    </div>
                  )}

                  {exec.taskRunList && exec.taskRunList.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Task Runs</p>
                      <div className="space-y-1">
                        {exec.taskRunList.map((task, i) => (
                          <div key={task.id || i} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                            <span className="font-mono text-xs">{task.taskId}</span>
                            <Badge variant={statusColor(task.state?.current)} className="text-xs">
                              {task.state?.current}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Execution ID: {exec.id}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
