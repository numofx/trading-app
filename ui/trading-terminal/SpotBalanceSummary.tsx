"use client";

import { formatBalance } from "@/lib/account-balance-display";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { SmartImage } from "@/ui/SmartImage";

/** The two legs of this market, in the order the ticket spends them. */
const BALANCE_ROWS = [
  { icon: "/tokens/usdc.svg", symbol: "USDC" },
  { icon: "/tokens/cngn.svg", symbol: "cNGN" },
] as const satisfies readonly { icon: string; symbol: DepositCurrency }[];

/**
 * One asset the trading account holds.
 *
 * The plus deposits into the account, which is the action when the figure is short — the same
 * control, in the same place, as the ticket's `Available` row directly above.
 */
function BalanceRow({
  balance,
  icon,
  onDepositRequest,
  symbol,
}: {
  balance: string;
  icon: string;
  onDepositRequest?: (currency: DepositCurrency) => void;
  symbol: DepositCurrency;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 text-[13px]">
      <span className="flex min-w-0 items-center gap-2">
        <SmartImage<string>
          alt={symbol}
          className="size-5 shrink-0 animate-none rounded-full"
          src={icon}
        />
        <span className="text-panel-text-muted">{symbol}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-panel-text">{balance}</span>
        <button
          aria-label={`Deposit ${symbol}`}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-input-bg text-[13px] text-panel-text-muted leading-none ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active"
          onClick={() => onDepositRequest?.(symbol)}
          type="button"
        >
          +
        </button>
      </span>
    </div>
  );
}

/**
 * What the connected wallet's trading subaccount holds, both legs at once.
 *
 * The ticket above only ever reports the leg the selected side spends, so a trader sizing a buy
 * sees cNGN and has to flip to Sell to learn what USDC the account holds. This carries both, under
 * the ticket where the order is being written.
 *
 * Deliberately two lines and nothing else: it sits in the ticket's column, and every row it takes
 * is a row the order fields lose on the 700–900px viewports most of this app's desktop traffic
 * uses. The balances are the account's whole holding — what a resting order has claimed out of
 * them is the ticket's `Available` figure one row up, and the header's breakdown beside it.
 *
 * `—` rather than `0` until a balance is known: a subaccount still resolving and one that genuinely
 * holds nothing are different answers, and a zero for the first invites a deposit it may not need.
 */
export function SpotBalanceSummary({
  accountCngn,
  accountUsdc,
  onDepositRequest,
}: {
  /** Subaccount balances, as ledger amounts; null until the ledger read lands. */
  accountCngn: number | null;
  accountUsdc: number | null;
  /** Opens the deposit dialog on the row's own currency. */
  onDepositRequest?: (currency: DepositCurrency) => void;
}) {
  const balances = { cNGN: accountCngn, USDC: accountUsdc };

  return (
    // Shares the ticket's panel chrome so the two read as one column, and `shrink-0` so a short
    // viewport takes its height out of the ticket's scroll area rather than squeezing these rows.
    <section className="flex shrink-0 flex-col overflow-clip bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300">
      {/* Dropped in the stacked layout for the reason the ticket drops its own: below `md` this
          column is the whole screen, and the label is only telling panels apart from siblings. */}
      <div className="hidden shrink-0 items-center border-panel-border border-b px-3 py-2 font-medium text-[11px] md:flex">
        <span className="rounded-sm bg-input-bg px-2 py-1 text-panel-text-active">
          Balance summary
        </span>
      </div>

      {/* Rows are given a real line height rather than being packed: this is a readout a trader
          checks at a glance, and at the ticket's field density it read as a footnote to the panel
          above it. The column scrolls, so the height it takes is not height the ticket loses.
          No rule between the rows — two holdings of one account are a list, and a divider made
          them read as separate sections. */}
      <div className="space-y-1 px-3 py-2">
        {BALANCE_ROWS.map((row) => (
          <BalanceRow
            balance={formatBalance(balances[row.symbol], row.symbol)}
            icon={row.icon}
            key={row.symbol}
            onDepositRequest={onDepositRequest}
            symbol={row.symbol}
          />
        ))}
      </div>
    </section>
  );
}
