import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

// Generic proxy — forwards all /api/* requests to the API service,
// passing cookies and response headers back to the browser.
async function proxy(req: NextRequest, method: string): Promise<NextResponse> {
  const url = req.nextUrl
  // Reconstruct the target path: /api/rest/employees?limit=10 → http://api:3001/api/rest/employees?limit=10
  const target = `${API_URL}${url.pathname}${url.search}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const cookieHeader = req.headers.get('cookie')
  if (cookieHeader) headers['cookie'] = cookieHeader

  const fetchOptions: RequestInit = { method, headers }
  if (!['GET', 'HEAD'].includes(method)) {
    const body = await req.text()
    if (body) fetchOptions.body = body
  }

  const res = await fetch(target, fetchOptions)

  // Read body as text to preserve as-is
  const responseBody = await res.text()

  const response = new NextResponse(responseBody, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  })

  // Forward Set-Cookie and Content-Range headers
  for (const c of res.headers.getSetCookie?.() ?? []) {
    response.headers.append('set-cookie', c)
  }
  const contentRange = res.headers.get('content-range')
  if (contentRange) response.headers.set('content-range', contentRange)

  return response
}

export const GET     = (req: NextRequest) => proxy(req, 'GET')
export const POST    = (req: NextRequest) => proxy(req, 'POST')
export const PATCH   = (req: NextRequest) => proxy(req, 'PATCH')
export const DELETE  = (req: NextRequest) => proxy(req, 'DELETE')
