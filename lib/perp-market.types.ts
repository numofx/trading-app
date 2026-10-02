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

/**
 * Hedge mode: what the ticket shows for an account margined in cNGN. Such an account is a synthetic
 * dollar — the venue only lets it be long USD, and no more of it than the cNGN it posted — so the
 * ticket shows the dollar value that collateral locks, how much of it the account has already
 * hedged, and what the hedge costs in funding at the current rate.
 */
export type PerpHedge = {
  /** The cNGN posted, whole units. */
  collateralCngn: number;
  /** Its value at the index: the most long-USD notional the account may hold. */
  lockedUsd: number;
  /** Long-USD notional held now (0 when flat or, abnormally, long naira). */
  hedgedUsd: number;
  /** The same, in the engine's cNGN contracts: what the venue's 1:1 bound counts. */
  hedgedCngn: number;
  /**
   * cNGN contracts the account may still go long USD with: collateral less hedged, never negative.
   * The venue's bound is in contracts, so a ticket converts this at its own price, not the index.
   */
  roomCngn: number;
  /** `roomCngn` at the index, for display. */
  roomUsd: number;
  /** Funding on the whole locked value at the current rate: positive means the hedge pays. */
  fundingPerDayUsd: number;
  fundingPerMonthUsd: number;
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
