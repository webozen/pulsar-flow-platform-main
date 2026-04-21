const express = require("express");
const app = express();
app.use(express.json());

// Fake Open Dental data
const patients = [
  { PatNum: 1, FName: "Alice", LName: "Johnson", Email: "alice@example.com", WirelessPhone: "+14155550101", HmPhone: "(415) 555-0100", PatStatus: 0 },
  { PatNum: 2, FName: "Bob", LName: "Smith", Email: "bob@example.com", WirelessPhone: "+14155550102", HmPhone: null, PatStatus: 0 },
  { PatNum: 3, FName: "Carol", LName: "Williams", Email: null, WirelessPhone: "+14155550103", HmPhone: null, PatStatus: 0 },
  { PatNum: 4, FName: "David", LName: "Brown", Email: "david@example.com", WirelessPhone: null, HmPhone: "(415) 555-0104", PatStatus: 0 },
  { PatNum: 5, FName: "Eve", LName: "Davis", Email: "eve@example.com", WirelessPhone: "+14155550105", HmPhone: null, PatStatus: 0 },
];

const recalls = [
  { RecallNum: 1, PatNum: 1, DateDue: "2026-03-12", RecallTypeNum: 1, IsDisabled: 0 },
  { RecallNum: 2, PatNum: 2, DateDue: "2026-02-10", RecallTypeNum: 1, IsDisabled: 0 },
  { RecallNum: 3, PatNum: 3, DateDue: "2026-04-01", RecallTypeNum: 1, IsDisabled: 0 },
];

const appointments = [
  { AptNum: 1, PatNum: 1, AptDateTime: new Date(Date.now() + 36 * 3600000).toISOString(), AptStatus: 1, Confirmed: 1 },
  { AptNum: 2, PatNum: 5, AptDateTime: new Date(Date.now() + 24 * 3600000).toISOString(), AptStatus: 1, Confirmed: 2 },
];

const claims = [
  { ClaimNum: 1, PatNum: 2, ClaimStatus: "S", DateSent: "2026-02-25", ClaimFee: 850.0, CarrierName: "Delta Dental", CarrierPhone: "(800) 765-6003", SubscriberID: "DD-123456" },
];

const procedures = [
  { ProcNum: 1, PatNum: 3, ProcDate: "2026-03-21", ProcCode: "D2750", ProcedureDescription: "Crown - Porcelain Fused to High Noble Metal", ProcStatus: 1 },
];

// Simple SQL parser — matches against fake data based on table name in the query
function executeQuery(sql) {
  const sqlLower = sql.toLowerCase();

  // Recall queries
  if (sqlLower.includes("from recall") || sqlLower.includes("join recall")) {
    return recalls.map((r) => {
      const p = patients.find((p) => p.PatNum === r.PatNum);
      return { ...r, ...(p || {}), DateDue: r.DateDue };
    });
  }

  // Appointment queries
  if (sqlLower.includes("from appointment") || sqlLower.includes("join appointment")) {
    return appointments.map((a) => {
      const p = patients.find((p) => p.PatNum === a.PatNum);
      return { ...a, ...(p || {}) };
    });
  }

  // Claim queries
  if (sqlLower.includes("from claim") || sqlLower.includes("join claim")) {
    return claims.map((c) => {
      const p = patients.find((p) => p.PatNum === c.PatNum);
      return { ...c, ...(p || {}) };
    });
  }

  // Procedure queries
  if (sqlLower.includes("from procedurelog") || sqlLower.includes("join procedurelog")) {
    return procedures.map((pr) => {
      const p = patients.find((p) => p.PatNum === pr.PatNum);
      return { ...pr, ...(p || {}) };
    });
  }

  // Patient queries
  if (sqlLower.includes("from patient")) {
    return patients;
  }

  return [];
}

// Open Dental API: PUT /queries/ShortQuery
app.put("/queries/ShortQuery", (req, res) => {
  const apiKey = req.headers.authorization;
  if (!apiKey || !apiKey.startsWith("ODFHIR ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { SqlCommand } = req.body;
  if (!SqlCommand) {
    return res.status(400).json({ error: "SqlCommand is required" });
  }

  // Check read-only
  const sqlLower = SqlCommand.toLowerCase().trim();
  if (!sqlLower.startsWith("select")) {
    return res.status(401).json({ error: "Queries must be read-only" });
  }

  console.log(`[Mock OD] Query: ${SqlCommand.substring(0, 100)}...`);
  const results = executeQuery(SqlCommand);
  console.log(`[Mock OD] Returned ${results.length} rows`);

  res.json(results);
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", service: "mock-opendental" }));

// API info
app.get("/api/v1", (_req, res) => res.json({
  service: "Mock Open Dental API",
  endpoints: ["PUT /queries/ShortQuery"],
  patients: patients.length,
  recalls: recalls.length,
  appointments: appointments.length,
}));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock Open Dental API running on port ${PORT}`);
  console.log(`  PUT http://localhost:${PORT}/queries/ShortQuery`);
  console.log(`  Auth: ODFHIR <any-key>`);
});
