"use client";

import { useEffect, useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Thread {
  clinic_id: string;
  phone: string;
  last_body: string;
  last_direction: "inbound" | "outbound";
  last_at: string;
  pat_num: string | null;
  total: number;
  inbound_count: number;
  opted_out: boolean;
}

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  keyword: string | null;
  created_at: string;
}

interface Clinic { id: string; name: string; kestra_namespace: string }

export default function ConversationsPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [filterClinic, setFilterClinic] = useState("");
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [optedOut, setOptedOut] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadThreads() {
    setLoading(true);
    const qs = filterClinic ? `?clinicId=${filterClinic}` : "";
    const [tRes, cRes] = await Promise.all([
      clientFetch(`/api/conversations${qs}`),
      clientFetch(`/api/clinics`),
    ]);
    if (tRes.ok) setThreads(await tRes.json());
    if (cRes.ok) setClinics(await cRes.json());
    setLoading(false);
  }

  async function openThread(t: Thread) {
    setSelected(t);
    setMessages([]);
    const res = await clientFetch(`/api/conversations/${encodeURIComponent(t.phone)}?clinicId=${t.clinic_id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setOptedOut(data.optedOut);
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    const res = await clientFetch(`/api/conversations/${encodeURIComponent(selected.phone)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId: selected.clinic_id, body: reply }),
    });
    setSending(false);
    if (res.ok) {
      setReply("");
      openThread(selected);
      loadThreads();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to send");
    }
  }

  useEffect(() => { loadThreads(); /* eslint-disable-next-line */ }, [filterClinic]);

  const clinicName = (id: string) => clinics.find((c) => c.id === id)?.name || id;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Conversations</h1>
            <p className="text-[13px] text-slate-500 mt-1">{threads.length} thread{threads.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <select
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={filterClinic}
          onChange={(e) => setFilterClinic(e.target.value)}
        >
          <option value="">All clinics</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="space-y-2 max-h-[70vh] overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!loading && threads.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">No conversations yet.</CardContent></Card>
          )}
          {threads.map((t) => (
            <button
              key={`${t.clinic_id}:${t.phone}`}
              onClick={() => openThread(t)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selected?.phone === t.phone && selected?.clinic_id === t.clinic_id
                  ? "border-blue-300 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-sm">{t.phone}</span>
                {t.opted_out && <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">STOPPED</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mb-1">{clinicName(t.clinic_id)}</p>
              <p className="text-sm text-gray-700 line-clamp-1">
                {t.last_direction === "inbound" ? "" : "You: "}
                {t.last_body}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">{new Date(t.last_at).toLocaleString()}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        {!selected ? (
          <Card>
            <CardContent className="py-24 text-center text-muted-foreground text-sm">
              Select a conversation to view the thread.
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full flex flex-col">
            <div className="border-b px-4 py-3 flex items-center justify-between">
              <div>
                <p className="font-mono text-sm">{selected.phone}</p>
                <p className="text-xs text-muted-foreground">{clinicName(selected.clinic_id)}</p>
              </div>
              {optedOut && <Badge className="bg-red-100 text-red-800 border-red-200">Opted out</Badge>}
            </div>
            <div className="flex-1 space-y-2 p-4 max-h-[60vh] overflow-y-auto">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                    m.direction === "outbound"
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-gray-100 text-gray-900 rounded-bl-sm"
                  }`}>
                    {m.keyword && <span className="mr-1 text-[10px] uppercase opacity-75">[{m.keyword}]</span>}
                    <span className="whitespace-pre-wrap">{m.body}</span>
                    <div className={`text-[10px] mt-1 ${m.direction === "outbound" ? "text-blue-100" : "text-gray-500"}`}>
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-3 flex gap-2">
              <input
                className="flex-1 rounded-md border px-3 py-2 text-sm"
                placeholder={optedOut ? "Patient has opted out" : "Type a reply…"}
                disabled={optedOut || sending}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
              />
              <Button onClick={sendReply} disabled={optedOut || sending || !reply.trim()}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
