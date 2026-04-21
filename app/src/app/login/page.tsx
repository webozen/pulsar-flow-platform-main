'use client'

import { useEffect } from 'react'

export default function LoginPage() {
  useEffect(() => {
    const pulsarUrl = process.env.NEXT_PUBLIC_PULSAR_APP_URL || 'http://localhost:5173'
    window.location.href = pulsarUrl
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mx-auto mb-4" />
        <p className="text-sm text-gray-500">Redirecting to Pulsar…</p>
      </div>
    </div>
  )
}
