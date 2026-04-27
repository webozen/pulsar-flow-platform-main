import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateToken } from '@/lib/pulsar-auth'

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

  // Plan B: route directly by slug. The legacy `/clinics/[id]/workflows`
  // tree was UUID-keyed against flowcore.clinics; under Plan B `[id]` is
  // the slug itself and no DB row is created.
  redirect(`/clinics/${slug}/workflows`)
}
