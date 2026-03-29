import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

// Next.js route handler — proxies dev-login server-to-server
// and correctly forwards Set-Cookie headers to the browser.
// Only works in development.
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const body = await req.json()

  const apiRes = await fetch(`${API_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await apiRes.json()

  if (!apiRes.ok) {
    return NextResponse.json(data, { status: apiRes.status })
  }

  const response = NextResponse.json(data)

  // Forward every Set-Cookie header from the API response to the browser
  const setCookieHeaders = apiRes.headers.getSetCookie?.() ?? []
  for (const cookie of setCookieHeaders) {
    response.headers.append('set-cookie', cookie)
  }

  return response
}
