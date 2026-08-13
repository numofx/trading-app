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
