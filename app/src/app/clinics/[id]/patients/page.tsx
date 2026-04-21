"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PatientExecution {
  id: string;
  flowId: string;
  namespace: string;
  state: string;
  startDate: string;
  record: Record<string, unknown> | null;
}

function statusColor(s: string) {
  switch (s) {
    case "SUCCESS": return "bg-emerald-100 text-emerald-800";
    case "FAILED": return "bg-red-100 text-red-800";
    case "PAUSED": return "bg-amber-100 text-amber-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

export default function PatientLogPage() {
  const { id: clinicId } = useParams();
  const [patNum, setPatNum] = useState("");
  const [executions, setExecutions] = useState<PatientExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!patNum.trim()) return;
    setLoading(true);
    setSearched(true);
    // Get clinic namespace
    const clinicRes = await fetch(`/api/clinics/${clinicId}`);
    const clinic = await clinicRes.json();
    const res = await fetch(`/api/patients/search?patNum=${patNum.trim()}&namespace=${clinic.kestra_namespace}`);
    if (res.ok) {
      const data = await res.json();
      setExecutions(data.executions || []);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Patient Communication Log</h1>
        <p className="text-[13px] text-slate-500 mt-1">Search all automated workflows that involved a specific patient</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <Input
          value={patNum}
          onChange={(e) => setPatNum(e.target.value)}
          placeholder="Enter Patient Number (PatNum)"
          className="max-w-xs"
        />
        <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
          {loading ? "Searching..." : "Search"}
        </Button>
      </form>

      {searched && !loading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">
              {executions.length} workflow execution{executions.length !== 1 ? "s" : ""} for patient #{patNum}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {executions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No automated workflows have touched this patient.</p>
            ) : (
              <div className="space-y-2">
                {executions.map((exec) => (
                  <div key={exec.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{exec.flowId}</p>
                      <p className="text-xs text-muted-foreground">
                        {exec.startDate ? new Date(exec.startDate).toLocaleString() : "—"}
                      </p>
                      {exec.record && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {Object.entries(exec.record).filter(([k]) => k !== "patNum").slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" | ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={statusColor(exec.state)}>{exec.state}</Badge>
                      <a href={`http://localhost:8080/ui/executions/${exec.namespace}/${exec.flowId}/${exec.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                        Kestra
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
