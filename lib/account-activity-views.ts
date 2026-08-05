import type { ActivityView } from "@/lib/trading.types";

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
