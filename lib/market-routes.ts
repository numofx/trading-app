import type { TerminalMarketId } from "@/lib/market-overview.types";

/**
 * The one trading route, `/trade/[market]`, and the slugs it answers to: one per market the
 * terminal offers, lowercase, so the URL reads the same however it was typed or shared. Both
 * markets render under one persistent shell (header, wallet, trading account, selector); only the
 * market's own panels change with the slug.
 *
 * `next.config.ts` redirects `/` to the default market, the perp, and `/perp` to the same; it cannot
 * import this file, so the two tables are pinned to each other by `lib/market-routes.test.mjs`.
 */
export const MARKET_SLUGS = {
  perp: "cngn-perp",
  spot: "cngn-usdc",
} as const satisfies Record<TerminalMarketId, string>;

export type MarketSlug = (typeof MARKET_SLUGS)[TerminalMarketId];

/** The URL of a market's terminal. */
export function marketPath(id: TerminalMarketId): `/trade/${MarketSlug}` {
  return `/trade/${MARKET_SLUGS[id]}`;
}

/**
 * What a `[market]` segment names. A slug in any other casing is `redirect`: the canonical URL to
 * send the request to, with its query string intact. Anything else is null, a 404.
 */
export function resolveMarketSlug(
  raw: string,
  search = ""
): { id: TerminalMarketId } | { redirect: string } | null {
  const lowered = raw.toLowerCase();
  const id = (Object.keys(MARKET_SLUGS) as TerminalMarketId[]).find(
    (candidate) => MARKET_SLUGS[candidate] === lowered
  );
  if (id === undefined) {
    return null;
  }
  return raw === lowered ? { id } : { redirect: `${marketPath(id)}${search}` };
}

/** The market a slug names, exactly as typed, or null: the selector's segment reader. */
export function marketIdForSlug(slug: string | null): TerminalMarketId | null {
  if (slug === null) {
    return null;
  }
  const resolved = resolveMarketSlug(slug);
  return resolved !== null && "id" in resolved ? resolved.id : null;
}
