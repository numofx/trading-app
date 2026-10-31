import type { FutureQuoting } from "@/lib/future-market";
/** The spot markets: `spot` is cNGN-USDC (shown USDC-cNGN), `eurc` is EURC-USDC. */
export type SpotMarketId = "spot" | "eurc";

/** Which market's panels render under the shell; each has its own slug under `/trade`. */
export type TerminalMarketId = SpotMarketId | "perp" | "future";

/** The selector's tabs: one per kind of market, the dated future under Futures. */
export type TerminalMarketKind = "spot" | "perp" | "futures";

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
 * figures are null on spot rows, the future's on the others.
 */
export type MarketOverviewRow = {
  id: TerminalMarketId;
  /**
   * The book's mid, else its one resting side, else the last trade (the perp's or future's mark
   * last). cNGN per USDC on USDC-cNGN spot and the v1 future, USDC per EURC on EURC-USDC, USDC per
   * base on a v2 future, USDC per cNGN on the perp.
   */
  price: number | null;
  changePercent24h: number | null;
  /** USDC notional traded in the window. */
  volume24hUsd: number | null;
  openInterestUsd: number | null;
  /** Hourly funding as the venue's long sees it: positive means longs pay. */
  fundingRate1h: number | null;
  /** The future's expiry, epoch ms: when the series settles. */
  expiryMs: number | null;
  /** The future's last trade time, epoch ms: after it the venue takes no new orders. */
  lastTradeAtMs: number | null;
  /** The future series' venue symbol (`cNGN-30NOV26`); null on spot and the perp. */
  symbol: string | null;
  /** The future's mark and index, in the series' terms, as the venue serves them. */
  markPrice: number | null;
  indexPrice: number | null;
  /** Whether the future series has settled; null on spot and the perp. */
  settled: boolean | null;
  /** How the future's next mark is set, from its book's depth; null on spot and the perp. */
  markSource: "book" | "carry" | null;
  /** How the future series is quoted (its terms, base, price unit and decimals); null on spot and the perp. */
  futureQuoting: FutureQuoting | null;
};

export type MarketOverviewResponse = {
  /**
   * USDC-cNGN spot, the perp and the front-month future, one row each, and EURC-USDC when the
   * venue lists it.
   */
  rows: MarketOverviewRow[];
  /** Every future series the venue lists and has not expired, nearest expiry first. */
  futures?: MarketOverviewRow[];
};
