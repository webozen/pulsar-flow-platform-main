import { NextResponse } from "next/server";
import { queryOne, initDb } from "@/lib/db";
import { listExecutions } from "@/lib/kestra";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  await initDb();
  const { slug } = await params;

  const clinic = await queryOne<{ kestra_namespace: string }>(
    "SELECT kestra_namespace FROM flowcore.clinics WHERE slug = $1",
    [slug]
  );
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  let executions: unknown[] = [];
  const stats = { total: 0, success: 0, failed: 0, paused: 0 };

  try {
    const data = await listExecutions({
      namespace: clinic.kestra_namespace,
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
