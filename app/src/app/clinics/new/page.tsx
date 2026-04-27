import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateToken } from '@/lib/pulsar-auth'

export const dynamic = 'force-dynamic'

/**
 * Plan B: tenant creation lives in pulsar-backend's admin UI, not here.
 * The flow-platform's `/clinics/new` route used to redirect to a Plan A
 * "set your secrets" settings page that has been removed. Send users
 * straight to their workflows view; if they need to manage per-tenant
 * secrets, that happens via the Pulsar admin portal or Kestra KV.
 */
export default async function NewClinicPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('pulsar_jwt')?.value
  if (!token) redirect('/login')

  try {
    const { slug } = validateToken(token)
    redirect(`/clinics/${slug}/workflows`)
  } catch {
    redirect('/login')
  }
}
