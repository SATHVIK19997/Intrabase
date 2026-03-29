import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get('ib_access_token')?.value

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  // Unauthenticated user hitting a protected route → /login
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Authenticated user hitting /login → /dashboard
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  // Run middleware on all routes except static files and Next internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
