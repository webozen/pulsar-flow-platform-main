import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateToken } from "@/lib/pulsar-auth";
import { AppShell } from "@/components/nav/app-shell";

export default async function ClinicsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("pulsar_jwt")?.value;
  if (!token) redirect("/login");

  try {
    const claims = validateToken(token);
    return <AppShell userName={claims.email}>{children}</AppShell>;
  } catch {
    redirect("/login");
  }
}
