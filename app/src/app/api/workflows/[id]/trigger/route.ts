import { NextResponse } from "next/server";
import { queryOne, initDb } from "@/lib/db";
import { triggerExecution } from "@/lib/kestra";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { namespaceFor } from "@/lib/tenant-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/{id}/trigger — kick off a manual run.
 *
 * `id` can be one of two things, depending on how the UI listed the
 * workflow:
 *   - A `flowcore.workflows.id` UUID (custom builder workflow). We look
 *     it up to get the slugified `name`, which IS the Kestra flowId.
 *   - A Kestra flowId directly (platform-managed flow shipped by
 *     tenant-sync — `appointment-reminder-test`, `apt-reminder-demo`,
 *     etc.). These never get a `flowcore.workflows` row, so the UUID
 *     lookup returns null and we fall through to using `id` as-is.
 *
 * Namespace is always derived from the JWT slug — `flowcore.clinics`
 * no longer stores it (Phase 2 cleanup).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { slug } = requireAuth(req);
    await initDb();
    const { id } = await params;

    // Try the builder workflow row first. UUIDs come back; flow string
    // ids (e.g. "appointment-reminder-test") return null.
    const wf = await queryOne<{ name: string }>(
      "SELECT name FROM flowcore.workflows WHERE id = $1",
      [id],
    );
    const flowId = wf
      ? wf.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : id;

    const namespace = namespaceFor(slug);
    const result = await triggerExecution(namespace, flowId);
    return NextResponse.json({
      success: true,
      executionId: result?.id,
      flowId,
      namespace,
    });
  } catch (e) {
    return authErrorResponse(e);
  }
}
