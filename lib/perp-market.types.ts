import type { SpotMarket } from "@/lib/trading.types";

/**
 * USDCcNGN-PERP's live state from markets-service `/v1/markets` (`perp`), parsed. Prices are the
 * venue's orientation, cNGN per USDC; the on-chain engine is USDC per cNGN.
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
   * Also false while `paused` holds.
   */
  tradingEnabled: boolean;
  /** The SRM guardian's pause: trades, deposits, withdrawals and liquidation bids all revert. */
  paused: boolean;
};

/**
 * A base asset the perp SRM credits as margin besides cash: today at most cNGN, through the perp
 * stack's own escrow. `marginFactor` is the share of its index value that counts as maintenance
 * margin (`imScale` multiplies in again for initial margin); `cap` and `total` are the escrow's
 * collateral cap and what is posted now, in whole units.
 */
export type PerpCollateralAsset = {
  symbol: string;
  escrow: `0x${string}`;
  marginFactor: number;
  imScale: number;
  cap: number;
  total: number;
};

/** Where perp orders are signed for and margin is deposited. Checksummed by the caller. */
export type PerpStack = {
  assetAddress: `0x${string}`;
  tradeModuleAddress: `0x${string}`;
  cashAddress: `0x${string}`;
  srmAddress: `0x${string}`;
  /** Empty while margin is cash only. */
  collateralAssets: PerpCollateralAsset[];
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
  /**
   * The position as the engine holds it: whole cNGN contracts, unsigned. What a close must trade to
   * reach exactly zero; the USD figure above moves with the index and cannot. Null from a
   * markets-service that does not report `engine_position`, which hides Close.
   */
  engineSize: bigint | null;
  markPrice: number;
  unrealizedPnl: number;
  initialMarginSurplus: number;
  maintenanceMarginSurplus: number;
  liquidationPrice: number | null;
};

/** One collateral asset the account holds, valued at the index, and what the SRM credits of it. */
export type PerpCollateralBalance = {
  symbol: string;
  escrow: `0x${string}`;
  /** Whole units of the asset. */
  balance: number;
  /** The same balance as the ledger holds it, 18 decimals: what a withdrawal is checked against. */
  balanceUnits: bigint;
  valueUsd: number;
  marginValueUsd: number;
};

/** The account's margin on the perp stack, whether or not it holds a position. */
export type PerpAccountMargin = {
  cash: number;
  /** The same cash as the ledger holds it, 18 decimals: what a withdrawal is checked against. */
  cashUnits: bigint;
  initialMarginSurplus: number;
  maintenanceMarginSurplus: number;
  /** Collateral besides cash; empty when none is held or none is accepted. */
  collateral: PerpCollateralBalance[];
};
