import type { SpotMarket } from "@/lib/trading.types";

/**
 * USDCcNGN-PERP's live state from markets-service `/v1/markets` (`perp`), parsed. Prices are the
 * venue's orientation, NGN per USD; the on-chain engine is USD per NGN.
 */
export type PerpState = {
  markPrice: number;
  indexPrice: number;
  /**
   * Hourly funding as the venue's LONG sees it: positive means UI longs pay. The chain's own rate is
   * paid by NGN-perp longs, who are the venue's shorts, so this is its negation.
   */
  uiLongFundingRate1h: number;
  fundingIntervalSeconds: number;
  openInterestUsd: number;
  initialMarginRate: number;
  maintenanceMarginRate: number;
  /** 1 / initial margin rate: the most leverage the SRM will open. */
  maxLeverage: number;
  /**
   * Whether the venue accepts perp orders: the trade module is allowed on Matching and the position
   * cap is above zero. The stack deploys closed, so this is false until the launch vault action.
   */
  tradingEnabled: boolean;
};

/** Where perp orders are signed for and margin is deposited. Checksummed by the caller. */
export type PerpStack = {
  assetAddress: `0x${string}`;
  tradeModuleAddress: `0x${string}`;
  cashAddress: `0x${string}`;
  srmAddress: `0x${string}`;
};

/** A live perp market: spot's book/trades/candles shape, plus its chain state and stack. */
export type PerpMarket = SpotMarket & {
  symbol: string;
  state: PerpState;
  stack: PerpStack;
};

/** One position from `/v1/positions`, in the venue's orientation. */
export type PerpPosition = {
  uiSide: "long" | "short";
  /** USD notional at the index. */
  uiSize: number;
  markPrice: number;
  unrealizedPnl: number;
  initialMarginSurplus: number;
  maintenanceMarginSurplus: number;
  liquidationPrice: number | null;
};

/** The account's margin on the perp stack, whether or not it holds a position. */
export type PerpAccountMargin = {
  cash: number;
  initialMarginSurplus: number;
  maintenanceMarginSurplus: number;
};
