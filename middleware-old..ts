import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const isAdmin = req.nextUrl.pathname.startsWith("/admin")

  const hasSession = req.cookies
  .getAll()
  .some((cookie) => cookie.name.includes("auth-token"))

   {if (isAdmin && !hasSession)
    return NextResponse.redirect(new URL("/login", req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/admin/:path*"],
}