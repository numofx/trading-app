import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { findFutureBySymbol } from "@/lib/market-pickers";
import { resolveMarketSlug } from "@/lib/market-routes";
import { getMarketsServiceMarkets } from "@/lib/markets-service";

/**
 * Whether the venue lists the future series `symbol`. A venue it cannot read is given the benefit
 * of the doubt: the page then renders the series' not-live state rather than a 404 for a market
 * that may well exist.
 */
async function isListedFuture(symbol: string) {
  try {
    return findFutureBySymbol(await getMarketsServiceMarkets(), symbol) !== null;
  } catch {
    return true;
  }
}

/**
 * Answers for the slug before anything streams: a future slug is a 404 unless the venue lists
 * that series. The page below sits behind `loading.tsx`, so the
 * shell and its skeleton are flushed before the page runs, and a `notFound()` or `redirect()`
 * thrown there arrives after the headers as a 200 with a meta refresh. A layout renders ahead of
 * that boundary, so an unknown slug is a real 404 here.
 *
 * Stateless on purpose: a layout inside a dynamic segment remounts with the slug, which is why
 * the shell lives one level up in `trade/layout.tsx`.
 *
 * Another casing of a known slug is redirected by `proxy.ts`, which sees the query string a
 * layout cannot; this redirect is the fallback for a request the proxy did not match.
 */
export default async function MarketLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const resolved = resolveMarketSlug(market);
  if (resolved === null) {
    notFound();
  }
  if ("redirect" in resolved) {
    redirect(resolved.redirect as Route);
  }
  if (resolved.id === "future" && !(await isListedFuture(resolved.symbol))) {
    notFound();
  }
  return children;
}
