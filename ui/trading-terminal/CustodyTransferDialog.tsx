"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { formatUnits } from "viem";
import {
  custodyAmountError,
  parseUsdcAmount,
  USDC_DECIMALS,
  withdrawableUsdc,
} from "@/lib/custody-routing";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import type { TransferMode } from "@/ui/trading-terminal/DepositDialog";
import { ModeTabs } from "@/ui/trading-terminal/DepositDialog";
import {
  HEADER_ACTION_CLASSES,
  HEADER_PRIMARY_ACTION_CLASSES,
} from "@/ui/trading-terminal/TerminalHeaderBar";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";
import type { useCustodianTrading } from "@/ui/trading-terminal/useCustodianTrading";

type Custody = ReturnType<typeof useCustodianTrading>;

/** The amount, its checks and the submit, for one side (deposit or withdraw). */
function CustodyTransferForm({
  accountCashUnits,
  custody,
  mode,
  onTransferred,
}: {
  accountCashUnits: bigint | null;
  custody: Custody;
  mode: TransferMode;
  onTransferred: (blockNumber: bigint | null) => void;
}) {
  const { refreshWalletBalances, walletBalances } = useTerminalSession();
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const isDeposit = mode === "deposit";
  const available = isDeposit
    ? (walletBalances.usdc?.units ?? null)
    : withdrawableUsdc(custody.accountId === null ? null : accountCashUnits);
  const parsed = parseUsdcAmount(amount);
  const error = amount === "" ? null : custodyAmountError(mode, parsed, available);
  const canSubmit = custody.busy === null && parsed !== null && parsed > 0n && error === null;

  async function submit() {
    if (!canSubmit || parsed === null) {
      return;
    }
    setDone(null);
    const sent = isDeposit ? await custody.setUp(parsed) : await custody.withdraw(parsed);
    if (sent === null) {
      return;
    }
    refreshWalletBalances(sent.blockNumber);
    onTransferred(sent.blockNumber);
    setAmount("");
    const usdc = formatUnits(parsed, USDC_DECIMALS);
    setDone(isDeposit ? `Deposited ${usdc} USDC.` : `Withdrew ${usdc} USDC to your wallet.`);
  }

  let description = "USDC from your onchain account to your wallet. Only your wallet can withdraw.";
  if (isDeposit) {
    description =
      "USDC from your wallet into your onchain account. No gas: your wallet signs, the venue pays.";
  } else if (custody.accountId === null) {
    description =
      "You have no onchain account yet. Other balances withdraw from their own rows under the ticket.";
  }
  let submitLabel = "Withdraw to my wallet";
  if (isDeposit) {
    submitLabel = custody.accountId === null ? "Open the account and deposit" : "Deposit";
  }
  return (
    <>
      <p className="text-[12px] text-panel-text-muted">{description}</p>
      <label className="flex items-center gap-2 bg-panel-bg px-3 py-2 ring-2 ring-panel-ring">
        <input
          aria-label={`${isDeposit ? "Deposit" : "Withdraw"} amount in USDC`}
          className="min-w-0 flex-1 bg-transparent font-mono font-semibold text-[22px] text-panel-text-active outline-none"
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder="0"
          value={amount}
        />
        <span className="font-semibold text-panel-text-muted">USDC</span>
      </label>
      <div className="flex items-center justify-between text-[12px] text-panel-text-muted">
        <span>
          {isDeposit ? "Wallet" : "Withdrawable"}:{" "}
          {available === null ? "—" : `${formatUnits(available, USDC_DECIMALS)} USDC`}
        </span>
        {available !== null && available > 0n ? (
          <button
            className="cursor-pointer font-semibold text-panel-text-active hover:underline"
            onClick={() => setAmount(formatUnits(available, USDC_DECIMALS))}
            type="button"
          >
            Max
          </button>
        ) : null}
      </div>
      <button
        className={HEADER_PRIMARY_ACTION_CLASSES}
        disabled={!canSubmit}
        onClick={() => void submit()}
        type="button"
      >
        {submitLabel}
      </button>
      <CustodyTransferStatus custody={custody} done={done} error={error} />
    </>
  );
}

function CustodyTransferStatus({
  custody,
  done,
  error,
}: {
  custody: Custody;
  done: string | null;
  error: string | null;
}) {
  return (
    <>
      {error ? <span className="text-[12px] text-red-400">{error}</span> : null}
      {custody.busy ? (
        <span className="text-[12px] text-panel-text-muted">
          {custody.busy}… check your wallet for a signature request.
        </span>
      ) : null}
      {custody.lastError ? (
        <span className="text-[12px] text-red-400">{custody.lastError}</span>
      ) : null}
      {done ? <span className="text-[12px] text-green-400">{done}</span> : null}
    </>
  );
}

/**
 * Deposit and Withdraw for an onchain custody account (NEXT_PUBLIC_CUSTODIAN_ENABLED): USDC only, gasless. A
 * deposit opens the account and sets this browser's trading key on the way when either is missing; a
 * withdrawal pays out to the wallet. Both are signed by the wallet. The same openers as `useAccountTransfer`,
 * so every Deposit and Withdraw in the terminal goes one way.
 */
export function useCustodyTransfer({
  accountCashUnits,
  custody,
  onTransferred,
  withdrawElsewhere,
}: {
  /** The custody account's cash (18 dp), or null when it has none or it is not read yet. */
  accountCashUnits: bigint | null;
  custody: Custody;
  /** Re-reads the account at or past the transfer's block. */
  onTransferred: (blockNumber: bigint | null) => void;
  /**
   * Where Withdraw goes while there is no custody account to withdraw from (the Matching account's own dialog),
   * or null to open this one.
   */
  withdrawElsewhere: (() => void) | null;
}): {
  headerControl: ReactNode;
  openDeposit: (currency?: DepositCurrency) => void;
  openWithdraw: (currency: DepositCurrency) => void;
} {
  const { login, primaryWallet } = useTerminalSession();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TransferMode>("deposit");
  // Bumped on every open so the form starts empty.
  const [session, setSession] = useState(0);

  function openWith(next: TransferMode) {
    setMode(next);
    setSession((n) => n + 1);
    setOpen(true);
  }

  const openWithdraw = () =>
    withdrawElsewhere === null ? openWith("withdraw") : withdrawElsewhere();

  const headerControl = (
    <div className="flex items-center gap-2">
      <button
        className={HEADER_PRIMARY_ACTION_CLASSES}
        id="header-deposit-trigger"
        onClick={() => openWith("deposit")}
        type="button"
      >
        Deposit
        <ArrowRight aria-hidden className="size-4" />
      </button>
      <button
        className={HEADER_ACTION_CLASSES}
        id="header-withdraw-trigger"
        onClick={openWithdraw}
        type="button"
      >
        Withdraw
      </button>
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="-translate-1/2 fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,420px)] flex-col gap-4 bg-dialog-bg p-6 text-foreground shadow-[0_28px_90px_var(--panel-shadow)] ring-1 ring-panel-ring">
            <div className="flex items-start justify-between gap-3">
              <Dialog.Title className="sr-only">
                {mode === "deposit" ? "Deposit" : "Withdraw"}
              </Dialog.Title>
              <ModeTabs mode={mode} onSelect={setMode} />
              <Dialog.Close
                aria-label="Close"
                className="-mt-0.5 -mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            {primaryWallet === null ? (
              <button
                className={HEADER_PRIMARY_ACTION_CLASSES}
                onClick={() => {
                  setOpen(false);
                  login();
                }}
                type="button"
              >
                Connect a wallet
              </button>
            ) : (
              <CustodyTransferForm
                accountCashUnits={accountCashUnits}
                custody={custody}
                key={`${session}-${mode}`}
                mode={mode}
                onTransferred={onTransferred}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );

  return {
    headerControl,
    openDeposit: () => openWith("deposit"),
    openWithdraw,
  };
}
