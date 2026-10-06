import { getAddress, isAddress, parseUnits } from "viem";
import { formatNaira } from "@/lib/market-formatting";
import type {
  PerpAccountMargin,
  PerpCngnExposure,
  PerpCollateralAsset,
  PerpCollateralBalance,
  PerpHeaderMetric,
  PerpPosition,
  PerpStack,
  PerpState,
} from "@/lib/perp-market.types";
import { sideTone } from "@/lib/side-tone";
import { getCngnTokenAddress, getUsdcTokenAddress } from "@/lib/subaccount-deposit-config";
import { formatCompactVolume } from "@/lib/ticker-stats";
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
 * `margin` of cash. Venue orientation in and out (cNGN per USDC); the arithmetic runs in the engine's
 * (USDC per cNGN), where maintenance surplus is linear in price:
 *
 *   surplus(e) = C + S·(e − e0) − |S|·mm·e
 *
 * with S the signed NGN position (negative for a venue long). Null when no positive price gets
 * there. An estimate: it ignores fees and funding.
 */
export function estimateLiquidationPrice({
  side,
  sizeUsd,
  entryPrice,
  margin,
  maintenanceMarginRate,
}: {
  side: "long" | "short";
  sizeUsd: number;
  entryPrice: number;
  margin: number;
  maintenanceMarginRate: number;
}): number | null {
  if (!(sizeUsd > 0 && entryPrice > 0 && margin >= 0 && maintenanceMarginRate > 0)) {
    return null;
  }
  const e0 = 1 / entryPrice;
  const ngn = sizeUsd * entryPrice;
  const s = side === "long" ? -ngn : ngn;
  // C + S(e - e0) - |S| mm e = 0  =>  e = (S e0 - C) / (S - |S| mm)
  const denominator = s - Math.abs(s) * maintenanceMarginRate;
  if (denominator === 0) {
    return null;
  }
  const e = (s * e0 - margin) / denominator;
  return e > 0 ? 1 / e : null;
}

type PresentedPositionPayload = {
  ui_side?: string;
  ui_size?: string;
  /** Signed whole cNGN contracts; negative is the venue's long. */
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
      maintenanceMarginSurplus === null
    ) {
      continue;
    }
    positions.push({
      engineSize,
      initialMarginSurplus,
      liquidationPrice: positive(row.liquidation_price_ui),
      maintenanceMarginSurplus,
      markPrice,
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

const HOURS_PER_DAY = 24;
/** For the simple annualised funding figure: the hourly rate times the hours in a year. */
const HOURS_PER_YEAR = HOURS_PER_DAY * 365;
const DAYS_PER_MONTH = 30;

/**
 * What an account's cNGN does for its position, or null for an account that posted no cNGN.
 * Information only (the ticket's naira-doubling warning reads it): how much of the account's long
 * USD the cNGN offsets at the index, what is left exposed to the naira either way, and the funding
 * the offset part pays or receives at the current rate.
 */
export function buildPerpCngnExposure(
  account: PerpAccountMargin | null,
  positions: PerpPosition[],
  state: PerpState | null
): PerpCngnExposure | null {
  if (account === null || state === null) {
    return null;
  }
  const cngn = account.collateral.filter((row) => row.symbol === "cNGN");
  if (cngn.length === 0) {
    return null;
  }
  const collateralCngn = cngn.reduce((sum, row) => sum + row.balance, 0);
  const collateralUsd = cngn.reduce((sum, row) => sum + row.valueUsd, 0);
  const longUsd = positions
    .filter((position) => position.uiSide === "long")
    .reduce((sum, position) => sum + position.uiSize, 0);
  const longNairaUsd = positions
    .filter((position) => position.uiSide === "short")
    .reduce((sum, position) => sum + position.uiSize, 0);
  const offsetUsd = Math.min(collateralUsd, longUsd);
  const fundingPerDayUsd = offsetUsd * state.uiLongFundingRate1h * HOURS_PER_DAY;
  return {
    collateralCngn,
    collateralUsd,
    fundingPerDayUsd,
    fundingPerMonthUsd: fundingPerDayUsd * DAYS_PER_MONTH,
    longNairaUsd,
    longUsd,
    nairaExposureUsd: collateralUsd + longNairaUsd - longUsd,
    offsetUsd,
  };
}

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

function signedUsd(value: number) {
  return `${signOf(value)}${USD_CELL.format(Math.abs(value))} USDC`;
}

/**
 * The cNGN leg of a side. The venue's long is long USDC, which is short cNGN, so the two words
 * always disagree; `lib/perp-market.test.mjs` pins this against `perpOrderUiSide`, because a flip
 * in one and not the other would place a live order the opposite way from what the button said.
 */
function cngnLeg(side: "long" | "short") {
  return side === "long" ? "Short cNGN" : "Long cNGN";
}

const SUBMIT_SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * What the ticket's submit button says for a side: the cNGN leg, then the size in the unit it is
 * entered in (USDC notional) after a dot so it never reads as cNGN.
 */
export function perpSubmitLabel(side: "long" | "short", sizeUsd: number | null) {
  const amount = sizeUsd === null ? "" : ` · ${SUBMIT_SIZE.format(sizeUsd)} USDC`;
  return `${cngnLeg(side)}${amount}`;
}

/** The side an order is sent with: a venue long buys USD, exactly as a spot buy does. */
export function perpOrderUiSide(side: "long" | "short"): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}

/**
 * A position's side, in both the venue's word and the cNGN leg the ticket names: the button a
 * trader pressed said "Long cNGN", and a row that then said only "Short" read as a wrong fill.
 */
export function perpSideLabel(uiSide: "long" | "short") {
  return `${uiSide === "long" ? "Long" : "Short"} · ${cngnLeg(uiSide)}`;
}

/** The Positions tab: side and size in the venue's terms, mark, liquidation price, PnL. */
export function buildPerpPositionsView(positions: PerpPosition[], label: string) {
  return {
    columns: ["Instrument", "Side", "Size", "Mark price", "Liq. price", "Unrealized PnL"],
    rows: positions.map((position) => ({
      tones: { 1: sideTone(perpOrderUiSide(position.uiSide)) },
      cells: [
        label,
        perpSideLabel(position.uiSide),
        `${USD_CELL.format(position.uiSize)} USDC`,
        `₦${USD_CELL.format(position.markPrice)}`,
        position.liquidationPrice === null ? "—" : `₦${USD_CELL.format(position.liquidationPrice)}`,
        signedUsd(position.unrealizedPnl),
      ],
    })),
  };
}

const PERCENT_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" });

/**
 * The Margin tab: one row per asset the account's margin is made of, with the balance, its value
 * in USDC and what the SRM credits as margin. Cash first, worth and credited at face value; then
 * each collateral asset held, at its index value and its margin factor; then, at zero, every
 * collateral asset the venue accepts that the account does not hold, so a depositor sees where it
 * would go. The row order is what `withdrawTarget` and the row actions index by: cash, the held
 * collateral in order, then the unheld ones. The headroom is one figure for the whole account
 * (cross-margin), shown on the cash row.
 */
export function buildPerpMarginView(
  account: PerpAccountMargin | null,
  listed: PerpCollateralAsset[] = []
) {
  const held = account?.collateral ?? [];
  const unheld = listed.filter(
    (asset) => !held.some((row) => row.escrow.toLowerCase() === asset.escrow.toLowerCase())
  );
  return {
    rows:
      account === null
        ? []
        : [
            {
              cells: [
                "USDC",
                `${USD_CELL.format(account.cash)} USDC`,
                `${USD_CELL.format(account.cash)} USDC`,
                `${USD_CELL.format(account.cash)} USDC (100%)`,
                signedUsd(account.initialMarginSurplus),
                signedUsd(account.maintenanceMarginSurplus),
              ],
            },
            ...held.map((row) => ({
              cells: [
                row.symbol,
                `${USD_CELL.format(row.balance)} ${row.symbol}`,
                `${USD_CELL.format(row.valueUsd)} USDC`,
                `${USD_CELL.format(row.marginValueUsd)} USDC (${PERCENT_CELL.format(
                  row.valueUsd > 0 ? row.marginValueUsd / row.valueUsd : 0
                )})`,
                "",
                "",
              ],
            })),
            ...unheld.map((asset) => ({
              cells: [
                asset.symbol,
                `0.00 ${asset.symbol}`,
                "0.00 USDC",
                `0.00 USDC (${PERCENT_CELL.format(asset.marginFactor)})`,
                "",
                "",
              ],
            })),
          ],
    columns: [
      "Asset",
      "Balance",
      "Value",
      "Counts as margin",
      "Initial margin headroom",
      "Maintenance margin headroom",
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

function signedNaira(value: number) {
  return `${value < 0 ? "-" : "+"}${formatNaira(Math.abs(value))}`;
}

function signedPercent(value: number, digits: number) {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(digits)}%`;
}

/** Open interest in USDC, compact; a venue with none open reads zero, not a dash. */
function formatOpenInterest(state: PerpState | null) {
  if (state === null) {
    return "—";
  }
  const compact = formatCompactVolume(state.openInterestUsd);
  return compact === "—" ? "0 USDC" : compact;
}

function toneOf(value: number | null): PerpHeaderMetric["tone"] {
  if (value === null || value === 0 || !Number.isFinite(value)) {
    return null;
  }
  return value > 0 ? "up" : "down";
}

/**
 * The perp header's figures, in the order a perp trader reads them: mark and index from the chain,
 * the day's move against the live price, volume, open interest and the hourly funding rate. Every
 * figure is the venue's own; a missing one is a dash. There is no market cap: a stablecoin FX
 * perp has no supply to value. There is no funding countdown either: the PerpAsset contract
 * accrues funding continuously (`aggregatedFunding += rate × elapsed / 1 hour` on every touch),
 * so there is no settlement moment to count down to, and a timer would be fiction.
 */
export function buildPerpHeaderMetrics({
  firstPrice,
  price,
  state,
  volumeLabel,
}: {
  /** The 24h window's first trade, which the change is measured from. */
  firstPrice: number | null;
  /** The live price the change is measured to: the book's mid, else the mark. */
  price: number | null;
  state: PerpState | null;
  volumeLabel: string;
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
      value: formatNaira(state?.markPrice ?? null),
    },
    {
      label: "Index",
      tone: null,
      tooltip: "The external NGN/USD reference the mark tracks; funding pushes the two together",
      value: formatNaira(state?.indexPrice ?? null),
    },
    {
      label: "24h Change",
      tone: toneOf(change),
      value:
        change === null || changePercent === null
          ? "—"
          : `${signedNaira(change)} (${signedPercent(changePercent, 2)})`,
    },
    { label: "24h Volume", tone: null, value: volumeLabel },
    {
      label: "Open Interest",
      tone: null,
      tooltip: "The USD notional of every open position, long and short",
      value: formatOpenInterest(state),
    },
    {
      label: "1h Funding",
      // Annualised beside the label rather than in the value: the value row is what sets the
      // metric's width, and six metrics have to share the row with the account buttons.
      labelSuffix:
        funding === null ? undefined : `${signedPercent(funding * HOURS_PER_YEAR * 100, 1)} APR`,
      tone: toneOf(funding),
      tooltip:
        "Hourly, as the long side sees it: positive means longs pay shorts. Beside it, the same rate annualised (hourly × 24 × 365, not compounded). It accrues every second; there is no funding settlement to count down to.",
      value: funding === null ? "—" : signedPercent(funding * 100, 4),
    },
  ];
}
