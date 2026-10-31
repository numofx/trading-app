import type { SpotMarketId } from "@/lib/market-overview.types";

/** The tokens spot trades against USDC: the engine's base of each pair. */
export type SpotBase = "cNGN" | "EURC";

/**
 * One spot market as the terminal shows it. The venue and the engine trade every spot pair with
 * USDC as the quote: the base is priced in USDC per base, sized in whole base, and an engine buy is
 * a buy of the base. `inverted` is whether the trader sees it the other way up.
 */
export type SpotPair = {
  id: SpotMarketId;
  /** The venue's symbol: what `/v1/markets`, the stream and the history rows call it. */
  symbol: "cNGN-USDC" | "EURC-USDC";
  /** The engine's base: what an order is signed and rests in, in whole units. */
  base: SpotBase;
  /**
   * Shown the other way up from the engine: USDC is what the trader buys and sells, priced in the
   * base. `lib/spot-orientation.ts` turns the venue's data over; orders are still signed as the
   * engine takes them.
   */
  inverted: boolean;
  /** What a buy acquires and a price is per. */
  displayBase: "USDC" | SpotBase;
  /** What a price is counted in. */
  displayQuote: "USDC" | SpotBase;
  /** The most decimals a displayed price takes. */
  priceDecimals: number;
  /** The ladder's groupings, finest first, in displayed prices. */
  priceGroups: readonly number[];
  /** Put before a header price: $ on a pair quoted in USDC. */
  pricePrefix: string;
  /** `market_id` on analytics events. */
  analyticsId: string;
  /** The order_id's prefix, so the book and history can tell the markets apart at a glance. */
  orderIdPrefix: string;
};

/**
 * The spot markets, both shown as they trade. cNGN-USDC is quoted in USDC per cNGN to eight
 * decimals, like cNGN-30NOV26, and sized in whole cNGN (shown USDC-cNGN, inverted, from 2026-10-14
 * to 2026-10-31). EURC-USDC is quoted in USDC per EURC to five decimals (markets-service's
 * `ui_price_decimals`), sized in EURC, with no `order_entry_spec` and no `spot_contract` echo, so
 * its book, orders and fills are read from the engine fields.
 */
export const SPOT_PAIRS = {
  eurc: {
    analyticsId: "eurc-usdc-spot",
    base: "EURC",
    displayBase: "EURC",
    displayQuote: "USDC",
    id: "eurc",
    inverted: false,
    orderIdPrefix: "eurc",
    priceDecimals: 5,
    priceGroups: [0.000_01, 0.0001, 0.001, 0.01],
    pricePrefix: "$",
    symbol: "EURC-USDC",
  },
  spot: {
    analyticsId: "cngn-usdc-spot",
    base: "cNGN",
    displayBase: "cNGN",
    displayQuote: "USDC",
    id: "spot",
    inverted: false,
    orderIdPrefix: "spot",
    priceDecimals: 8,
    priceGroups: [0.000_000_01, 0.000_000_1, 0.000_001],
    pricePrefix: "$",
    symbol: "cNGN-USDC",
  },
} as const satisfies Record<SpotMarketId, SpotPair>;

/** Whether a terminal market is one of the spot pairs. */
export function isSpotMarketId(id: string): id is SpotMarketId {
  return id in SPOT_PAIRS;
}
