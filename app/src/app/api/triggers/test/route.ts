import { NextResponse } from "next/server";
import { queryOne, initDb } from "@/lib/db";
import { extractPlaceholders } from "@/lib/trigger-library";

export const dynamic = "force-dynamic";

/**
 * Test a trigger SQL query against a clinic's Open Dental API.
 * Returns sample rows + extracted placeholders.
 * POST { clinicId, sql }
 */
export async function POST(req: Request) {
  await initDb();
  const { clinicId, sql } = await req.json();

  if (!clinicId || !sql) {
    return NextResponse.json({ error: "clinicId and sql required" }, { status: 400 });
  }

  // Validate read-only
  const upper = sql.trim().toUpperCase();
  if (!upper.startsWith("SELECT")) {
    return NextResponse.json({ error: "Query must start with SELECT" }, { status: 400 });
  }
  for (const kw of ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE"]) {
    if (new RegExp(`(?<![A-Z])${kw}(?![A-Z])`).test(upper)) {
      return NextResponse.json({ error: `Query must not contain ${kw}` }, { status: 400 });
    }
  }

  // Get clinic's Open Dental API config
  const clinic = await queryOne<{ opendental_api_url: string; opendental_api_key: string }>(
    "SELECT opendental_api_url, opendental_api_key FROM flowcore.clinics WHERE id = $1",
    [clinicId]
  );
  if (!clinic?.opendental_api_url) {
    return NextResponse.json({ error: "Clinic has no Open Dental API configured" }, { status: 400 });
  }

  // Add LIMIT 5 if not present
  let testSql = sql.trim().replace(/;$/, "");
  if (!testSql.toUpperCase().includes("LIMIT")) {
    testSql += " LIMIT 5";
  }

  // Replace {{since}} with 30 days ago
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  testSql = testSql.replace(/\{\{since\}\}/g, since);

  try {
    const res = await fetch(`${clinic.opendental_api_url}/queries/ShortQuery`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ODFHIR ${clinic.opendental_api_key}`,
      },
      body: JSON.stringify({ SqlCommand: testSql }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Open Dental API error: ${text}` }, { status: 502 });
    }

    const rows = await res.json();
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const placeholders = extractPlaceholders(sql);

    return NextResponse.json({
      columns,
      placeholders: placeholders.map((p) => `{{${p}}}`),
      rows,
      rowCount: rows.length,
    });
  } catch (e) {
    return NextResponse.json({ error: `Failed to reach Open Dental API: ${e}` }, { status: 502 });
  }
}
