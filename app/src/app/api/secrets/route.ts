import { NextResponse } from "next/server";
import { setSecret } from "@/lib/kestra";
import { initDb } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { getOrCreateClinic } from "@/lib/clinic-context";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const { key, value } = await req.json();

    if (!key || !value) {
      return NextResponse.json({ error: "key and value required" }, { status: 400 });
    }

    await setSecret(clinic.kestra_namespace, key, value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e);
  }
}
