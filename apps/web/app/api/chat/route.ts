import { NextRequest, NextResponse } from "next/server"

const API_URL = process.env.ORION_API_URL
const API_KEY = process.env.ORION_API_KEY

export async function GET(request: NextRequest) {
  if (!API_URL || !API_KEY) {
    return NextResponse.json(
      { error: "ORION_API_URL or ORION_API_KEY is not set in .env.local" },
      { status: 500 }
    )
  }

  const q = request.nextUrl.searchParams.get("q")
  if (!q) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 })
  }

  const url = new URL("/chat/v1", API_URL)
  
  url.searchParams.set("q", q)

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  })

  const data = await response.json()
  
  return NextResponse.json(data.data, { status: response.status })
}
