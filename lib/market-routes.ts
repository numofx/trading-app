import type { TerminalMarketId } from "@/lib/market-overview.types";

/** The markets whose slug never changes; a future's slug names its series. */
export type FixedMarketId = Exclude<TerminalMarketId, "future">;

/**
 * The one trading route, `/trade/[market]`, and the slugs it answers to, lowercase, so the URL reads
 * the same however it was typed or shared. The spot markets and the perp have fixed slugs. A future's slug is
 * its venue symbol lowercased (`USDC-cNGN-30NOV26` → `usdc-cngn-30nov26`), so a new series is a new
 * URL with no code change; whether that series is listed is the segment layout's question, asked
 * of the venue. Every market renders under one persistent shell (header, wallet, trading account,
 * selector); only the market's own panels change with the slug.
 *
 * `/` opens the front-month future, chosen per request by `app/route.ts`. `next.config.ts`
 * redirects `/perp` to the perp, which is winding down and reachable only by URL; it cannot import
 * this file, so `lib/market-routes.test.mjs` pins the two together.
 */
export const MARKET_SLUGS = {
  eurc: "eurc-usdc",
  perp: "cngn-perp",
  spot: "cngn-usdc",
} as const satisfies Record<FixedMarketId, string>;

export type MarketSlug = (typeof MARKET_SLUGS)[FixedMarketId];

/** `usdc-cngn-<DDMONYY>`: the venue lists each future as `USDC-cNGN-<DDMONYY>`. */
const FUTURE_SLUG_PATTERN = /^usdc-cngn-(\d{2}[a-z]{3}\d{2})$/;

/** The URL of a spot market's or the perp's terminal. */
export function marketPath(id: FixedMarketId): `/trade/${MarketSlug}` {
  return `/trade/${MARKET_SLUGS[id]}`;
}

/** The URL of a future series' terminal, from its venue symbol. */
export function futurePath(symbol: string): `/trade/${string}` {
  return `/trade/${symbol.toLowerCase()}`;
}

/** The venue symbol a future slug names: `usdc-cngn-30nov26` → `USDC-cNGN-30NOV26`; null for anything else. */
export function futureSymbolForSlug(slug: string): string | null {
  const series = FUTURE_SLUG_PATTERN.exec(slug)?.[1];
  return series === undefined ? null : `USDC-cNGN-${series.toUpperCase()}`;
}

/** What a canonical slug names: a spot market or the perp, or a future series by its venue symbol. */
export type ResolvedMarket = { id: FixedMarketId } | { id: "future"; symbol: string };

/**
 * What a `[market]` segment names. A slug in any other casing is `redirect`: the canonical URL to
 * send the request to, with its query string intact. Anything else is null, a 404. A future slug
 * resolves by its shape alone; the layout checks the venue lists it.
 */
export function resolveMarketSlug(
  raw: string,
  search = ""
): ResolvedMarket | { redirect: string } | null {
  const lowered = raw.toLowerCase();
  const id = (Object.keys(MARKET_SLUGS) as FixedMarketId[]).find(
    (candidate) => MARKET_SLUGS[candidate] === lowered
  );
  const futureSymbol = futureSymbolForSlug(lowered);
  if (id === undefined && futureSymbol === null) {
    return null;
  }
  if (raw !== lowered) {
    return { redirect: `/trade/${lowered}${search}` };
  }
  return id === undefined ? { id: "future", symbol: futureSymbol as string } : { id };
}

/** The market a slug names, exactly as typed, or null: the shell's segment reader. */
export function resolveSegment(slug: string | null): ResolvedMarket | null {
  if (slug === null) {
    return null;
  }
  const resolved = resolveMarketSlug(slug);
  return resolved !== null && "id" in resolved ? resolved : null;
}

/** Which market a slug names, exactly as typed, or null. */
export function marketIdForSlug(slug: string | null): TerminalMarketId | null {
  return resolveSegment(slug)?.id ?? null;
}
