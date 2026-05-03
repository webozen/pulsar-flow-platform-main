import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

// Inter matches `pulsar-frontend/apps/web/src/index.css` (which uses
// 'Inter' as the body font). Both apps share the same wordmark + body
// type so the Automation chrome reads as one product with the Pulsar
// React shell. The legacy variable name `--font-geist-sans` is kept so
// the @theme bindings in globals.css don't need to be rewritten — only
// the loaded face changes.
const inter = Inter({ variable: '--font-geist-sans', subsets: ['latin'] })
const mono = JetBrains_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Pulsar Flow - Dental Practice Automation',
  description: 'Workflow automation for dental practices powered by Kestra',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {/* Single Sonner mount for the whole app — replaces the
            hand-rolled ToastStack. `toast()` calls from any client
            component now feed into this. Top-right placement,
            swipe-to-dismiss, brand-themed via CSS vars. */}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  )
}
