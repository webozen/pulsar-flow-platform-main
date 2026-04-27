import { requireEnv } from "./env";

// OpenDental API is shared SaaS — base URL is constant; only the
// per-tenant credentials vary. Auth header form is `ODFHIR <dev>/<cust>`,
// matching the apt-reminder-row.yml flow's HTTP Request task. Per-tenant
// keys live in Kestra KV as `opendental_developer_key` +
// `opendental_customer_key`.
export const OPENDENTAL_BASE = requireEnv("OPENDENTAL_API_BASE", "https://api.opendental.com/api/v1");
