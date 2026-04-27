import { NextResponse } from "next/server";
import { listExecutions } from "@/lib/kestra";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // No DB lookup — namespace is derivable from slug. Plan B + Phase 2
  // cleanup: flowcore.clinics no longer stores kestra_namespace.

  let executions: unknown[] = [];
  const stats = { total: 0, success: 0, failed: 0, paused: 0 };

  try {
    const data = await listExecutions({
      namespace: namespaceFor(slug),
      size: 50,
    });
    executions = data?.results || [];
    stats.total = data?.total || executions.length;
    for (const exec of executions as { state: { current: string } }[]) {
      if (exec.state?.current === "SUCCESS") stats.success++;
      if (exec.state?.current === "FAILED") stats.failed++;
      if (exec.state?.current === "PAUSED") stats.paused++;
    }
  } catch {
    // Kestra not available
  }

  return NextResponse.json({ executions, stats });
}
