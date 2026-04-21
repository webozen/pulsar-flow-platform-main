import { NextResponse } from "next/server";
import { toggleFlow } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    requireAuth(req)
    const { namespace, flowId, disabled } = await req.json();
    if (!namespace || !flowId) {
      return NextResponse.json({ error: "namespace and flowId required" }, { status: 400 });
    }

    const flow = await toggleFlow(namespace, flowId, disabled);
    return NextResponse.json(flow);
  } catch (e) {
    return authErrorResponse(e);
  }
}
