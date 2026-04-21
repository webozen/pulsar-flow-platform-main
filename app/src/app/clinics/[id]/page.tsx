import { redirect } from "next/navigation";

// Clicking a clinic goes straight to the automation center
export default async function ClinicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clinics/${id}/workflows`);
}
