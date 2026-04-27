import { NextResponse } from "next/server";
import { queryOne, initDb } from "@/lib/db";
import { extractPlaceholders } from "@/lib/trigger-library";
import { getKV } from "@/lib/kestra";
import { OPENDENTAL_BASE } from "@/lib/opendental";
import { namespaceFor } from "@/lib/tenant-sync";

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

  // Phase 2: per-tenant credentials live in Kestra KV under the
  // tenant's namespace. The UI passes `clinicId` from the URL params
  // — under Plan B the URL `[id]` is the slug, not a UUID, but legacy
  // call sites still pass the UUID `flowcore.clinics.id`. Accept both:
  // try slug first (covers the URL-param path), fall back to id lookup
  // (covers any caller that still uses the UUID).
  let slug: string | null = clinicId;
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(String(clinicId))) {
    const row = await queryOne<{ slug: string }>(
      "SELECT slug FROM flowcore.clinics WHERE id = $1",
      [clinicId]
    );
    slug = row?.slug ?? null;
  }
  if (!slug) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }
  const namespace = namespaceFor(slug);
  const developerKey = await getKV(namespace, "opendental_developer_key");
  const customerKey  = await getKV(namespace, "opendental_customer_key");
  if (!developerKey || !customerKey) {
    return NextResponse.json(
      { error: "Clinic has no OpenDental credentials configured (set opendental_developer_key + opendental_customer_key in Kestra KV)" },
      { status: 400 },
    );
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
    const res = await fetch(`${OPENDENTAL_BASE}/queries/ShortQuery`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ODFHIR ${developerKey}/${customerKey}`,
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
