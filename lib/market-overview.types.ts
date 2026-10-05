/** Which terminal a market renders in; each is its own route. */
export type TerminalMarketId = "spot" | "perp";

export type TerminalMarketKind = "spot" | "perp";

/** A market the selector offers: its route, display symbol and which tab it lists under. */
export type TerminalMarketEntry = {
  id: TerminalMarketId;
  href: string;
  kind: TerminalMarketKind;
  symbol: string;
};

/**
 * One row of the market selector, from the venue's own figures. Every number is null when the
 * venue did not serve it, and the row renders a dash there rather than a guess. The perp-only
 * figures are null on spot rows.
 */
export type MarketOverviewRow = {
  id: TerminalMarketId;
  /** cNGN per USDC: the book's mid, else its one resting side, else the last trade (the perp's mark last). */
  price: number | null;
  changePercent24h: number | null;
  /** USDC notional traded in the window. */
  volume24hUsd: number | null;
  openInterestUsd: number | null;
  /** Hourly funding as the venue's long sees it: positive means longs pay. */
  fundingRate1h: number | null;
};

export type MarketOverviewResponse = {
  rows: MarketOverviewRow[];
};
