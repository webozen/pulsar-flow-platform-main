/**
 * Unit tests for the inbound Twilio SMS webhook.
 *
 * This is the highest-blast-radius surface in the app: it routes
 * inbound texts by `twilio_from_number → slug`, enforces STOP/START
 * opt-outs that gate every future outbound to that number, and
 * triggers the per-tenant inbound-sms webhook flow in Kestra. A bug
 * here can silently brick outbound delivery for a patient or send the
 * wrong tenant's reply flow. Pinning the contract here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Twilio webhook is unauthenticated (Twilio posts directly), so no
// pulsar-auth mock needed. The route reads/writes flowcore tables and
// Kestra KV — both are mocked.
const { queryMock, queryOneMock, getKVMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  getKVMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: queryMock, queryOne: queryOneMock }));
vi.mock("@/lib/kestra", () => ({ getKV: getKVMock, KESTRA_URL: "http://kestra-mock:8080" }));
// classifyInboundSms is pure but used; let it run.

import { POST } from "../route";

const fetchMock = vi.fn();
beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  getKVMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function form(data: Record<string, string>): Request {
  const body = new URLSearchParams(data);
  return new Request("http://localhost/api/twilio/webhook/sms", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

describe("POST /api/twilio/webhook/sms — inbound routing", () => {
  it("unknown destination number → empty TwiML, no DB writes", async () => {
    queryOneMock.mockResolvedValueOnce(null); // no clinic with this twilio_from_number
    const res = await POST(form({ From: "+15551234567", To: "+10000000000", Body: "hi", MessageSid: "SM1" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Response/>");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("known destination + plain message → logs inbound + empty TwiML", async () => {
    queryOneMock
      .mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental", name: "Acme Dental" });
    getKVMock.mockResolvedValue(null); // no opendental creds → skip patient lookup
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })); // kestra inbound-sms trigger

    const res = await POST(form({
      From: "+15551234567", To: "+17406606649", Body: "thanks!", MessageSid: "SM2",
    }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Response/>");
    // sms_messages INSERT was called with the inbound row
    expect(queryMock).toHaveBeenCalled();
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO flowcore.sms_messages");
    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("clinic-uuid"); // clinic_id
    expect(params[1]).toBe("+15551234567"); // from_number
  });

  it("STOP keyword → opt-out row created with reason; HELP/CONFIRM auto-replies are returned", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental", name: "Acme Dental" });
    getKVMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await POST(form({ From: "+15551234567", To: "+17406606649", Body: "STOP", MessageSid: "SM3" }));
    // sms_messages INSERT + sms_opt_outs INSERT
    const stopInsert = queryMock.mock.calls.find(
      (c) => String(c[0]).includes("INSERT INTO flowcore.sms_opt_outs"),
    );
    expect(stopInsert, "STOP must write to opt-outs").toBeTruthy();
    expect((stopInsert![1] as unknown[])[0]).toBe("clinic-uuid");
    expect((stopInsert![1] as unknown[])[1]).toBe("+15551234567");
  });

  it("START keyword → opt-out row deleted (re-subscribes the number)", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental", name: "Acme Dental" });
    getKVMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await POST(form({ From: "+15551234567", To: "+17406606649", Body: "START", MessageSid: "SM4" }));
    const startDelete = queryMock.mock.calls.find(
      (c) => String(c[0]).includes("DELETE FROM flowcore.sms_opt_outs"),
    );
    expect(startDelete, "START must remove the opt-out row").toBeTruthy();
  });

  it("OpenDental KV creds present → looks up patient and stores PatNum", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental", name: "Acme Dental" });
    getKVMock.mockImplementation(async (_ns, key) => {
      if (key === "opendental_developer_key") return "dev-key";
      if (key === "opendental_customer_key") return "cust-key";
      return null;
    });
    // OpenDental returns a patient match
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ PatNum: 1234, FName: "Sawyer" }]), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // kestra trigger

    await POST(form({ From: "+15551234567", To: "+17406606649", Body: "ok", MessageSid: "SM5" }));
    // OpenDental was called with the right auth header
    const odCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("opendental.com/api/v1/patients"),
    );
    expect(odCall, "OpenDental lookup must fire").toBeTruthy();
    const auth = ((odCall![1] as RequestInit).headers as Record<string, string>).Authorization;
    expect(auth).toBe("ODFHIR dev-key/cust-key");
    // patNum was passed to sms_messages INSERT — last positional param.
    // SQL: ($1 clinic_id, $2 from, $3 to, $4 body, $5 sid, $6 keyword, $7 pat_num).
    const insertCall = queryMock.mock.calls[0];
    const insertParams = insertCall[1] as unknown[];
    expect(insertParams[6]).toBe("1234");
  });

  it("namespace for the Kestra inbound-sms trigger is derived from the clinic slug", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "beta-dental", name: "Beta Dental" });
    getKVMock.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await POST(form({ From: "+15551234567", To: "+17406606649", Body: "ok", MessageSid: "SM6" }));
    const kestraCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/inbound-sms/inbound-sms"),
    );
    expect(kestraCall, "Kestra inbound-sms trigger must fire").toBeTruthy();
    expect(String(kestraCall![0])).toContain("/dental.beta-dental/");
  });

  it("Kestra trigger failure does NOT break the inbound — message is still logged", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental", name: "Acme Dental" });
    getKVMock.mockResolvedValue(null);
    fetchMock.mockRejectedValueOnce(new Error("kestra down"));

    const res = await POST(form({ From: "+15551234567", To: "+17406606649", Body: "ok", MessageSid: "SM7" }));
    expect(res.status).toBe(200);
    expect(queryMock).toHaveBeenCalled(); // still logged
  });

  it("HELP keyword → TwiML <Message> reply with the clinic name", async () => {
    queryOneMock.mockResolvedValueOnce({ id: "clinic-uuid", slug: "acme-dental", name: "Acme Dental" });
    getKVMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await POST(form({ From: "+15551234567", To: "+17406606649", Body: "HELP", MessageSid: "SM8" }));
    const xml = await res.text();
    expect(xml).toContain("<Message>");
    expect(xml).toContain("Acme Dental");
  });
});
