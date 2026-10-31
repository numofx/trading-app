import type { SpotMarket } from "@/lib/trading.types";

/**
 * The future's `future` block in `/v1/markets`, as markets-service serves it. Prices are decimal
 * strings in the series' own terms (cNGN per USDC on the v1 series, USDC per base on a v2 one);
 * times are unix seconds.
 */
export type FutureStatePresentation = {
  expiry_timestamp?: number;
  last_trade_time?: number;
  listed?: boolean;
  settled?: boolean;
  trading_open?: boolean;
  /** Why the venue is not matching the series, when `trading_open` is false. */
  trading_closed_reason?: string;
  mark_price?: string;
  index_price?: string;
  /** The fill band's half-width around the index, as a fraction: 0.1 is ±10%. */
  band_width?: string;
  band_status?: string;
  /** One contract's notional, USDC: the v1 series only. */
  contract_size_usdc?: string;
  /** One contract in `contract_size_asset`: a v2 series, quoted in USDC per that asset. */
  contract_size?: string;
  contract_size_asset?: string;
  updated_at?: string;
};

/**
 * How a series is quoted and sized. `usdc`: the v1 series (`USDC-cNGN-<DDMONYY>`), quoted in cNGN
 * per USDC, one contract a fixed 1,000 USDC, sized in USDC of notional, VM in cNGN; a long gains as
 * the naira weakens. `american`: a v2 series (`cNGN-30NOV26`, `EURC-30NOV26`), quoted in USDC per
 * base, one contract a fixed amount of the base, sized in the base, VM in USDC; a long is long the
 * base, and a contract's USDC value moves with the price.
 */
export type FutureTerms = "usdc" | "american";

/**
 * The future's live state, parsed. Prices are in the series' own terms (`priceUnit`), the way it
 * is quoted and shown.
 */
export type FutureState = {
  terms: FutureTerms;
  /** The asset the series is a future on: cNGN on the v1 series and cNGN-30NOV26, EURC on EURC-30NOV26. */
  baseSymbol: string;
  /** What sizes count: USDC of notional on the v1 series, the base on a v2 one. */
  sizeSymbol: string;
  /** The price's unit as the ticket names it: "cNGN per USDC", "USDC per EURC". */
  priceUnit: string;
  /** Decimals a price is shown and typed to: 2 on the v1 series, 8 on cNGN-30NOV26, 5 on EURC-30NOV26. */
  priceDecimals: number;
  /** The book's price groupings, the default first. */
  priceGroups: readonly number[];
  /** What variation margin is paid in: cNGN on the v1 series, USDC on a v2 one. */
  vmSymbol: string;
  markPrice: number | null;
  indexPrice: number | null;
  /** Settlement time, epoch ms. Also the series' sub id, in seconds. */
  expiryMs: number;
  /** After this, epoch ms, the venue takes no new orders on the series. */
  lastTradeAtMs: number;
  listed: boolean;
  settled: boolean;
  /** Whether the venue is matching the series now. */
  tradingOpen: boolean;
  tradingClosedReason: string | null;
  /** The band of prices a fill may carry, cNGN per USDC; null while the venue cannot read it. */
  fillBand: { low: number; high: number } | null;
  /** The band's half-width around the index as a fraction (0.1 is ±10%); null when unserved. */
  bandWidth: number | null;
  /** One contract, in `sizeSymbol`: 1,000 USDC on the v1 series, 1,000,000 cNGN, 1,000 EURC. */
  contractSize: number;
  /**
   * The venue's size unit, in `sizeSymbol`: 0.001 contract (`amount_scale` 1e15), so 1 USDC on the
   * v1 series, 1,000 cNGN, 1 EURC; a whole contract on a venue naming no scale. Every amount the
   * venue serves for the series (book, trades, orders, volume) counts these units.
   */
  unitSize: number;
  /** One unit as the signed on-chain amount, the ledger counting 1e18 a contract. */
  amountScale: bigint;
};

/** Where an order for the series is signed and its margin account lives. Checksummed. */
export type FutureStack = {
  assetAddress: `0x${string}`;
  /** The series id: the expiry, in unix seconds. */
  subId: string;
  tradeModuleAddress: `0x${string}`;
  /** The USDC CashAsset the engine settles fees, PnL and variation margin shortfalls in. */
  cashAddress: `0x${string}`;
  /** The MarginEngine: the only manager whose accounts may hold the future. */
  managerAddress: `0x${string}`;
};

/** The live future: spot's book, trades and candles shape, plus its state and stack. */
export type FutureMarket = SpotMarket & {
  symbol: string;
  state: FutureState;
  stack: FutureStack;
  /** 24h volume in the venue's units (`unitSize` each), as it reports `stats_24h.volume`. */
  volumeUnits24h: number | null;
};

/**
 * The account's standing under the MarginEngine, read from chain. USD figures are 18-decimal
 * ledger values turned into numbers; the position and cash keep their exact units too, for what
 * a close or a withdrawal must match.
 */
export type FutureAccount = {
  /** Signed contracts in the series: positive long. */
  positionUnits: bigint;
  /** USDC cash on the account. */
  cash: number;
  cashUnits: bigint;
  /** cNGN escrow held as collateral. */
  cngn: number;
  cngnUnits: bigint;
  /** Variation margin accrued and not yet settled to the account, in the series' `vmSymbol`: positive owed to it. */
  pendingVm: number;
  /** `getMargin(account, true)`: what is left above initial margin, USDC. Negative is under. */
  initialMarginSurplus: number;
  /** `getMargin(account, false)`: what is left above maintenance margin, USDC. */
  maintenanceMarginSurplus: number;
  /** The engine's futures requirements for the series' market, as fractions of notional. */
  imRate: number;
  mmRate: number;
};

export type FutureSide = "long" | "short";
