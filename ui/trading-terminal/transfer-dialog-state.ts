import type { ConnectedWallet } from "@privy-io/react-auth";
import { formatUnits } from "viem";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { toTokenUnits } from "@/lib/subaccount-withdraw";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import { getAssetLedgerUnits } from "@/lib/withdrawable-assets";
import type {
  DepositAccount,
  DepositWalletBalances,
  TransferMode,
} from "@/ui/trading-terminal/DepositDialog";

/** What one row of the asset screen needs, whichever side built it. */
export type AssetOption = {
  balanceLabel: string | null;
  iconSrc: string;
  id: string;
  label: string;
};

/** The SubAccounts ledger normalizes every asset to 18 decimals, whatever the token uses. */
const LEDGER_DECIMALS = 18;

export function toBalanceNumber(balance: { decimals: number; units: bigint } | null | undefined) {
  return balance === null || balance === undefined
    ? null
    : Number(formatUnits(balance.units, balance.decimals));
}

export function formatBalanceLabel(value: number, currency: DepositCurrency) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
}

/** The label for a wallet balance, or null when there is no read for that currency. */
export function getBalanceLabelFor(
  balances: DepositWalletBalances | undefined,
  currency: DepositCurrency
) {
  const value = toBalanceNumber(balances?.[currency]);
  return value === null ? null : formatBalanceLabel(value, currency);
}

/**
 * What the funding wallet holds of the selected asset: the display label, and the exact amount Max
 * would fill in. `max` is null with nothing to spend, which is also what hides the Max button.
 */
export function getBalanceView(
  balances: DepositWalletBalances | undefined,
  currency: DepositCurrency
): { label: string | null; max: string | null } {
  const balance = balances?.[currency] ?? null;
  const value = toBalanceNumber(balance);

  if (balance === null || value === null || value <= 0) {
    return { label: getBalanceLabelFor(balances, currency), max: null };
  }

  return {
    label: formatBalanceLabel(value, currency),
    max: formatUnits(balance.units, balance.decimals),
  };
}

/**
 * What the amount field draws on: the wallet for a deposit, the trading account for a withdrawal.
 */
export function getSideBalanceView({
  currency,
  mode,
  symbol,
  walletBalances,
  withdrawBalance,
}: {
  currency: DepositCurrency;
  mode: TransferMode;
  /** The withdraw asset's ticker, which is independent of the deposit currency. */
  symbol: string;
  walletBalances: DepositWalletBalances | undefined;
  withdrawBalance: { decimals: number; units: bigint } | null;
}) {
  if (mode === "deposit") {
    return getBalanceView(walletBalances, currency);
  }

  const ticker = symbol as DepositCurrency;
  return getBalanceView({ [ticker]: withdrawBalance }, ticker);
}

/** Rows for the asset screen, built from whichever side is showing. */
export function buildAssetOptions({
  accountRows,
  currencies,
  mode,
  walletBalances,
  withdrawableAssets,
}: {
  accountRows: { asset: string; balance: bigint }[] | null;
  currencies: DepositCurrency[];
  mode: TransferMode;
  walletBalances: DepositWalletBalances | undefined;
  withdrawableAssets: WithdrawableAsset[];
}): AssetOption[] {
  if (mode === "deposit") {
    return currencies.map((option) => ({
      balanceLabel: getBalanceLabelFor(walletBalances, option),
      iconSrc: getTokenIconSrc(option),
      id: option,
      label: option,
    }));
  }

  return withdrawableAssets.map((asset) => ({
    balanceLabel: getLedgerBalanceLabel(
      getAssetLedgerUnits(accountRows, asset.escrow),
      getTokenDecimals(walletBalances, asset.symbol),
      asset.symbol
    ),
    iconSrc: getTokenIconSrc(asset.symbol),
    id: asset.id,
    label: asset.label,
  }));
}

/**
 * The token's decimals, borrowed from the wallet-balance read for the same token.
 *
 * Nothing else on this screen knows them, and they matter: the ledger's 18 are not the scale a
 * withdrawal is denominated in. Undefined until that read lands, which leaves the balance at
 * ledger scale for a moment rather than showing a wrong number.
 */
export function getTokenDecimals(balances: DepositWalletBalances | undefined, symbol: string) {
  return balances?.[symbol as DepositCurrency]?.decimals;
}

/**
 * A ledger balance restated in the token's decimals, rounding down.
 *
 * The ledger keeps 18 for every asset; the escrow pays out in the token's own scale. Rounding down
 * matters because this is what Max fills in — a balance rounded up is an amount the escrow refuses.
 */
export function toTokenScaledBalance(
  ledgerUnits: bigint | null,
  tokenDecimals: number | undefined
) {
  if (ledgerUnits === null) {
    return null;
  }

  if (tokenDecimals === undefined) {
    return { decimals: LEDGER_DECIMALS, units: ledgerUnits };
  }

  return {
    decimals: tokenDecimals,
    units: toTokenUnits({ decimals: LEDGER_DECIMALS, units: ledgerUnits }, tokenDecimals),
  };
}

/** The same balance as a display label, or null when the ledger has not been read. */
export function getLedgerBalanceLabel(
  ledgerUnits: bigint | null,
  tokenDecimals: number | undefined,
  symbol: string
) {
  const balance = toTokenScaledBalance(ledgerUnits, tokenDecimals);

  if (balance === null) {
    return null;
  }

  const value = Number(formatUnits(balance.units, balance.decimals));
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
}

/**
 * The row opens whenever there are wallets to choose between — first deposit included.
 *
 * That case needs the selection to move the app's whole trading identity, not just who signs:
 * the first deposit creates the account, and the account belongs to the signer. See
 * `OrderBookTradingTerminal`, which resolves the subaccount from the selected wallet for exactly
 * this reason.
 */
export function canPickFundingWallet(account: DepositAccount | null, wallets: ConnectedWallet[]) {
  return account !== null && wallets.length > 0;
}

/**
 * Shrinks the hero amount as it grows so a cNGN-sized number stays on one line. The unit and the
 * invisible width sizer take the same class, or the caret drifts away from the digits.
 */
export function getAmountFontClass(text: string) {
  if (text.length > 13) {
    return "text-[20px]";
  }

  if (text.length > 9) {
    return "text-[26px]";
  }

  if (text.length > 6) {
    return "text-[34px]";
  }

  return "text-[44px]";
}

/** Token mark for a ticker, from the same set the market pill uses. */
export function getTokenIconSrc(symbol: string) {
  return symbol === "cNGN" ? "/tokens/cngn.svg" : "/tokens/usdc.svg";
}

/** Screen names for the drill-downs, which read differently depending on the direction. */
export function getPickerTitles(mode: TransferMode) {
  return mode === "deposit"
    ? { asset: "Deposit to", balanceCaption: "Available", wallet: "Transfer from" }
    : { asset: "Withdraw from", balanceCaption: "In account", wallet: "Transfer to" };
}
