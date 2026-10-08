import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveMarketSlug } from "@/lib/market-routes";

/**
 * `/trade/<slug>` in any casing but the lowercase one is sent to the lowercase URL, query string
 * and all, as a real 307. Only a proxy can do that: the page streams behind its loading boundary,
 * so a redirect thrown there lands after the headers as a 200 with a meta refresh, and a layout
 * never sees the query string. An unknown slug passes through to the segment's layout, which
 * answers it with a 404.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const slug = pathname.split("/")[2] ?? "";
  const resolved = resolveMarketSlug(slug, search);
  if (resolved !== null && "redirect" in resolved) {
    return NextResponse.redirect(new URL(resolved.redirect, request.url), 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/trade/:market",
};
