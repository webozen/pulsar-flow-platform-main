import { NextResponse } from "next/server";
import { KESTRA_URL } from "@/lib/kestra";

export const dynamic = "force-dynamic";

/**
 * Search for all workflow executions involving a specific patient.
 * Searches Kestra executions where inputs.record contains the patient ID.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const patNum = searchParams.get("patNum");
  const namespace = searchParams.get("namespace");

  if (!patNum) {
    return NextResponse.json({ error: "patNum required" }, { status: 400 });
  }

  try {
    // Search Kestra executions — get recent ones and filter by patient
    const params = new URLSearchParams({ size: "100" });
    if (namespace) params.set("namespace", namespace);

    const res = await fetch(`${KESTRA_URL}/api/v1/executions/search?${params}`);
    if (!res.ok) return NextResponse.json({ executions: [] });

    const data = await res.json();
    const allExecs = data.results || [];

    // Filter executions that involve this patient
    const matching = allExecs.filter((exec: Record<string, unknown>) => {
      // Check inputs.record.patNum (per-record subflow)
      const inputs = exec.inputs as Record<string, unknown> | undefined;
      if (inputs?.record) {
        const record = typeof inputs.record === "string" ? JSON.parse(inputs.record) : inputs.record;
        if (String(record.patNum) === patNum) return true;
      }

      // Check task outputs for patNum in query results
      const taskRuns = exec.taskRunList as { outputs?: { body?: string } }[] | undefined;
      if (taskRuns) {
        for (const tr of taskRuns) {
          if (tr.outputs?.body) {
            const body = typeof tr.outputs.body === "string" ? tr.outputs.body : JSON.stringify(tr.outputs.body);
            if (body.includes(`"patNum":${patNum}`) || body.includes(`"patNum":"${patNum}"`)) return true;
          }
        }
      }

      return false;
    });

    // Format results
    const executions = matching.map((exec: Record<string, unknown>) => {
      const state = exec.state as { current: string; startDate?: string } | undefined;
      const inputs = exec.inputs as Record<string, unknown> | undefined;
      let record = null;
      if (inputs?.record) {
        record = typeof inputs.record === "string" ? JSON.parse(inputs.record) : inputs.record;
      }
      return {
        id: exec.id,
        flowId: exec.flowId,
        namespace: exec.namespace,
        state: state?.current,
        startDate: state?.startDate,
        record,
      };
    });

    return NextResponse.json({ executions, total: executions.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
