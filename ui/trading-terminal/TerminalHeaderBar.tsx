"use client";

import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
  changePercent24h,
  depositControl,
  high24h,
  lastPrice,
  low24h,
  onPortfolioSelect,
  volume24hLabel,
}: {
  changePercent24h: number | null;
  depositControl?: ReactNode;
  /** Extremes over the same window as the volume; null when nothing traded in it. */
  high24h: number | null;
  lastPrice: number | null;
  low24h: number | null;
  /** Fired by the connected wallet menu's Portfolio item. */
  onPortfolioSelect?: () => void;
  volume24hLabel: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

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
    // rather than overflowing when it does not — the wallet button's address makes the right-hand
    // cluster's extent unknowable, so the row cannot be sized as if it were fixed.
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
         * The extremes stood down below `2xl` to pay for the account balance pair that used to sit
         * beside the deposit control — roughly 150px, more once a claim note was on it. That pair
         * now lives in the balance summary under the order ticket, so they come back up alongside
         * the volume metric. Gated on width alone, never on the wallet: tying header structure to
         * `hasWallet` rearranged the row at the moment of connecting, which reads as a glitch.
         */}
        <HeaderMetric className="hidden xl:flex" label="24H high">
          {formatNaira(high24h)}
        </HeaderMetric>
        <HeaderMetric className="hidden xl:flex" label="24H low">
          {formatNaira(low24h)}
        </HeaderMetric>
      </div>

      {/*
       * Wraps inside itself rather than overflowing: the wallet button carries an address whose
       * width is not knowable in advance, and this is the cluster the header can least afford to
       * have paint over its neighbours.
       */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
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
