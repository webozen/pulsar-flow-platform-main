import { NextResponse } from "next/server";
import { listDocuments, uploadDocument } from "@/lib/playbook";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let slug: string;
  try {
    ({ slug } = requireAuth(req));
  } catch (e) {
    return authErrorResponse(e);
  }

  try {
    const data = await listDocuments(slug);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ documents: [], error: String(e) });
  }
}

export async function POST(req: Request) {
  let slug: string;
  try {
    ({ slug } = requireAuth(req));
  } catch (e) {
    return authErrorResponse(e);
  }

  const { content, filename } = await req.json();
  if (!content || !filename) {
    return NextResponse.json({ error: "content and filename required" }, { status: 400 });
  }

  try {
    const result = await uploadDocument(slug, content, filename);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
