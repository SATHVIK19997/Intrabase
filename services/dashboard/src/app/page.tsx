import { redirect } from 'next/navigation'

// Root page — middleware handles auth redirect, this is a fallback
export default function RootPage() {
  redirect('/dashboard')
}
