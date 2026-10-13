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
import { formatCompactUsd } from "@/lib/ticker-stats";
import { tokenIcon } from "@/lib/token-icons";
import type { ActivityRow, ActivityView, CellTone } from "@/lib/trading.types";

/**
 * The future is quoted in cNGN per USDC (about 1,390), so two decimals resolve well under a basis
 * point; the engine's own tick is 1e-18.
 */
export const FUTURE_PRICE_DECIMALS = 2;

/** The ladder's price groupings for the future, in cNGN per USDC, finest first. */
export const FUTURE_PRICE_GROUPS = [0.01, 0.1, 1, 5] as const;

/**
 * The fee ceiling signed into every future order, as a fraction of a contract's notional: the
 * same 30 bps spot and the perp sign against a 25 bps schedule. TradeModule compares it per
 * contract, so it is signed as USDC per contract, never scaled by the price.
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

/** A cNGN-per-USDC price, e.g. "1,386.81"; an em dash when unknown. */
export function formatFuturePrice(value: number | null, digits = FUTURE_PRICE_DECIMALS) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return formatMarketPrice(value, digits);
}

/** A cNGN-per-USDC price with its unit, where nothing else names it: "₦1,386.81". */
export function formatNairaPrice(value: number | null) {
  const price = formatFuturePrice(value);
  return price === "—" ? price : `₦${price}`;
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
  asset_address?: string;
  sub_id?: string;
  trade_module_address?: string;
  quote_asset_address?: string;
  margin_manager_address?: string;
  expiry_timestamp?: number;
  fill_band_low?: string;
  fill_band_high?: string;
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
  return {
    contractSizeUsdc: positiveDecimal(future.contract_size_usdc) ?? 1000,
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

/** The signed fee ceiling per contract, 18 decimals: 3 USDC on a 1,000 USDC contract. */
export function futureWorstFeeUnits(contractSizeUsdc: number): bigint {
  const microUsdc = BigInt(Math.round(contractSizeUsdc * FUTURE_WORST_FEE_RATE * 1e6));
  return microUsdc * 10n ** 12n;
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

/** Time left to an instant, coarsest two units: "48d 17h", "5h 12m", "12m", "<1m"; "—" once past. */
export function formatCountdown(targetMs: number, nowMs: number) {
  const left = targetMs - nowMs;
  if (!Number.isFinite(left) || left <= 0) {
    return "—";
  }
  const day = Duration.toMillis("1 day");
  const hour = Duration.toMillis("1 hour");
  const minute = Duration.toMillis("1 minute");
  const days = Math.floor(left / day);
  const hours = Math.floor((left % day) / hour);
  const minutes = Math.floor((left % hour) / minute);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return minutes > 0 ? `${minutes}m` : "<1m";
}

const UTC_STAMP = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

/** An instant in UTC, as the series is specified: "30 Nov 2026, 14:00 UTC". */
export function formatUtcStamp(ms: number) {
  return `${UTC_STAMP.format(ms)} UTC`;
}

/** A future long is a buy: it gains when cNGN weakens, as more cNGN per USDC. */
export function futureOrderUiSide(side: FutureSide): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}

export function futureSideLabel(side: FutureSide) {
  return side === "long" ? "Long" : "Short";
}

/** Contracts as the ledger holds them, 18 decimals, to a signed whole-contract count. */
export function toContracts(units: bigint) {
  return Number(units / 10n ** 12n) / 1e6;
}

/**
 * What an order does to the margin the engine checks, before it is sent: the contracts it adds
 * to the account's exposure (a reduction adds none, and the engine checks it against maintenance
 * margin only), the initial margin those add, and the taker fee if it crosses.
 */
export function estimateFutureOrder({
  account,
  contracts,
  side,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  contracts: number;
  side: FutureSide;
  state: FutureState;
  takerFeeBps: number | null;
}) {
  const position = account === null ? 0 : toContracts(account.positionUnits);
  const after = position + (side === "long" ? contracts : -contracts);
  const added = Math.max(0, Math.abs(after) - Math.abs(position));
  const imRate = account?.imRate ?? null;
  const notional = contracts * state.contractSizeUsdc;
  const fee = takerFeeBps === null ? null : (notional * takerFeeBps) / 10_000;
  const initialMargin = imRate === null ? null : added * state.contractSizeUsdc * imRate;
  const shortfall =
    account === null || initialMargin === null
      ? null
      : Math.max(0, initialMargin + (fee ?? 0) - account.initialMarginSurplus);
  return { after, fee, initialMargin, notional, position, shortfall };
}

/**
 * The most contracts the ticket offers on one side: the position it can close outright (reducing
 * is always allowed), plus what the initial margin surplus opens at the engine's rate with the
 * taker fee on top. Zero without an account or its rates.
 */
export function maxFutureContracts({
  account,
  side,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  side: FutureSide;
  state: FutureState;
  takerFeeBps: number | null;
}) {
  if (account === null) {
    return 0;
  }
  const position = toContracts(account.positionUnits);
  const closable = side === "long" ? Math.max(0, -position) : Math.max(0, position);
  const perContract = state.contractSizeUsdc * (account.imRate + (takerFeeBps ?? 0) / 10_000);
  const opening =
    perContract > 0 ? Math.floor(Math.max(0, account.initialMarginSurplus) / perContract) : 0;
  return Math.floor(closable) + opening;
}

const USD_CELL = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const CONTRACTS_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

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
 * account last settled, which is the position's running profit or loss at the mark.
 */
export const FUTURE_POSITIONS_COLUMNS = [
  "Market",
  "Size",
  "Notional",
  "Mark Price",
  "Unsettled VM",
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
  const size = Math.abs(contracts);
  const notional = size * state.contractSizeUsdc;
  const vmUsd = state.markPrice === null ? null : account.pendingVmCngn / state.markPrice;
  const tones: Record<number, CellTone> = { 1: sideTone(futureOrderUiSide(side)) };
  const vmTone = pnlTone(account.pendingVmCngn);
  if (vmTone !== undefined) {
    tones[4] = vmTone;
  }
  const row: ActivityRow = {
    badges: { 0: [{ label: futureSideLabel(side), tone: tones[1] }] },
    details: vmUsd === null ? undefined : { 4: `(≈ ${signedUsd(vmUsd)})` },
    cells: [
      label,
      `${CONTRACTS_CELL.format(size)} ${size === 1 ? "contract" : "contracts"}`,
      `$${USD_CELL.format(notional)}`,
      formatFuturePrice(state.markPrice),
      signedCngn(account.pendingVmCngn),
      `$${USD_CELL.format(notional * account.imRate)}`,
      signedUsd(account.maintenanceMarginSurplus),
    ],
    tones,
  };
  return { columns: [...FUTURE_POSITIONS_COLUMNS], rows: [row] };
}

/** The Balances tab's columns. The trailing column holds each row's Deposit and Withdraw. */
export const FUTURE_BALANCES_COLUMNS = ["Asset", "Amount", "Price", "Value", ""];

/**
 * The trading account's balances: its USDC cash, then its cNGN collateral, valued at the index
 * (cNGN per USDC, so a cNGN balance is worth balance ÷ index dollars before the engine's haircut).
 * cNGN is listed at zero until it is held, so a depositor sees where it would go.
 */
export function buildFutureBalancesView(
  account: FutureAccount | null,
  state: FutureState | null
): ActivityView {
  if (account === null) {
    return { columns: [...FUTURE_BALANCES_COLUMNS], rows: [] };
  }
  const index = state?.indexPrice ?? null;
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
      withIcon("cNGN", [
        "cNGN",
        USD_CELL.format(account.cngn),
        index === null ? "—" : `$${(1 / index).toFixed(7)}`,
        index === null ? "—" : `$${USD_CELL.format(account.cngn / index)}`,
      ]),
    ],
  };
}

function signedPercent(value: number, digits: number) {
  return `${signPrefix(value)}${Math.abs(value).toFixed(digits)}%`;
}

/** The day's move as "+1.20 (+0.09%)", or a dash without both ends of the window. */
function formatFutureChange(firstPrice: number | null, lastPrice: number | null) {
  if (firstPrice === null || lastPrice === null || firstPrice <= 0) {
    return { change: null, value: "—" };
  }
  const change = lastPrice - firstPrice;
  const percent = (change / firstPrice) * 100;
  return {
    change,
    value: `${signPrefix(change)}${formatFuturePrice(Math.abs(change))} (${signedPercent(percent, 2)})`,
  };
}

/** The mark's premium over the index, as a percentage of the index; null without both. */
function basisPercent(state: FutureState | null) {
  const mark = state?.markPrice ?? null;
  const index = state?.indexPrice ?? null;
  return mark !== null && index !== null ? ((mark - index) / index) * 100 : null;
}

function formatBand(band: FutureState["fillBand"]) {
  return band === null ? "—" : `${formatFuturePrice(band.low)} – ${formatFuturePrice(band.high)}`;
}

function toneOf(value: number | null): PerpHeaderMetric["tone"] {
  if (value === null || value === 0) {
    return null;
  }
  return value > 0 ? "up" : "down";
}

/**
 * The future's header figures: mark and index from the venue, the basis between them, the day's
 * move and volume, the band a fill must sit in, and the time left to trade. Prices are cNGN per
 * USDC; the volume is the contracts traded at their USDC notional.
 */
export function buildFutureHeaderMetrics({
  firstPrice,
  lastPrice,
  nowMs,
  state,
  volumeUsd,
}: {
  firstPrice: number | null;
  lastPrice: number | null;
  nowMs: number;
  state: FutureState | null;
  volumeUsd: number | null;
}): PerpHeaderMetric[] {
  const change = formatFutureChange(firstPrice, lastPrice);
  const basis = basisPercent(state);
  return [
    {
      label: "Mark",
      tone: null,
      tooltip:
        "cNGN per USDC. The price variation margin is paid at: each hourly mark moves every position by Δmark × 1,000 cNGN a contract",
      value: formatFuturePrice(state?.markPrice ?? null),
    },
    {
      label: "Index",
      tone: null,
      tooltip:
        "The NGN/USD reference in cNGN per USDC; the series settles at its average over the last hour",
      value: formatFuturePrice(state?.indexPrice ?? null),
    },
    {
      label: "Basis",
      tone: toneOf(basis),
      tooltip: "The mark's premium over the index",
      value: basis === null ? "—" : signedPercent(basis, 2),
    },
    { label: "24h Change", tone: toneOf(change.change), value: change.value },
    { label: "24h Volume", tone: null, value: formatCompactUsd(volumeUsd ?? Number.NaN) },
    {
      label: "Fill Band",
      tone: null,
      tooltip:
        "The prices a fill may carry, around the index: the chain refuses a fill outside it, and so does the venue",
      value: formatBand(state?.fillBand ?? null),
    },
    {
      label: "Last Trade In",
      tone: null,
      tooltip:
        state === null
          ? undefined
          : `New orders close ${formatUtcStamp(state.lastTradeAtMs)}; the series settles ${formatUtcStamp(state.expiryMs)}`,
      value: state === null ? "—" : formatCountdown(state.lastTradeAtMs, nowMs),
    },
  ];
}

/** The header's figures from the selector's row while the future's panels load after a switch. */
export function buildFutureOverviewMetrics(
  row: {
    changePercent24h: number | null;
    lastTradeAtMs: number | null;
    volume24hUsd: number | null;
  },
  nowMs: number
): PerpHeaderMetric[] {
  const live = buildFutureHeaderMetrics({
    firstPrice: null,
    lastPrice: null,
    nowMs,
    state: null,
    volumeUsd: row.volume24hUsd,
  });
  const seeded: Partial<Record<string, Pick<PerpHeaderMetric, "tone" | "value">>> = {
    "24h Change": {
      tone: toneOf(row.changePercent24h),
      value: row.changePercent24h === null ? "—" : `(${signedPercent(row.changePercent24h, 2)})`,
    },
    "Last Trade In": {
      tone: null,
      value: row.lastTradeAtMs === null ? "—" : formatCountdown(row.lastTradeAtMs, nowMs),
    },
  };
  return live.map((metric) => ({ ...metric, ...seeded[metric.label] }));
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
