import { getExplorerTransactionUrl } from "@/lib/explorer-links";
import { MARKET_LABELS, marketLabel } from "@/lib/market-labels";
import type {
  AccountFill,
  FillLiquidity,
  OrderHistoryOrder,
  OrderHistoryStatus,
} from "@/lib/order-history.types";
import { sideTone } from "@/lib/side-tone";
import type { ActivityView, SpotOpenOrder } from "@/lib/trading.types";

/** Rendered when a balance is genuinely unknown — never substitute a zero or a placeholder figure. */
const UNKNOWN_BALANCE = "—";

/** Columns for the Open Orders tab. The trailing column holds each row's cancel control. */
export const OPEN_ORDERS_COLUMNS = ["Side", "Price", "Size", "Filled", ""] as const;

const OPEN_ORDERS_SIDE_COLUMN = OPEN_ORDERS_COLUMNS.indexOf("Side");

/** The instrument a row belongs to, under the terminal's one name for it. */
function formatInstrument(row: { display_name?: string; market?: string }) {
  return (
    marketLabel(row.market) ?? row.display_name ?? row.market ?? MARKET_LABELS["USDCcNGN-SPOT"]
  );
}

function formatUsdc(size: number) {
  return `${size.toLocaleString("en-US", { maximumFractionDigits: 3 })} USDC`;
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
        `\u20a6${order.price.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`,
        formatUsdc(order.size),
        formatUsdc(order.filled),
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
 * ticket signs both as limits — so the column could only be guessed. No "Size" either: the only size
 * an order carries is its amount valued at its signed limit, which for a marketable order includes
 * slippage room the fill never used (trade #345 delivered 0.9994 USDC and read as 1.004). What
 * traded comes from the fills instead.
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

/**
 * The trader's direction in the cNGN leg, from a UI intent; a dash when there is none. A buy of
 * USDC is paid for in cNGN, so it is a short of cNGN, and a sell a long. The venue's own word is
 * kept beside it as the cell's hover text (`describeVenueSide`), and untouched in the payloads
 * the `/api/orders` and `/api/fills` proxies relay.
 */
function formatIntentDirection(intent: IntentSide) {
  if (intent === undefined) {
    return UNKNOWN_BALANCE;
  }
  return intent.side === "buy" ? "Short cNGN" : "Long cNGN";
}

/** The side as the venue reports it, for the direction cell's hover text. */
function describeVenueSide(intent: IntentSide) {
  return intent === undefined ? undefined : `Venue side: ${intent.side}`;
}

/** The direction cell's hover text keyed by its column, or nothing when there is no intent. */
function directionTitles(column: number, intent: IntentSide) {
  const title = describeVenueSide(intent);
  return title === undefined ? undefined : { [column]: title };
}

/** The direction cell's tint keyed by its column, or nothing when there is no intent. */
function directionTones(column: number, intent: IntentSide) {
  return intent === undefined ? undefined : { [column]: sideTone(intent.side) };
}

function formatNairaPrice(price: number) {
  return `\u20a6${price.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

/**
 * What the order actually traded, from its fills.
 *
 * `filledUsdc` is null when it cannot be known: the order filled (its cNGN `filled_amount` is above
 * zero) but the service did not report `filled_quote`. That reads as a dash, never as a figure — a
 * reconciliation built on a guess is worse than one with a gap in it. An order that filled nothing
 * is a known zero.
 */
function getOrderFill(order: OrderHistoryOrder) {
  const filledCngn = Number(order.filled_amount);
  if (!Number.isFinite(filledCngn) || filledCngn <= 0) {
    return { averagePrice: null, filledUsdc: 0 };
  }
  const filledUsdc = order.filled_quote === undefined ? Number.NaN : Number(order.filled_quote);
  if (!Number.isFinite(filledUsdc) || filledUsdc <= 0) {
    return { averagePrice: null, filledUsdc: null };
  }
  return { averagePrice: filledCngn / filledUsdc, filledUsdc };
}

function formatHistoryUsdc(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} USDC`;
}

/**
 * The connected wallet's orders in every status, newest first, as `GET /v1/orders` returns them.
 *
 * Direction and limit are read from the order's UI intent, not its engine fields: the engine side is
 * inverted on this pair and its price is USDC per cNGN, so reading those would show a USDC buy as a
 * sell. "Filled" and "Avg price" come from the order's fills, so they are what the account was
 * actually debited and credited.
 */
export function buildOrderHistoryActivityView(
  orders: OrderHistoryOrder[],
  timeZone?: string
): ActivityView {
  return {
    columns: [...ORDER_HISTORY_COLUMNS],
    rows: orders.map((order) => {
      const limit = Number(order.spot_contract?.ui_intent.price);
      const { averagePrice, filledUsdc } = getOrderFill(order);

      return {
        titles: directionTitles(ORDER_HISTORY_DIRECTION_COLUMN, order.spot_contract?.ui_intent),
        cells: [
          formatOrderTime(order.created_at, timeZone),
          formatInstrument(order),
          formatIntentDirection(order.spot_contract?.ui_intent),
          filledUsdc === null ? UNKNOWN_BALANCE : formatHistoryUsdc(filledUsdc),
          averagePrice === null ? UNKNOWN_BALANCE : formatNairaPrice(averagePrice),
          Number.isFinite(limit) ? formatNairaPrice(limit) : UNKNOWN_BALANCE,
          ORDER_STATUS_LABELS[order.status] ?? order.status,
        ],
        tones: {
          ...directionTones(ORDER_HISTORY_DIRECTION_COLUMN, order.spot_contract?.ui_intent),
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
 * "Size" is the USDC that changed hands and "Total" the cNGN, both as the fill executed, so each row
 * reconciles against the account's balances. "Fee" is what the order paid, which is nothing for a
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

function formatCngn(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} cNGN`;
}

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
 * The fills on the connected wallet's orders, newest first, as `GET /v1/fills` returns them.
 *
 * Direction, price and size are read from the fill's UI intent, which markets-service derives from
 * the wallet's own order — not from the engine fields, whose side is inverted on this pair and whose
 * price is USDC per cNGN. A fill without an intent shows dashes rather than engine figures in the
 * trader's columns; its cNGN total needs no translation.
 */
export function buildTradeHistoryActivityView(
  fills: AccountFill[],
  timeZone?: string
): ActivityView {
  return {
    columns: [...TRADE_HISTORY_COLUMNS],
    rows: fills.map((fill) => {
      const intent = fill.spot_contract?.ui_intent;
      const price = Number(intent?.price);
      const sizeUsdc = Number(intent?.size);
      const totalCngn = Number(fill.size);

      return {
        titles: directionTitles(TRADE_HISTORY_DIRECTION_COLUMN, intent),
        tones: directionTones(TRADE_HISTORY_DIRECTION_COLUMN, intent),
        cells: [
          formatOrderTime(fill.created_at, timeZone),
          formatInstrument(fill),
          formatIntentDirection(intent),
          Number.isFinite(price) ? formatNairaPrice(price) : UNKNOWN_BALANCE,
          Number.isFinite(sizeUsdc) ? formatHistoryUsdc(sizeUsdc) : UNKNOWN_BALANCE,
          Number.isFinite(totalCngn) ? formatCngn(totalCngn) : UNKNOWN_BALANCE,
          formatFillFee(fill.fee),
          LIQUIDITY_LABELS[fill.liquidity] ?? fill.liquidity,
        ],
      };
    }),
  };
}
