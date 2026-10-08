"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { getFirstDepositableCurrency } from "@/lib/subaccount-deposit-config";
import type { TransferMode } from "@/ui/trading-terminal/DepositDialog";
import { buildDepositAccount, DepositDialog } from "@/ui/trading-terminal/DepositDialog";
import { HEADER_ACTION_CLASSES } from "@/ui/trading-terminal/TerminalHeaderBar";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";

/**
 * The trading account's one Deposit / Withdraw flow, the same on both markets. Since the
 * unified-account cutover (2026-10-04) spot and the perp settle into one account under one manager,
 * so there is one dialog for moving money in and out of it, wherever the trader opens it from.
 *
 * Returns the header's Deposit and Withdraw controls (the dialog hangs off the Deposit trigger) and
 * the two openers every other entry point uses: the ticket's shortfall CTA, the Account rows, the
 * Balances tab. Each names the asset, so the dialog lands on the one the trader was looking at.
 */
export function useAccountTransfer({
  accountRows,
  depositNotes,
  depositPauseReasons,
  onTransferred,
}: {
  /** The account's on-ledger rows, which the withdraw side reads its balances and Max from. */
  accountRows: { asset: string; balance: bigint }[] | null;
  /** A note per currency on the deposit form; the perp's cNGN haircut. */
  depositNotes?: Partial<Record<DepositCurrency, string>>;
  /** Deposits the market knows are closed, beyond the deployment's configured pauses. */
  depositPauseReasons?: Partial<Record<DepositCurrency, string>>;
  /**
   * Re-reads what a transfer moved besides the wallet's balances, which the session refreshes:
   * the market's own view of the account. At or past the receipt's block when one is known.
   */
  onTransferred: (blockNumber: bigint | null) => void;
}): {
  headerControl: ReactNode;
  openDeposit: (currency?: DepositCurrency) => void;
  openWithdraw: (currency: DepositCurrency) => void;
} {
  const {
    account,
    isSignedIn,
    login,
    primaryWallet,
    refreshWalletBalances,
    selectWallet,
    walletBalances,
    wallets,
  } = useTerminalSession();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TransferMode>("deposit");
  // Held here rather than inside the dialog because the opener names the currency: a "Deposit
  // cNGN" button must not land on the USDC form.
  const [currency, setCurrency] = useState<DepositCurrency>(getFirstDepositableCurrency);
  const [resumeAfterLogin, setResumeAfterLogin] = useState(false);

  /**
   * Base UI dialogs are modal, so Privy's login modal would render inert behind this one. The
   * dialog steps aside for the login and the effect below brings it back once a wallet lands.
   */
  function handleConnectWallet() {
    setOpen(false);
    setResumeAfterLogin(true);
    login();
  }

  useEffect(() => {
    if (resumeAfterLogin && primaryWallet !== null) {
      setResumeAfterLogin(false);
      setOpen(true);
    }
  }, [primaryWallet, resumeAfterLogin]);

  /** Re-reads every balance a transfer moves, at or past its block. */
  function refreshAfter(blockNumber: bigint | null) {
    refreshWalletBalances(blockNumber);
    onTransferred(blockNumber);
  }

  function openDeposit(next?: DepositCurrency) {
    if (next !== undefined) {
      setCurrency(next);
    }
    setMode("deposit");
    setOpen(true);
  }

  function openWithdraw(next: DepositCurrency) {
    setCurrency(next);
    setMode("withdraw");
    setOpen(true);
  }

  const headerControl = (
    // Deposit opens the dialog on its own trigger; Withdraw is a second door into the same dialog,
    // opened on its Withdraw side.
    <div className="flex items-center gap-2">
      <DepositDialog
        account={buildDepositAccount(primaryWallet, account.subaccountId)}
        accountRows={accountRows}
        currency={currency}
        depositNotes={depositNotes}
        depositPauseReasons={depositPauseReasons}
        fundingWallets={isSignedIn ? wallets : []}
        mode={mode}
        onConnectWallet={handleConnectWallet}
        onCurrencyChange={setCurrency}
        onDeposited={(subaccountId, blockNumber) => {
          account.adoptSubaccountId(subaccountId);
          refreshAfter(blockNumber);
        }}
        onModeChange={setMode}
        onOpenChange={setOpen}
        onSelectFundingWallet={(wallet) => selectWallet(wallet.address)}
        onWithdrawn={refreshAfter}
        open={open}
        triggerClassName={HEADER_ACTION_CLASSES}
        triggerId="header-deposit-trigger"
        walletBalances={{ cNGN: walletBalances.cngn, USDC: walletBalances.usdc }}
      />
      <button
        className={HEADER_ACTION_CLASSES}
        id="header-withdraw-trigger"
        onClick={() => {
          setMode("withdraw");
          setOpen(true);
        }}
        type="button"
      >
        Withdraw
      </button>
    </div>
  );

  return { headerControl, openDeposit, openWithdraw };
}
