import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateToken } from "@/lib/pulsar-auth";

export const dynamic = "force-dynamic";

/**
 * Tenant-scoped landing for the Workflows nav tab. The actual workflows
 * UI is the slug-keyed page at `/clinics/<slug>/workflows` (kept under
 * `[id]` for legacy URL compatibility — Plan B made `[id]` the slug).
 * This page just resolves the slug from the JWT and forwards there.
 */
export default async function WorkflowsLandingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("pulsar_jwt")?.value;
  if (!token) redirect("/login");

  let slug: string;
  try {
    ({ slug } = validateToken(token));
  } catch {
    redirect("/login");
  }
  redirect(`/clinics/${slug}/workflows`);
}
