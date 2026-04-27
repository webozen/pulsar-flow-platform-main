"use client";

import { useEffect, useState } from "react";

export interface Branding {
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  domain: string;
  source: "domain" | "tenant";
  copy?: Record<string, string>;
}

/**
 * Tenant branding fetcher mirrored from `pulsar-frontend/src/lib/branding.ts`.
 *
 * Endpoint lives on Pulsar's frontend host (`/api/tenant/branding`,
 * proxied to the Spring backend) — NOT under flow-platform's
 * `/automation` basePath. So we use a raw `fetch()` with the
 * `pulsar_jwt` cookie travelling automatically. Same result as the
 * Vite-side hook: appName, logoUrl, primary/accent colors.
 */
export function useBranding(): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tenant/branding", { credentials: "include" });
        if (!res.ok) return;
        const b = (await res.json()) as Branding;
        if (cancelled) return;
        setBranding(b);
        document.title = b.appName;
        const root = document.documentElement;
        root.style.setProperty("--pulsar-primary", b.primaryColor);
        root.style.setProperty("--pulsar-accent", b.accentColor);
      } catch {
        // Branding is best-effort; fall back to default styles.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return branding;
}
