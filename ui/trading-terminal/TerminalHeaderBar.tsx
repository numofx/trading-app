"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import type { TerminalMarketId } from "@/lib/market-overview.types";
import { PrivyWalletButton } from "@/ui/PrivyWalletButton";
import { SmartImage } from "@/ui/SmartImage";
import { MarketSelectDialog } from "@/ui/trading-terminal/MarketSelectDialog";

export type TerminalMarket = TerminalMarketId;

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
  tooltip,
}: {
  children: ReactNode;
  /** Lets a metric yield its place at narrower widths; merged over the display class. */
  className?: string;
  label: string;
  /** A hint on the label, dotted-underlined like the ticket's. */
  tooltip?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span
        className={cn(
          "whitespace-nowrap text-[10px] text-panel-text-muted",
          tooltip && "cursor-help underline decoration-dotted underline-offset-4"
        )}
        title={tooltip}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap font-medium text-[13px] text-panel-text-active">
        {children}
      </span>
    </div>
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
export type HeaderMetricItem = {
  label: string;
  tooltip?: string;
  value: string;
  tone: "up" | "down" | null;
};

export function TerminalHeaderBar({
  changePercent24h,
  depositControl,
  high24h,
  low24h,
  market = "spot",
  metrics,
  onPortfolioSelect,
  price,
  volume24hLabel,
}: {
  changePercent24h: number | null;
  depositControl?: ReactNode;
  /** Extremes over the same window as the volume; null when nothing traded in it. */
  high24h: number | null;
  low24h: number | null;
  /** Which terminal is showing; the selector's pill and check follow it. */
  market?: TerminalMarket;
  /**
   * Figures to show instead of the spot set (price, volume, high, low): the perp's mark, index,
   * change, volume, open interest and funding. From `lg` as many show as the width holds, in
   * order, whole; the actions keep the row and the figures stand down, rather than the wallet
   * button wrapping under the rest.
   */
  metrics?: HeaderMetricItem[];
  /** Fired by the connected wallet menu's Portfolio item. */
  onPortfolioSelect?: () => void;
  /**
   * What the market is worth here now: the book's mid, else its one resting side, else the last
   * trade. NOT the last trade alone — on a quiet venue that print can be days old and sit outside
   * the current spread. On 2026-09-16 the header read 1,327.34 from a trade two days earlier while
   * every resting order stood between 1,361 and 1,383, and the order ticket, which prices off the
   * same anchor the order book centres on, was seeded at 1,372.15.
   */
  price: number | null;
  volume24hLabel: string;
}) {
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

      <MarketSelectDialog changePercent24h={changePercent24h} market={market} price={price} />

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
      {metrics === undefined ? (
        <div className="hidden min-w-0 items-center gap-6 overflow-hidden lg:flex">
          <HeaderMetric label="Price">
            {formatNaira(price)}
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
      ) : (
        /*
         * As many figures as the width holds, whole: the row wraps, and the wrap is clipped to one
         * row's height with a gap tall enough that nothing of a second row shows. Breakpoints
         * could not say how many fit, since the wallet button's width is not knowable in advance.
         */
        <div className="hidden max-h-10 min-w-0 flex-wrap content-start gap-x-6 gap-y-10 overflow-hidden lg:flex">
          {metrics.map((metric) => (
            <HeaderMetric
              className="shrink-0"
              key={metric.label}
              label={metric.label}
              tooltip={metric.tooltip}
            >
              <span
                className={cn(
                  metric.tone === "up" && "text-bid-text",
                  metric.tone === "down" && "text-ask-text"
                )}
              >
                {metric.value}
              </span>
            </HeaderMetric>
          ))}
        </div>
      )}

      {/*
       * Below `lg` the cluster may wrap inside itself, as the header around it does on a phone.
       * From `lg` it stays on one line and never shrinks: the wallet button carries an address whose width is
       * not knowable in advance, and a cluster that wrapped inside itself dropped that button under
       * the others. The metrics beside it are what give way, since they clip rather than paint over.
       */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 lg:shrink-0 lg:flex-nowrap">
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
