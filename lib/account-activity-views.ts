import { getExplorerTransactionUrl } from "@/lib/explorer-links";
import type { FutureState } from "@/lib/future-market.types";
import { formatDollarPrice, formatPrice } from "@/lib/market-formatting";
import { MARKET_LABELS, marketLabel } from "@/lib/market-labels";
import type {
  AccountFill,
  FillLiquidity,
  OrderHistoryOrder,
  OrderHistoryStatus,
} from "@/lib/order-history.types";
import { sideTone } from "@/lib/side-tone";
import { spotOrientation } from "@/lib/spot-orientation";
import type { SpotPair } from "@/lib/spot-pairs";
import { SPOT_PAIRS } from "@/lib/spot-pairs";
import type {
  ActivityRow,
  ActivityView,
  CellBadge,
  CellTone,
  SpotOpenOrder,
} from "@/lib/trading.types";

/** Rendered when a balance is genuinely unknown — never substitute a zero or a placeholder figure. */
const UNKNOWN_BALANCE = "—";

/** Columns for the Open Orders tab. The trailing column holds each row's cancel control. */
export const OPEN_ORDERS_COLUMNS = ["Side", "Price", "Size", "Filled", ""] as const;

const OPEN_ORDERS_SIDE_COLUMN = OPEN_ORDERS_COLUMNS.indexOf("Side");

/** The instrument a row belongs to, under the terminal's one name for it. */
function formatInstrument(row: { display_name?: string; market?: string }) {
  return marketLabel(row.market) ?? row.display_name ?? row.market ?? MARKET_LABELS["cNGN-USDC"];
}

function formatCngnSize(size: number) {
  return `${size.toLocaleString("en-US", { maximumFractionDigits: 3 })} cNGN`;
}

/**
 * The connected wallet's resting orders, newest-priced first.
 *
 * Filtered to the wallet rather than showing the whole book: the tab is the trader's own working
 * orders, and every other row on the venue belongs to someone else. Returns no rows when there is
 * no wallet, which the panel renders as its signed-out state.
 */
export function buildOpenOrdersActivityView(
  openOrders: SpotOpenOrder[],
  walletAddress: string | null
): ActivityView {
  const owned =
    walletAddress === null
      ? []
      : openOrders.filter(
          (order) => order.ownerAddress.toLowerCase() === walletAddress.toLowerCase()
        );

  return {
    columns: [...OPEN_ORDERS_COLUMNS],
    rows: owned.map((order) => ({
      tones: { [OPEN_ORDERS_SIDE_COLUMN]: sideTone(order.side) },
      cells: [
        order.side === "buy" ? "Buy" : "Sell",
        formatPrice(order.price),
        formatCngnSize(order.size),
        formatCngnSize(order.filled),
      ],
    })),
  };
}

function formatUsdcSize(size: number) {
  return Number.isFinite(size)
    ? `${size.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDC`
    : UNKNOWN_BALANCE;
}

/** A spot price as its pair shows it: USDC per cNGN to eight places, USDC per EURC to five. */
function formatSpotPrice(price: number, pair: SpotPair) {
  return Number.isFinite(price)
    ? price.toLocaleString("en-US", {
        maximumFractionDigits: pair.priceDecimals,
        minimumFractionDigits: pair.priceDecimals,
      })
    : UNKNOWN_BALANCE;
}

/** A spot amount in `symbol`: USDC to two places, a base token (cNGN, EURC) to three. */
function formatSpotAmount(amount: number, symbol: string) {
  if (symbol === "USDC") {
    return formatUsdcSize(amount);
  }
  return Number.isFinite(amount)
    ? `${amount.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${symbol}`
    : UNKNOWN_BALANCE;
}

/**
 * A spot pair's Open Orders in the trader's terms (orders already turned the pair's way up by
 * `spotOrientation`): a buy or sell of the displayed base at its displayed price, its size and fill
 * in that base, at USDC per base. Only the wallet's own.
 */
export function buildSpotOpenOrdersActivityView(
  openOrders: SpotOpenOrder[],
  walletAddress: string | null,
  pair: SpotPair = SPOT_PAIRS.spot
): ActivityView {
  return {
    columns: [...OPEN_ORDERS_COLUMNS],
    rows: getOwnedOpenOrders(openOrders, walletAddress).map((order) => ({
      tones: { [OPEN_ORDERS_SIDE_COLUMN]: sideTone(order.side) },
      cells: [
        order.side === "buy" ? "Buy" : "Sell",
        formatSpotPrice(order.price, pair),
        formatSpotAmount(order.size, pair.displayBase),
        formatSpotAmount(order.filled, pair.displayBase),
      ],
    })),
  };
}

/** The orders a cancel control acts on, in the same order as the view's rows. */
export function getOwnedOpenOrders(openOrders: SpotOpenOrder[], walletAddress: string | null) {
  return walletAddress === null
    ? []
    : openOrders.filter(
        (order) => order.ownerAddress.toLowerCase() === walletAddress.toLowerCase()
      );
}

/**
 * Columns for the Order History tab.
 *
 * No "Type": markets-service does not record whether an order was placed as limit or market — the
 * ticket signs both as limits — so the column could only be guessed. "Filled" is the base that
 * traded and "Avg price" what it traded at in USDC per base, both from the fills, so a marketable
 * order's slippage room never reads as size.
 */
export const ORDER_HISTORY_COLUMNS = [
  "Time",
  "Instrument",
  "Direction",
  "Filled",
  "Avg price",
  "Limit",
  "Status",
] as const;

const ORDER_HISTORY_STATUS_COLUMN = ORDER_HISTORY_COLUMNS.indexOf("Status");
const ORDER_HISTORY_DIRECTION_COLUMN = ORDER_HISTORY_COLUMNS.indexOf("Direction");

const ORDER_STATUS_LABELS = {
  active: "Open",
  cancelled: "Cancelled",
  expired: "Expired",
  filled: "Filled",
  matching: "Matching",
} satisfies Record<OrderHistoryStatus, string>;

/**
 * "Sep 13, 16:51". Date and time are formatted apart and joined here because the combined
 * `toLocaleString` joiner depends on the runtime's ICU data — "Sep 13, 16:51" in one, "Sep 13 at
 * 16:51" in another — so the same order would read differently from one browser to the next.
 */
function formatOrderTime(createdAt: string, timeZone: string | undefined) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return UNKNOWN_BALANCE;
  }
  const day = date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone });
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  });
  return `${day}, ${time}`;
}

type IntentSide = { side: "buy" | "sell" } | undefined;

/** The trader's direction, from a UI intent; a dash when there is none. On the perp a buy is a buy of cNGN. */
function formatIntentDirection(intent: IntentSide) {
  if (intent === undefined) {
    return UNKNOWN_BALANCE;
  }
  return intent.side === "buy" ? "Buy" : "Sell";
}

/** A spot intent's side the trader's way: the engine's own, unless the pair is shown inverted. */
function displayIntent(intent: IntentSide, pair: SpotPair): IntentSide {
  return intent === undefined ? undefined : { side: spotOrientation(pair).side(intent.side) };
}

type EngineIntent = { price: string; side: "buy" | "sell"; size: string };

/**
 * A spot row's engine order: the venue's `spot_contract` echo where it sent one, else, on a pair
 * shown as it trades (EURC-USDC, which the venue echoes nothing for), the engine fields themselves.
 * Undefined otherwise, and the row shows dashes rather than engine values under trader labels.
 */
function spotEngineIntent(
  echo: EngineIntent | undefined,
  engine: EngineIntent,
  pair: SpotPair
): EngineIntent | undefined {
  return echo ?? (pair.inverted ? undefined : engine);
}

/** The direction cell's tint keyed by its column, or nothing when there is no intent. */
function directionTones(column: number, intent: IntentSide) {
  return intent === undefined ? undefined : { [column]: sideTone(intent.side) };
}

/**
 * What the order actually traded, from its fills: the cNGN that changed hands and the average USDC
 * per cNGN it did so at.
 *
 * The average is null when it cannot be known: the order filled (its `filled_amount` is above zero)
 * but the service did not report `filled_quote`. That reads as a dash, never as a figure — a
 * reconciliation built on a guess is worse than one with a gap in it. An order that filled nothing
 * is a known zero.
 */
function getOrderFill(order: OrderHistoryOrder) {
  const filledCngn = Number(order.filled_amount);
  if (!Number.isFinite(filledCngn) || filledCngn <= 0) {
    return { averagePrice: null, filledCngn: 0 };
  }
  const filledUsdc = order.filled_quote === undefined ? Number.NaN : Number(order.filled_quote);
  if (!Number.isFinite(filledUsdc) || filledUsdc <= 0) {
    return { averagePrice: null, filledCngn };
  }
  return { averagePrice: filledUsdc / filledCngn, filledCngn };
}

/**
 * The perp's Order History columns. Unlike spot's, the order's own size and price are shown (the
 * size is whole cNGN contracts, so it is what the trader asked for and not a slippage-room figure),
 * with the fill beside them and the average fill price as its note. The trailing column is Filled
 * rather than an action: a historical order has nothing to act on.
 */
export const PERP_ORDER_HISTORY_COLUMNS = [
  "Time",
  "Market",
  "Action",
  "Type",
  "Status",
  "Size",
  "Price",
  "Filled",
] as const;

const PERP_ORDER_HISTORY_ACTION_COLUMN = PERP_ORDER_HISTORY_COLUMNS.indexOf("Action");
const PERP_ORDER_HISTORY_TYPE_COLUMN = PERP_ORDER_HISTORY_COLUMNS.indexOf("Type");
const PERP_ORDER_HISTORY_STATUS_COLUMN = PERP_ORDER_HISTORY_COLUMNS.indexOf("Status");
const PERP_ORDER_HISTORY_FILLED_COLUMN = PERP_ORDER_HISTORY_COLUMNS.indexOf("Filled");

const PERP_ORDER_TYPE_NOTE =
  "Every order is signed as a limit; a market order is a limit priced through the touch. RO: reduce-only, clamped to the open position. PO: post-only, rested and never crossed.";

/**
 * What the order did, in the perp's words: a buy of cNGN is a Long, a sell a Short. A reduce-only
 * order can only have shrunk the opposite position, so it reads as closing that one: a reduce-only
 * buy is "Close Short".
 */
function formatPerpAction(intent: IntentSide, reduceOnly: boolean) {
  if (intent === undefined) {
    return UNKNOWN_BALANCE;
  }
  if (reduceOnly) {
    return intent.side === "buy" ? "Close Short" : "Close Long";
  }
  return intent.side === "buy" ? "Long" : "Short";
}

/**
 * The perp's Order History: the connected wallet's orders in every status, newest first. Every
 * figure is the order's own or its fills': the venue records the side, the reduce-only and
 * post-only flags, the size and limit, what filled and for how much. It does not record whether
 * the ticket sent a market or a limit order, since both are signed as limits, so the Type cell
 * says so rather than guessing.
 */
export function buildPerpOrderHistoryActivityView(
  orders: OrderHistoryOrder[],
  label: string,
  timeZone?: string
): ActivityView {
  return {
    columns: [...PERP_ORDER_HISTORY_COLUMNS],
    rows: orders.map((order) => {
      const intent = order.spot_contract?.ui_intent;
      const limit = Number(order.limit_price);
      const size = Number(order.desired_amount);
      const { averagePrice, filledCngn } = getOrderFill(order);
      const flags: CellBadge[] = [];
      if (order.reduce_only === true) {
        flags.push({ label: "RO" });
      }
      if (order.post_only === true) {
        flags.push({ label: "PO" });
      }
      const row: ActivityRow = {
        titles: { [PERP_ORDER_HISTORY_TYPE_COLUMN]: PERP_ORDER_TYPE_NOTE },
        cells: [
          formatOrderTime(order.created_at, timeZone),
          label,
          formatPerpAction(intent, order.reduce_only === true),
          "Limit",
          ORDER_STATUS_LABELS[order.status] ?? order.status,
          Number.isFinite(size) ? formatCngnSize(size) : UNKNOWN_BALANCE,
          formatDollarPrice(Number.isFinite(limit) ? limit : null),
          formatCngnSize(filledCngn),
        ],
        tones: {
          ...directionTones(PERP_ORDER_HISTORY_ACTION_COLUMN, intent),
          ...(order.status === "filled"
            ? { [PERP_ORDER_HISTORY_STATUS_COLUMN]: "positive" as const }
            : {}),
        },
      };
      if (flags.length > 0) {
        row.badges = { [PERP_ORDER_HISTORY_TYPE_COLUMN]: flags };
      }
      if (averagePrice !== null) {
        row.details = {
          [PERP_ORDER_HISTORY_FILLED_COLUMN]: `@ ${formatDollarPrice(averagePrice)}`,
        };
      }
      return row;
    }),
  };
}

/**
 * What a spot order traded, in its pair's displayed base: the cNGN or EURC; on a pair shown with
 * USDC as its base, the USDC (or, when the venue did not value the fill, the base that did).
 */
function formatSpotFilled(filledBase: number, averagePrice: number | null, pair: SpotPair): string {
  if (pair.displayBase !== "USDC") {
    return formatSpotAmount(filledBase, pair.base);
  }
  return averagePrice === null && filledBase > 0
    ? formatSpotAmount(filledBase, pair.base)
    : formatUsdcSize(filledBase * (averagePrice ?? 0));
}

/** An engine price (USDC per base) the pair's way up, or a dash. */
function formatEngineSpotPrice(price: number | null, pair: SpotPair) {
  const shown = spotOrientation(pair).price(price);
  return shown === null ? UNKNOWN_BALANCE : formatSpotPrice(shown, pair);
}

/**
 * The connected wallet's orders in every status, newest first, as `GET /v1/orders` returns them.
 *
 * Direction and limit are read from the order's UI intent, which under the identity contract is
 * the engine order itself (and is the engine order on EURC-USDC, which echoes none). "Filled" and
 * "Avg price" come from the order's fills, so they are what the account was actually debited and
 * credited.
 */
export function buildOrderHistoryActivityView(
  orders: OrderHistoryOrder[],
  timeZone?: string,
  pair: SpotPair = SPOT_PAIRS.spot
): ActivityView {
  return {
    columns: [...ORDER_HISTORY_COLUMNS],
    rows: orders.map((order) => {
      // The venue's intent is the engine order, shown the pair's way up.
      const engine = spotEngineIntent(
        order.spot_contract?.ui_intent,
        { price: order.limit_price, side: order.side, size: order.desired_amount },
        pair
      );
      const limit = Number(engine?.price);
      const { averagePrice, filledCngn } = getOrderFill(order);
      const intent = displayIntent(engine, pair);

      return {
        cells: [
          formatOrderTime(order.created_at, timeZone),
          formatInstrument(order),
          formatIntentDirection(intent),
          formatSpotFilled(filledCngn, averagePrice, pair),
          formatEngineSpotPrice(averagePrice, pair),
          limit > 0 ? formatEngineSpotPrice(limit, pair) : UNKNOWN_BALANCE,
          ORDER_STATUS_LABELS[order.status] ?? order.status,
        ],
        tones: {
          ...directionTones(ORDER_HISTORY_DIRECTION_COLUMN, intent),
          ...(order.status === "filled"
            ? { [ORDER_HISTORY_STATUS_COLUMN]: "positive" as const }
            : {}),
        },
      };
    }),
  };
}

/**
 * Columns for the Trade History tab: one row per fill.
 *
 * "Size" is the base that changed hands and "Total" the USDC, both as the fill executed, so each row reconciles against the account's balances. "Fee" is what the order paid, which is nothing for a
 * maker. "Role" says whether the order crossed the book or rested and was hit.
 *
 * The trailing column holds the link to the fill's settling transaction on Basescan.
 */
export const TRADE_HISTORY_COLUMNS = [
  "Time",
  "Instrument",
  "Direction",
  "Price",
  "Size",
  "Total",
  "Fee",
  "Role",
  "",
] as const;

/**
 * Where a fill's settling transaction can be checked on the chain's explorer — Basescan on Base — or
 * null when there is nothing to link. Fills recorded before the venue stored transaction hashes carry
 * none; those rows get no link rather than a dead one.
 */
export function getFillTransactionUrl(fill: AccountFill, explorerUrl: string | undefined) {
  return getExplorerTransactionUrl(fill.tx_hash, explorerUrl);
}

const TRADE_HISTORY_DIRECTION_COLUMN = TRADE_HISTORY_COLUMNS.indexOf("Direction");

const LIQUIDITY_LABELS = {
  maker: "Maker",
  taker: "Taker",
} satisfies Record<FillLiquidity, string>;

/**
 * A fill's fee, to 6 places so a fee on a small fill does not round away to zero. A dash when the
 * venue did not record it: an unknown fee must never read as one it did not charge.
 */
function formatFillFee(fee: string | undefined) {
  const value = fee === undefined ? Number.NaN : Number(fee);
  return Number.isFinite(value)
    ? `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`
    : UNKNOWN_BALANCE;
}

/**
 * The perp's Trade History columns, one row per fill: when, the market, what the trader did, the
 * order type with whether it made or took liquidity, the cNGN that changed hands, the price, the
 * USDC value and the fee. No "Closed PnL": the SRM marks positions to market and keeps no entry
 * price, so the venue reports no realized PnL per fill, and a figure here could only be invented.
 * The trailing column holds the link to the fill's settling transaction on Basescan.
 */
export const PERP_TRADE_HISTORY_COLUMNS = [
  "Time",
  "Market",
  "Action",
  "Type",
  "Size",
  "Price",
  "Trade Value",
  "Fee",
  "",
] as const;

const PERP_TRADE_HISTORY_ACTION_COLUMN = PERP_TRADE_HISTORY_COLUMNS.indexOf("Action");
const PERP_TRADE_HISTORY_TYPE_COLUMN = PERP_TRADE_HISTORY_COLUMNS.indexOf("Type");

const PERP_FILL_TYPE_NOTE =
  "Every order is signed as a limit; a market order is a limit priced through the touch. M: your order rested and was hit (maker, no fee). T: your order crossed the book (taker).";

/** "$1.3351", "$0.003338": a USDC amount in dollars, to as many places as the figure needs. */
function formatDollars(value: number, maximumFractionDigits: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits, minimumFractionDigits: 2 })}`;
}

/**
 * The perp's Trade History: the fills on the connected wallet's orders, newest first. Action,
 * price and size come from the fill's UI intent, which under the identity contract equals the
 * engine fill; the value is the two multiplied; the fee is what the venue recorded, a dash when
 * it recorded none. Maker or taker rides the Type cell as a pill.
 */
export function buildPerpTradeHistoryActivityView(
  fills: AccountFill[],
  label: string,
  timeZone?: string
): ActivityView {
  return {
    columns: [...PERP_TRADE_HISTORY_COLUMNS],
    rows: fills.map((fill) => {
      const intent = fill.spot_contract?.ui_intent;
      const price = Number(intent?.price);
      const sizeCngn = Number(intent?.size ?? fill.size);
      const valueUsd = price * sizeCngn;
      const fee = fill.fee === undefined ? Number.NaN : Number(fill.fee);
      return {
        titles: { [PERP_TRADE_HISTORY_TYPE_COLUMN]: PERP_FILL_TYPE_NOTE },
        tones: directionTones(PERP_TRADE_HISTORY_ACTION_COLUMN, intent),
        badges: {
          [PERP_TRADE_HISTORY_TYPE_COLUMN]: [{ label: fill.liquidity === "maker" ? "M" : "T" }],
        },
        cells: [
          formatOrderTime(fill.created_at, timeZone),
          label,
          formatPerpAction(intent, false),
          "Limit",
          Number.isFinite(sizeCngn) ? formatCngnSize(sizeCngn) : UNKNOWN_BALANCE,
          formatDollarPrice(Number.isFinite(price) ? price : null),
          Number.isFinite(valueUsd) ? formatDollars(valueUsd, 4) : UNKNOWN_BALANCE,
          Number.isFinite(fee) ? formatDollars(fee, 6) : UNKNOWN_BALANCE,
        ],
      };
    }),
  };
}

/**
 * The fills on the connected wallet's orders, newest first, as `GET /v1/fills` returns them.
 *
 * Direction, price and size are read from the fill's UI intent, which markets-service derives from
 * the wallet's own order and which under the identity contract equals the engine fill (EURC-USDC
 * echoes none, and its engine fill is read directly). A fill without an intent shows dashes rather
 * than guessed figures in the trader's columns.
 */
export function buildTradeHistoryActivityView(
  fills: AccountFill[],
  timeZone?: string,
  pair: SpotPair = SPOT_PAIRS.spot
): ActivityView {
  return {
    columns: [...TRADE_HISTORY_COLUMNS],
    rows: fills.map((fill) => {
      // The fill's intent is the engine's. "Size" is the displayed base and "Total" the other leg:
      // sized in the displayed base with the other leg as its total.
      const engineIntent = spotEngineIntent(
        fill.spot_contract?.ui_intent,
        { price: fill.price, side: fill.side, size: fill.size },
        pair
      );
      const intent = displayIntent(engineIntent, pair);
      const price = Number(engineIntent?.price);
      const sizeBase = Number(engineIntent?.size ?? fill.size);
      const sizeUsdc = price * sizeBase;
      const usdcLeg = Number.isFinite(sizeUsdc) ? formatUsdcSize(sizeUsdc) : UNKNOWN_BALANCE;
      const baseLeg = formatSpotAmount(sizeBase, pair.base);

      return {
        tones: directionTones(TRADE_HISTORY_DIRECTION_COLUMN, intent),
        cells: [
          formatOrderTime(fill.created_at, timeZone),
          formatInstrument(fill),
          formatIntentDirection(intent),
          price > 0 ? formatEngineSpotPrice(price, pair) : UNKNOWN_BALANCE,
          pair.displayBase === "USDC" ? usdcLeg : baseLeg,
          pair.displayBase === "USDC" ? baseLeg : usdcLeg,
          formatFillFee(fill.fee),
          LIQUIDITY_LABELS[fill.liquidity] ?? fill.liquidity,
        ],
      };
    }),
  };
}

/**
 * How a series' amounts read: what its sizes count (`sizeSymbol`, `unitSize` per venue unit), the
 * decimals its prices take and what its variation margin is paid in.
 */
export type FutureUnits = Pick<
  FutureState,
  "priceDecimals" | "sizeSymbol" | "terms" | "unitSize" | "vmSymbol"
>;

/** A size in the venue's units in the series' `sizeSymbol`, `unitSize` a unit. */
function formatFutureSize(units: number, futureUnits: FutureUnits) {
  return Number.isFinite(units)
    ? (units * futureUnits.unitSize).toLocaleString("en-US", { maximumFractionDigits: 2 })
    : UNKNOWN_BALANCE;
}

/** A price in the series' terms, to its `priceDecimals`. */
function formatFutureHistoryPrice(price: number, futureUnits: FutureUnits) {
  const digits = futureUnits.priceDecimals;
  return Number.isFinite(price)
    ? price.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : UNKNOWN_BALANCE;
}

/** A column list with its "Size (USDC)" header naming the series' size unit instead. */
function withSizeColumn<T extends readonly string[]>(columns: T, futureUnits: FutureUnits) {
  return columns.map((column) =>
    column === "Size (USDC)" ? `Size (${futureUnits.sizeSymbol})` : column
  );
}

/** What a future order did: a buy is a Long, a sell a Short. */
function formatFutureAction(side: "buy" | "sell" | undefined) {
  if (side === undefined) {
    return UNKNOWN_BALANCE;
  }
  return side === "buy" ? "Long" : "Short";
}

/** The future's Order History columns; the size header names the series' size unit when built. */
export const FUTURE_ORDER_HISTORY_COLUMNS = [
  "Time",
  "Market",
  "Action",
  "Status",
  "Size (USDC)",
  "Price",
  "Filled",
] as const;

const FUTURE_ORDER_HISTORY_ACTION_COLUMN = FUTURE_ORDER_HISTORY_COLUMNS.indexOf("Action");
const FUTURE_ORDER_HISTORY_STATUS_COLUMN = FUTURE_ORDER_HISTORY_COLUMNS.indexOf("Status");

/**
 * The future's Order History. The venue presents the future without a UI intent: its engine
 * side and limit are already the trader's own, and its size counts the venue's units, `unitSize`
 * of the series' `sizeSymbol` each. An order the venue cancelled for margin says so in its status
 * cell.
 */
export function buildFutureOrderHistoryActivityView(
  orders: OrderHistoryOrder[],
  label: string,
  futureUnits: FutureUnits,
  timeZone?: string
): ActivityView {
  return {
    columns: withSizeColumn(FUTURE_ORDER_HISTORY_COLUMNS, futureUnits),
    rows: orders.map((order) => {
      const size = Number(order.desired_amount);
      const filled = Number(order.filled_amount);
      const status = ORDER_STATUS_LABELS[order.status] ?? order.status;
      const row: ActivityRow = {
        cells: [
          formatOrderTime(order.created_at, timeZone),
          label,
          formatFutureAction(order.side),
          order.cancel_reason === "insufficient_margin" ? `${status} (margin)` : status,
          formatFutureSize(size, futureUnits),
          formatFutureHistoryPrice(Number(order.limit_price), futureUnits),
          formatFutureSize(filled, futureUnits),
        ],
        tones: {
          [FUTURE_ORDER_HISTORY_ACTION_COLUMN]: sideTone(order.side),
          ...(order.status === "filled"
            ? { [FUTURE_ORDER_HISTORY_STATUS_COLUMN]: "positive" as const }
            : {}),
        },
      };
      return row;
    }),
  };
}

/** The future's Trade History columns; the trailing column holds the fill's transaction link. */
export const FUTURE_TRADE_HISTORY_COLUMNS = [
  "Time",
  "Market",
  "Action",
  "Size (USDC)",
  "Price",
  "Fee",
  "VM",
  "",
] as const;

const FUTURE_TRADE_HISTORY_VM_COLUMN = FUTURE_TRADE_HISTORY_COLUMNS.indexOf("VM");

/** What the VM column says of a fill, by what the series pays VM in. */
function futureFillVmNote(futureUnits: FutureUnits) {
  return futureUnits.terms === "american"
    ? "Variation margin the fill settled at once, in USDC: the gap between the fill price and the mark, times the size."
    : "Variation margin the fill settled at once, in cNGN: the gap between the fill price and the mark, times the size. USDC covers any cNGN the account lacked.";
}

const SIGNED_CNGN = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/** A VM amount with its sign and currency, so a credit and a charge read apart at a glance. */
function formatSignedVm(value: number, symbol: string) {
  return `${signPrefix(value)}${SIGNED_CNGN.format(Math.abs(value))} ${symbol}`;
}

function signPrefix(value: number) {
  if (value > 0) {
    return "+";
  }
  return value < 0 ? "-" : "";
}

/** A VM credit reads positive and a charge negative; nothing, or an unknown VM, takes no tone. */
function vmTone(value: number): CellTone | undefined {
  if (value > 0) {
    return "positive";
  }
  return value < 0 ? "negative" : undefined;
}

const FUTURE_TRADE_HISTORY_ACTION_COLUMN = FUTURE_TRADE_HISTORY_COLUMNS.indexOf("Action");

const FUTURE_FILL_ROLE_NOTE =
  "M: your order rested and was hit (maker, no fee). T: your order crossed the book (taker).";

/**
 * The future's Trade History: one row per fill, its size in the series' `sizeSymbol` (the venue's
 * units × `unitSize`) and the fee the venue recorded. A fill moves no quote leg on chain; its
 * profit or loss arrives as variation margin at each mark.
 */
export function buildFutureTradeHistoryActivityView(
  fills: AccountFill[],
  label: string,
  futureUnits: FutureUnits,
  timeZone?: string
): ActivityView {
  const vmNote = futureFillVmNote(futureUnits);
  return {
    columns: withSizeColumn(FUTURE_TRADE_HISTORY_COLUMNS, futureUnits),
    rows: fills.map((fill) => {
      const size = Number(fill.size);
      const fee = fill.fee === undefined ? Number.NaN : Number(fill.fee);
      const served = futureUnits.terms === "american" ? fill.vm_usdc : fill.vm_cngn;
      const vm = served === undefined ? Number.NaN : Number(served);
      const tone = vmTone(vm);
      return {
        badges: {
          [FUTURE_TRADE_HISTORY_ACTION_COLUMN]: [{ label: fill.liquidity === "maker" ? "M" : "T" }],
        },
        cells: [
          formatOrderTime(fill.created_at, timeZone),
          label,
          formatFutureAction(fill.side),
          formatFutureSize(size, futureUnits),
          formatFutureHistoryPrice(Number(fill.price), futureUnits),
          Number.isFinite(fee) ? formatDollars(fee, 6) : UNKNOWN_BALANCE,
          Number.isFinite(vm) ? formatSignedVm(vm, futureUnits.vmSymbol) : UNKNOWN_BALANCE,
        ],
        titles: {
          [FUTURE_TRADE_HISTORY_ACTION_COLUMN]: FUTURE_FILL_ROLE_NOTE,
          [FUTURE_TRADE_HISTORY_VM_COLUMN]: vmNote,
        },
        tones: {
          [FUTURE_TRADE_HISTORY_ACTION_COLUMN]: sideTone(fill.side),
          ...(tone === undefined ? {} : { [FUTURE_TRADE_HISTORY_VM_COLUMN]: tone }),
        },
      };
    }),
  };
}

/** The future's Open Orders: sides as Long and Short, prices and sizes in the series' terms. */
export function buildFutureOpenOrdersActivityView(
  openOrders: SpotOpenOrder[],
  walletAddress: string | null,
  futureUnits: FutureUnits
): ActivityView {
  const owned = getOwnedOpenOrders(openOrders, walletAddress);
  return {
    columns: ["Side", "Price", `Size (${futureUnits.sizeSymbol})`, "Filled", ""],
    rows: owned.map((order) => ({
      tones: { 0: sideTone(order.side) },
      cells: [
        formatFutureAction(order.side),
        formatFutureHistoryPrice(order.price, futureUnits),
        formatFutureSize(order.size, futureUnits),
        formatFutureSize(order.filled, futureUnits),
      ],
    })),
  };
}
