import { NextResponse } from "next/server";
import { query, initDb } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/pulsar-auth";
import { getOrCreateClinic } from "@/lib/clinic-context";

export const dynamic = "force-dynamic";

/**
 * List conversation threads. One row per (clinic, phone) with the latest
 * message, total count, and unread (inbound-since-last-outbound) count.
 * Scoped to the authenticated tenant's clinic.
 */
export async function GET(req: Request) {
  try {
    const { slug } = requireAuth(req)
    await initDb()
    const clinic = await getOrCreateClinic(slug)
    const clinicId = clinic.id

    const rows = await query(
      `
      WITH latest AS (
        SELECT DISTINCT ON (clinic_id, phone)
          clinic_id,
          CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END AS phone,
          body AS last_body,
          direction AS last_direction,
          created_at AS last_at,
          pat_num
        FROM flowcore.sms_messages
        WHERE clinic_id = $1
        ORDER BY clinic_id, phone, created_at DESC
      ),
      counts AS (
        SELECT
          clinic_id,
          CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END AS phone,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound_count
        FROM flowcore.sms_messages
        WHERE clinic_id = $1
        GROUP BY 1, 2
      )
      SELECT l.*, c.total, c.inbound_count,
        EXISTS(SELECT 1 FROM flowcore.sms_opt_outs o WHERE o.clinic_id = l.clinic_id AND o.phone_number = l.phone) AS opted_out
      FROM latest l
      JOIN counts c USING (clinic_id, phone)
      ORDER BY l.last_at DESC
      LIMIT 200
      `,
      [clinicId]
    );

    return NextResponse.json(rows);
  } catch (e) {
    return authErrorResponse(e);
  }
}
