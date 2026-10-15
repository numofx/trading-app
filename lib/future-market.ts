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

/**
 * The ladder's price groupings for the future, in cNGN per USDC, the default first: whole cNGN, a
 * level per 1.00, which spreads the maker's ladder over the grid rather than a sliver of it.
 */
export const FUTURE_PRICE_GROUPS = [1, 0.1, 0.01] as const;

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
  const contractSizeUsdc = positiveDecimal(future.contract_size_usdc) ?? 1000;
  const amountScale = parseAmountScale(presentation?.amount_scale);
  return {
    amountScale,
    bandWidth: positiveDecimal(future.band_width),
    contractSizeUsdc,
    expiryMs: expiry * 1000,
    fillBand: low !== null && high !== null && low < high ? { high, low } : null,
    indexPrice: positiveDecimal(future.index_price),
    lastTradeAtMs: lastTrade * 1000,
    listed: future.listed === true,
    markPrice: positiveDecimal(future.mark_price),
    settled: future.settled === true,
    tradingClosedReason: future.trading_closed_reason?.trim() || null,
    tradingOpen: future.trading_open === true,
    unitUsdc: (contractSizeUsdc * Number(amountScale / 10n ** 12n)) / 1e6,
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

/** The signed fee ceiling per contract, 18 decimals: 3 USDC on a 1,000 USDC contract. */
export function futureWorstFeeUnits(contractSizeUsdc: number): bigint {
  const microUsdc = BigInt(Math.round(contractSizeUsdc * FUTURE_WORST_FEE_RATE * 1e6));
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

/** Contracts as the ledger holds them, 18 decimals, to a signed count to six decimals. */
export function toContracts(units: bigint) {
  return Number(units / 10n ** 12n) / 1e6;
}

/** A position or order as USDC of notional: contracts × the contract size. */
export function futureNotionalUsdc(contracts: number, state: FutureState) {
  return contracts * state.contractSizeUsdc;
}

/**
 * A ticket's size, USDC of notional, as the venue's whole units, or null unless it is a positive
 * whole number of them: the venue rests whole units only (1 USDC since it sized the future in USDC).
 */
export function futureOrderUnits(sizeUsdc: number, state: FutureState) {
  if (!Number.isFinite(sizeUsdc) || sizeUsdc <= 0 || state.unitUsdc <= 0) {
    return null;
  }
  const units = sizeUsdc / state.unitUsdc;
  const whole = Math.round(units);
  return whole >= 1 && Math.abs(units - whole) < 1e-9 ? whole : null;
}

/**
 * What an order of `notional` USDC does to the margin the engine checks, before it is sent: the
 * exposure it adds (a reduction adds none, and the engine checks it against maintenance margin
 * only), the initial margin that adds, and the taker fee if it crosses. `position` and `after`
 * are USDC of notional, signed: positive long.
 */
export function estimateFutureOrder({
  account,
  notional,
  side,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  notional: number;
  side: FutureSide;
  state: FutureState;
  takerFeeBps: number | null;
}) {
  const position =
    account === null ? 0 : futureNotionalUsdc(toContracts(account.positionUnits), state);
  const after = position + (side === "long" ? notional : -notional);
  const added = Math.max(0, Math.abs(after) - Math.abs(position));
  const imRate = account?.imRate ?? null;
  const fee = takerFeeBps === null ? null : (notional * takerFeeBps) / 10_000;
  const initialMargin = imRate === null ? null : added * imRate;
  const shortfall =
    account === null || initialMargin === null
      ? null
      : Math.max(0, initialMargin + (fee ?? 0) - account.initialMarginSurplus);
  return { after, fee, initialMargin, notional, position, shortfall };
}

/**
 * The account's leverage once an order leaves the position at `afterNotional` (USDC, signed): its
 * size over the margin the engine credits the account, which is the initial margin surplus plus
 * what the open position already holds at the initial rate. The engine opens up to 1 / its initial
 * rate. There is no per-position leverage to set: the engine margins the account as a whole.
 */
export function estimateFutureLeverage({
  account,
  afterNotional,
  state,
}: {
  account: FutureAccount | null;
  afterNotional: number;
  state: FutureState;
}) {
  if (account === null || !(account.imRate > 0)) {
    return { leverage: null, maxLeverage: null };
  }
  const held = Math.abs(futureNotionalUsdc(toContracts(account.positionUnits), state));
  const credited = account.initialMarginSurplus + held * account.imRate;
  return {
    leverage: credited > 0 ? Math.abs(afterNotional) / credited : null,
    maxLeverage: 1 / account.imRate,
  };
}

/**
 * The most USDC of notional the ticket offers on one side, in whole venue units: the position it
 * can close outright (reducing is always allowed), plus what the initial margin surplus opens at
 * the engine's rate with the taker fee on top. Zero without an account or its rates.
 */
export function maxFutureNotional({
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
  if (account === null || state.unitUsdc <= 0) {
    return 0;
  }
  const position = futureNotionalUsdc(toContracts(account.positionUnits), state);
  const closable = side === "long" ? Math.max(0, -position) : Math.max(0, position);
  const perUsdc = account.imRate + (takerFeeBps ?? 0) / 10_000;
  const opening = perUsdc > 0 ? Math.max(0, account.initialMarginSurplus) / perUsdc : 0;
  return Math.floor((closable + opening) / state.unitUsdc) * state.unitUsdc;
}

const USD_CELL = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const CONTRACTS_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const SIZE_USDC_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

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
 * account last settled. VM settles in cNGN at once on every fill (the gap between the fill price
 * and the mark) and whenever the account is touched, so this is only what the hourly marks have
 * added since: "Pending", not the position's whole profit or loss.
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
  const size = Math.abs(contracts);
  const notional = size * state.contractSizeUsdc;
  const vmUsd = state.markPrice === null ? null : account.pendingVmCngn / state.markPrice;
  const tones: Record<number, CellTone> = { 1: sideTone(futureOrderUiSide(side)) };
  const vmTone = pnlTone(account.pendingVmCngn);
  if (vmTone !== undefined) {
    tones[4] = vmTone;
  }
  const contractsText = `${CONTRACTS_CELL.format(size)} ${size === 1 ? "contract" : "contracts"}`;
  const row: ActivityRow = {
    badges: { 0: [{ label: futureSideLabel(side), tone: tones[1] }] },
    details:
      vmUsd === null ? { 1: contractsText } : { 1: contractsText, 4: `(≈ ${signedUsd(vmUsd)})` },
    cells: [
      label,
      `${SIZE_USDC_CELL.format(notional)} USDC`,
      `$${USD_CELL.format(notional)}`,
      formatFuturePrice(state.markPrice),
      signedCngn(account.pendingVmCngn),
      `$${USD_CELL.format(notional * account.imRate)}`,
      signedUsd(account.maintenanceMarginSurplus),
    ],
    titles: {
      1: `${contractsText} of ${USD_CELL.format(state.contractSizeUsdc)} USDC each`,
      4: "Variation margin the hourly marks have accrued since the account last settled. VM settles in cNGN at once on every fill (the gap between the fill price and the mark) and whenever the account is touched, so a new position starts here at zero.",
    },
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

/**
 * The mark against the index: forward points (mark − index, cNGN per USDC) and the premium as a
 * fraction (mark / index − 1). Null without both prices or with a non-positive index.
 */
/** What the stats bar reads of a series: the selector's rows carry the same. */
export type FutureStatsInput = Pick<
  FutureState,
  "expiryMs" | "indexPrice" | "lastTradeAtMs" | "markPrice" | "settled"
>;

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

function markTooltip(source: FutureMarkSource | null) {
  const method = `cNGN per USDC, set hourly by the forward keeper: the futures book's depth-weighted mid when each side holds ${USD_WHOLE.format(FUTURE_MARK_BOOK_DEPTH_USDC)} USDC, otherwise a model, the index carried forward at the NGN–USD rate differential. Either way it is held within 3% of that model and inside the index band. It is never the last trade. Variation margin is paid at it.`;
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

function formatBasis(basis: ReturnType<typeof futureBasis>) {
  if (basis === null) {
    return "—";
  }
  return `${signPrefix(basis.points)}${formatFuturePrice(Math.abs(basis.points))} (${signedPercent(basis.premium * 100, 2)})`;
}

/** Time to expiry, or what the series is once it has none left. */
function formatExpiresIn(state: FutureStatsInput | null, nowMs: number) {
  if (state === null) {
    return "—";
  }
  if (state.settled) {
    return "Settled";
  }
  return state.expiryMs <= nowMs ? "Expired" : formatCountdown(state.expiryMs, nowMs);
}

/**
 * Open interest at its USDC notional from the asset's `totalPosition`: the sum of every account's
 * |position| under the manager, 18 decimals a contract. That counts each contract on both its long
 * and its short side, so open interest is half of it. It spans every series of the asset under that
 * manager; one series is listed at a time.
 */
export function futureOpenInterestUsd(totalPosition: bigint, contractSizeUsdc: number) {
  return (toContracts(totalPosition) / 2) * contractSizeUsdc;
}

/**
 * The future's header figures, in order: mark (with how it is set), index, basis in forward points
 * and percent, the basis annualized, open interest at its USDC notional, and the time to expiry.
 * Prices are cNGN per USDC.
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
  return [
    {
      label: "Mark",
      tone: null,
      tooltip: markTooltip(markSource),
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
      tone: toneOf(basis?.points ?? null),
      tooltip: "Mark − Index. Positive when the future trades above spot.",
      value: formatBasis(basis),
    },
    {
      label: "APR",
      tone: null,
      tooltip: "Implied naira-dollar rate differential, annualized.",
      value: apr === null ? "—" : signedPercent(apr * 100, 2),
    },
    {
      label: "Open Interest",
      tone: null,
      tooltip: "Contracts open, one side, at their USDC notional",
      value: openInterestUsd === null ? "—" : formatCompactUsd(openInterestUsd),
    },
    {
      label: "Expires In",
      tone: null,
      tooltip:
        state === null
          ? undefined
          : `New orders close ${formatUtcStamp(state.lastTradeAtMs)}; the series settles ${formatUtcStamp(state.expiryMs)}`,
      value: formatExpiresIn(state, nowMs),
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
    row.expiryMs === null || row.lastTradeAtMs === null
      ? null
      : {
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
