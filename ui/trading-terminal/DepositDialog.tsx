"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { X } from "lucide-react";
import posthog from "posthog-js";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { DepositBlockedReason, DepositFlowState } from "@/lib/subaccount-deposit.types";
import { useSubaccountDeposit } from "@/ui/trading-terminal/useSubaccountDeposit";

function getBlockedCopy(reason: DepositBlockedReason, isCreatePath: boolean) {
  if (reason === "zero-amount") {
    return "Enter an amount greater than zero.";
  }

  if (reason === "insufficient-balance") {
    return "Your wallet balance is below the deposit amount.";
  }

  if (isCreatePath) {
    return "Deposits are whitelist-gated on this deployment, and a brand-new trading account cannot be pre-approved. Ask the venue operator to whitelist your account or disable the whitelist.";
  }

  return "This trading account is not approved for deposits yet. Ask the venue operator to whitelist it.";
}

function getStepCopy(flowState: DepositFlowState) {
  switch (flowState.status) {
    case "preflight":
      return "Checking balance, allowance, and deposit permissions...";
    case "awaiting-approval":
      return "Step 1 of 2 — approve USDC so the venue can pull your deposit.";
    case "approving":
      return "Waiting for the approval transaction to confirm...";
    case "awaiting-deposit":
      return "Step 2 of 2 — confirm the deposit transaction.";
    case "depositing":
      return "Waiting for the deposit transaction to confirm...";
    default:
      return null;
  }
}

const PRIMARY_BUTTON_CLASSES =
  "min-h-11 flex-1 cursor-pointer rounded-[12px] bg-foreground font-semibold text-[13px] text-background transition-colors hover:bg-foreground/90";

/**
 * First step for a visitor with no wallet. The deposit form itself is useless without one — there
 * is no address to pull USDC from — so the dialog offers login instead of a dead disabled field.
 */
function ConnectWalletStep({ onConnectWallet }: { onConnectWallet?: () => void }) {
  return (
    <div className="mt-4 space-y-3">
      <p className="text-[12px] text-panel-text">
        Connect a wallet to open a trading account and fund it with USDC margin.
      </p>
      {onConnectWallet === undefined ? null : (
        <button
          className={cn(PRIMARY_BUTTON_CLASSES, "w-full")}
          onClick={onConnectWallet}
          type="button"
        >
          Connect wallet
        </button>
      )}
    </div>
  );
}

function DepositProgress({
  approve,
  deposit,
  flowState,
  reset,
  retry,
}: {
  approve: () => Promise<void>;
  deposit: () => Promise<void>;
  flowState: DepositFlowState;
  reset: () => void;
  retry: () => void;
}) {
  const isBusy =
    flowState.status === "preflight" ||
    flowState.status === "approving" ||
    flowState.status === "depositing";
  const stepCopy = getStepCopy(flowState);

  return (
    <div className="mt-4 space-y-3">
      {stepCopy !== null ? (
        <p className={cn("text-[12px] text-panel-text", isBusy && "animate-pulse")}>{stepCopy}</p>
      ) : null}

      {flowState.status === "blocked" ? (
        <p className="text-[12px] text-ask-text">
          {getBlockedCopy(flowState.reason, flowState.context.path === "create-and-deposit")}
        </p>
      ) : null}

      {flowState.status === "failed" ? (
        <p className="wrap-break-word text-[12px] text-ask-text">{flowState.error}</p>
      ) : null}

      {flowState.status === "success" ? (
        <p className="text-[12px] text-panel-text-active">
          Deposit confirmed to trading account #{flowState.subaccountId}.
        </p>
      ) : null}

      <div className="flex gap-2">
        {flowState.status === "awaiting-approval" ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={() => void approve()} type="button">
            Approve USDC
          </button>
        ) : null}

        {flowState.status === "awaiting-deposit" ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={() => void deposit()} type="button">
            Confirm deposit
          </button>
        ) : null}

        {flowState.status === "failed" ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={retry} type="button">
            Retry
          </button>
        ) : null}

        {flowState.status === "blocked" || flowState.status === "failed" ? (
          <button
            className="min-h-11 flex-1 rounded-[12px] bg-input-bg font-semibold text-[13px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover"
            onClick={reset}
            type="button"
          >
            Back
          </button>
        ) : null}

        {flowState.status === "success" ? (
          <Dialog.Close className={PRIMARY_BUTTON_CLASSES}>Done</Dialog.Close>
        ) : null}
      </div>
    </div>
  );
}

export function DepositDialog({
  onConnectWallet,
  onDeposited,
  onOpenChange,
  open,
  subaccountId,
  triggerClassName,
  triggerId,
  wallet,
}: {
  /** Starts wallet login from the dialog's no-wallet step. */
  onConnectWallet?: () => void;
  onDeposited: (subaccountId: string) => void;
  /** Pass with `open` to drive the dialog from outside, e.g. the order ticket's Deposit CTA. */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state; omit to let the dialog own it from its own trigger. */
  open?: boolean;
  subaccountId: string | null;
  /** Overrides the default inline pill trigger styling, e.g. for the global header toolbar. */
  triggerClassName?: string;
  /** Stable DOM id for the trigger so SSR and client markup agree even if hydration re-renders. */
  triggerId?: string;
  wallet: ConnectedWallet | null;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const { approve, deposit, flowState, inputError, reset, retry, startDeposit } =
    useSubaccountDeposit({
      onDeposited,
    });
  const isOpen = open ?? uncontrolledOpen;

  function handleOpenChange(nextOpen: boolean) {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      reset();
    }
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={isOpen}>
      {/*
       * Not gated on a connected wallet: the dialog's first step is the login prompt, so a
       * disconnected visitor clicking Deposit gets somewhere to go instead of a dead button.
       */}
      <Dialog.Trigger
        className={
          triggerClassName ??
          "rounded-lg bg-input-bg px-2 py-0.5 font-semibold text-[11px] text-panel-text-active ring-1 ring-panel-border transition-colors hover:bg-input-hover"
        }
        id={triggerId}
      >
        Deposit
      </Dialog.Trigger>
      <Dialog.Portal>
        {/*
         * Explicit z-index: the terminal panels create stacking contexts that otherwise paint
         * over the popup — order book rows were rendering on top of this dialog's own controls.
         */}
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-1/2 fixed top-1/2 left-1/2 z-50 w-[min(92vw,380px)] rounded-[20px] bg-panel-bg p-5 text-foreground shadow-[0_28px_90px_var(--panel-shadow)] ring-1 ring-panel-ring transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-semibold text-[15px] text-panel-text">
              Deposit USDC margin
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close deposit dialog"
              className="-mt-1 -mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-[12px] text-panel-text-muted">
            {subaccountId === null
              ? "Creates your trading account and funds it in one flow."
              : `Funds trading account #${subaccountId}.`}
          </Dialog.Description>

          {wallet === null ? <ConnectWalletStep onConnectWallet={onConnectWallet} /> : null}

          {wallet !== null && flowState === null ? (
            <div className="mt-4 space-y-3">
              <label className="block text-[12px] text-panel-text" htmlFor="deposit-amount">
                Amount (USDC)
              </label>
              <input
                className="min-h-11 w-full rounded-[12px] border border-input-border bg-input-bg px-3 font-semibold text-[14px] text-panel-text outline-none"
                id="deposit-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="1000"
                value={amount}
              />
              {inputError !== null ? (
                <p className="text-[11px] text-ask-text">{inputError}</p>
              ) : null}
              <button
                className={cn(PRIMARY_BUTTON_CLASSES, "w-full")}
                onClick={() => {
                  posthog.capture("deposit_started", {
                    is_new_account: subaccountId === null,
                    subaccount_id: subaccountId,
                  });
                  void startDeposit(wallet, amount, subaccountId);
                }}
                type="button"
              >
                Continue
              </button>
            </div>
          ) : null}

          {wallet !== null && flowState !== null ? (
            <DepositProgress
              approve={approve}
              deposit={deposit}
              flowState={flowState}
              reset={reset}
              retry={retry}
            />
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
