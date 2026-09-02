import { NextResponse } from "next/server";

/**
 * The document must not outlive the deploy that produced it.
 *
 * The prerendered page goes out with `s-maxage=31536000` — a year, to any
 * shared cache that honours it. That page names content-hashed script chunks,
 * so a cache that keeps the document keeps the whole application frozen at the
 * version it first saw: every deploy after that is invisible to whoever holds
 * it, and the site looks unchanged while the new code sits on the server. The
 * chunks are immutable and stay so; only the document pointing at them has to
 * be checked on each visit, which costs one conditional request.
 */
export function middleware() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return response;
}

export const config = {
  /*
   * Documents only.
   *
   * The hashed assets are immutable by construction, and every API route
   * chooses its own `s-maxage` deliberately — a normalized company is four
   * megabytes and the hour of edge cache on `/api/company/:ticker` is what
   * keeps the Worker from rebuilding one on every visit. A blanket rule here
   * overwrote all of them with `max-age=0`, which is how a cache-control fix
   * turns into a CPU-limit outage.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.svg|og.png).*)"],
};
