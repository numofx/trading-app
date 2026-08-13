"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Moon, Sun } from "lucide-react";
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
function HeaderMetric({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1">
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
  lastPrice,
  volume24hLabel,
}: {
  changePercent24h: number | null;
  depositControl?: ReactNode;
  lastPrice: number | null;
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
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {depositControl}
        <button
          aria-label="Toggle theme"
          className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-panel-border bg-input-bg text-panel-text-active transition-all duration-300 hover:bg-input-hover"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "light" ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </button>
        <PrivyWalletButton />
      </div>
    </header>
  );
}
