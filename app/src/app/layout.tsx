import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Pulsar Flow - Dental Practice Automation',
  description: 'Workflow automation for dental practices powered by Kestra',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
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
