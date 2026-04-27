import { NextResponse } from "next/server";
import { createOrUpdateFlowFromYaml } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/workflows/{id}/yaml — accept raw YAML and overwrite the flow
 * in Kestra. The path `id` is the Kestra flow id; the namespace comes from
 * the tenant's JWT. The YAML's own `namespace:` line MUST match
 * `dental.<slug>` or we 400 — prevents a tenant from sneaking a flow into
 * another tenant's namespace.
 *
 * Note: the YAML on disk under `kestra/flows/dental/` will overwrite this
 * change the next time pulsar-backend's tenant-sync calls /provision. A
 * follow-up will add a per-tenant override flag to skip files that the
 * tenant has explicitly edited; until then, edit changes are temporary.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { slug } = requireAuth(req);
    const namespace = namespaceFor(slug);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const text: string = typeof body?.yaml === "string" ? body.yaml : "";
    if (!text.trim()) {
      return NextResponse.json({ error: "yaml_required" }, { status: 400 });
    }

    const idLine = text.match(/^\s*id:\s*(\S+)\s*$/m)?.[1];
    const nsLine = text.match(/^\s*namespace:\s*(\S+)\s*$/m)?.[1];
    if (!idLine || idLine !== id) {
      return NextResponse.json({
        error: "yaml_id_mismatch",
        expected: id,
        got: idLine ?? "(missing)",
      }, { status: 400 });
    }
    if (!nsLine || nsLine !== namespace) {
      return NextResponse.json({
        error: "yaml_namespace_mismatch",
        expected: namespace,
        got: nsLine ?? "(missing)",
      }, { status: 400 });
    }

    try {
      const result = await createOrUpdateFlowFromYaml(text);
      return NextResponse.json({ ok: true, id, namespace, revision: result?.revision });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: "kestra_rejected",
        detail: (e as Error).message,
      }, { status: 422 });
    }
  } catch (e) {
    return authErrorResponse(e);
  }
}
