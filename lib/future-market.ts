import { Duration } from "effect";
import { getAddress, isAddress } from "viem";
import type {
  FutureAccount,
  FutureSide,
  FutureStack,
  FutureState,
  FutureStatePresentation,
} from "@/lib/future-market.types";
import { formatMarketPrice } from "@/lib/market-formatting";
import type { PerpHeaderMetric } from "@/lib/perp-market.types";
import { sideTone } from "@/lib/side-tone";
import { getMarketableLimitPrice, getMarketFill } from "@/lib/spot-market";
import { formatCompactUsd } from "@/lib/ticker-stats";
import { tokenIcon } from "@/lib/token-icons";
import type { ActivityRow, ActivityView, CellTone, OrderBookLevel } from "@/lib/trading.types";

/**
 * The v1 series is quoted in cNGN per USDC (about 1,390), so two decimals resolve well under a
 * basis point; the engine's own tick is 1e-18.
 */
const V1_PRICE_DECIMALS = 2;

/**
 * The v1 ladder's price groupings, cNGN per USDC, the default first: whole cNGN, a level per 1.00,
 * which spreads the maker's ladder over the grid rather than a sliver of it.
 */
const V1_PRICE_GROUPS = [1, 0.1, 0.01] as const;

/**
 * How a v2 series' price (USDC per base) is shown and typed, per base: to about a basis point. At
 * 0.00072 USDC per cNGN a seventh decimal is 14 bps, coarser than the maker's rungs, so cNGN takes
 * eight; EURC near 1.12 takes five, as EURC-USDC spot does. Groupings put the default first.
 */
const AMERICAN_QUOTING: Record<string, { decimals: number; groups: readonly number[] }> = {
  cNGN: { decimals: 8, groups: [0.000_000_1, 0.000_000_01] },
  EURC: { decimals: 5, groups: [0.0001, 0.000_01] },
};

/** A base the table does not name: six decimals, about a basis point at a price near 0.01. */
const AMERICAN_QUOTING_DEFAULT = { decimals: 6, groups: [0.000_01, 0.000_001] } as const;

/**
 * The fee ceiling signed into every future order, as a fraction of a contract's notional: the
 * same 30 bps spot and the perp sign against a 25 bps schedule. TradeModule compares it per
 * contract, so it is signed as USDC per contract.
 */
const FUTURE_WORST_FEE_RATE = 0.003;

const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

/** The sign a figure is written with: "+" above zero, "-" below, nothing at zero. */
function signPrefix(value: number) {
  if (value > 0) {
    return "+";
  }
  return value < 0 ? "-" : "";
}

/** A price in the series' terms to `digits` (its `priceDecimals`), e.g. "1,386.81"; an em dash when unknown. */
export function formatFuturePrice(value: number | null, digits: number) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return formatMarketPrice(value, digits);
}

function decimal(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveDecimal(value: string | undefined): number | null {
  const parsed = decimal(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/** The `/v1/markets` fields the future's state is read from. */
export type FuturePresentation = {
  base_asset_symbol?: string;
  asset_address?: string;
  sub_id?: string;
  trade_module_address?: string;
  quote_asset_address?: string;
  margin_manager_address?: string;
  expiry_timestamp?: number;
  fill_band_low?: string;
  fill_band_high?: string;
  /** The signed on-chain amount of one unit of desired_amount; absent, a whole contract. */
  amount_scale?: string;
  future?: FutureStatePresentation;
};

/**
 * The series' state, or null when the venue served no `future` block or no expiry: without them
 * nothing on the ticket could be said truthfully. The band is null while the venue cannot read it;
 * the ticket then refuses to sign, since the venue would too.
 */
export function parseFutureState(presentation: FuturePresentation | null): FutureState | null {
  const future = presentation?.future;
  const expiry = future?.expiry_timestamp ?? presentation?.expiry_timestamp;
  if (future === undefined || expiry === undefined || !Number.isFinite(expiry)) {
    return null;
  }
  const lastTrade = future.last_trade_time ?? expiry;
  const low = positiveDecimal(presentation?.fill_band_low);
  const high = positiveDecimal(presentation?.fill_band_high);
  const amountScale = parseAmountScale(presentation?.amount_scale);
  return {
    ...parseFutureTerms(presentation, future, amountScale),
    amountScale,
    bandWidth: positiveDecimal(future.band_width),
    expiryMs: expiry * 1000,
    fillBand: low !== null && high !== null && low < high ? { high, low } : null,
    indexPrice: positiveDecimal(future.index_price),
    lastTradeAtMs: lastTrade * 1000,
    listed: future.listed === true,
    markPrice: positiveDecimal(future.mark_price),
    settled: future.settled === true,
    tradingClosedReason: future.trading_closed_reason?.trim() || null,
    tradingOpen: future.trading_open === true,
  };
}

/**
 * How the series is quoted and sized, from its listing. A v2 series names its contract in an asset
 * (`contract_size` and `contract_size_asset`) and none in USDC; the v1 series names one in USDC.
 */
function parseFutureTerms(
  presentation: FuturePresentation | null,
  future: FutureStatePresentation,
  amountScale: bigint
): Pick<
  FutureState,
  | "baseSymbol"
  | "contractSize"
  | "priceDecimals"
  | "priceGroups"
  | "priceUnit"
  | "sizeSymbol"
  | "terms"
  | "unitSize"
  | "vmSymbol"
> {
  // One venue unit is `amountScale` of the ledger's 1e18 a contract.
  const unitOf = (contractSize: number) => (contractSize * Number(amountScale)) / 1e18;
  const assetContract = positiveDecimal(future.contract_size);
  if (assetContract !== null && positiveDecimal(future.contract_size_usdc) === null) {
    const base =
      future.contract_size_asset?.trim() || presentation?.base_asset_symbol?.trim() || "base";
    const quoting = AMERICAN_QUOTING[base] ?? AMERICAN_QUOTING_DEFAULT;
    return {
      baseSymbol: base,
      contractSize: assetContract,
      priceDecimals: quoting.decimals,
      priceGroups: quoting.groups,
      priceUnit: `USDC per ${base}`,
      sizeSymbol: base,
      terms: "american",
      unitSize: unitOf(assetContract),
      vmSymbol: "USDC",
    };
  }
  const contractSizeUsdc = positiveDecimal(future.contract_size_usdc) ?? 1000;
  return {
    baseSymbol: "cNGN",
    contractSize: contractSizeUsdc,
    priceDecimals: V1_PRICE_DECIMALS,
    priceGroups: V1_PRICE_GROUPS,
    priceUnit: "cNGN per USDC",
    sizeSymbol: "USDC",
    terms: "usdc",
    unitSize: unitOf(contractSizeUsdc),
    vmSymbol: "cNGN",
  };
}

/** The ledger's amount for one whole contract. */
const CONTRACT_UNITS = 10n ** 18n;

/** The venue's `amount_scale`, or a whole contract when it names none (before it sized in USDC). */
function parseAmountScale(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!UNSIGNED_INTEGER_PATTERN.test(trimmed)) {
    return CONTRACT_UNITS;
  }
  const scale = BigInt(trimmed);
  return scale > 0n && scale <= CONTRACT_UNITS ? scale : CONTRACT_UNITS;
}

function checksummed(value: string | undefined): `0x${string}` | null {
  return value !== undefined && isAddress(value) ? getAddress(value) : null;
}

/** Where the series is signed and margined, or null unless the venue named every part of it. */
export function parseFutureStack(presentation: FuturePresentation | null): FutureStack | null {
  const assetAddress = checksummed(presentation?.asset_address);
  const tradeModuleAddress = checksummed(presentation?.trade_module_address);
  const cashAddress = checksummed(presentation?.quote_asset_address);
  const managerAddress = checksummed(presentation?.margin_manager_address);
  const subId = presentation?.sub_id;
  if (
    assetAddress === null ||
    tradeModuleAddress === null ||
    cashAddress === null ||
    managerAddress === null ||
    subId === undefined ||
    !UNSIGNED_INTEGER_PATTERN.test(subId)
  ) {
    return null;
  }
  return { assetAddress, cashAddress, managerAddress, subId, tradeModuleAddress };
}

/**
 * The signed fee ceiling per contract, 18 decimals: 3 USDC on the v1 series' 1,000 USDC contract.
 * A v2 contract's value moves with the price, so its ceiling is taken at `priceCeiling`, the
 * highest price the order can fill at (the band's top): the venue charges on the fill's notional,
 * and a ceiling at any lower price could fall under the fee of a fill above it.
 */
export function futureWorstFeeUnits(
  state: Pick<FutureState, "contractSize" | "terms">,
  priceCeiling: number
): bigint {
  const contractUsdc =
    state.terms === "american" ? state.contractSize * priceCeiling : state.contractSize;
  const microUsdc = BigInt(Math.ceil(contractUsdc * FUTURE_WORST_FEE_RATE * 1e6));
  return microUsdc * 10n ** 12n;
}

/** The most fee an order of `notional` USDC is signed to pay: the ceiling `futureWorstFeeUnits` signs. */
export function futureMaxFeeUsdc(notional: number) {
  return notional * FUTURE_WORST_FEE_RATE;
}

/** Why an order cannot be placed on the series now, or null when it can. */
export function futureTradingBlock(state: FutureState, nowMs: number): string | null {
  if (state.settled) {
    return "This series has settled. Open positions are closed out at the settlement price.";
  }
  if (nowMs >= state.lastTradeAtMs) {
    return "Past the last trade time: the venue takes no new orders on this series.";
  }
  if (!state.tradingOpen) {
    return state.tradingClosedReason === null
      ? "The venue is not matching this series right now."
      : `The venue is not matching this series right now: ${state.tradingClosedReason}.`;
  }
  return null;
}

/** Whether a signed limit would be refused for the band: the venue and the chain both check it. */
export function isOutsideFillBand(price: number, band: FutureState["fillBand"]) {
  return band !== null && (price < band.low || price > band.high);
}

/**
 * A long is a buy: on the v1 series it gains as cNGN weakens (more cNGN per USDC), on a v2 series
 * as the base strengthens against USDC.
 */
export function futureOrderUiSide(side: FutureSide): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}

export function futureSideLabel(side: FutureSide) {
  return side === "long" ? "Long" : "Short";
}

/** Contracts as the ledger holds them, 18 decimals, to a signed count to six decimals. */
export function toContracts(units: bigint) {
  return Number(units / 10n ** 12n) / 1e6;
}

/** Contracts as a size in the series' `sizeSymbol`: contracts × the contract size. */
export function futureContractsSize(contracts: number, state: Pick<FutureState, "contractSize">) {
  return contracts * state.contractSize;
}

/**
 * A size in the series' `sizeSymbol` as USDC of notional: itself on the v1 series, size × price
 * (USDC per base) on a v2 one, null there without a price.
 */
export function futureSizeUsdc(
  size: number,
  price: number | null,
  state: Pick<FutureState, "terms">
): number | null {
  if (state.terms === "usdc") {
    return size;
  }
  return price === null || !(price > 0) ? null : size * price;
}

/**
 * A ticket's size, in `sizeSymbol`, as the venue's whole units, or null unless it is a positive
 * whole number of them: the venue rests whole units only (1 USDC, 1,000 cNGN, 1 EURC).
 */
export function futureOrderUnits(size: number, state: Pick<FutureState, "unitSize">) {
  if (!Number.isFinite(size) || size <= 0 || state.unitSize <= 0) {
    return null;
  }
  const units = size / state.unitSize;
  const whole = Math.round(units);
  return whole >= 1 && Math.abs(units - whole) < 1e-9 ? whole : null;
}

/** The account's position in the series, signed (positive long), in `sizeSymbol`. */
export function futurePositionSize(account: FutureAccount | null, state: FutureState) {
  return account === null ? 0 : futureContractsSize(toContracts(account.positionUnits), state);
}

/**
 * What an order of `size` (in `sizeSymbol`) does to the margin the engine checks, before it is
 * sent: the exposure it adds (a reduction adds none, and the engine checks it against maintenance
 * margin only), the initial margin that adds, and the taker fee if it crosses, all USDC at `price`.
 * `position` and `after` are signed sizes in `sizeSymbol`: positive long.
 */
export function estimateFutureOrder({
  account,
  price,
  side,
  size,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  /** What the order trades at: a v2 series values the size at it. */
  price: number | null;
  side: FutureSide;
  size: number;
  state: FutureState;
  takerFeeBps: number | null;
}) {
  const position = futurePositionSize(account, state);
  const after = position + (side === "long" ? size : -size);
  const added = Math.max(0, Math.abs(after) - Math.abs(position));
  const notional = futureSizeUsdc(size, price, state);
  const addedUsdc = futureSizeUsdc(added, price, state);
  const imRate = account?.imRate ?? null;
  const fee = takerFeeBps === null || notional === null ? null : (notional * takerFeeBps) / 10_000;
  const initialMargin = imRate === null || addedUsdc === null ? null : addedUsdc * imRate;
  const shortfall =
    account === null || initialMargin === null
      ? null
      : Math.max(0, initialMargin + (fee ?? 0) - account.initialMarginSurplus);
  return { after, fee, initialMargin, notional, position, shortfall, size };
}

/**
 * The account's leverage once an order leaves the position at `afterSize` (signed, `sizeSymbol`):
 * its USDC value at `price` over the margin the engine credits the account, which is the initial
 * margin surplus plus what the open position already holds at the initial rate. The engine opens up
 * to 1 / its initial rate. There is no per-position leverage to set: the engine margins the account
 * as a whole.
 */
export function estimateFutureLeverage({
  account,
  afterSize,
  price,
  state,
}: {
  account: FutureAccount | null;
  afterSize: number;
  price: number | null;
  state: FutureState;
}) {
  if (account === null || !(account.imRate > 0)) {
    return { leverage: null, maxLeverage: null };
  }
  const maxLeverage = 1 / account.imRate;
  const held = futureSizeUsdc(Math.abs(futurePositionSize(account, state)), price, state);
  const after = futureSizeUsdc(Math.abs(afterSize), price, state);
  if (held === null || after === null) {
    return { leverage: null, maxLeverage };
  }
  const credited = account.initialMarginSurplus + held * account.imRate;
  return { leverage: credited > 0 ? after / credited : null, maxLeverage };
}

/**
 * A market order's fill, walked through the resting book: the average price its `size` trades at,
 * and how far that sits past the touch (the best ask for a long, the best bid for a short) as a
 * fraction. The book's sizes are in `sizeSymbol`, as the terminal shows them. Null figures when the
 * size is unset or the side cannot fill it.
 */
export function estimateFutureFill({
  asks,
  bids,
  side,
  size,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  side: FutureSide;
  size: number | null;
}): { averagePrice: number | null; slippage: number | null } {
  if (size === null) {
    return { averagePrice: null, slippage: null };
  }
  const uiSide = futureOrderUiSide(side);
  const touch = (uiSide === "buy" ? asks[0]?.price : bids[0]?.price) ?? null;
  const fill = getMarketFill(uiSide, asks, bids, size);
  if (!fill.isFullyFilled || fill.averagePrice === null || touch === null || touch <= 0) {
    return { averagePrice: fill.averagePrice, slippage: null };
  }
  const adverse = uiSide === "buy" ? fill.averagePrice - touch : touch - fill.averagePrice;
  return { averagePrice: fill.averagePrice, slippage: Math.max(0, adverse / touch) };
}

/**
 * The variation margin a fill settles at once, in the series' `vmSymbol` to the trader: the engine
 * marks the new position to the mark on the fill, so a long that fills above the mark (or a short
 * below it) pays the gap times the size, and one that fills on the better side of the mark receives
 * it. On the v1 series the size is USDC and the price cNGN per USDC, so it is cNGN; on a v2 series
 * the size is the base and the price USDC per base, so it is USDC.
 */
export function futureFillVm({
  markPrice,
  price,
  side,
  size,
}: {
  markPrice: number | null;
  price: number | null;
  side: FutureSide;
  size: number;
}) {
  if (markPrice === null || price === null || !(size > 0)) {
    return null;
  }
  return (side === "long" ? markPrice - price : price - markPrice) * size;
}

/**
 * A fill's VM as the ticket and history show it: signed cNGN with its dollar value at the mark on
 * the v1 series, signed USDC on a v2 one.
 */
export function formatFutureVm(
  vm: number | null,
  markPrice: number | null,
  state: Pick<FutureState, "terms">
) {
  if (vm === null || !Number.isFinite(vm)) {
    return "—";
  }
  if (state.terms === "american") {
    return signedUsd(vm);
  }
  const cngn = signedCngn(vm);
  return markPrice === null || !(markPrice > 0) ? cngn : `${cngn} (≈ ${signedUsd(vm / markPrice)})`;
}

/** A USDC amount to the cent, or to four places under a cent, so a small fee never reads as free. */
export function formatFutureUsdc(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })} USDC`;
}

/**
 * What Reduce Only means for this ticket: whether it is in force (the box is ticked and there is a
 * position), why the order cannot go (it is on the position's own side), the size the venue would
 * fill (no more than the position, the rest cancelled) and the most MAX offers (the position). Sizes
 * are in the series' `sizeSymbol`.
 */
export function futureReduceOnlyTerms(inputs: {
  position: number;
  reduceOnly: boolean;
  side: FutureSide;
  size: number | null;
  unitSize: number;
}) {
  const held = Math.abs(inputs.position);
  const reducing = inputs.reduceOnly && held > 1e-9;
  if (!reducing) {
    return { error: null, filled: inputs.size, maxSize: null, reducing };
  }
  const long = inputs.position > 0;
  const increases = (inputs.side === "long") === long;
  return {
    error: increases
      ? `Reduce Only: ${long ? "Short" : "Long"} to reduce your ${long ? "long" : "short"} position.`
      : null,
    filled: inputs.size === null ? null : Math.min(inputs.size, held),
    maxSize: inputs.unitSize > 0 ? Math.floor(held / inputs.unitSize) * inputs.unitSize : 0,
    reducing,
  };
}

/**
 * The most the ticket offers on one side, in `sizeSymbol` and whole venue units: the position it
 * can close outright (reducing is always allowed), plus what the initial margin surplus opens at
 * the engine's rate with the taker fee on top, at `price` on a v2 series. Zero without an account,
 * its rates or (on a v2 series) a price.
 */
export function maxFutureSize({
  account,
  price,
  side,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  price: number | null;
  side: FutureSide;
  state: FutureState;
  takerFeeBps: number | null;
}) {
  if (account === null || state.unitSize <= 0) {
    return 0;
  }
  const position = futurePositionSize(account, state);
  const closable = side === "long" ? Math.max(0, -position) : Math.max(0, position);
  const perUsdc = account.imRate + (takerFeeBps ?? 0) / 10_000;
  const openingUsdc = perUsdc > 0 ? Math.max(0, account.initialMarginSurplus) / perUsdc : 0;
  // The USDC it opens, back in the series' size: itself on v1, over the price on v2.
  const perSize = futureSizeUsdc(1, price, state);
  const opening = perSize === null ? 0 : openingUsdc / perSize;
  return Math.floor((closable + opening) / state.unitSize) * state.unitSize;
}

/**
 * The size, in `sizeSymbol`, a market order on `side` fills at once: what rests inside the limit it
 * is signed at, the touch through `maxSlippage` held inside the fill band, in whole venue units. A
 * market order is a limit order that rests, so whatever the book does not hold inside that limit
 * stays on it.
 */
export function futureMarketableSize({
  asks,
  band,
  bids,
  maxSlippage,
  side,
  unitSize,
}: {
  asks: OrderBookLevel[];
  band: FutureState["fillBand"];
  bids: OrderBookLevel[];
  maxSlippage: number;
  side: FutureSide;
  unitSize: number;
}) {
  const uiSide = futureOrderUiSide(side);
  const limit = getMarketableLimitPrice(
    uiSide,
    asks[0]?.price ?? null,
    bids[0]?.price ?? null,
    maxSlippage
  );
  if (limit === null || !(unitSize > 0)) {
    return 0;
  }
  const banded = band === null ? limit : Math.min(band.high, Math.max(band.low, limit));
  const levels = uiSide === "buy" ? asks : bids;
  const reachable = levels.filter((level) =>
    uiSide === "buy" ? level.price <= banded : level.price >= banded
  );
  const size = reachable.reduce((sum, level) => sum + level.size, 0);
  // A hair under a whole unit is one: the sizes are units scaled to the display, in floating point.
  return Math.floor(size / unitSize + 1e-9) * unitSize;
}

/**
 * The Close on a position row: a reduce-only market order on the opposite side, sized to the
 * position or to what the book fills inside the slippage, whichever is smaller, so a close never
 * leaves a remainder resting. `held` and `units` are venue units, `held` to say a close is partial.
 */
export function futureCloseOrder({
  account,
  asks,
  bids,
  maxSlippage,
  state,
}: {
  account: FutureAccount | null;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  maxSlippage: number;
  state: FutureState;
}): { error: string } | { held: number; side: FutureSide; units: number } {
  const position = futurePositionSize(account, state);
  const held = state.unitSize > 0 ? Math.floor(Math.abs(position) / state.unitSize + 1e-9) : 0;
  if (held < 1) {
    return { error: "No position to close." };
  }
  const side: FutureSide = position > 0 ? "short" : "long";
  const fillable = Math.round(
    futureMarketableSize({
      asks,
      band: state.fillBand,
      bids,
      maxSlippage,
      side,
      unitSize: state.unitSize,
    }) / state.unitSize
  );
  if (fillable < 1) {
    return {
      error: `No ${side === "long" ? "asks" : "bids"} to close against. Use a reduce-only limit order.`,
    };
  }
  return { held, side, units: Math.min(held, fillable) };
}

const USD_CELL = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const CONTRACTS_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const SIZE_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function signedUsd(value: number) {
  return `${signPrefix(value)}$${USD_CELL.format(Math.abs(value))}`;
}

function signedCngn(value: number) {
  return `${signPrefix(value)}${USD_CELL.format(Math.abs(value))} cNGN`;
}

function pnlTone(value: number): CellTone | undefined {
  if (value > 0) {
    return "positive";
  }
  return value < 0 ? "negative" : undefined;
}

/**
 * The Positions tab's columns. No entry price, uPnL or liquidation price: the engine keeps none
 * on chain and the venue serves none. What it does keep is the variation margin accrued since the
 * account last settled. VM settles at once on every fill (the gap between the fill price and the
 * mark) and whenever the account is touched, so this is only what the hourly marks have added
 * since: "Pending", not the position's whole profit or loss.
 */
export const FUTURE_POSITIONS_COLUMNS = [
  "Market",
  "Size",
  "Notional",
  "Mark Price",
  "Pending VM",
  "Initial Margin",
  "Maintenance Surplus",
  "",
];

/** The account's position in the series as one row, or none while it is flat. */
export function buildFuturePositionsView(
  account: FutureAccount | null,
  state: FutureState | null,
  label: string
): ActivityView {
  if (account === null || state === null || account.positionUnits === 0n) {
    return { columns: [...FUTURE_POSITIONS_COLUMNS], rows: [] };
  }
  const contracts = toContracts(account.positionUnits);
  const side: FutureSide = contracts > 0 ? "long" : "short";
  const count = Math.abs(contracts);
  const size = futureContractsSize(count, state);
  // A v2 position's USDC value is its size at the mark; a v1 position's is its size.
  const notional = futureSizeUsdc(size, state.markPrice, state);
  const american = state.terms === "american";
  // v1 VM is cNGN, restated in dollars at the mark; v2 VM is already USDC.
  const vmUsd = american || state.markPrice === null ? null : account.pendingVm / state.markPrice;
  const tones: Record<number, CellTone> = { 1: sideTone(futureOrderUiSide(side)) };
  const vmTone = pnlTone(account.pendingVm);
  if (vmTone !== undefined) {
    tones[4] = vmTone;
  }
  const contractsText = `${CONTRACTS_CELL.format(count)} ${count === 1 ? "contract" : "contracts"}`;
  const usd = (value: number | null) => (value === null ? "—" : `$${USD_CELL.format(value)}`);
  const row: ActivityRow = {
    badges: { 0: [{ label: futureSideLabel(side), tone: tones[1] }] },
    details:
      vmUsd === null ? { 1: contractsText } : { 1: contractsText, 4: `(≈ ${signedUsd(vmUsd)})` },
    cells: [
      label,
      `${SIZE_CELL.format(size)} ${state.sizeSymbol}`,
      usd(notional),
      formatFuturePrice(state.markPrice, state.priceDecimals),
      american ? signedUsd(account.pendingVm) : signedCngn(account.pendingVm),
      usd(notional === null ? null : notional * account.imRate),
      signedUsd(account.maintenanceMarginSurplus),
    ],
    titles: {
      1: `${contractsText} of ${USD_CELL.format(state.contractSize)} ${state.sizeSymbol} each`,
      4: `Variation margin the hourly marks have accrued since the account last settled. VM settles in ${state.vmSymbol} at once on every fill (the gap between the fill price and the mark) and whenever the account is touched, so a new position starts here at zero.`,
    },
    tones,
  };
  return { columns: [...FUTURE_POSITIONS_COLUMNS], rows: [row] };
}

/** The Balances tab's columns. The trailing column holds each row's Deposit and Withdraw. */
export const FUTURE_BALANCES_COLUMNS = ["Asset", "Amount", "Price", "Value", ""];

/**
 * The trading account's balances: its USDC cash, then, on the v1 series, its cNGN collateral,
 * valued at the index (cNGN per USDC, so a cNGN balance is worth balance ÷ index dollars before
 * the engine's haircut), listed at zero until it is held, so a depositor sees where it would go. A
 * v2 series margins in USDC alone, so its account lists only USDC.
 */
export function buildFutureBalancesView(
  account: FutureAccount | null,
  state: FutureState | null
): ActivityView {
  if (account === null) {
    return { columns: [...FUTURE_BALANCES_COLUMNS], rows: [] };
  }
  const index = state?.terms === "usdc" ? state.indexPrice : null;
  const withIcon = (symbol: string, cells: string[]): ActivityRow => {
    const icon = tokenIcon(symbol);
    return icon === undefined ? { cells } : { cells, icons: { 0: icon } };
  };
  return {
    columns: [...FUTURE_BALANCES_COLUMNS],
    rows: [
      withIcon("USDC", [
        "USDC",
        USD_CELL.format(account.cash),
        "$1.00",
        `$${USD_CELL.format(account.cash)}`,
      ]),
      ...(state?.terms === "american"
        ? []
        : [
            withIcon("cNGN", [
              "cNGN",
              USD_CELL.format(account.cngn),
              index === null ? "—" : `$${(1 / index).toFixed(7)}`,
              index === null ? "—" : `$${USD_CELL.format(account.cngn / index)}`,
            ]),
          ]),
    ],
  };
}

function signedPercent(value: number, digits: number) {
  return `${signPrefix(value)}${Math.abs(value).toFixed(digits)}%`;
}

/** How a series is quoted, for its stats: the selector's rows carry the same. */
export type FutureQuoting = Pick<
  FutureState,
  "baseSymbol" | "priceDecimals" | "priceUnit" | "terms"
>;

/** What the stats bar reads of a series: the selector's rows carry the same. */
export type FutureStatsInput = Pick<
  FutureState,
  "expiryMs" | "indexPrice" | "lastTradeAtMs" | "markPrice" | "settled"
> &
  FutureQuoting;

/**
 * The mark against the index: forward points (mark − index, in the series' price unit) and the
 * premium as a fraction (mark / index − 1). Null without both prices or with a non-positive index.
 */
export function futureBasis(state: Pick<FutureState, "indexPrice" | "markPrice"> | null) {
  const mark = state?.markPrice ?? null;
  const index = state?.indexPrice ?? null;
  if (mark === null || index === null || !(index > 0) || !(mark > 0)) {
    return null;
  }
  return { points: mark - index, premium: mark / index - 1 };
}

/**
 * The basis annualized: (mark / index − 1) × 365 / days to expiry, the naira-dollar rate
 * differential the future implies. Null without a basis, or once the series has expired or
 * settled, when there are no days left to spread it over.
 */
export function futureBasisApr(
  state: Pick<FutureState, "expiryMs" | "indexPrice" | "markPrice" | "settled"> | null,
  nowMs: number
) {
  const basis = futureBasis(state);
  if (state === null || basis === null || state.settled) {
    return null;
  }
  const days = (state.expiryMs - nowMs) / Duration.toMillis("1 day");
  return days > 0 ? (basis.premium * 365) / days : null;
}

/**
 * How the forward keeper sets the next hourly mark: from the futures book when each side holds
 * `FUTURE_MARK_BOOK_DEPTH_USDC` of notional, otherwise from the index carried forward. The keeper's
 * own threshold (perp-feeds FORWARD_MIN_BOOK_DEPTH_USDC) is the figure this mirrors.
 */
export const FUTURE_MARK_BOOK_DEPTH_USDC = 2000;

export type FutureMarkSource = "book" | "carry";

/** Which way the next mark is set, from the depth each side of the live book holds (USDC). */
export function futureMarkSource(depthUsdc: { asks: number; bids: number }): FutureMarkSource {
  return depthUsdc.bids >= FUTURE_MARK_BOOK_DEPTH_USDC &&
    depthUsdc.asks >= FUTURE_MARK_BOOK_DEPTH_USDC
    ? "book"
    : "carry";
}

/** A stablecoin's trailing "C" (EURC → EUR), to name the currency it tracks. */
const STABLECOIN_SUFFIX = /C$/;

/** The pair's rate differential as the tooltips name it: the naira's for cNGN, the base's otherwise. */
function differentialName(quoting: FutureQuoting | null) {
  if (quoting === null || quoting.baseSymbol === "cNGN") {
    return "NGN–USD";
  }
  return `${quoting.baseSymbol.replace(STABLECOIN_SUFFIX, "")}–USD`;
}

function markTooltip(source: FutureMarkSource | null, quoting: FutureQuoting | null) {
  const unit = quoting?.priceUnit ?? "cNGN per USDC";
  const method = `${unit}, set hourly by the forward keeper: the futures book's depth-weighted mid when each side holds ${USD_WHOLE.format(FUTURE_MARK_BOOK_DEPTH_USDC)} USDC, otherwise a model, the index carried forward at the ${differentialName(quoting)} rate differential. Either way it is held near that model and inside the index band. It is never the last trade. Variation margin is paid at it.`;
  if (source === null) {
    return method;
  }
  return `${method} The book ${source === "book" ? "holds that depth now, so the mark is book-derived" : "is thinner than that now, so the mark is model-derived"}.`;
}

const USD_WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function toneOf(value: number | null): PerpHeaderMetric["tone"] {
  if (value === null || value === 0) {
    return null;
  }
  return value > 0 ? "up" : "down";
}

/** A header price, with "$" when the series is quoted in USDC (American terms). */
function formatHeaderPrice(value: number | null, digits: number, dollars: boolean) {
  const text = formatFuturePrice(value, digits);
  return dollars && text !== "—" ? `$${text}` : text;
}

function formatBasis(basis: ReturnType<typeof futureBasis>, digits: number, dollars: boolean) {
  if (basis === null) {
    return "—";
  }
  return `${signPrefix(basis.points)}${formatHeaderPrice(Math.abs(basis.points), digits, dollars)} (${signedPercent(basis.premium * 100, 2)})`;
}

/**
 * Open interest at its USDC notional from the asset's `totalPosition`: the sum of every account's
 * |position| under the manager, 18 decimals a contract. That counts each contract on both its long
 * and its short side, so open interest is half of it. It spans every series of the asset under that
 * manager; each asset carries one series. A v2 contract is valued at the mark: null without one.
 */
export function futureOpenInterestUsd(
  totalPosition: bigint,
  state: Pick<FutureState, "contractSize" | "markPrice" | "terms">
) {
  return futureSizeUsdc(
    futureContractsSize(toContracts(totalPosition) / 2, state),
    state.markPrice,
    state
  );
}

function formatOpenInterestUsd(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return "—";
  }
  return value === 0 ? "$0" : formatCompactUsd(value);
}

/**
 * The future's header figures, in order: mark (with how it is set), index, basis in forward points
 * and percent, the basis annualized, and open interest at its USDC notional. Prices are in the
 * series' own terms.
 */
export function buildFutureHeaderMetrics({
  markSource,
  nowMs,
  openInterestUsd,
  state,
}: {
  /** How the next mark is set, from the live book; null while it is unknown. */
  markSource: FutureMarkSource | null;
  nowMs: number;
  openInterestUsd: number | null;
  state: FutureStatsInput | null;
}): PerpHeaderMetric[] {
  const basis = futureBasis(state);
  const apr = futureBasisApr(state, nowMs);
  const digits = state?.priceDecimals ?? V1_PRICE_DECIMALS;
  const american = state?.terms === "american";
  return [
    {
      label: "Mark",
      tone: null,
      tooltip: markTooltip(markSource, state),
      value: formatHeaderPrice(state?.markPrice ?? null, digits, american),
    },
    {
      label: "Index",
      tone: null,
      tooltip: american
        ? `The ${state.baseSymbol} reference in ${state.priceUnit}; the series settles at its average over the last hour`
        : "The NGN/USD reference in cNGN per USDC; the series settles at its average over the last hour",
      value: formatHeaderPrice(state?.indexPrice ?? null, digits, american),
    },
    {
      label: "Basis",
      tone: toneOf(basis?.points ?? null),
      tooltip: "Mark − Index. Positive when the future trades above spot.",
      value: formatBasis(basis, digits, american),
    },
    {
      label: "APR",
      tone: null,
      tooltip: american
        ? `The basis annualized: the USD interest rate less the ${differentialName(state).split("–")[0]} one, as the future implies it.`
        : "Implied naira-dollar rate differential, annualized.",
      value: apr === null ? "—" : signedPercent(apr * 100, 2),
    },
    {
      label: "Open Interest",
      tone: null,
      tooltip: "Contracts open, one side, at their USDC notional",
      // Nothing open is a figure, not a gap: "$0", where an unread value is a dash.
      value: formatOpenInterestUsd(openInterestUsd),
    },
  ];
}

/**
 * A series' stats-bar figures from its selector row: the selector's Futures tab shows them, and the
 * header shows them while the series' panels load after a switch. The same builder as the bar, so
 * the two never compute or word a figure differently.
 */
export function buildFutureOverviewMetrics(
  row: {
    expiryMs: number | null;
    /** How the series is quoted; null on a row the venue is not serving. */
    futureQuoting: FutureQuoting | null;
    indexPrice: number | null;
    lastTradeAtMs: number | null;
    markPrice: number | null;
    markSource: FutureMarkSource | null;
    openInterestUsd: number | null;
    settled: boolean | null;
  },
  nowMs: number
): PerpHeaderMetric[] {
  const state =
    row.expiryMs === null || row.lastTradeAtMs === null || row.futureQuoting === null
      ? null
      : {
          ...row.futureQuoting,
          expiryMs: row.expiryMs,
          indexPrice: row.indexPrice,
          lastTradeAtMs: row.lastTradeAtMs,
          markPrice: row.markPrice,
          settled: row.settled ?? false,
        };
  return buildFutureHeaderMetrics({
    markSource: row.markSource,
    nowMs,
    openInterestUsd: row.openInterestUsd,
    state,
  });
}

/** The venue's refusal of a future order in a trader's words; the venue's own text otherwise. */
export function describeFutureRejection(error: string | null | undefined, fallback: string) {
  const message = error?.trim();
  if (!message) {
    return fallback;
  }
  if (message.startsWith("fill_band")) {
    return "Limit price outside the fill band: the venue only takes prices within the band around the index shown in the header.";
  }
  if (message.includes("not the MarginEngine")) {
    return "This order came from an account that cannot hold the future: only accounts under the MarginEngine can. Deposit to open one and try again.";
  }
  if (message.startsWith("trading_paused")) {
    return "Trading is paused on the futures engine. Try again shortly.";
  }
  return message;
}
