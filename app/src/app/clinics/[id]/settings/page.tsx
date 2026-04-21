"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Clinic {
  id: string; name: string; slug: string; phone: string | null; timezone: string;
  kestra_namespace: string; is_active: boolean;
  opendental_api_url: string | null; opendental_api_key: string | null;
  twilio_sid: string | null; twilio_from_number: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_username: string | null; smtp_from: string | null;
  billing_email: string | null; front_desk_email: string | null;
}

export default function SettingsPage() {
  const { id } = useParams();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { clientFetch(`/api/clinics/${id}`).then((r) => r.json()).then(setClinic); }, [id]);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    await clientFetch(`/api/clinics/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setSaving(false);
    setMessage("Saved. Click 'Sync to Kestra' to push changes.");
  }

  async function handleSync() {
    setSyncing(true);
    const res = await clientFetch(`/api/clinics/${id}/sync`, { method: "POST" });
    const result = await res.json();
    setSyncing(false);
    setMessage(`Synced ${result.kvVariables} variables to Kestra.`);
  }

  if (!clinic) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Clinic Settings</h2>
        <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm">
          {syncing ? "Syncing..." : "Sync to Kestra"}
        </Button>
      </div>

      {message && <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-sm text-blue-800">{message}</div>}

      <form onSubmit={handleSave} className="space-y-5">
        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">General</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Clinic Name</Label><Input name="name" defaultValue={clinic.name} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Phone</Label><Input name="phone" defaultValue={clinic.phone || ""} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Timezone</Label><Input name="timezone" defaultValue={clinic.timezone} className="h-9" /></div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Open Dental API</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">API URL</Label><Input name="opendentalApiUrl" defaultValue={clinic.opendental_api_url || ""} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">API Key</Label><Input name="opendentalApiKey" type="password" defaultValue={clinic.opendental_api_key || ""} className="h-9" /></div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Twilio (SMS)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Account SID</Label><Input name="twilioSid" defaultValue={clinic.twilio_sid || ""} className="h-9" /></div>
              <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Auth Token</Label><Input name="twilioAuthToken" type="password" placeholder="Leave blank to keep current" className="h-9" /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">From Number</Label><Input name="twilioFromNumber" defaultValue={clinic.twilio_from_number || ""} className="h-9 max-w-xs" /></div>
            <p className="text-xs text-muted-foreground">Auth Token is synced to Kestra as a computed Basic auth header. It is not stored in the app database.</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Email</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">SMTP Host</Label><Input name="smtpHost" defaultValue={clinic.smtp_host || ""} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Port</Label><Input name="smtpPort" type="number" defaultValue={clinic.smtp_port || 587} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Username</Label><Input name="smtpUsername" defaultValue={clinic.smtp_username || ""} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">From Address</Label><Input name="smtpFrom" defaultValue={clinic.smtp_from || ""} className="h-9" /></div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Routing</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Billing Team Email</Label><Input name="billingEmail" defaultValue={clinic.billing_email || ""} className="h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Front Desk Email</Label><Input name="frontDeskEmail" defaultValue={clinic.front_desk_email || ""} className="h-9" /></div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
