"use client";

import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Lock, Moon, Sun } from "lucide-react";
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

/** One `label — value` line in the claim breakdown. */
function ClaimRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-panel-text-muted">{label}</span>
      <span className="font-medium text-panel-text-active">{value}</span>
    </div>
  );
}

/**
 * One holding, in ticker form — "1,300 cNGN", the figure carrying its own symbol. Inline rather
 * than the stacked {@link HeaderMetric} so the pair reads as a single group with the deposit button
 * next to it.
 *
 * The header reports what the account holds while the ticket reports what a new order can spend.
 * When resting orders have opened a gap between the two, the balance becomes a disclosure that
 * breaks the difference down, so the smaller number in the ticket is accounted for rather than
 * looking like a disagreement between two panels.
 *
 * A popover rather than a `title` tooltip: the inline note only fits from `xl`, and a `title` is
 * unreachable on the touch devices that make up the widths below it — which is where the note is
 * hidden and the explanation is needed most. Plain text when there is nothing to explain, so the
 * trader is not offered a control that opens an empty box.
 */
function AccountBalance({
  claimedLabel,
  spendableLabel,
  symbol,
  value,
}: {
  /** Non-null only when this trader's resting orders claim a printable part of the balance. */
  claimedLabel: string | null;
  spendableLabel: string;
  symbol: string;
  value: string;
}) {
  if (claimedLabel === null) {
    return (
      <span className="whitespace-nowrap font-medium text-[13px] text-panel-text-active">
        {value}
      </span>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${symbol} balance breakdown`}
        // The padding is bled back out with matching negative margins: it buys the tap target
        // ~12px of height and a little grab room either side without spending a pixel of the
        // header's own row, which is measured to the edge at these widths.
        className="-mx-1 -my-1.5 flex cursor-pointer items-baseline gap-1.5 whitespace-nowrap rounded-md px-1 py-1.5 outline-none transition-colors hover:bg-input-bg focus-visible:ring-2 focus-visible:ring-panel-text-muted"
      >
        <span className="font-medium text-[13px] text-panel-text-active">{value}</span>
        {/*
         * A bare minus would read as a price move on a row of market figures. The lock says what
         * the number is — spoken for, not lost — and holds that meaning at the width where the
         * figure beside it does not fit.
         *
         * Below `xl` the lock travels alone: a noted pair measures ~335px there and pushes the row
         * onto a second line. It is still a ~12px tap target inside a taller trigger, and it is
         * what tells the trader there is something to open.
         */}
        <span className="flex items-center gap-1 text-[10px] text-panel-text-muted">
          <Lock aria-hidden className="size-2.5" />
          {/*
           * Two spans for one figure, so exactly one of them is ever rendered and exactly one is
           * ever announced. The visible one is `aria-hidden`; the phrased one is always in the
           * accessibility tree — `sr-only` is out of flow, so below `2xl` it costs no width, and
           * the lock is never left carrying the meaning alone for a screen reader.
           */}
          <span aria-hidden className="hidden xl:inline 2xl:hidden">
            {claimedLabel}
          </span>
          <span className="sr-only 2xl:not-sr-only">{claimedLabel} in orders</span>
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={8}>
          <Popover.Popup className="z-50 w-[260px] rounded-2xl border border-panel-border bg-panel-bg-darker p-3 text-[11px] shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <div className="space-y-1.5">
              <ClaimRow label="In account" value={value} />
              <ClaimRow label="Claimed by resting orders" value={claimedLabel} />
              <ClaimRow label="Available to trade" value={spendableLabel} />
            </div>
            <p className="mt-2.5 border-panel-border border-t pt-2 text-[10px] text-panel-text-muted leading-snug">
              Your working orders hold this much until they fill or expire. The order ticket can
              spend the rest.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
    // 64px when everything fits on one line (40px of controls inside 24px of padding), growing
    // rather than overflowing when it does not: the account balances now render at every width, so
    // the row can no longer be sized as if the right-hand cluster had a fixed extent.
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-panel-border border-b px-4 py-3 transition-colors duration-300 md:flex-nowrap">
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
          <Popover.Positioner align="start" sideOffset={6}>
            <Popover.Popup className="z-50 min-w-(--anchor-width) overflow-hidden rounded-sm border border-panel-border bg-menu-surface p-1 shadow-[0_10px_28px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
              {/*
               * The venue serves one spot market, so this row is always the selected one and the
               * check is unconditional. A second market would make it conditional, not decorative.
               */}
              <button
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm p-2 text-left text-panel-text-active transition-colors hover:bg-input-hover"
                onClick={() => setDropdownOpen(false)}
                type="button"
              >
                <MarketIdentity compact />
                <Check
                  aria-label="Selected market"
                  className="ml-auto size-4 shrink-0 text-panel-text-muted"
                />
              </button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {/*
       * Spacing separates the metrics, not rules — the one divider above marks the app/market
       * split, and repeating it between every figure would turn the bar into a table. Hidden
       * rather than wrapped below `lg`: the balances hold the right of the row at every width now,
       * and between `md` and `lg` the actions need what is left more than the figures do.
       */}
      {/*
       * `overflow-hidden` because every figure in here is `whitespace-nowrap`: squeezed by a wide
       * balance cluster to its right, the values would otherwise paint straight over it rather
       * than clip.
       */}
      <div className="hidden min-w-0 items-center gap-6 overflow-hidden lg:flex">
        <HeaderMetric label="Price">
          {formatNaira(lastPrice)}
          <span className={cn("text-[11px]", getChangeClassName(changePercent24h))}>
            {formatChangePercent(changePercent24h)}
          </span>
        </HeaderMetric>
        {/*
         * Volume stands down below `xl` for the same reason the extremes stand down below `2xl`:
         * measured at 1024px, Price, volume and a claim-noted balance pair overrun the row by
         * ~40px, and the metrics box is the one that gives — clipping "24H volume ₦1" mid-figure.
         * Price is the figure worth keeping at every width the metrics show at all.
         */}
        <HeaderMetric className="hidden xl:flex" label="24H volume">
          {volume24hLabel}
        </HeaderMetric>
        {/*
         * The extremes stand down below `2xl`, where the row cannot hold both them and the account
         * balances — measured, the balances need ~150px these were occupying, more once a claim
         * note is on them. They are the two figures a trader can read straight off the chart, so
         * they are the ones to give up. Unconditional rather than gated on the wallet: tying it to
         * `hasWallet` rearranged the header at the moment of connecting, which reads as a glitch,
         * and this way the row's shape depends only on its width.
         */}
        <HeaderMetric className="hidden 2xl:flex" label="24H high">
          {formatNaira(high24h)}
        </HeaderMetric>
        <HeaderMetric className="hidden 2xl:flex" label="24H low">
          {formatNaira(low24h)}
        </HeaderMetric>
      </div>

      {/*
       * Wraps inside itself rather than overflowing. This is the only cluster whose width is not
       * knowable in advance — a claim note can add ~60px to either balance — and it is the one the
       * header can least afford to have paint over its neighbours, so it is allowed a second line
       * at the narrow widths where the balances plus the three controls do not fit on one.
       */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {/*
         * Shown at every width, and the only place either balance is now reported: the strip that
         * used to carry them under the order ticket is gone, so hiding them here would leave a
         * phone with no account balance on screen at all. 24H high and low stand down below `2xl`
         * to pay for the space.
         */}
        {hasWallet ? (
          <div className="mr-1 flex shrink-0 items-center gap-4">
            <AccountBalance
              claimedLabel={getClaimedNote(accountUsdc, spendableUsdc, formatAccountUsdc)}
              spendableLabel={formatAccountUsdc(spendableUsdc)}
              symbol="USDC"
              value={usdcLabel}
            />
            <AccountBalance
              claimedLabel={getClaimedNote(accountCngn, spendableCngn, formatAccountCngn)}
              spendableLabel={formatAccountCngn(spendableCngn)}
              symbol="cNGN"
              value={cngnLabel}
            />
          </div>
        ) : null}
        {depositControl}
        <button
          aria-label="Toggle theme"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-panel-border bg-input-bg text-panel-text-active transition-all duration-300 hover:bg-input-hover"
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
