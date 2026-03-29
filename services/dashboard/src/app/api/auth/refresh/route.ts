import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

export async function POST(req: NextRequest) {
  const cookie = req.headers.get('cookie') ?? ''
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { cookie },
  })
  const data = await res.json()
  const response = NextResponse.json(data, { status: res.status })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    response.headers.append('set-cookie', c)
  }
  return response
}
