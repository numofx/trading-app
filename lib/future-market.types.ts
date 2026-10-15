import type { SpotMarket } from "@/lib/trading.types";

/**
 * The future's `future` block in `/v1/markets`, as markets-service serves it. Prices are decimal
 * strings in cNGN per USDC; times are unix seconds.
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
  contract_size_usdc?: string;
  updated_at?: string;
};

/**
 * The future's live state, parsed. Prices are cNGN per USDC, the way the series is quoted and
 * shown: a long gains when the naira weakens (more cNGN per USDC).
 */
export type FutureState = {
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
  /** One contract's notional, USDC. */
  contractSizeUsdc: number;
  /**
   * The venue's size unit, as USDC of notional: 1 since the venue sized the future in USDC
   * (`amount_scale` 1e15, 0.001 contract), a whole contract before. Every amount the venue serves
   * for the series (book, trades, orders, volume) counts these units.
   */
  unitUsdc: number;
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
  /** 24h volume in the venue's units (`unitUsdc` each), as it reports `stats_24h.volume`. */
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
  /** Variation margin accrued and not yet settled to the account, cNGN: positive owed to it. */
  pendingVmCngn: number;
  /** `getMargin(account, true)`: what is left above initial margin, USDC. Negative is under. */
  initialMarginSurplus: number;
  /** `getMargin(account, false)`: what is left above maintenance margin, USDC. */
  maintenanceMarginSurplus: number;
  /** The engine's futures requirements, as fractions of notional: 0.25 and 0.15 at listing. */
  imRate: number;
  mmRate: number;
};

export type FutureSide = "long" | "short";
