import { NextResponse, type NextRequest } from "next/server";

import { constantTimeEqual, SESSION_COOKIE, sha256Hex } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/ingest") ||
    pathname.startsWith("/api/gateway")
  ) {
    return NextResponse.next();
  }

  const adminKey = process.env.ADMIN_KEY;
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const expected = adminKey ? await sha256Hex(adminKey) : null;

  if (expected && session && constantTimeEqual(session, expected)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
