"use client";

import type { useCustodianTrading } from "@/ui/trading-terminal/useCustodianTrading";

const BUTTON_CLASSES =
  "cursor-pointer bg-panel-bg px-2 py-1 text-[12px] text-panel-text-active ring-2 ring-panel-ring transition-colors hover:bg-input-hover disabled:cursor-default disabled:opacity-50";

function custodyStatus(custody: ReturnType<typeof useCustodianTrading>, heldBackBy: string | null) {
  if (heldBackBy !== null) {
    return `Matching account #${heldBackBy} holds a position: it stays in use until that is closed`;
  }
  if (custody.accountId === null) {
    return "Your first deposit opens it";
  }
  return custody.hasKey
    ? `Account #${custody.accountId}: orders sign without a prompt`
    : `Account #${custody.accountId}: enable trading in this browser`;
}

/**
 * Onchain custody under the ticket (NEXT_PUBLIC_CUSTODIAN_ENABLED only). Deposits and withdrawals go through the
 * terminal's own Deposit and Withdraw, which route here; this says which account is in use, sets this browser's
 * trading key, and moves the whole account to the wallet.
 */
export function CustodyPanel({
  custody,
  heldBackBy,
}: {
  custody: ReturnType<typeof useCustodianTrading>;
  /** The Matching account kept in front because it holds a position, or null. */
  heldBackBy: string | null;
}) {
  if (!custody.enabled) {
    return null;
  }
  const busy = custody.busy !== null;
  return (
    <section className="flex shrink-0 flex-col gap-2 bg-panel-bg-muted px-4 py-3 text-[12px] ring-2 ring-panel-ring">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[13px] text-panel-text-active">Onchain account</span>
        <span className="text-right text-panel-text-muted">
          {custodyStatus(custody, heldBackBy)}
        </span>
      </div>
      <p className="text-[11px] text-panel-text-muted/80">
        Only your wallet can withdraw or move the account, and it can always take the account back.
      </p>
      {custody.accountId !== null && !custody.hasKey && heldBackBy === null ? (
        <button
          className={BUTTON_CLASSES}
          disabled={busy}
          onClick={() => void custody.setUp(0n)}
          type="button"
        >
          Enable trading in this browser
        </button>
      ) : null}
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
