import { NextResponse, type NextRequest } from "next/server";

/**
 * Gate for /admin.
 *
 * This only checks that a session cookie is PRESENT — it does not verify the
 * signature, because middleware runs on the edge runtime where the crypto
 * used to sign it is awkward. Real verification happens in
 * `requireStaff()` inside every page and action, which is where it belongs:
 * middleware is a convenience redirect, not the security boundary.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const hasCookie = request.cookies.has("gootee_staff");
    if (!hasCookie) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
