import { getAddress, isAddress, parseUnits } from "viem";
import type {
  PerpAccountMargin,
  PerpPosition,
  PerpStack,
  PerpState,
} from "@/lib/perp-market.types";
import { getUsdcTokenAddress } from "@/lib/subaccount-deposit-config";
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
  return { assetAddress: asset, cashAddress: cash, srmAddress: srm, tradeModuleAddress: module };
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
      ? { cash, cashUnits, initialMarginSurplus: im, maintenanceMarginSurplus: mm }
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

/** The Positions tab: side and size in the venue's terms, mark, liquidation price, PnL. */
export function buildPerpPositionsView(positions: PerpPosition[], label: string) {
  return {
    columns: ["Instrument", "Side", "Size", "Mark price", "Liq. price", "Unrealized PnL"],
    rows: positions.map((position) => ({
      cells: [
        label,
        position.uiSide === "long" ? "Long" : "Short",
        `${USD_CELL.format(position.uiSize)} USDC`,
        `₦${USD_CELL.format(position.markPrice)}`,
        position.liquidationPrice === null ? "—" : `₦${USD_CELL.format(position.liquidationPrice)}`,
        signedUsd(position.unrealizedPnl),
      ],
    })),
  };
}

/** The Margin tab: one row of the account's cash and headroom, or none before it is read. */
export function buildPerpMarginView(account: PerpAccountMargin | null) {
  return {
    columns: ["Cash", "Initial margin headroom", "Maintenance margin headroom"],
    rows:
      account === null
        ? []
        : [
            {
              cells: [
                `${USD_CELL.format(account.cash)} USDC`,
                signedUsd(account.initialMarginSurplus),
                signedUsd(account.maintenanceMarginSurplus),
              ],
            },
          ],
  };
}
