"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { X } from "lucide-react";
import { useState } from "react";
import type { PerpCollateralAsset, PerpStack } from "@/lib/perp-market.types";
import type { DepositBlockedReason, DepositCurrency } from "@/lib/subaccount-deposit.types";
import {
  getCngnTokenAddress,
  getSubaccountCreatorAddress,
  getUsdcTokenAddress,
} from "@/lib/subaccount-deposit-config";
import { useSubaccountDeposit } from "@/ui/trading-terminal/useSubaccountDeposit";

const PRIMARY_BUTTON_CLASSES =
  "h-11 w-full cursor-pointer rounded-sm bg-[#9BDBF8] font-semibold text-[#111111] text-[14px] transition-colors hover:bg-[#9BDBF8]/90 disabled:cursor-not-allowed disabled:opacity-60";

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" });

/**
 * The cNGN the venue accepts as perp margin: credited by its SRM AND open for deposits on the
 * escrow itself. Between the two (the vault configures first, opens later) a deposit would revert,
 * so the dialog does not offer it.
 */
function getCngnCollateral(stack: PerpStack): PerpCollateralAsset | null {
  return (
    stack.collateralAssets.find((asset) => asset.symbol === "cNGN" && asset.depositsOpen) ?? null
  );
}

/**
 * Deposits perp margin: USDC into the perp's cash (a CashAsset over real USDC), or cNGN into the
 * perp's cNGN escrow when the venue credits it. Since the unified-account cutover (2026-10-04)
 * spot trades on the perp's stack, so this is the wallet's one trading account under the perp SRM:
 * the same account spot settles into, and margin deposited here is also the spot balance. The
 * first deposit opens it; later ones top it up. Runs on the same deposit state machine as spot,
 * with the perp's addresses.
 */
export function PerpMarginDialog({
  onDeposited,
  onOpenChange,
  open,
  stack,
  subaccountId,
  wallet,
}: {
  onDeposited: (subaccountId: string, blockNumber: bigint | null) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  stack: PerpStack;
  /** The wallet's perp account, or null to open one with this deposit. */
  subaccountId: string | null;
  wallet: ConnectedWallet | null;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<DepositCurrency>("USDC");
  const deposit = useSubaccountDeposit({ onDeposited });
  const state = deposit.flowState;
  const cngn = getCngnCollateral(stack);

  function start() {
    if (wallet === null) {
      return;
    }
    if (currency === "cNGN" && cngn !== null) {
      void deposit.startDeposit(wallet, amount, subaccountId, "cNGN", {
        baseAssetContract: cngn.escrow,
        manager: stack.srmAddress,
        subaccountCreator: getSubaccountCreatorAddress(),
        token: getCngnTokenAddress(),
      });
      return;
    }
    void deposit.startDeposit(wallet, amount, subaccountId, "USDC", {
      baseAssetContract: stack.cashAddress,
      manager: stack.srmAddress,
      subaccountCreator: getSubaccountCreatorAddress(),
      token: getUsdcTokenAddress(),
    });
  }

  function close(next: boolean) {
    if (!next) {
      deposit.reset();
      setAmount("");
      setCurrency("USDC");
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
              Deposit perp margin
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close perp margin dialog"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <p className="text-[12px] text-panel-text-muted leading-snug">
            Spot and perp share this account: margin you deposit here is also your spot balance.
            {subaccountId === null ? " Your first deposit opens it." : ` Account #${subaccountId}.`}
          </p>

          {state === null ? (
            <>
              {cngn === null ? null : (
                <fieldset
                  aria-label="Margin asset"
                  className="grid grid-cols-2 gap-1 rounded-sm bg-input-bg p-1 ring-1 ring-panel-border"
                >
                  {(["USDC", "cNGN"] as const).map((option) => (
                    <button
                      aria-pressed={currency === option}
                      className={
                        currency === option
                          ? "cursor-pointer rounded-sm bg-panel-bg py-1.5 font-semibold text-[12px] text-panel-text-active ring-1 ring-panel-border"
                          : "cursor-pointer rounded-sm py-1.5 text-[12px] text-panel-text-muted hover:text-panel-text"
                      }
                      key={option}
                      onClick={() => {
                        deposit.reset();
                        setCurrency(option);
                      }}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </fieldset>
              )}
              {currency === "cNGN" && cngn !== null ? (
                <p className="text-[12px] text-panel-text-muted leading-snug">
                  cNGN is valued at the index and {PERCENT.format(cngn.marginFactor)} of that counts
                  as margin. A short of cNGN loses as cNGN strengthens; the cNGN you post gains
                  then, but only that share of the gain is credited, so the haircut is what gets a
                  leveraged short liquidated: post about as much cNGN as you short.
                </p>
              ) : null}
              <div className="rounded-sm bg-input-bg px-3 py-2 ring-1 ring-panel-border focus-within:ring-panel-text-muted">
                <label
                  className="block text-[11px] text-panel-text-muted"
                  htmlFor="perp-margin-amount"
                >
                  Amount ({currency})
                </label>
                <input
                  className="w-full bg-transparent font-mono text-[16px] text-panel-text-active outline-none placeholder:text-panel-text-muted/60"
                  id="perp-margin-amount"
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="0.0"
                  value={amount}
                />
              </div>
              {deposit.inputError === null ? null : (
                <p className="text-[11px] text-sell">{deposit.inputError}</p>
              )}
              <button
                className={PRIMARY_BUTTON_CLASSES}
                disabled={wallet === null || amount === ""}
                onClick={start}
                type="button"
              >
                Continue
              </button>
            </>
          ) : (
            <DepositProgress currency={currency} deposit={deposit} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const BLOCKED_COPY = {
  "insufficient-balance": "Your wallet does not hold that much of this asset.",
  "not-whitelisted": "Deposits to this account are not open.",
  "zero-amount": "Enter an amount above zero.",
} satisfies Record<DepositBlockedReason, string>;

/** One step at a time: each wallet signature maps to one click, as in the spot deposit dialog. */
function DepositProgress({
  currency,
  deposit,
}: {
  currency: DepositCurrency;
  deposit: ReturnType<typeof useSubaccountDeposit>;
}) {
  const state = deposit.flowState;
  if (state === null) {
    return null;
  }
  switch (state.status) {
    case "preflight":
      return (
        <p className="text-[12px] text-panel-text-muted">Checking your balance and allowance…</p>
      );
    case "blocked":
      return <p className="text-[12px] text-sell">{BLOCKED_COPY[state.reason]}</p>;
    case "awaiting-approval":
      return (
        <button
          className={PRIMARY_BUTTON_CLASSES}
          onClick={() => void deposit.approve()}
          type="button"
        >
          Approve {currency}
        </button>
      );
    case "approving":
      return (
        <p className="text-[12px] text-panel-text-muted">Waiting for the approval to confirm…</p>
      );
    case "awaiting-deposit":
      return (
        <button
          className={PRIMARY_BUTTON_CLASSES}
          onClick={() => void deposit.deposit()}
          type="button"
        >
          Deposit
        </button>
      );
    case "depositing":
      return (
        <p className="text-[12px] text-panel-text-muted">Waiting for the deposit to confirm…</p>
      );
    case "success":
      return (
        <>
          <p className="text-[12px] text-panel-text">Deposited. Your perp margin is updated.</p>
          <Dialog.Close className={PRIMARY_BUTTON_CLASSES}>Done</Dialog.Close>
        </>
      );
    case "failed":
      return (
        <>
          <p className="text-[12px] text-sell">{state.error}</p>
          <button className={PRIMARY_BUTTON_CLASSES} onClick={() => deposit.retry()} type="button">
            Try again
          </button>
        </>
      );
    default:
      return null;
  }
}
