import { NextResponse } from "next/server";
import { replayExecution } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    const { id } = await params;
    const { taskRunId } = await req.json();

    if (!taskRunId) {
      return NextResponse.json({ error: "taskRunId required" }, { status: 400 });
    }

    const result = await replayExecution(id, taskRunId);
    return NextResponse.json({ success: true, result });
  } catch (e) {
    return authErrorResponse(e);
  }
}
