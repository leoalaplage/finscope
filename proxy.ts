import { NextResponse } from "next/server";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Document policy only. API routes keep their deliberately longer data caches
 * and content-hashed assets remain immutable. Browsers revalidate HTML while
 * the edge may reuse it briefly, so deploys propagate without turning every
 * visit into a fresh Worker render.
 */
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=60");
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.svg|og.png).*)"],
};
