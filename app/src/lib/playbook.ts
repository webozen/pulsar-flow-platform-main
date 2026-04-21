/**
 * AnythingLLM REST API client for playbook/knowledge base features.
 * Self-contained — designed for extraction into @pulsarflow/playbook-client.
 *
 * AnythingLLM provides: document parsing, embedding, RAG chat with Gemini.
 * This client just calls its API. Zero content management logic here.
 */

const PLAYBOOK_URL = process.env.ANYTHINGLLM_URL || "http://localhost:3001";
const PLAYBOOK_KEY = process.env.ANYTHINGLLM_API_KEY || "playbook-dev-key";

async function playbookFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${PLAYBOOK_URL}/api/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PLAYBOOK_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AnythingLLM error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Workspaces ──────────────────────────────────────────────────

export async function createWorkspace(name: string, slug: string) {
  return playbookFetch("/workspace/new", {
    method: "POST",
    body: JSON.stringify({ name, slug }),
  });
}

export async function listWorkspaces() {
  return playbookFetch("/workspaces");
}

export async function getWorkspace(slug: string) {
  return playbookFetch(`/workspace/${slug}`);
}

// ── Documents ───────────────────────────────────────────────────

export async function uploadDocument(workspaceSlug: string, content: string, filename: string) {
  // AnythingLLM expects multipart upload for documents.
  // For text content, we use the raw-text upload endpoint.
  return playbookFetch(`/document/raw-text`, {
    method: "POST",
    body: JSON.stringify({
      textContent: content,
      metadata: { title: filename, workspaceSlug },
    }),
  });
}

export async function listDocuments(workspaceSlug: string) {
  return playbookFetch(`/workspace/${workspaceSlug}`);
}

// ── Chat (RAG) ──────────────────────────────────────────────────

export interface ChatResponse {
  textResponse: string;
  sources: { title: string; text: string; chunkSource?: string }[];
  close: boolean;
}

export async function chat(
  workspaceSlug: string,
  message: string,
  systemPrompt?: string
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { message, mode: "chat" };
  if (systemPrompt) {
    body.systemPrompt = systemPrompt;
  }
  const data = await playbookFetch(`/workspace/${workspaceSlug}/chat`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data;
}

// ── Health ──────────────────────────────────────────────────────

export async function isPlaybookHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${PLAYBOOK_URL}/api/v1/auth`, {
      headers: { Authorization: `Bearer ${PLAYBOOK_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
