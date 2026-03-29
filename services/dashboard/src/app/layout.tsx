import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'IntraBase',
  description: 'Internal database platform',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-white antialiased">
        {children}
      </body>
    </html>
  )
}
