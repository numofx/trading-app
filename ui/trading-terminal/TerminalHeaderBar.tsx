"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Lock, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  formatAccountCngn,
  formatAccountUsdc,
  getClaimedNote,
} from "@/lib/account-balance-display";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import { PrivyWalletButton } from "@/ui/PrivyWalletButton";
import { SmartImage } from "@/ui/SmartImage";

/** Change is only coloured when there is one — an empty window shows a neutral dash. */
function getChangeClassName(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return value < 0 ? "text-ask-text" : "text-bid-text";
}

function formatChangePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/**
 * One metric: a muted label over its value. Every label shares a type size and every value shares
 * another, so the two rows keep a common baseline across the group without explicit alignment.
 */
function HeaderMetric({
  children,
  className,
  label,
}: {
  children: ReactNode;
  /** Lets a metric yield its place at narrower widths; merged over the display class. */
  className?: string;
  label: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="whitespace-nowrap text-[10px] text-panel-text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap font-medium text-[13px] text-panel-text-active">
        {children}
      </span>
    </div>
  );
}

/**
 * One holding, as a muted symbol beside its figure. Inline rather than the stacked
 * {@link HeaderMetric} so the pair reads as a single group with the deposit button next to it.
 *
 * The header reports what the account holds while the ticket reports what a new order can spend.
 * When resting orders have opened a gap between the two, the balance carries the claimed figure
 * after it, so the smaller number in the ticket is accounted for rather than looking like a
 * disagreement between two panels.
 */
function AccountBalance({
  claimedLabel,
  label,
  value,
}: {
  /** Non-null only when this trader's resting orders claim a printable part of the balance. */
  claimedLabel: string | null;
  label: string;
  value: string;
}) {
  return (
    <span
      className="flex items-baseline gap-1.5 whitespace-nowrap"
      title={
        claimedLabel === null
          ? undefined
          : `${value} ${label} in the account. ${claimedLabel} is claimed by your resting orders, so the order ticket can spend the rest.`
      }
    >
      <span className="text-[10px] text-panel-text-muted">{label}</span>
      <span className="font-medium text-[13px] text-panel-text-active">{value}</span>
      {claimedLabel === null ? null : (
        <span className="flex items-center gap-1 text-[10px] text-panel-text-muted">
          {/*
           * A bare minus would read as a price move on a row of market figures. The lock says what
           * the number is — spoken for, not lost — and holds that meaning at the width where the
           * word itself does not fit.
           */}
          <Lock aria-hidden className="size-2.5" />
          {claimedLabel}
          {/*
           * Always announced, shown from `2xl` where the row has room for it: `sr-only` is out of
           * flow, so below that the words cost nothing and the lock is not left carrying the
           * meaning alone for a screen reader.
           */}
          <span className="sr-only 2xl:not-sr-only">in orders</span>
        </span>
      )}
    </span>
  );
}

/** The paired token marks and symbol, shared by the pill and its dropdown row. */
function MarketIdentity({ compact }: { compact?: boolean }) {
  return (
    <>
      <span className="flex shrink-0 items-center -space-x-1.5">
        <SmartImage<string>
          alt="USDC"
          className={cn(
            "animate-none rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border",
            compact ? "size-5" : "size-6"
          )}
          src="/tokens/usdc.svg"
        />
        <SmartImage<string>
          alt="cNGN"
          className={cn(
            "animate-none rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border",
            compact ? "size-5" : "size-6"
          )}
          src="/tokens/cngn.svg"
        />
      </span>
      <span className="font-semibold text-[13px] text-panel-text-active leading-none">
        USDC-cNGN
      </span>
    </>
  );
}

/**
 * The terminal's single header bar: branding, the market selector, its live metrics and the
 * account actions, on one full-bleed row.
 *
 * This replaced two stacked rounded cards — a logo/actions panel above a ticker panel — which cost
 * roughly 130px of vertical space and two card borders to say what one row says. Being full-bleed,
 * it is rendered outside the padded panel column rather than as its first child.
 */
export function TerminalHeaderBar({
  accountCngn = null,
  accountUsdc = null,
  changePercent24h,
  depositControl,
  hasWallet = false,
  high24h,
  lastPrice,
  low24h,
  onPortfolioSelect,
  spendableCngn = null,
  spendableUsdc = null,
  volume24hLabel,
}: {
  /**
   * The trading account's holdings, shown beside the deposit control because that button is the
   * remedy when a figure reads lower than the trader expected. Null while unknown — no wallet, or
   * the balance still loading — which renders as a dash rather than a zero the account may not hold.
   */
  accountCngn?: number | null;
  accountUsdc?: number | null;
  changePercent24h: number | null;
  depositControl?: ReactNode;
  /** Gates the balances: a visitor with no account has no holdings to report. */
  hasWallet?: boolean;
  /** Extremes over the same window as the volume; null when nothing traded in it. */
  high24h: number | null;
  lastPrice: number | null;
  low24h: number | null;
  /** Fired by the connected wallet menu's Portfolio item. */
  onPortfolioSelect?: () => void;
  /**
   * What a new order can actually draw on — the balance less what this trader's own resting orders
   * already claim. This is the ticket's `Available`, passed in so the header can show where the
   * difference went instead of leaving the two panels quoting unexplained different numbers.
   */
  spendableCngn?: number | null;
  spendableUsdc?: number | null;
  volume24hLabel: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const usdcLabel = formatAccountUsdc(accountUsdc);
  const cngnLabel = formatAccountCngn(accountCngn);

  useEffect(() => {
    const isLight = document.documentElement.classList.contains("light");
    setTheme(isLight ? "light" : "dark");
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    if (nextTheme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    }
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  };

  return (
    // Exactly 64px from `md` up. Below that the actions alone need ~320px, so the row wraps to a
    // second line rather than overflowing — the same two-row treatment the previous header used on
    // phones, and what keeps the page free of horizontal scroll at 375px.
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-panel-border border-b px-4 py-3 transition-colors duration-300 md:h-16 md:flex-nowrap md:py-0">
      <SmartImage<string>
        alt="Numo"
        className="h-7 w-24 shrink-0"
        imgClassName="object-left"
        priority
        src={theme === "light" ? "/numo_logo_black.png" : "/numo_logo_white.png"}
      />

      {/* The only rule in the bar: everything right of it belongs to the market, not the app. */}
      <div className="w-px shrink-0 self-stretch bg-panel-border" />

      <Popover.Root onOpenChange={setDropdownOpen} open={dropdownOpen}>
        {/* Stable id: auto-generated useId values can shift when async state (e.g. Privy init) races hydration. */}
        <Popover.Trigger
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-input-bg px-2.5 outline-none ring-1 ring-panel-border transition-colors hover:bg-input-hover focus-visible:ring-2 focus-visible:ring-panel-text-muted"
          id="spot-ticker-market-trigger"
        >
          <MarketIdentity />
          <ChevronDown
            className={cn(
              "size-4 text-panel-text-muted transition-transform duration-200",
              dropdownOpen && "rotate-180"
            )}
          />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Positioner align="start" sideOffset={8}>
            <Popover.Popup className="z-50 min-w-[280px] overflow-hidden rounded-2xl border border-panel-border bg-panel-bg-darker p-1.5 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
              <button
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-input-bg p-2.5 text-left text-panel-text-active transition-colors"
                onClick={() => setDropdownOpen(false)}
                type="button"
              >
                <MarketIdentity compact />
              </button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {/*
       * Spacing separates the metrics, not rules — the one divider above marks the app/market
       * split, and repeating it between every figure would turn the bar into a table. Hidden
       * rather than wrapped below `md`, where the actions need the width more than the figures do.
       */}
      <div className="hidden min-w-0 items-center gap-6 md:flex">
        <HeaderMetric label="Price">
          {formatNaira(lastPrice)}
          <span className={cn("text-[11px]", getChangeClassName(changePercent24h))}>
            {formatChangePercent(changePercent24h)}
          </span>
        </HeaderMetric>
        <HeaderMetric label="24H volume">{volume24hLabel}</HeaderMetric>
        {/*
         * The extremes step aside between `xl` and `2xl`, where the row cannot hold both them and
         * the account balances — measured, the balances need ~150px these were occupying. They are
         * the two figures a trader can read straight off the chart, so they are the ones to give
         * up. Unconditional rather than gated on the wallet: tying it to `hasWallet` rearranged the
         * header at the moment of connecting, which reads as a glitch, and this way the row's shape
         * depends only on its width. Below `xl` they stay — the balances do not appear there, so
         * hiding them would cost the trader two figures and return nothing.
         */}
        <HeaderMetric className="xl:hidden 2xl:flex" label="24H high">
          {formatNaira(high24h)}
        </HeaderMetric>
        <HeaderMetric className="xl:hidden 2xl:flex" label="24H low">
          {formatNaira(low24h)}
        </HeaderMetric>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/*
         * `xl` is affordable only because 24H high and low stand down above — the 24H metrics sit
         * in a `min-w-0` box, so a group added without freeing that space does not widen the
         * header, it silently squeezes those figures until their nowrap values paint over these
         * balances. Below `xl` the ticket column's balance summary carries the same numbers.
         */}
        {hasWallet ? (
          <div className="mr-1 hidden items-center gap-4 xl:flex">
            <AccountBalance
              claimedLabel={getClaimedNote(accountUsdc, spendableUsdc, formatAccountUsdc)}
              label="USDC"
              value={usdcLabel}
            />
            <AccountBalance
              claimedLabel={getClaimedNote(accountCngn, spendableCngn, formatAccountCngn)}
              label="cNGN"
              value={cngnLabel}
            />
          </div>
        ) : null}
        {depositControl}
        <button
          aria-label="Toggle theme"
          className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-panel-border bg-input-bg text-panel-text-active transition-all duration-300 hover:bg-input-hover"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "light" ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </button>
        <PrivyWalletButton onPortfolioSelect={onPortfolioSelect} />
      </div>
    </header>
  );
}
