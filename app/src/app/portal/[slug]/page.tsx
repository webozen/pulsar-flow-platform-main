"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Clinic {
  id: string;
  name: string;
  slug: string;
  kestra_namespace: string;
  timezone: string;
  phone: string | null;
  is_active: boolean;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  trigger_cron: string;
  is_enabled: boolean;
  actions: unknown[];
}

interface ExecStats {
  total: number;
  success: number;
  failed: number;
  paused: number;
}

export default function PortalOverview() {
  const { slug } = useParams();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [stats, setStats] = useState<ExecStats>({ total: 0, success: 0, failed: 0, paused: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Get clinic by slug
      const clinicsRes = await fetch("/api/clinics");
      if (clinicsRes.ok) {
        const clinics: Clinic[] = await clinicsRes.json();
        const c = clinics.find((c) => c.slug === slug);
        if (c) {
          setClinic(c);
          // Get workflows
          const wfRes = await fetch(`/api/workflows?clinicId=${c.id}`);
          if (wfRes.ok) setWorkflows(await wfRes.json());
          // Get execution stats
          const execRes = await fetch(`/api/portal/${slug}/executions`);
          if (execRes.ok) {
            const data = await execRes.json();
            setStats(data.stats || { total: 0, success: 0, failed: 0, paused: 0 });
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [slug]);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!clinic) return <p className="text-red-600">Clinic not found.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{clinic.name}</h1>
        <p className="text-sm text-muted-foreground">
          {clinic.timezone} {clinic.phone && `| ${clinic.phone}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{workflows.filter((w) => w.is_enabled).length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Approvals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{stats.paused}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workflows configured for this clinic.</p>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => (
                <div key={wf.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="font-medium">{wf.name}</p>
                    {wf.description && <p className="text-sm text-muted-foreground">{wf.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      Schedule: {wf.trigger_cron} | {Array.isArray(wf.actions) ? wf.actions.length : 0} actions
                    </p>
                  </div>
                  <Badge variant={wf.is_enabled ? "default" : "secondary"}>
                    {wf.is_enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex">
        <Link href={`/portal/${slug}/executions`}>
          <Card className="transition-shadow hover:shadow-md cursor-pointer">
            <CardContent className="py-4">
              <p className="font-medium">View Execution History &rarr;</p>
              <p className="text-sm text-muted-foreground">See all workflow runs, logs, and details</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
