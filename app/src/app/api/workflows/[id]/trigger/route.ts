import { NextResponse } from "next/server";
import { queryOne, initDb } from "@/lib/db";
import { triggerExecution } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    await initDb();
    const { id } = await params;

    const wf = await queryOne<Record<string, unknown>>(
      "SELECT w.*, c.kestra_namespace FROM flowcore.workflows w JOIN flowcore.clinics c ON c.id = w.clinic_id WHERE w.id = $1",
      [id]
    );
    if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    const flowId = (wf.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const namespace = wf.kestra_namespace as string;

    const result = await triggerExecution(namespace, flowId);
    return NextResponse.json({ success: true, executionId: result?.id, flowId, namespace });
  } catch (e) {
    return authErrorResponse(e);
  }
}
