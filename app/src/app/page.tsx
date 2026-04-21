import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { validateToken } from '@/lib/pulsar-auth'
import { getOrCreateClinic } from '@/lib/clinic-context'

export default async function HomePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('pulsar_jwt')?.value
  if (!token) redirect('/login')

  let slug: string
  try {
    slug = validateToken(token).slug
  } catch {
    redirect('/login')
  }

  let clinic
  try {
    clinic = await getOrCreateClinic(slug)
  } catch (e) {
    if (isRedirectError(e)) throw e
    console.error('[HomePage] getOrCreateClinic failed:', e)
    redirect('/login')
  }

  redirect(`/clinics/${clinic.id}/workflows`)
}
