import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateToken } from '@/lib/pulsar-auth'
import { getOrCreateClinic } from '@/lib/clinic-context'

export const dynamic = 'force-dynamic'

export default async function ClinicsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('pulsar_jwt')?.value
  if (!token) redirect('/login')

  let clinicId: string
  try {
    const { slug } = validateToken(token)
    const clinic = await getOrCreateClinic(slug)
    clinicId = clinic.id
  } catch {
    redirect('/login')
  }
  // Must live OUTSIDE the try/catch. Next's `redirect()` is implemented by
  // throwing a NEXT_REDIRECT sentinel error; the surrounding catch would
  // swallow it and send the user to /login on every successful hit.
  redirect(`/clinics/${clinicId}/workflows`)
}
