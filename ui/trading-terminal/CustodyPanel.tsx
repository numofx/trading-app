"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import type { useCustodianTrading } from "@/ui/trading-terminal/useCustodianTrading";

const BUTTON_CLASSES =
  "cursor-pointer bg-panel-bg px-2 py-1 text-[12px] text-panel-text-active ring-2 ring-panel-ring transition-colors hover:bg-input-hover disabled:cursor-default disabled:opacity-50";

function custodyStatus(custody: ReturnType<typeof useCustodianTrading>) {
  if (custody.accountId === null) {
    return "Not set up";
  }
  return custody.ready
    ? `Account #${custody.accountId}: orders sign without a prompt`
    : `Account #${custody.accountId}: set a trading key to trade`;
}

/**
 * Onchain custody under the ticket (NEXT_PUBLIC_CUSTODIAN_ENABLED only): set it up (an account, a gasless USDC
 * deposit, a trading key), withdraw USDC, or move the whole account to the wallet. The wallet signs each of
 * those; orders are then signed by the trading key, with no prompt.
 */
export function CustodyPanel({ custody }: { custody: ReturnType<typeof useCustodianTrading> }) {
  const [amount, setAmount] = useState("");
  if (!custody.enabled) {
    return null;
  }
  const usdc = () => {
    try {
      return parseUnits(amount.trim() || "0", 6);
    } catch {
      return -1n;
    }
  };
  const busy = custody.busy !== null;
  return (
    <section className="flex shrink-0 flex-col gap-2 bg-panel-bg-muted px-4 py-3 text-[12px] ring-2 ring-panel-ring">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[13px] text-panel-text-active">Onchain custody</span>
        <span className="text-panel-text-muted">{custodyStatus(custody)}</span>
      </div>
      <p className="text-[11px] text-panel-text-muted/80">
        Only your wallet can withdraw or move the account, and it can always take the account back.
      </p>
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 bg-panel-bg px-2 py-1 font-mono text-panel-text ring-2 ring-panel-ring"
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="USDC"
          value={amount}
        />
        <button
          className={BUTTON_CLASSES}
          disabled={busy || usdc() < 0n}
          onClick={() => void custody.setUp(usdc())}
          type="button"
        >
          {custody.ready ? "Deposit" : "Set up"}
        </button>
        <button
          className={BUTTON_CLASSES}
          disabled={busy || custody.accountId === null || usdc() <= 0n}
          onClick={() => void custody.withdraw(usdc())}
          type="button"
        >
          Withdraw
        </button>
      </div>
      {custody.accountId === null ? null : (
        <button
          className={BUTTON_CLASSES}
          disabled={busy}
          onClick={() => void custody.exit()}
          type="button"
        >
          Move the account to my wallet
        </button>
      )}
      {custody.busy ? <span className="text-panel-text-muted">{custody.busy}…</span> : null}
      {custody.lastError ? <span className="text-red-400">{custody.lastError}</span> : null}
    </section>
  );
}
