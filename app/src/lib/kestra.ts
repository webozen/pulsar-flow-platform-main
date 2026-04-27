import { requireEnv } from "./env";

export const KESTRA_URL = requireEnv("KESTRA_API_URL", "http://localhost:8080");

async function kestraFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${KESTRA_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kestra API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Flows
export async function listFlows(namespace: string) {
  const data = await kestraFetch(`/api/v1/flows/search?namespace=${namespace}&size=50`);
  return data?.results || [];
}

export async function getFlow(namespace: string, id: string) {
  return kestraFetch(`/api/v1/flows/${namespace}/${id}`);
}

export async function createOrUpdateFlowFromYaml(yaml: string) {
  const res = await fetch(`${KESTRA_URL}/api/v1/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/x-yaml" },
    body: yaml,
  });
  // Kestra signals "already exists" with either 409 (older versions) or
  // 422 + message="Flow id already exists" (0.19+). Both → fall through to PUT.
  let alreadyExists = res.status === 409;
  let body = "";
  if (!alreadyExists && !res.ok) {
    body = await res.text();
    if (res.status === 422 && body.includes("Flow id already exists")) alreadyExists = true;
  }
  if (alreadyExists) {
    const nsMatch = yaml.match(/^namespace:\s*(.+)$/m);
    const idMatch = yaml.match(/^id:\s*(.+)$/m);
    if (nsMatch && idMatch) {
      const updateRes = await fetch(
        `${KESTRA_URL}/api/v1/flows/${nsMatch[1].trim()}/${idMatch[1].trim()}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/x-yaml" },
          body: yaml,
        }
      );
      if (!updateRes.ok) {
        const utext = await updateRes.text();
        throw new Error(`Kestra update error ${updateRes.status}: ${utext}`);
      }
      return updateRes.json();
    }
  }
  if (!res.ok) throw new Error(`Kestra create error ${res.status}: ${body}`);
  return res.json();
}

export async function deleteFlow(namespace: string, id: string) {
  return kestraFetch(`/api/v1/flows/${namespace}/${id}`, { method: "DELETE" });
}

export async function toggleFlow(namespace: string, id: string, disabled: boolean) {
  const flow = await getFlow(namespace, id);
  flow.disabled = disabled;
  const res = await fetch(`${KESTRA_URL}/api/v1/flows/${namespace}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(flow),
  });
  if (!res.ok) throw new Error(`Kestra toggle error ${res.status}`);
  return res.json();
}

// Trigger manual execution (Kestra v0.19 requires multipart/form-data)
export async function triggerExecution(namespace: string, flowId: string) {
  const res = await fetch(`${KESTRA_URL}/api/v1/executions/${namespace}/${flowId}`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=----empty" },
    body: "------empty--",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kestra trigger error ${res.status}: ${text}`);
  }
  return res.json();
}

// Replay execution from specific task
export async function replayExecution(executionId: string, taskRunId: string) {
  return kestraFetch(
    `/api/v1/executions/${executionId}/replay?taskRunId=${taskRunId}`,
    { method: "POST" }
  );
}

// `setSecret` was an attempt to write per-tenant secrets via Kestra
// OSS's `/api/v1/namespaces/{ns}/secrets/{key}` endpoint. That endpoint
// returns 404 in Kestra OSS — secrets are an enterprise feature.
// Per-tenant secrets live in Kestra KV instead (see `setKV`/`getKV`),
// and the legacy /api/secrets route now delegates to setKV directly.

// Executions
export async function listExecutions(params: {
  namespace?: string;
  state?: string;
  flowId?: string;
  size?: number;
}) {
  const qs = new URLSearchParams();
  if (params.namespace) qs.set("namespace", params.namespace);
  if (params.state) qs.set("state", params.state);
  if (params.flowId) qs.set("flowId", params.flowId);
  qs.set("size", String(params.size || 25));
  return kestraFetch(`/api/v1/executions/search?${qs}`);
}

export async function resumeExecution(id: string) {
  // Empty multipart body — gates in apt-reminder-row have no onResume
  // inputs, so the resume payload is intentionally minimal.
  const res = await fetch(`${KESTRA_URL}/api/v1/executions/${id}/resume`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=----empty" },
    body: "------empty--",
  });
  if (!res.ok && res.status !== 204) throw new Error(`Kestra resume error ${res.status}`);
  return { ok: true };
}

/** Hard kill via Kestra's DELETE /kill endpoint. Used when staff hits
 *  Skip on a row execution — stops it before send_sms fires. With the
 *  subflow-per-row architecture, killing an execution affects only
 *  that one row; siblings are independent executions. */
export async function killExecution(id: string) {
  const res = await fetch(`${KESTRA_URL}/api/v1/executions/${id}/kill`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    throw new Error(`Kestra kill error ${res.status}: ${text}`);
  }
  return { ok: true };
}

// Namespace KV store
/** Read a single KV value. Returns null when the key isn't set (Kestra
 *  responds 404).
 *
 *  Kestra OSS 0.19 returns a typed envelope:
 *    `{"type":"STRING","value":"<actual>"}`
 *  for STRING values, not the raw string. Earlier code assumed a bare
 *  JSON-quoted string and silently returned the envelope JSON as the
 *  "key", which broke OpenDental and Twilio auth headers downstream
 *  ("Invalid API key(s).").
 *
 *  We unwrap STRING / NUMBER / BOOLEAN / DURATION envelopes here so
 *  callers get a native value. JSON / array / object KV values come
 *  back as the parsed structure. */
export async function getKV(namespace: string, key: string): Promise<string | null> {
  const res = await fetch(`${KESTRA_URL}/api/v1/namespaces/${namespace}/kv/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Kestra KV get error ${res.status}`);
  const text = await res.text();
  // Try the typed-envelope form first.
  try {
    const parsed = JSON.parse(text) as { type?: string; value?: unknown };
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      const v = parsed.value;
      if (v == null) return null;
      return typeof v === "string" ? v : String(v);
    }
    // No envelope — fall back to JSON-string form.
    return typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    // Not JSON at all; return raw.
    return text;
  }
}

export async function setKV(namespace: string, key: string, value: string) {
  const res = await fetch(
    `${KESTRA_URL}/api/v1/namespaces/${namespace}/kv/${key}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }
  );
  if (!res.ok) throw new Error(`Kestra KV error ${res.status}`);
}

// `syncClinicToKestra` was the Plan A bridge that copied per-tenant
// secrets out of `flowcore.clinics` columns and INTO Kestra KV. Phase 2
// cleanup dropped those columns; per-tenant secrets are now written
// directly to KV (by pulsar-backend's automation-sync module via
// `pushTenantSecrets`, or by an admin via /api/secrets). The function
// had only one caller (`/api/clinics/[id]/sync`, now a deprecated
// no-op) and used the WRONG KV key names anyway (`opendental_api_*`
// instead of `opendental_developer_key`/`_customer_key`). Removed.
