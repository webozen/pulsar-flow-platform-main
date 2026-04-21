"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useEffect, useState } from "react";

const portalLinks = [
  { href: "", label: "Overview" },
  { href: "/executions", label: "Executions" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams();
  const pathname = usePathname();
  const base = `/portal/${slug}`;
  const [clinicName, setClinicName] = useState("");
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    // Verify clinic exists and user has access
    fetch("/api/clinics").then(async (res) => {
      if (res.ok) {
        const clinics = await res.json();
        const clinic = clinics.find((c: { slug: string; name: string }) => c.slug === slug);
        if (clinic) {
          setClinicName(clinic.name);
          setAuthorized(true);
        } else {
          setAuthorized(false);
        }
      } else {
        setAuthorized(false);
      }
    });
  }, [slug]);

  if (authorized === null) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (authorized === false) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Clinic Not Found</h1>
          <p className="text-muted-foreground">The clinic &quot;{slug}&quot; does not exist or you don&apos;t have access.</p>
          <Link href="/login" className="text-blue-600 hover:underline text-sm mt-4 block">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href={base} className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white text-sm font-bold">
                {clinicName.charAt(0).toUpperCase()}
              </div>
              <div>
                <span className="text-sm font-semibold">{clinicName}</span>
                <span className="text-xs text-muted-foreground ml-2">Portal</span>
              </div>
            </Link>
            <nav className="flex gap-1">
              {portalLinks.map((link) => {
                const href = `${base}${link.href}`;
                const active = link.href === "" ? pathname === base : pathname.startsWith(href);
                return (
                  <Link
                    key={link.href}
                    href={href}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active ? "bg-emerald-50 text-emerald-700" : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 bg-gray-50/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
