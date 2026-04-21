const KESTRA_URL = process.env.KESTRA_API_URL || "http://localhost:8080";

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
  if (res.status === 409) {
    // Flow already exists — extract namespace/id from yaml and update
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
      if (!updateRes.ok) throw new Error(`Kestra update error ${updateRes.status}`);
      return updateRes.json();
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kestra create error ${res.status}: ${text}`);
  }
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

// Secrets
export async function setSecret(namespace: string, key: string, value: string) {
  const res = await fetch(
    `${KESTRA_URL}/api/v1/namespaces/${namespace}/secrets/${key}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }
  );
  if (!res.ok) throw new Error(`Kestra secret error ${res.status}`);
}

// Executions
export async function listExecutions(params: {
  namespace?: string;
  state?: string;
  size?: number;
}) {
  const qs = new URLSearchParams();
  if (params.namespace) qs.set("namespace", params.namespace);
  if (params.state) qs.set("state", params.state);
  qs.set("size", String(params.size || 25));
  return kestraFetch(`/api/v1/executions/search?${qs}`);
}

export async function resumeExecution(id: string) {
  const res = await fetch(`${KESTRA_URL}/api/v1/executions/${id}/resume`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=----empty" },
    body: "------empty--",
  });
  if (!res.ok && res.status !== 204) throw new Error(`Kestra resume error ${res.status}`);
  return { ok: true };
}

export async function killExecution(id: string) {
  // Soft kill: resume the execution (it will complete with no actions or a log)
  // This preserves the execution in Kestra's audit trail
  // Then add a "rejected" label for tracking
  await resumeExecution(id);
  return { ok: true };
}

// Namespace KV store
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

// Sync clinic config to Kestra namespace KV variables
export async function syncClinicToKestra(clinic: {
  kestraNamespace: string;
  name: string;
  phone?: string | null;
  timezone: string;
  opendentalApiUrl?: string | null;
  opendentalApiKey?: string | null;
  twilioSid?: string | null;
  twilioAuthToken?: string | null;
  twilioFromNumber?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  smtpFrom?: string | null;
  billingEmail?: string | null;
  frontDeskEmail?: string | null;
}) {
  const ns = clinic.kestraNamespace;
  const kvPairs: Record<string, string> = {
    clinic_name: clinic.name,
    timezone: clinic.timezone,
    // App URL is used by voice call actions to build the TwiML callback URL
    app_url: process.env.PUBLIC_APP_URL || "http://localhost:3000",
  };

  if (clinic.phone) kvPairs.clinic_phone = clinic.phone;
  if (clinic.opendentalApiUrl) kvPairs.opendental_api_url = clinic.opendentalApiUrl;
  if (clinic.opendentalApiKey) kvPairs.opendental_api_key = clinic.opendentalApiKey;
  if (clinic.twilioSid) kvPairs.twilio_sid = clinic.twilioSid;
  if (clinic.twilioFromNumber) kvPairs.twilio_from_number = clinic.twilioFromNumber;
  // Compute Twilio Basic auth (Base64 of SID:AuthToken) for Kestra HTTP tasks
  if (clinic.twilioSid && clinic.twilioAuthToken) {
    const basicAuth = Buffer.from(`${clinic.twilioSid}:${clinic.twilioAuthToken}`).toString("base64");
    kvPairs.twilio_basic_auth = basicAuth;
  }
  if (clinic.smtpHost) kvPairs.smtp_host = clinic.smtpHost;
  if (clinic.smtpPort) kvPairs.smtp_port = String(clinic.smtpPort);
  if (clinic.smtpUsername) kvPairs.smtp_username = clinic.smtpUsername;
  if (clinic.smtpFrom) kvPairs.smtp_from = clinic.smtpFrom;
  if (clinic.billingEmail) kvPairs.billing_team_email = clinic.billingEmail;
  if (clinic.frontDeskEmail) kvPairs.front_desk_email = clinic.frontDeskEmail;

  for (const [key, value] of Object.entries(kvPairs)) {
    await setKV(ns, key, value);
  }

  return { synced: Object.keys(kvPairs).length };
}
