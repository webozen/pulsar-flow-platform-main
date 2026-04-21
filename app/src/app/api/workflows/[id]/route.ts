import { NextResponse } from "next/server";
import { queryOne, query, initDb } from "@/lib/db";
import { createOrUpdateFlowFromYaml, deleteFlow, toggleFlow } from "@/lib/kestra";
import { generateKestraYaml } from "@/lib/workflow-generator";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    await initDb();
    const { id } = await params;
    const workflow = await queryOne(
      "SELECT w.*, c.kestra_namespace FROM flowcore.workflows w JOIN flowcore.clinics c ON c.id = w.clinic_id WHERE w.id = $1",
      [id]
    );
    if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(workflow);
  } catch (e) {
    return authErrorResponse(e);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    await initDb();
    const { id } = await params;
    const data = await req.json();

    // Handle toggle enable/disable
    if (data.action === "toggle") {
      const wf = await queryOne<Record<string, unknown>>(
        "SELECT w.*, c.kestra_namespace FROM flowcore.workflows w JOIN flowcore.clinics c ON c.id = w.clinic_id WHERE w.id = $1",
        [id]
      );
      if (!wf) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const newEnabled = !wf.is_enabled;
      await query("UPDATE flowcore.workflows SET is_enabled = $1, updated_at = now() WHERE id = $2", [newEnabled, id]);

      try {
        const flowId = (wf.kestra_flow_id as string) || (wf.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        await toggleFlow(wf.kestra_namespace as string, flowId, !newEnabled);
      } catch (e) {
        console.error("Kestra toggle failed:", e);
      }

      return NextResponse.json({ is_enabled: newEnabled });
    }

    // Full update
    const workflow = await queryOne(
      `UPDATE flowcore.workflows SET
        name = COALESCE($2, name),
        description = $3,
        trigger_cron = COALESCE($4, trigger_cron),
        trigger_sql = COALESCE($5, trigger_sql),
        actions = COALESCE($6::jsonb, actions),
        updated_at = now()
      WHERE id = $1 RETURNING *`,
      [
        id,
        data.name,
        data.description || null,
        data.triggerCron,
        data.triggerSql,
        data.actions ? JSON.stringify(data.actions) : null,
      ]
    );

    // Redeploy to Kestra
    const wf = workflow as Record<string, unknown>;
    const clinic = await queryOne<{ kestra_namespace: string }>(
      "SELECT kestra_namespace FROM flowcore.clinics WHERE id = $1",
      [wf.clinic_id]
    );
    if (clinic) {
      try {
        const { parent, worker } = generateKestraYaml(
          {
            id: wf.id as string,
            name: wf.name as string,
            description: wf.description as string,
            triggerType: wf.trigger_type as string,
            triggerCron: wf.trigger_cron as string,
            triggerSql: wf.trigger_sql as string,
            actions: typeof wf.actions === "string" ? JSON.parse(wf.actions as string) : (wf.actions as []),
            namespace: clinic.kestra_namespace,
          },
          { pair: true }
        );
        await createOrUpdateFlowFromYaml(worker);
        if (parent) await createOrUpdateFlowFromYaml(parent);
      } catch (e) {
        console.error("Kestra redeploy failed:", e);
      }
    }

    return NextResponse.json(workflow);
  } catch (e) {
    return authErrorResponse(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req)
    await initDb();
    const { id } = await params;

    const wf = await queryOne<Record<string, unknown>>(
      "SELECT w.*, c.kestra_namespace FROM flowcore.workflows w JOIN flowcore.clinics c ON c.id = w.clinic_id WHERE w.id = $1",
      [id]
    );

    if (wf) {
      try {
        const flowId = (wf.kestra_flow_id as string) || (wf.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        // Every workflow compiles to a parent + worker pair — delete both.
        // Worker is named {flowId}-run and always exists; parent may not (manual mode).
        await deleteFlow(wf.kestra_namespace as string, `${flowId}-run`).catch(() => {});
        await deleteFlow(wf.kestra_namespace as string, flowId).catch(() => {});
      } catch (e) {
        console.error("Kestra delete failed:", e);
      }
      await query("DELETE FROM flowcore.workflows WHERE id = $1", [id]);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return authErrorResponse(e);
  }
}
