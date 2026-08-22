"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import posthog from "posthog-js";
import { useState } from "react";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { getDepositableCurrencies } from "@/lib/subaccount-deposit-config";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import {
  findSiblingAssetWithBalance,
  getAssetLedgerUnits,
  getWithdrawableAssets,
} from "@/lib/withdrawable-assets";
import type {
  DepositAccount,
  DepositScreen,
  DepositWalletBalances,
  TransferMode,
} from "@/ui/trading-terminal/DepositDialog";
import {
  buildAssetOptions,
  canPickFundingWallet,
  getLedgerBalanceLabel,
  getSideBalanceView,
  getTokenDecimals,
  toTokenScaledBalance,
} from "@/ui/trading-terminal/transfer-dialog-state";
import { useSubaccountDeposit } from "@/ui/trading-terminal/useSubaccountDeposit";
import { useSubaccountWithdraw } from "@/ui/trading-terminal/useSubaccountWithdraw";

/**
 * The "deposit the other asset" callback, or null on a deployment with only one.
 *
 * Funding a new account means two deposits — margin in USDC and inventory in cNGN — so a confirmed
 * deposit offers the other asset rather than only closing.
 */
function getDepositAnother(
  currencies: DepositCurrency[],
  currency: DepositCurrency,
  onSelect: (next: DepositCurrency) => void
) {
  const other = currencies.find((option) => option !== currency);
  return other === undefined ? null : () => onSelect(other);
}

/** The sibling escrow as the progress panel needs it: what to call it, how much, and how to switch. */
function buildWithdrawFallback({
  asset,
  onSelect,
  rows,
  walletBalances,
}: {
  asset: WithdrawableAsset | null;
  onSelect: (id: string) => void;
  rows: { asset: string; balance: bigint }[] | null;
  walletBalances: DepositWalletBalances | undefined;
}) {
  if (asset === null) {
    return null;
  }

  return {
    balanceLabel: getLedgerBalanceLabel(
      getAssetLedgerUnits(rows, asset.escrow),
      getTokenDecimals(walletBalances, asset.symbol),
      asset.symbol
    ),
    label: asset.label,
    onSelect: () => onSelect(asset.id),
  };
}

/**
 * Everything the transfer dialog knows: which side is showing, which screen, which asset, how much,
 * and both on-chain flows.
 *
 * It lives outside the component because two sides times three screens is more branching than a
 * render function should carry — what is left down there is close to pure markup.
 */
export function useTransferDialog({
  account,
  accountRows,
  controlledCurrency,
  fundingWallets,
  onCurrencyChange,
  onDeposited,
  onOpenChange,
  onSelectFundingWallet,
  onWithdrawn,
  open,
  walletBalances,
}: {
  account: DepositAccount | null;
  accountRows?: { asset: string; balance: bigint }[] | null;
  controlledCurrency?: DepositCurrency;
  fundingWallets?: ConnectedWallet[];
  onCurrencyChange?: (currency: DepositCurrency) => void;
  onDeposited: (subaccountId: string) => void;
  onOpenChange?: (open: boolean) => void;
  onSelectFundingWallet?: (wallet: ConnectedWallet) => void;
  onWithdrawn?: () => void;
  open?: boolean;
  walletBalances?: DepositWalletBalances;
}) {
  const depositableCurrencies = getDepositableCurrencies();
  const withdrawableAssets = getWithdrawableAssets();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [mode, setMode] = useState<TransferMode>("deposit");
  const [screen, setScreen] = useState<DepositScreen>("form");
  const [withdrawAssetId, setWithdrawAssetId] = useState(withdrawableAssets[0].id);
  const [amount, setAmount] = useState("");
  const [uncontrolledCurrency, setUncontrolledCurrency] = useState<DepositCurrency>("USDC");
  const { approve, clearInputError, deposit, flowState, inputError, reset, retry, startDeposit } =
    useSubaccountDeposit({ onDeposited });
  const {
    clearInputError: clearWithdrawInputError,
    flowState: withdrawFlowState,
    inputError: withdrawInputError,
    reset: resetWithdraw,
    startWithdraw,
  } = useSubaccountWithdraw({ onWithdrawn });

  const currency = controlledCurrency ?? uncontrolledCurrency;
  const withdrawAsset =
    withdrawableAssets.find((asset) => asset.id === withdrawAssetId) ?? withdrawableAssets[0];
  /**
   * Each side reads its own pot: deposits spend the wallet, withdrawals draw on the account. The
   * withdraw balance is keyed by escrow and restated in the token's decimals, which is the scale a
   * withdrawal is denominated in and the number Max fills in.
   */
  const withdrawBalance = toTokenScaledBalance(
    getAssetLedgerUnits(accountRows ?? null, withdrawAsset.escrow),
    getTokenDecimals(walletBalances, withdrawAsset.symbol)
  );
  const balanceView = getSideBalanceView({
    currency,
    mode,
    symbol: withdrawAsset.symbol,
    walletBalances,
    withdrawBalance,
  });
  /** Bound out of the view so the callback below keeps the non-null narrowing. */
  const maxAmount = balanceView.max;
  const connectedWallets = fundingWallets ?? [];

  function handleOpenChange(nextOpen: boolean) {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);

    if (!nextOpen) {
      reset();
      resetWithdraw();
      setMode("deposit");
      setScreen("form");
    }
  }

  /** Both states are kept, so the dialog behaves the same whether or not a parent drives it. */
  function selectCurrency(next: DepositCurrency) {
    setUncontrolledCurrency(next);
    onCurrencyChange?.(next);
  }

  function handleDepositAnother(next: DepositCurrency) {
    reset();
    setAmount("");
    selectCurrency(next);
  }

  /** Hands the amount to the flow machine; everything after this is on-chain steps. */
  function handleReviewDeposit(depositAccount: DepositAccount) {
    posthog.capture("deposit_started", {
      deposit_currency: currency,
      is_new_account: depositAccount.subaccountId === null,
      subaccount_id: depositAccount.subaccountId,
    });
    void startDeposit(depositAccount.wallet, amount, depositAccount.subaccountId, currency);
  }

  /** Sends the account's own balance back out to the wallet that is currently selected. */
  function handleWithdraw(withdrawAccount: DepositAccount) {
    posthog.capture("withdraw_started", {
      subaccount_id: withdrawAccount.subaccountId,
      withdraw_asset: withdrawAsset.id,
    });
    void startWithdraw({
      amountInput: amount,
      asset: withdrawAsset,
      balance: withdrawBalance,
      recipient: withdrawAccount.wallet.address,
      subaccountId: withdrawAccount.subaccountId,
      wallet: withdrawAccount.wallet,
    });
  }

  /**
   * Picking is also how a screen is dismissed, so re-picking what is already selected must not wipe
   * a typed amount — only a real switch does, because the amount was sized against the old balance.
   */
  function handlePickAsset(nextId: string) {
    const isSameAsset = mode === "deposit" ? nextId === currency : nextId === withdrawAssetId;

    if (!isSameAsset) {
      setAmount("");
      if (mode === "deposit") {
        selectCurrency(nextId as DepositCurrency);
      } else {
        setWithdrawAssetId(nextId);
      }
    }

    setScreen("form");
  }

  /** Switches to the sibling escrow and returns to a clean amount step. */
  function useSiblingAsset(nextId: string) {
    resetWithdraw();
    setAmount("");
    setWithdrawAssetId(nextId);
  }

  function handlePickWallet(wallet: ConnectedWallet) {
    onSelectFundingWallet?.(wallet);
    setScreen("form");
  }

  /**
   * Hands off to Privy's on-ramp for the wallet that would pay. The picker closes first: the flow
   * opens Privy's own modal, and leaving this one stacked behind it reads as two dialogs fighting.
   */
  function handleFundWithBank() {
    setScreen("form");
    void account?.wallet.fund?.();
  }

  /** An amount typed against the wallet balance means nothing against the account's, and back. */
  function handleSelectMode(next: TransferMode) {
    if (next !== mode) {
      setAmount("");
      clearInputError();
      clearWithdrawInputError();
    }

    setMode(next);
  }

  function handleAmountChange(next: string) {
    clearInputError();
    clearWithdrawInputError();
    setAmount(next);
  }

  return {
    amount,
    approve,
    assetOptions: buildAssetOptions({
      accountRows: accountRows ?? null,
      currencies: depositableCurrencies,
      mode,
      walletBalances,
      withdrawableAssets,
    }),
    balanceView,
    canFundWithBank: typeof account?.wallet.fund === "function",
    connectedWallets,
    currency,
    deposit,
    depositFlowState: flowState,
    handleAmountChange,
    handleFundWithBank,
    handleOpenChange,
    handlePickAsset,
    handlePickWallet,
    handleReviewDeposit,
    handleSelectMode,
    handleWithdraw,
    inputError: mode === "deposit" ? inputError : withdrawInputError,
    isDepositMode: mode === "deposit",
    isOnPicker: screen !== "form",
    isOpen: open ?? uncontrolledOpen,
    mode,
    depositAnother: getDepositAnother(depositableCurrencies, currency, handleDepositAnother),
    openWalletPicker: canPickFundingWallet(account, connectedWallets)
      ? () => setScreen("wallet")
      : null,
    openAssetPicker: () => setScreen("asset"),
    reset,
    resetWithdraw,
    retry,
    returnToForm: () => setScreen("form"),
    screen,
    selectedAssetId: mode === "deposit" ? currency : withdrawAssetId,
    setMaxAmount: maxAmount === null ? null : () => setAmount(maxAmount),
    withdrawAsset,
    /**
     * The other escrow of the same ticker, offered only when this one has been blocked — the
     * moment it becomes useful, and the moment a trader would otherwise give up.
     */
    withdrawFallback:
      withdrawFlowState?.status === "blocked"
        ? buildWithdrawFallback({
            asset: findSiblingAssetWithBalance({
              assets: withdrawableAssets,
              current: withdrawAsset,
              rows: accountRows ?? null,
            }),
            onSelect: useSiblingAsset,
            rows: accountRows ?? null,
            walletBalances,
          })
        : null,
    withdrawFlowState,
  };
}
