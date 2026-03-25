import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const adminOnlyPrefixes = ["/stock", "/orders", "/customers", "/conversations", "/settings", "/schema", "/audit", "/admin"];

function normalizeHost(rawHost: string | null) {
  return (rawHost ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function isAdminHostname(hostname: string) {
  if (!hostname) return true;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("admin.");
}

export function middleware(request: NextRequest) {
  const hostname = normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  const pathname = request.nextUrl.pathname;

  if (isAdminHostname(hostname)) {
    return NextResponse.next();
  }

  const isAdminPath = adminOnlyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isAdminPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
