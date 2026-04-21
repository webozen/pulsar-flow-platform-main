"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaybookChatWidget } from "@/components/playbook/chat-widget";

interface Clinic {
  id: string;
  name: string;
  slug: string;
}

export default function PlaybooksPage() {
  const { id: clinicId } = useParams();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [documents, setDocuments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/clinics/${clinicId}`).then((r) => r.json()).then(setClinic);
  }, [clinicId]);

  useEffect(() => {
    if (clinic) loadDocs();
  }, [clinic]);

  async function loadDocs() {
    if (!clinic) return;
    try {
      const res = await fetch(`/api/playbook/documents?workspace=${clinic.slug}`);
      if (res.ok) {
        const data = await res.json();
        // AnythingLLM returns workspace with documents array
        const docs = data?.workspace?.documents || data?.documents || [];
        setDocuments(docs.map((d: Record<string, string>) => d.name || d.title || "Untitled"));
      }
    } catch {
      // AnythingLLM may not be running
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!clinic || !docTitle || !docContent) return;
    setUploading(true);
    setMessage("");

    const res = await fetch("/api/playbook/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceSlug: clinic.slug,
        content: docContent,
        filename: docTitle,
      }),
    });

    if (res.ok) {
      setMessage("Document uploaded. It may take a moment for AI to index it.");
      setDocTitle("");
      setDocContent("");
      loadDocs();
    } else {
      const err = await res.json();
      setMessage(`Upload failed: ${err.error || "Unknown error"}. Is AnythingLLM running?`);
    }
    setUploading(false);
  }

  if (!clinic) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Playbooks</h1>
          <p className="text-[13px] text-slate-500 mt-1">Upload SOPs and dental procedures — staff can ask AI questions about them</p>
        </div>
        <a href="http://localhost:3001" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <svg className="mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
            AnythingLLM Admin
          </Button>
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Upload Playbook</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-3">
              <div className="space-y-1.5">
                <Input
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Document title (e.g., Claim Follow-Up SOP)"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <textarea
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="Paste the playbook content here (Markdown or plain text)..."
                  className="w-full rounded-md border px-3 py-2 text-sm min-h-[150px]"
                />
              </div>
              <Button type="submit" disabled={uploading || !docTitle || !docContent} size="sm" className="bg-blue-600 hover:bg-blue-700">
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </form>
            {message && (
              <p className="mt-3 text-sm text-blue-800 bg-blue-50 rounded-md px-3 py-2">{message}</p>
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Uploaded Documents</CardTitle>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <div className="text-center py-8">
                <div className="rounded-full bg-blue-50 p-3 mx-auto w-fit mb-3">
                  <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
                </div>
                <p className="text-sm text-muted-foreground">No playbooks uploaded yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Upload SOPs, procedures, and guides for AI-powered staff assistance.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                      <span className="text-sm">{doc}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Test Chat */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700">Test Playbook Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <PlaybookChatWidget workspaceSlug={clinic.slug} />
        </CardContent>
      </Card>
    </div>
  );
}
