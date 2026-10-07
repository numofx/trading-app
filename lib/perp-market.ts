import { getAddress, isAddress, parseUnits } from "viem";
import { formatDollarPrice, formatPrice, PRICE_DECIMALS } from "@/lib/market-formatting";
import type {
  PerpAccountMargin,
  PerpCollateralAsset,
  PerpCollateralBalance,
  PerpHeaderMetric,
  PerpPosition,
  PerpStack,
  PerpState,
} from "@/lib/perp-market.types";
import { sideTone } from "@/lib/side-tone";
import { getMarketFill, SPOT_MARKET_SLIPPAGE } from "@/lib/spot-market";
import { getCngnTokenAddress, getUsdcTokenAddress } from "@/lib/subaccount-deposit-config";
import { formatCompactUsd } from "@/lib/ticker-stats";
import type {
  ActivityRow,
  ActivityView,
  CellBadge,
  CellTone,
  OrderBookLevel,
} from "@/lib/trading.types";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";

/** The `perp` object markets-service serves on `/v1/markets` for the perpetual. */
export type PerpStatePresentation = {
  mark_price_ui?: string;
  index_price_ui?: string;
  ui_long_funding_rate_1h?: string;
  funding_interval_seconds?: number;
  open_interest_usd?: string;
  initial_margin_rate?: string;
  maintenance_margin_rate?: string;
  max_leverage?: string;
  trading_enabled?: boolean;
  /** The SRM guardian's pause: every adjustment on the perp's accounts reverts while it holds. */
  paused?: boolean;
  trade_module_address?: string;
  quote_asset_address?: string;
  margin_manager_address?: string;
  /** Base assets the SRM credits as margin besides cash; absent or empty when margin is cash only. */
  collateral_assets?: PresentedCollateralAsset[];
};

type PresentedCollateralAsset = {
  symbol?: string;
  asset_address?: string;
  margin_factor?: string;
  im_scale?: string;
  cap?: string;
  total?: string;
  deposits_open?: boolean;
};

type PresentedCollateralBalance = {
  symbol?: string;
  asset_address?: string;
  balance?: string;
  value_usd?: string;
  margin_value_usd?: string;
};

const WHOLE_NUMBER_PATTERN = /^-?\d+$/;
const LEDGER_DECIMAL_PATTERN = /^-?\d+(\.\d{1,18})?$/;

/** A whole-number string as an unsigned bigint, or null. */
function wholeMagnitude(value: string | undefined): bigint | null {
  if (value === undefined || !WHOLE_NUMBER_PATTERN.test(value.trim())) {
    return null;
  }
  const parsed = BigInt(value.trim());
  return parsed < 0n ? -parsed : parsed;
}

/** A decimal string in ledger units (18 decimals), or null when it is not one. */
function ledgerUnits(value: string | undefined): bigint | null {
  if (value === undefined || !LEDGER_DECIMAL_PATTERN.test(value.trim())) {
    return null;
  }
  try {
    return parseUnits(value.trim(), 18);
  } catch {
    return null;
  }
}

function finite(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: string | undefined): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * The perp's chain state, or null when any part the terminal prices with is missing. Partial state
 * is not rendered: a mark without a margin rate would size a leverage slider against nothing.
 */
export function parsePerpState(perp: PerpStatePresentation | undefined): PerpState | null {
  if (!perp) {
    return null;
  }
  const markPrice = positive(perp.mark_price_ui);
  const indexPrice = positive(perp.index_price_ui);
  const initialMarginRate = positive(perp.initial_margin_rate);
  const maintenanceMarginRate = positive(perp.maintenance_margin_rate);
  const maxLeverage = positive(perp.max_leverage);
  const uiLongFundingRate1h = finite(perp.ui_long_funding_rate_1h);
  if (
    markPrice === null ||
    indexPrice === null ||
    initialMarginRate === null ||
    maintenanceMarginRate === null ||
    maxLeverage === null ||
    uiLongFundingRate1h === null
  ) {
    return null;
  }
  return {
    fundingIntervalSeconds: perp.funding_interval_seconds ?? 3600,
    indexPrice,
    initialMarginRate,
    maintenanceMarginRate,
    markPrice,
    maxLeverage,
    openInterestUsd: finite(perp.open_interest_usd) ?? 0,
    paused: perp.paused === true,
    // Absent reads as closed: an older markets-service that does not report it cannot vouch for it.
    tradingEnabled: perp.trading_enabled === true,
    uiLongFundingRate1h,
  };
}

/** The perp's stack addresses, or null unless every one is a real address. */
export function parsePerpStack(
  assetAddress: string | undefined,
  perp: PerpStatePresentation | undefined
): PerpStack | null {
  const candidates = [
    assetAddress,
    perp?.trade_module_address,
    perp?.quote_asset_address,
    perp?.margin_manager_address,
  ];
  if (!candidates.every((value): value is string => value !== undefined && isAddress(value))) {
    return null;
  }
  const [asset, module, cash, srm] = candidates.map((value) => getAddress(value));
  return {
    assetAddress: asset,
    cashAddress: cash,
    collateralAssets: parseCollateralAssets(perp?.collateral_assets),
    srmAddress: srm,
    tradeModuleAddress: module,
  };
}

/**
 * The collateral assets as the venue serves them, dropping any row the terminal could not deposit
 * to or value: a missing haircut would show a deposit as full margin it does not get.
 */
function parseCollateralAssets(
  rows: PresentedCollateralAsset[] | undefined
): PerpCollateralAsset[] {
  const assets: PerpCollateralAsset[] = [];
  for (const row of rows ?? []) {
    const marginFactor = finite(row.margin_factor);
    const imScale = finite(row.im_scale);
    const cap = finite(row.cap);
    const total = finite(row.total);
    if (
      row.symbol === undefined ||
      row.symbol === "" ||
      row.asset_address === undefined ||
      !isAddress(row.asset_address) ||
      marginFactor === null ||
      imScale === null ||
      cap === null ||
      total === null
    ) {
      continue;
    }
    assets.push({
      cap,
      // Absent means closed: an older venue that does not say cannot be offering deposits.
      depositsOpen: row.deposits_open === true,
      escrow: getAddress(row.asset_address),
      imScale,
      marginFactor,
      symbol: row.symbol,
      total,
    });
  }
  return assets;
}

function parseCollateralBalances(
  rows: PresentedCollateralBalance[] | undefined
): PerpCollateralBalance[] {
  const balances: PerpCollateralBalance[] = [];
  for (const row of rows ?? []) {
    const balance = finite(row.balance);
    const balanceUnits = ledgerUnits(row.balance);
    const valueUsd = finite(row.value_usd);
    const marginValueUsd = finite(row.margin_value_usd);
    if (
      row.symbol === undefined ||
      row.symbol === "" ||
      row.asset_address === undefined ||
      !isAddress(row.asset_address) ||
      balance === null ||
      balanceUnits === null ||
      valueUsd === null ||
      marginValueUsd === null
    ) {
      continue;
    }
    balances.push({
      balance,
      balanceUnits,
      escrow: getAddress(row.asset_address),
      marginValueUsd,
      symbol: row.symbol,
      valueUsd,
    });
  }
  return balances;
}

/** The venue's stable error token for an order refused while the guardian's pause holds. */
export const TRADING_PAUSED_ERROR = "trading_paused";

/** What the ticket shows while the perp is paused, in place of the venue's raw error. */
export const TRADING_PAUSED_MESSAGE =
  "Trading paused by the venue. Open positions stay as they are; orders resume when the pause lifts.";

/** A venue rejection, as the ticket should show it: the pause gets its own wording, the rest passes through. */
export function describeOrderRejection(error: string | null | undefined, fallback: string) {
  if (error?.startsWith(TRADING_PAUSED_ERROR)) {
    return TRADING_PAUSED_MESSAGE;
  }
  return error ?? fallback;
}

/** The most leverage the ticket offers: the SRM's ceiling, whole numbers only, never below 1. */
export function getLeverageCeiling(state: PerpState | null): number {
  if (state === null) {
    return 1;
  }
  return Math.max(1, Math.floor(state.maxLeverage + 1e-9));
}

/**
 * Where a new position would be liquidated, for an account that holds only this position and
 * `margin` of cash, in USDC per cNGN: the orientation shown, which is the engine's own, where
 * maintenance surplus is linear in price:
 *
 *   surplus(p) = C + S·(p − p0) − |S|·mm·p
 *
 * with S the signed cNGN position (positive for a long). Null when no positive price gets there:
 * a long at 1x never does, since its equity (S·p) always exceeds the requirement (mm·S·p). An
 * estimate: it ignores fees and funding.
 */
/**
 * How far through the touch a perp market order is signed unless the trader edits it: spot's
 * 0.5%. Not a cost the trader pays (fills land at the maker's price) but the room the order has
 * to still cross if the book moves between the ticket reading it and the engine matching.
 */
export const PERP_DEFAULT_MAX_SLIPPAGE = SPOT_MARKET_SLIPPAGE;

/** The most slippage room the ticket lets a trader sign for: 5%. */
export const PERP_MAX_SLIPPAGE_LIMIT = 0.05;

/**
 * A typed slippage tolerance, "0.5" or "1%", as a fraction; null when it is not a number in
 * (0, limit]. Zero is refused because a market order signed exactly at the touch fails to cross
 * the moment the book ticks.
 */
export function parseSlippagePercent(text: string) {
  const parsed = Number(text.replace("%", "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const fraction = parsed / 100;
  return fraction <= PERP_MAX_SLIPPAGE_LIMIT ? fraction : null;
}

const TRAILING_ZEROS = /\.?0+$/;

/** A slippage fraction as the ticket prints it: "0.5%", "0.046%", at most three decimals. */
export function formatSlippagePercent(fraction: number) {
  const pct = fraction * 100;
  const text = pct.toFixed(3).replace(TRAILING_ZEROS, "");
  return `${text === "" ? "0" : text}%`;
}

/**
 * Where an order is expected to trade, and how far past the touch that is. A limit order trades
 * at its limit, with no slippage to speak of. A market order trades at the touch and then at
 * every level behind it until it is filled, so its expected price is the size-weighted average
 * over the depth it consumes, and its slippage is how far that average sits past the touch, as a
 * fraction of the touch. With nothing resting on that side the expected price falls back to the
 * reference price (where the ticket sizes from) and the slippage is unknown rather than zero.
 */
export function estimatePerpEntry({
  asks,
  bids,
  limitPrice,
  orderType,
  referencePrice,
  side,
  sizeCngn,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  /** The typed limit, USDC per cNGN; null when none or unparseable. */
  limitPrice: number | null;
  orderType: "Market" | "Limit";
  /** The price a market order fills near: the touch, else the mark. */
  referencePrice: number | null;
  side: "long" | "short";
  sizeCngn: number | null;
}): { expectedPrice: number | null; slippage: number | null } {
  if (orderType === "Limit") {
    return { expectedPrice: limitPrice, slippage: null };
  }
  const uiSide = perpOrderUiSide(side);
  const touch = (uiSide === "buy" ? asks[0]?.price : bids[0]?.price) ?? null;
  const fill = sizeCngn === null ? null : getMarketFill(uiSide, asks, bids, sizeCngn);
  const averagePrice = fill?.averagePrice ?? null;
  if (averagePrice === null || touch === null || touch <= 0) {
    return { expectedPrice: averagePrice ?? referencePrice, slippage: null };
  }
  const adverse = uiSide === "buy" ? averagePrice - touch : touch - averagePrice;
  return { expectedPrice: averagePrice, slippage: Math.max(0, adverse / touch) };
}

const CNGN_AMOUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A cNGN amount as the ticket prints it: "2,793.39", "500,000". */
export function formatCngnAmount(value: number) {
  return CNGN_AMOUNT.format(value);
}

const TRAILING_POINT_ZERO = /\.0$/;

/** A leverage as the ticket prints it: "8.7x", "1x", "0x". */
export function formatLeverage(value: number) {
  const text = value.toFixed(1).replace(TRAILING_POINT_ZERO, "");
  return `${text}x`;
}

/**
 * The largest order the account can open, in whole cNGN: the initial-margin surplus spread over
 * what each cNGN of notional costs to open (its initial margin plus the taker fee) at the
 * ticket's price. An order against an open position reduces it first, which frees margin rather
 * than using it, so that position's size is added. Null when the ticket has no price or the
 * account is unknown; zero when there is no margin left to open with.
 */
export function maxOrderSizeCngn({
  availableMargin,
  position,
  price,
  side,
  state,
  takerFeeBps,
}: {
  availableMargin: number | null;
  position: PerpPosition | null;
  price: number | null;
  side: "long" | "short";
  state: PerpState | null;
  takerFeeBps: number | null;
}): number | null {
  if (availableMargin === null || price === null || price <= 0 || state === null) {
    return null;
  }
  const costPerUsd = state.initialMarginRate + (takerFeeBps ?? 0) / 10_000;
  const fromMargin = costPerUsd > 0 ? Math.max(0, availableMargin) / (costPerUsd * price) : 0;
  const reducing = position !== null && position.uiSide !== side ? position.uiSize : 0;
  return Math.floor(fromMargin + reducing);
}

/** A cNGN amount signed by its side: a long positive, a short negative. */
function signedCngn(side: "long" | "short", size: number) {
  return side === "long" ? size : -size;
}

/**
 * The position after this order, signed in cNGN (a long positive): what the Position row shows
 * and what the leverage after the order is counted on. A reduce-only order never crosses zero.
 */
export function positionAfterOrder({
  position,
  reduceOnly,
  side,
  sizeCngn,
}: {
  position: PerpPosition | null;
  reduceOnly: boolean;
  side: "long" | "short";
  sizeCngn: number | null;
}): { current: number; next: number } {
  const current = position === null ? 0 : signedCngn(position.uiSide, position.uiSize);
  const delta = sizeCngn === null ? 0 : signedCngn(side, sizeCngn);
  if (reduceOnly) {
    if (current === 0 || Math.sign(delta) === Math.sign(current)) {
      return { current, next: current };
    }
    return { current, next: Math.sign(current) * Math.max(0, Math.abs(current) - Math.abs(delta)) };
  }
  return { current, next: current + delta };
}

/**
 * The account's leverage after the order: the position's notional at the ticket's price over the
 * margin the SRM credits the account. That margin is read back from the initial-margin surplus
 * the venue reports plus what the open position already uses, so it is the SRM's own count (cNGN
 * at its factor, P&L in USDC) rather than the wallet's balances. Null without an account, a
 * price or margin; zero when nothing would be open.
 */
export function estimatePositionLeverage({
  availableMargin,
  nextPositionCngn,
  position,
  price,
  state,
}: {
  availableMargin: number | null;
  nextPositionCngn: number;
  position: PerpPosition | null;
  price: number | null;
  state: PerpState | null;
}): number | null {
  if (availableMargin === null || price === null || price <= 0 || state === null) {
    return null;
  }
  const equity = availableMargin + (position?.notionalUsd ?? 0) * state.initialMarginRate;
  if (equity <= 0) {
    return nextPositionCngn === 0 ? 0 : null;
  }
  return (Math.abs(nextPositionCngn) * price) / equity;
}

export function estimateLiquidationPrice({
  side,
  sizeCngn,
  entryPrice,
  margin,
  maintenanceMarginRate,
}: {
  side: "long" | "short";
  sizeCngn: number;
  entryPrice: number;
  margin: number;
  maintenanceMarginRate: number;
}): number | null {
  if (!(sizeCngn > 0 && entryPrice > 0 && margin >= 0 && maintenanceMarginRate > 0)) {
    return null;
  }
  const s = side === "long" ? sizeCngn : -sizeCngn;
  // C + S(p - p0) - |S| mm p = 0  =>  p = (S p0 - C) / (S - |S| mm)
  const denominator = s - Math.abs(s) * maintenanceMarginRate;
  if (denominator === 0) {
    return null;
  }
  const price = (s * entryPrice - margin) / denominator;
  return price > 0 ? price : null;
}

type PresentedPositionPayload = {
  ui_side?: string;
  ui_size?: string;
  /** The same position valued at the index, USDC. */
  ui_notional_usdc?: string;
  index_price_ui?: string;
  /** Signed whole cNGN contracts; positive is a long. */
  engine_position?: string;
  mark_price_ui?: string;
  unrealized_pnl?: string;
  initial_margin_surplus?: string;
  maintenance_margin_surplus?: string;
  liquidation_price_ui?: string;
};

type PresentedAccountPayload = {
  cash?: string;
  initial_margin_surplus?: string;
  maintenance_margin_surplus?: string;
  collateral?: PresentedCollateralBalance[];
};

/** `/v1/positions` for one account, parsed. Unreadable rows are dropped rather than zero-filled. */
export function parsePositionsResponse(body: unknown): {
  positions: PerpPosition[];
  account: PerpAccountMargin | null;
} {
  const payload = (body ?? {}) as {
    positions?: PresentedPositionPayload[];
    accounts?: PresentedAccountPayload[];
  };
  const positions: PerpPosition[] = [];
  for (const row of payload.positions ?? []) {
    const uiSize = positive(row.ui_size);
    const engineSize = wholeMagnitude(row.engine_position);
    const markPrice = positive(row.mark_price_ui);
    const indexPrice = positive(row.index_price_ui);
    // The venue values the position at the index; an older service that does not is valued here.
    const notionalUsd =
      positive(row.ui_notional_usdc) ??
      (uiSize !== null && indexPrice !== null ? uiSize * indexPrice : null);
    const unrealizedPnl = finite(row.unrealized_pnl);
    const initialMarginSurplus = finite(row.initial_margin_surplus);
    const maintenanceMarginSurplus = finite(row.maintenance_margin_surplus);
    if (
      (row.ui_side !== "long" && row.ui_side !== "short") ||
      uiSize === null ||
      engineSize === 0n ||
      markPrice === null ||
      unrealizedPnl === null ||
      initialMarginSurplus === null ||
      maintenanceMarginSurplus === null ||
      notionalUsd === null
    ) {
      continue;
    }
    positions.push({
      engineSize,
      initialMarginSurplus,
      liquidationPrice: positive(row.liquidation_price_ui),
      maintenanceMarginSurplus,
      markPrice,
      notionalUsd,
      uiSide: row.ui_side,
      uiSize,
      unrealizedPnl,
    });
  }

  const first = payload.accounts?.[0];
  const cash = finite(first?.cash);
  const cashUnits = ledgerUnits(first?.cash);
  const im = finite(first?.initial_margin_surplus);
  const mm = finite(first?.maintenance_margin_surplus);
  const account =
    cash !== null && cashUnits !== null && im !== null && mm !== null
      ? {
          cash,
          cashUnits,
          collateral: parseCollateralBalances(first?.collateral),
          initialMarginSurplus: im,
          maintenanceMarginSurplus: mm,
        }
      : null;
  return { account, positions };
}

/**
 * The perp margin as something the withdraw flow can pay out: the escrow is the perp's CashAsset
 * (it holds real USDC and its `withdraw` has the same shape as the spot escrows'), the token is
 * USDC. Withdrawn by a signed WithdrawalModule action, like spot, since Matching holds the account.
 */
export function getPerpWithdrawableAsset(stack: PerpStack): WithdrawableAsset {
  return {
    escrow: stack.cashAddress,
    id: "perp-cash",
    label: "Perp margin",
    symbol: "USDC",
    token: getUsdcTokenAddress(),
  };
}

/**
 * A collateral asset as something the withdraw flow can pay out: the escrow is the perp's own
 * cNGN WrappedERC20Asset, the token the cNGN the wallet holds. Only cNGN is wrapped by the venue
 * today; an unknown symbol gets no withdraw path rather than a guessed token.
 */
export function getPerpCollateralWithdrawableAsset(
  asset: PerpCollateralAsset
): WithdrawableAsset | null {
  if (asset.symbol !== "cNGN") {
    return null;
  }
  return {
    escrow: asset.escrow,
    id: "perp-cngn",
    label: "Perp cNGN margin",
    symbol: "cNGN",
    token: getCngnTokenAddress(),
  };
}

/** For the simple annualised funding figure: the hourly rate times the hours in a year. */
const HOURS_PER_YEAR = 24 * 365;

const USD_CELL = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

function signOf(value: number) {
  if (value < 0) {
    return "-";
  }
  return value > 0 ? "+" : "";
}

const SUBMIT_SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * What the ticket's submit button says for a side: "Long 1,000 cNGN". A long is long cNGN, the
 * engine's own long; `lib/perp-market.test.mjs` pins this against `perpOrderUiSide`, so the button
 * and the order it sends cannot drift apart.
 */
export function perpSubmitLabel(side: "long" | "short", sizeCngn: number | null) {
  const amount = sizeCngn === null ? "" : ` ${SUBMIT_SIZE.format(sizeCngn)}`;
  return `${perpSideLabel(side)}${amount} cNGN`;
}

/** The side an order is sent with: a long buys cNGN, exactly as a spot buy does. */
export function perpOrderUiSide(side: "long" | "short"): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}

/** A position's side as the venue and the ticket both name it. */
export function perpSideLabel(uiSide: "long" | "short") {
  return uiSide === "long" ? "Long" : "Short";
}

const CNGN_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function signedDollars(value: number) {
  return `${signOf(value)}$${USD_CELL.format(Math.abs(value))}`;
}

function pnlTone(value: number): CellTone | undefined {
  if (value === 0) {
    return undefined;
  }
  return value > 0 ? "positive" : "negative";
}

/**
 * The Positions tab, one row per position: the market with its side and the account's leverage
 * as pills, the cNGN size in the side's colour, the value at the index, mark and liquidation
 * prices, the initial margin the position uses (marked Cross beside it, since the whole account
 * backs it) and the unrealized PnL with its share of the value beside it. The trailing column holds Close, which
 * the terminal renders; the rows carry no cell for it.
 *
 * No entry price: the SRM marks positions to market and keeps none on chain, so the column could
 * only be invented. No funding or TP/SL columns either: the venue reports no per-position funding
 * and takes no trigger orders. The leverage pill is the position's value over the margin the SRM
 * credits the account (its surplus plus what every open position uses), the same count the
 * ticket's Position Leverage shows.
 */
export function buildPerpPositionsView(
  positions: PerpPosition[],
  label: string,
  context: { account: PerpAccountMargin | null; state: PerpState | null } = {
    account: null,
    state: null,
  }
) {
  const imRate = context.state?.initialMarginRate ?? null;
  const totalNotional = positions.reduce((sum, position) => sum + position.notionalUsd, 0);
  const equity =
    context.account !== null && imRate !== null
      ? context.account.initialMarginSurplus + totalNotional * imRate
      : null;
  return {
    columns: PERP_POSITIONS_COLUMNS,
    rows: positions.map((position): ActivityRow => {
      const side = sideTone(perpOrderUiSide(position.uiSide));
      const leverage =
        equity !== null && equity > 0 ? formatLeverage(position.notionalUsd / equity) : null;
      const pnlShare =
        position.notionalUsd > 0 ? (position.unrealizedPnl / position.notionalUsd) * 100 : null;
      const marginUsed = imRate === null ? null : position.notionalUsd * imRate;
      const pnl = pnlTone(position.unrealizedPnl);
      const details: Record<number, string> = { 5: "Cross" };
      if (pnlShare !== null) {
        details[6] = `(${signOf(pnlShare)}${Math.abs(pnlShare).toFixed(2)}%)`;
      }
      const tones: Record<number, CellTone> = { 1: side };
      if (pnl !== undefined) {
        tones[6] = pnl;
      }
      const badges: CellBadge[] = [{ label: perpSideLabel(position.uiSide), tone: side }];
      if (leverage !== null) {
        badges.push({ label: leverage });
      }
      return {
        badges: { 0: badges },
        cells: [
          label,
          `${CNGN_CELL.format(position.uiSize)} cNGN`,
          `$${USD_CELL.format(position.notionalUsd)}`,
          formatDollarPrice(position.markPrice),
          formatDollarPrice(position.liquidationPrice),
          marginUsed === null ? "—" : `$${USD_CELL.format(marginUsed)}`,
          signedDollars(position.unrealizedPnl),
        ],
        details,
        tones,
      };
    }),
  };
}

/** The Positions tab's columns, shared with the empty view the terminal renders before data. */
export const PERP_POSITIONS_COLUMNS = [
  "Market",
  "Size",
  "Position Value",
  "Mark Price",
  "Liq Price",
  "Margin",
  "uPnL",
  "",
];

const PERCENT_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" });

/**
 * The Balances tab's columns. The trailing column holds each row's Deposit and Withdraw.
 */
export const PERP_BALANCES_COLUMNS = ["Asset", "Balance", "Value", "Counts as Margin", ""];

/**
 * The Balances tab: one row per asset the account's margin is made of, with the balance, its
 * value in dollars and what the SRM credits as margin. Cash first, worth and credited at face
 * value; then each collateral asset held, at its index value and its margin factor; then, at
 * zero, every collateral asset the venue accepts that the account does not hold, so a depositor
 * sees where it would go. The row order is what the terminal's Withdraw indexes by: cash is
 * ledger row 0, the held collateral rows 1.., and the unheld rows have nothing to withdraw.
 */
export function buildPerpBalancesView(
  account: PerpAccountMargin | null,
  listed: PerpCollateralAsset[] = []
): ActivityView {
  const held = account?.collateral ?? [];
  const unheld = listed.filter(
    (asset) => !held.some((row) => row.escrow.toLowerCase() === asset.escrow.toLowerCase())
  );
  const dollars = (value: number) => `$${USD_CELL.format(value)}`;
  return {
    columns: [...PERP_BALANCES_COLUMNS],
    rows:
      account === null
        ? []
        : [
            {
              cells: [
                "USDC",
                `${USD_CELL.format(account.cash)} USDC`,
                dollars(account.cash),
                `${dollars(account.cash)} (100%)`,
              ],
            },
            ...held.map((row) => ({
              cells: [
                row.symbol,
                `${USD_CELL.format(row.balance)} ${row.symbol}`,
                dollars(row.valueUsd),
                `${dollars(row.marginValueUsd)} (${PERCENT_CELL.format(
                  row.valueUsd > 0 ? row.marginValueUsd / row.valueUsd : 0
                )})`,
              ],
            })),
            ...unheld.map((asset) => ({
              cells: [
                asset.symbol,
                `0.00 ${asset.symbol}`,
                "$0.00",
                `$0.00 (${PERCENT_CELL.format(asset.marginFactor)})`,
              ],
            })),
          ],
  };
}

/**
 * What "Available to trade" is made of, for the ticket: the cash, each collateral asset with its
 * value and margin credit, and what the account's positions already use. Null without an account.
 * Cross-margin: all of it backs every position, and profit and loss settle in USDC.
 */
export function describePerpMarginSources(account: PerpAccountMargin | null): string | null {
  if (account === null) {
    return null;
  }
  const parts = [`${USD_CELL.format(account.cash)} USDC cash`];
  for (const row of account.collateral) {
    parts.push(
      `${USD_CELL.format(row.balance)} ${row.symbol} (worth ${USD_CELL.format(row.valueUsd)} USDC, counts as ${USD_CELL.format(row.marginValueUsd)} USDC)`
    );
  }
  const credited =
    account.cash + account.collateral.reduce((sum, row) => sum + row.marginValueUsd, 0);
  const inUse = credited - account.initialMarginSurplus;
  const used = inUse > 0.005 ? ` − ${USD_CELL.format(inUse)} USDC backing your positions` : "";
  return `${parts.join(" + ")}${used}`;
}

function signedPrice(value: number) {
  return `${value < 0 ? "-" : "+"}${formatPrice(Math.abs(value), PRICE_DECIMALS)}`;
}

function signedPercent(value: number, digits: number) {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(digits)}%`;
}

/** Open interest in USDC, compact; a venue with none open reads zero, not a dash. */
function formatOpenInterest(state: PerpState | null) {
  if (state === null) {
    return "—";
  }
  const compact = formatCompactUsd(state.openInterestUsd);
  return compact === "—" ? "$0.00" : compact;
}

function toneOf(value: number | null): PerpHeaderMetric["tone"] {
  if (value === null || value === 0 || !Number.isFinite(value)) {
    return null;
  }
  return value > 0 ? "up" : "down";
}

/**
 * The perp header's figures, in the order a perp trader reads them: mark and index from the chain,
 * the day's move against the live price, volume, open interest, the hourly funding rate and that
 * rate annualised. Every figure is the venue's own; a missing one is a dash. There is no market
 * cap: a stablecoin FX perp has no supply to value. There is no funding countdown either: the PerpAsset contract
 * accrues funding continuously (`aggregatedFunding += rate × elapsed / 1 hour` on every touch),
 * so there is no settlement moment to count down to, and a timer would be fiction.
 */
export function buildPerpHeaderMetrics({
  firstPrice,
  price,
  state,
  volumeUsd,
}: {
  /** The 24h window's first trade, which the change is measured from. */
  firstPrice: number | null;
  /** The live price the change is measured to: the book's mid, else the mark. */
  price: number | null;
  state: PerpState | null;
  /** The 24h window's quote volume in USDC; null when nothing traded or the window is unknown. */
  volumeUsd: number | null;
}): PerpHeaderMetric[] {
  const change = firstPrice !== null && price !== null ? price - firstPrice : null;
  const changePercent =
    change !== null && firstPrice !== null && firstPrice > 0 ? (change / firstPrice) * 100 : null;
  const funding = state?.uiLongFundingRate1h ?? null;
  return [
    {
      label: "Mark",
      tone: null,
      tooltip: "The price positions are valued and liquidated at, from the venue's chain state",
      value: formatDollarPrice(state?.markPrice ?? null),
    },
    {
      label: "Index",
      tone: null,
      tooltip: "The external NGN/USD reference the mark tracks; funding pushes the two together",
      value: formatDollarPrice(state?.indexPrice ?? null),
    },
    {
      label: "24h Change",
      tone: toneOf(change),
      value:
        change === null || changePercent === null
          ? "—"
          : `${signedPrice(change)} (${signedPercent(changePercent, 2)})`,
    },
    { label: "24h Volume", tone: null, value: formatCompactUsd(volumeUsd ?? Number.NaN) },
    {
      label: "Open Interest",
      tone: null,
      tooltip: "The USD notional of every open position, long and short",
      value: formatOpenInterest(state),
    },
    {
      label: "1h Funding",
      tone: toneOf(funding),
      tooltip:
        "Hourly, as the long side sees it: positive means longs (long cNGN) pay shorts. It accrues every second; there is no funding settlement to count down to.",
      value: funding === null ? "—" : signedPercent(funding * 100, 4),
    },
    {
      // The same rate annualised, as its own figure: hourly × 24 × 365, not compounded, with the
      // same sign and colour as the hourly rate it is read from.
      label: "APR",
      tone: toneOf(funding),
      tooltip:
        "The hourly funding rate annualised (hourly × 24 × 365, not compounded), as the long side sees it",
      value: funding === null ? "—" : signedPercent(funding * HOURS_PER_YEAR * 100, 1),
    },
  ];
}
