"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { X } from "lucide-react";
import { useState } from "react";
import { formatUnits } from "viem";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import { useSubaccountWithdraw } from "@/ui/trading-terminal/useSubaccountWithdraw";

const PRIMARY_BUTTON_CLASSES =
  "h-11 w-full cursor-pointer rounded-sm bg-[#9BDBF8] font-semibold text-[#111111] text-[14px] transition-colors hover:bg-[#9BDBF8]/90 disabled:cursor-not-allowed disabled:opacity-60";

const LEDGER_DECIMALS = 18;
/** Every token the perp pays out has at most this many decimals; the ledger's extra ones are dust. */
const DISPLAY_DECIMALS = 6;

/** A ledger balance in the token's own precision, rounded down, as the amount input shows it. */
function formatWithdrawable(units: bigint) {
  const dust = 10n ** BigInt(LEDGER_DECIMALS - DISPLAY_DECIMALS);
  return formatUnits(units - (units % dust), LEDGER_DECIMALS);
}

/**
 * Withdraws one asset from the perp margin account: its USDC cash, or cNGN posted as collateral.
 * Matching holds the account, so the wallet signs a WithdrawalModule action for that asset's escrow
 * (no gas) and the venue's executor submits it; the escrow pays the account's owner. Only what the
 * account can spare leaves: a withdrawal that would take it under initial margin for an open
 * position is refused by the venue's simulation, with nothing sent.
 */
export function PerpWithdrawDialog({
  asset,
  balanceUnits,
  onOpenChange,
  onWithdrawn,
  open,
  subaccountId,
  wallet,
}: {
  asset: WithdrawableAsset;
  /** The account's balance of this asset in ledger units (18 decimals), or null before it is read. */
  balanceUnits: bigint | null;
  onOpenChange: (open: boolean) => void;
  onWithdrawn: () => void;
  open: boolean;
  subaccountId: string | null;
  wallet: ConnectedWallet | null;
}) {
  const [amount, setAmount] = useState("");
  const withdraw = useSubaccountWithdraw({ onWithdrawn: () => onWithdrawn() });
  const state = withdraw.flowState;

  function start() {
    if (wallet === null) {
      return;
    }
    void withdraw.startWithdraw({
      amountInput: amount,
      asset,
      balance: balanceUnits === null ? null : { decimals: LEDGER_DECIMALS, units: balanceUnits },
      recipient: wallet.address,
      subaccountId,
      wallet,
    });
  }

  function close(next: boolean) {
    if (!next) {
      withdraw.reset();
      setAmount("");
    }
    onOpenChange(next);
  }

  return (
    <Dialog.Root onOpenChange={close} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-1/2 fixed top-1/2 left-1/2 z-50 w-[min(92vw,400px)] space-y-4 bg-dialog-bg p-6 text-foreground shadow-[0_28px_90px_var(--panel-shadow)] ring-1 ring-panel-ring transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-center gap-3">
            <Dialog.Title className="flex-1 font-semibold text-[15px] text-panel-text-active">
              Withdraw perp margin ({asset.symbol})
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close perp withdraw dialog"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <p className="text-[12px] text-panel-text-muted leading-snug">
            {asset.symbol} is paid to your connected wallet. Margin backing an open position cannot
            leave; close the position first.
            {subaccountId === null ? "" : ` Account #${subaccountId}.`}
          </p>

          {state === null ? (
            <>
              <div className="rounded-sm bg-input-bg px-3 py-2 ring-1 ring-panel-border focus-within:ring-panel-text-muted">
                <div className="flex items-center justify-between gap-2">
                  <label
                    className="block text-[11px] text-panel-text-muted"
                    htmlFor="perp-withdraw-amount"
                  >
                    Amount ({asset.symbol})
                  </label>
                  {balanceUnits === null ? null : (
                    <button
                      className="cursor-pointer text-[11px] text-panel-text hover:text-panel-text-active"
                      onClick={() => {
                        withdraw.clearInputError();
                        setAmount(formatWithdrawable(balanceUnits));
                      }}
                      type="button"
                    >
                      Max {formatWithdrawable(balanceUnits)}
                    </button>
                  )}
                </div>
                <input
                  className="w-full bg-transparent font-mono text-[16px] text-panel-text-active outline-none placeholder:text-panel-text-muted/60"
                  id="perp-withdraw-amount"
                  inputMode="decimal"
                  onChange={(event) => {
                    withdraw.clearInputError();
                    setAmount(event.target.value.replace(/[^\d.,]/g, ""));
                  }}
                  placeholder="0.0"
                  value={amount}
                />
              </div>
              {withdraw.inputError === null ? null : (
                <p className="text-[11px] text-sell">{withdraw.inputError}</p>
              )}
              <button
                className={PRIMARY_BUTTON_CLASSES}
                disabled={wallet === null || subaccountId === null || amount === ""}
                onClick={start}
                type="button"
              >
                Withdraw
              </button>
            </>
          ) : (
            <WithdrawProgress
              onRetry={() => withdraw.reset()}
              state={state}
              symbol={asset.symbol}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WithdrawProgress({
  onRetry,
  state,
  symbol,
}: {
  onRetry: () => void;
  state: NonNullable<ReturnType<typeof useSubaccountWithdraw>["flowState"]>;
  symbol: string;
}) {
  switch (state.status) {
    case "checking":
      return <p className="text-[12px] text-panel-text-muted">Checking the account…</p>;
    case "signing":
      return (
        <p className="text-[12px] text-panel-text-muted">
          Sign the withdrawal of{" "}
          <span className="font-semibold text-panel-text-active">{state.amount}</span> in your
          wallet. It costs no gas; the venue submits it. Check the amount here: the wallet shows
          only the encoded message.
        </p>
      );
    case "submitting":
      return (
        <p className="text-[12px] text-panel-text-muted">
          The venue is checking and submitting your withdrawal of {state.amount}…
        </p>
      );
    case "confirming":
      return (
        <p className="text-[12px] text-panel-text-muted">Waiting for the transaction to confirm…</p>
      );
    case "success":
      return (
        <>
          <p className="text-[12px] text-panel-text">Withdrawn. The {symbol} is in your wallet.</p>
          <Dialog.Close className={PRIMARY_BUTTON_CLASSES}>Done</Dialog.Close>
        </>
      );
    case "blocked":
      return (
        <>
          <p className="text-[12px] text-sell">{state.reason}</p>
          <button className={PRIMARY_BUTTON_CLASSES} onClick={onRetry} type="button">
            Back
          </button>
        </>
      );
    case "failed":
      return (
        <>
          <p className="text-[12px] text-sell">{state.error}</p>
          <button className={PRIMARY_BUTTON_CLASSES} onClick={onRetry} type="button">
            Try again
          </button>
        </>
      );
    default:
      return null;
  }
}
