import { NextResponse } from "next/server";
import { chat } from "@/lib/playbook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { workspaceSlug, message, context } = await req.json();

  if (!workspaceSlug || !message) {
    return NextResponse.json({ error: "workspaceSlug and message required" }, { status: 400 });
  }

  // Build system prompt with context if provided
  let systemPrompt: string | undefined;
  if (context) {
    systemPrompt = `You are a dental office assistant helping staff review a pending task. Here is the context:\n${JSON.stringify(context, null, 2)}\n\nAnswer based on the clinic's uploaded playbooks and SOPs. Be concise and actionable.`;
  }

  try {
    const response = await chat(workspaceSlug, message, systemPrompt);
    return NextResponse.json({
      answer: response.textResponse,
      sources: response.sources || [],
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
