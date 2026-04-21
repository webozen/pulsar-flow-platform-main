import { NextResponse } from "next/server";
import { listDocuments, uploadDocument } from "@/lib/playbook";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const workspaceSlug = searchParams.get("workspace");
  if (!workspaceSlug) {
    return NextResponse.json({ error: "workspace required" }, { status: 400 });
  }

  try {
    const data = await listDocuments(workspaceSlug);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ documents: [], error: String(e) });
  }
}

export async function POST(req: Request) {
  const { workspaceSlug, content, filename } = await req.json();
  if (!workspaceSlug || !content || !filename) {
    return NextResponse.json({ error: "workspaceSlug, content, and filename required" }, { status: 400 });
  }

  try {
    const result = await uploadDocument(workspaceSlug, content, filename);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
