"use client";

import { useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatSource {
  title: string;
  text: string;
}

interface ChatWidgetProps {
  workspaceSlug: string;
  context?: Record<string, unknown>;
}

export function PlaybookChatWidget({ workspaceSlug, context }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setAnswer("");
    setSources([]);

    const res = await clientFetch("/api/playbook/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceSlug, message, context }),
    });

    if (res.ok) {
      const data = await res.json();
      setAnswer(data.answer || "No answer found in playbooks.");
      setSources(data.sources || []);
    } else {
      setAnswer("Could not reach the playbook service. Make sure AnythingLLM is running.");
    }
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
        Ask Playbook AI
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
          Playbook AI
        </div>
        <button onClick={() => setOpen(false)} className="text-xs text-blue-600 hover:underline">Close</button>
      </div>

      <form onSubmit={handleAsk} className="flex gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="How should I handle this?"
          className="text-sm bg-white border-blue-200"
          disabled={loading}
        />
        <Button type="submit" size="sm" disabled={loading || !message.trim()} className="bg-blue-600 hover:bg-blue-700 shrink-0">
          {loading ? "..." : "Ask"}
        </Button>
      </form>

      {answer && (
        <div className="space-y-2">
          <div className="rounded-md bg-white border border-blue-100 p-3 text-sm whitespace-pre-wrap">
            {answer}
          </div>
          {sources.length > 0 && (
            <div className="text-xs text-blue-700">
              <span className="font-medium">Sources: </span>
              {sources.map((s, i) => (
                <span key={i}>
                  {s.title || "Document"}
                  {i < sources.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
