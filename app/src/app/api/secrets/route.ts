import { NextResponse } from "next/server";
import { setKV } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { slug } = requireAuth(req)
    const { key, value } = await req.json();

    if (!key || !value) {
      return NextResponse.json({ error: "key and value required" }, { status: 400 });
    }

    // Per-tenant secrets live in Kestra KV under the tenant's namespace
    // (Kestra OSS doesn't expose /secrets — that's an enterprise feature).
    await setKV(namespaceFor(slug), key, value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e);
  }
}
