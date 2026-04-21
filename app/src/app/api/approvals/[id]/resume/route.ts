import { NextResponse } from "next/server";
import { resumeExecution, killExecution } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    const { id } = await params;

    let action = "resume";
    try {
      const body = await req.json();
      if (body.action === "kill") action = "kill";
    } catch {
      // No body = resume
    }

    if (action === "kill") {
      await killExecution(id);
    } else {
      await resumeExecution(id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e);
  }
}
