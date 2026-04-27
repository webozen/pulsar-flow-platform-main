/**
 * Direct tests for the Kestra REST wrappers in `lib/kestra.ts`.
 *
 * These helpers are thin but every one carries a Kestra-OSS quirk we
 * had to learn the hard way (taskRunId silently ignored on resume,
 * /secrets returning 404, KV typed-envelope wrap, 422 vs 409 on flow
 * update). The route tests mock at the fetch level, so this suite is
 * the only place those quirks are pinned at the helper boundary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setKV,
  resumeExecution,
  killExecution,
  triggerExecution,
  createOrUpdateFlowFromYaml,
  listExecutions,
  listFlows,
  toggleFlow,
  deleteFlow,
} from "../kestra";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("setKV", () => {
  it("PUTs the value to /api/v1/namespaces/{ns}/kv/{key} as JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await setKV("dental.acme-dental", "twilio_sid", "AC123");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/v1/namespaces/dental.acme-dental/kv/twilio_sid");
    expect((opts as RequestInit).method).toBe("PUT");
    expect((opts as RequestInit).body).toBe('"AC123"');
  });

  it("throws on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(setKV("ns", "k", "v")).rejects.toThrow(/Kestra KV error/);
  });
});

describe("resumeExecution", () => {
  it("POSTs an empty multipart body — no taskRunId (Kestra OSS bug)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await resumeExecution("EX1");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/v1/executions/EX1/resume");
    expect((opts as RequestInit).method).toBe("POST");
    expect(String((opts as RequestInit).body)).not.toContain("taskRunId");
  });

  it("treats 204 as success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(resumeExecution("EX1")).resolves.toEqual({ ok: true });
  });

  it("non-2xx (other than 204) throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(resumeExecution("EX1")).rejects.toThrow(/Kestra resume error/);
  });
});

describe("killExecution", () => {
  it("DELETEs /api/v1/executions/{id}/kill — accepts 202", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(killExecution("EX1")).resolves.toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/v1/executions/EX1/kill");
    expect((opts as RequestInit).method).toBe("DELETE");
  });

  it("non-202/2xx throws with the response body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("dead", { status: 500 }));
    await expect(killExecution("EX1")).rejects.toThrow(/Kestra kill error 500/);
  });
});

describe("triggerExecution", () => {
  it("POSTs multipart/form-data with no body to /executions/{ns}/{flowId}", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "exec-1" })));
    const out = await triggerExecution("dental.acme-dental", "my-flow");
    expect(out.id).toBe("exec-1");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("http://localhost:8080/api/v1/executions/dental.acme-dental/my-flow");
  });
});

describe("listExecutions", () => {
  it("builds the query string from namespace + state + flowId + size", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await listExecutions({ namespace: "dental.acme-dental", state: "PAUSED", flowId: "my-flow", size: 50 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("namespace=dental.acme-dental");
    expect(url).toContain("state=PAUSED");
    expect(url).toContain("flowId=my-flow");
    expect(url).toContain("size=50");
  });

  it("default size = 25 when not supplied", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await listExecutions({ namespace: "ns" });
    expect(fetchMock.mock.calls[0][0]).toContain("size=25");
  });
});

describe("listFlows", () => {
  it("calls /api/v1/flows/search with the namespace + size=50", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await listFlows("dental.acme-dental");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("namespace=dental.acme-dental");
    expect(url).toContain("size=50");
  });
});

describe("createOrUpdateFlowFromYaml", () => {
  const yaml = "id: my-flow\nnamespace: dental.acme-dental\ntasks:\n  - id: x\n    type: io.kestra.plugin.core.log.Log\n";

  it("first POST succeeds → returns the parsed flow", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "my-flow", revision: 1 })));
    const out = await createOrUpdateFlowFromYaml(yaml);
    expect(out.id).toBe("my-flow");
    expect(out.revision).toBe(1);
  });

  it("409 → falls through to PUT (already-exists path, older Kestra)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "my-flow", revision: 2 })));
    const out = await createOrUpdateFlowFromYaml(yaml);
    expect(out.revision).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/api/v1/flows/dental.acme-dental/my-flow");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PUT");
  });

  it("422 with 'Flow id already exists' → falls through to PUT (Kestra 0.19+)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Flow id already exists" }), { status: 422 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "my-flow", revision: 3 })));
    const out = await createOrUpdateFlowFromYaml(yaml);
    expect(out.revision).toBe(3);
  });

  it("non-409/422 errors throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("kaboom", { status: 500 }));
    await expect(createOrUpdateFlowFromYaml(yaml)).rejects.toThrow(/Kestra create error/);
  });
});

describe("toggleFlow", () => {
  it("GETs the flow, mutates `disabled`, then PUTs it back", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "my-flow", disabled: false, revision: 1, tasks: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "my-flow", disabled: true, revision: 2 })));
    const out = await toggleFlow("dental.acme-dental", "my-flow", true);
    expect(out.disabled).toBe(true);
    const putCall = fetchMock.mock.calls[1];
    expect((putCall[1] as RequestInit).method).toBe("PUT");
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.disabled).toBe(true);
  });
});

describe("deleteFlow", () => {
  it("DELETEs /api/v1/flows/{ns}/{id}", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteFlow("dental.acme-dental", "my-flow");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/flows/dental.acme-dental/my-flow");
    expect((opts as RequestInit).method).toBe("DELETE");
  });
});
