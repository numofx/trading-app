import type { OrderHistoryOrder, OrderHistoryStatus } from "@/lib/order-history.types";
import type { ActivityView, SpotOpenOrder } from "@/lib/trading.types";

/** Rendered when a balance is genuinely unknown — never substitute a zero or a placeholder figure. */
const UNKNOWN_BALANCE = "—";

/**
 * Builds the Assets view from real balances rather than sample data.
 *
 * The two balances are distinct and both matter to a trader: the trading account leg is what the
 * SubAccounts ledger holds (deposited and traded funds, the balance orders draw on), and the wallet
 * leg is what is still in the connected wallet and therefore available to deposit.
 */
export function buildAssetsActivityView({
  accountCngnLabel,
  accountUsdcLabel,
  walletCngnLabel,
  walletUsdcLabel,
}: {
  /** Subaccount cNGN balance, or null when it hasn't loaded or the asset is unknown for this chain. */
  accountCngnLabel: string | null;
  /** Subaccount USDC cash balance, or null when it hasn't loaded. */
  accountUsdcLabel: string | null;
  /** Connected wallet's cNGN balance, or null when no wallet is connected or the token is unconfigured. */
  walletCngnLabel: string | null;
  /** Connected wallet's USDC balance, or null when no wallet is connected. */
  walletUsdcLabel: string | null;
}): ActivityView {
  return {
    columns: ["Asset", "Trading Account", "Wallet"],
    rows: [
      { cells: ["USDC", accountUsdcLabel ?? UNKNOWN_BALANCE, walletUsdcLabel ?? UNKNOWN_BALANCE] },
      { cells: ["cNGN", accountCngnLabel ?? UNKNOWN_BALANCE, walletCngnLabel ?? UNKNOWN_BALANCE] },
    ],
  };
}

/** Columns for the Open Orders tab. The trailing column holds each row's cancel control. */
export const OPEN_ORDERS_COLUMNS = ["Side", "Price", "Size", "Filled", ""] as const;

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

/** The trader's side, from the UI intent; a dash when the order carries none. */
function formatIntentDirection(order: OrderHistoryOrder) {
  const side = order.spot_contract?.ui_intent.side;
  if (side === undefined) {
    return UNKNOWN_BALANCE;
  }
  return side === "buy" ? "Buy" : "Sell";
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
        positiveCellIndexes: order.status === "filled" ? [ORDER_HISTORY_STATUS_COLUMN] : undefined,
        cells: [
          formatOrderTime(order.created_at, timeZone),
          order.display_name ?? order.market ?? "USDC/cNGN",
          formatIntentDirection(order),
          filledUsdc === null ? UNKNOWN_BALANCE : formatHistoryUsdc(filledUsdc),
          averagePrice === null ? UNKNOWN_BALANCE : formatNairaPrice(averagePrice),
          Number.isFinite(limit) ? formatNairaPrice(limit) : UNKNOWN_BALANCE,
          ORDER_STATUS_LABELS[order.status] ?? order.status,
        ],
      };
    }),
  };
}
