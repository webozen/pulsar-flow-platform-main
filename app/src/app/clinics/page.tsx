import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateToken } from '@/lib/pulsar-auth'
import { getOrCreateClinic } from '@/lib/clinic-context'

export const dynamic = 'force-dynamic'

export default async function ClinicsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('pulsar_jwt')?.value
  if (!token) redirect('/login')

  try {
    const { slug } = validateToken(token)
    const clinic = await getOrCreateClinic(slug)
    redirect(`/clinics/${clinic.id}/workflows`)
  } catch {
    redirect('/login')
  }
}
