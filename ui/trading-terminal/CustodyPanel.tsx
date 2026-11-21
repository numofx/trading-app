"use client";

import { useEffect, useState } from "react";
import type { useCustodianTrading } from "@/ui/trading-terminal/useCustodianTrading";

const BUTTON_CLASSES =
  "cursor-pointer bg-panel-bg px-2 py-1 text-[12px] text-panel-text-active ring-2 ring-panel-ring transition-colors hover:bg-input-hover disabled:cursor-default disabled:opacity-50";

/**
 * Onchain custody under the ticket (NEXT_PUBLIC_CUSTODIAN_ENABLED only), as one line: which account is in use, and
 * its two actions. Deposits and withdrawals go through the terminal's own Deposit and Withdraw, which route here.
 * Exit (the whole account to the wallet) asks once more before it runs: it ends custody trading for the account.
 */
export function CustodyPanel({
  custody,
  heldBackBy,
}: {
  custody: ReturnType<typeof useCustodianTrading>;
  /** The Matching account kept in front because it holds a position, or null. */
  heldBackBy: string | null;
}) {
  const [confirmExit, setConfirmExit] = useState(false);
  useEffect(() => {
    if (!confirmExit) {
      return;
    }
    const timer = setTimeout(() => setConfirmExit(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmExit]);
  if (!custody.enabled) {
    return null;
  }
  const busy = custody.busy !== null;
  const hasAccount = custody.accountId !== null;
  let label = "Account";
  let status: string | null = null;
  if (heldBackBy !== null) {
    status = `Matching #${heldBackBy} in use`;
  } else if (hasAccount) {
    label = `Account #${custody.accountId}`;
  } else {
    status = "Opens on deposit";
  }
  return (
    <section className="flex shrink-0 flex-col gap-1 bg-panel-bg-muted px-4 py-2 text-[12px] ring-2 ring-panel-ring">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="font-semibold text-[13px] text-panel-text-active">{label}</span>
        <span className="flex items-center gap-2">
          {status === null ? null : <span className="text-panel-text-muted">{status}</span>}
          {hasAccount && !custody.hasKey && heldBackBy === null ? (
            <button
              className={BUTTON_CLASSES}
              disabled={busy}
              onClick={() => void custody.setUp(0n)}
              title="Let this browser sign orders for the account"
              type="button"
            >
              Enable
            </button>
          ) : null}
          {hasAccount ? (
            <button
              className={BUTTON_CLASSES}
              disabled={busy}
              onClick={() => {
                if (confirmExit) {
                  setConfirmExit(false);
                  void custody.exit();
                } else {
                  setConfirmExit(true);
                }
              }}
              title="Move the account to your wallet"
              type="button"
            >
              {confirmExit ? "Confirm" : "Exit"}
            </button>
          ) : null}
        </span>
      </div>
      {custody.busy ? (
        <span className="text-[11px] text-panel-text-muted">Sign in wallet…</span>
      ) : null}
      {custody.lastError ? (
        <span className="truncate text-[11px] text-red-400" title={custody.lastError}>
          {custody.lastError}
        </span>
      ) : null}
    </section>
  );
}
