"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNairaPerUsdc, formatPrice } from "@/lib/market-formatting";
import type { TerminalMarketId } from "@/lib/market-overview.types";
import { PrivyWalletButton } from "@/ui/PrivyWalletButton";
import { SmartImage } from "@/ui/SmartImage";
import { MarketSelectDialog } from "@/ui/trading-terminal/MarketSelectDialog";
import type { TerminalHeaderPublication } from "@/ui/trading-terminal/TerminalHeaderSlot";

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
 * One metric: a muted label over its value. Every metric is exactly these two lines tall, on both
 * markets, so every label shares one baseline and every value another across the header. A
 * `secondary` line (spot's ₦ per USDC) hangs under the value out of the flow: in the flow it
 * made spot's Price a line taller than its neighbours, and the header's centring then lifted
 * Price's label above the 24h labels beside it.
 */
function HeaderMetric({
  children,
  className,
  label,
  secondary,
  tooltip,
}: {
  children: ReactNode;
  /** Lets a metric yield its place at narrower widths; merged over the display class. */
  className?: string;
  label: string;
  /** A muted line under the value: the same figure read another way. */
  secondary?: string;
  /** A hint on the label, shown on hover like the ticket's. */
  tooltip?: string;
}) {
  return (
    <div className={cn("relative flex flex-col gap-1", className)}>
      <span
        className={cn(
          "whitespace-nowrap text-[9px] text-panel-text-muted",
          tooltip && "cursor-help"
        )}
        data-metric-label
        title={tooltip}
      >
        {label}
      </span>
      <span
        className="flex items-baseline gap-1.5 whitespace-nowrap font-medium text-[11px] text-panel-text-active"
        data-metric-value
      >
        {children}
      </span>
      {secondary === undefined ? null : (
        <span className="absolute top-full left-0 mt-0.5 whitespace-nowrap text-[10px] text-panel-text-muted">
          {secondary}
        </span>
      )}
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
 *
 * Rendered by the shell, above the market's panels, and never remounted by a market switch. The
 * figures and the Deposit and Withdraw controls are the market's own, published by its panels
 * (`usePublishTerminalHeader`); until the selected market's panels have published, the metrics
 * show a skeleton and the action cluster holds the wallet alone.
 */
export type HeaderMetricItem = {
  label: string;
  tooltip?: string;
  value: string;
  tone: "up" | "down" | null;
};

/** The header's Deposit and Withdraw buttons, and their placeholders, share one look. */
export const HEADER_ACTION_CLASSES =
  "flex h-10 cursor-pointer items-center whitespace-nowrap rounded-sm bg-input-bg px-4 font-semibold text-[14px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Stand-ins for the market's Deposit and Withdraw until its panels publish them, so the action
 * cluster keeps its width and nothing in the header shifts on a switch. Disabled: they open
 * nothing. A market whose panels publish no controls (the perp before it is live) keeps them.
 */
function HeaderActionPlaceholders() {
  return (
    <div aria-hidden className="flex items-center gap-2" data-placeholder="deposit-withdraw">
      <button className={HEADER_ACTION_CLASSES} disabled tabIndex={-1} type="button">
        Deposit
      </button>
      <button className={HEADER_ACTION_CLASSES} disabled tabIndex={-1} type="button">
        Withdraw
      </button>
    </div>
  );
}

/** One metric's frame while the market's panels have not published: label and value placeholders. */
function HeaderMetricSkeleton({ className }: { className?: string }) {
  return (
    // The real metric's type sizes on a blank line each, so the bars sit exactly where the label
    // and value will: no header row moves when the figures arrive.
    <div aria-hidden className={cn("flex flex-col gap-1", className)}>
      <span className="w-10 animate-pulse rounded-sm bg-input-bg text-[9px]">{"\u00a0"}</span>
      <span className="w-16 animate-pulse rounded-sm bg-input-bg font-medium text-[11px]">
        {"\u00a0"}
      </span>
    </div>
  );
}

/**
 * The figures beside the selector: the spot set (price, volume, high, low), or the perp's own
 * list, or placeholders until the selected market's panels publish. Hidden rather than wrapped
 * below `lg`: the balances hold the right of the row at every width now, and between `md` and
 * `lg` the actions need what is left more than the figures do.
 */
function HeaderMetrics({ publication }: { publication: TerminalHeaderPublication | null }) {
  if (publication === null) {
    return (
      <div
        aria-busy="true"
        className="hidden h-9 min-w-0 items-start gap-6 overflow-hidden lg:flex"
      >
        <HeaderMetricSkeleton />
        <HeaderMetricSkeleton className="hidden xl:flex" />
        <HeaderMetricSkeleton className="hidden xl:flex" />
        <HeaderMetricSkeleton className="hidden xl:flex" />
      </div>
    );
  }
  const { changePercent24h, metrics, price, seeded = false } = publication;
  // Seeded figures are the selector's last read, not the market's own: shown dimmed, and busy,
  // until the panels publish the live set.
  const provisional = seeded ? { "aria-busy": true, "data-seeded": true } : {};
  if (metrics === undefined) {
    return (
      <div
        className={cn(
          // One height for both markets' rows, metrics aligned at the top, so labels and values sit
          // at the same heights whichever market is on screen. Clipped sideways only: the ₦ line
          // hangs below the row.
          "hidden h-9 min-w-0 items-start gap-6 overflow-x-clip lg:flex",
          seeded && "opacity-50"
        )}
        {...provisional}
      >
        <HeaderMetric label="Price" secondary={formatNairaPerUsdc(price)}>
          {formatPrice(price)}
          <span className={cn("text-[10px]", getChangeClassName(changePercent24h))}>
            {formatChangePercent(changePercent24h)}
          </span>
        </HeaderMetric>
        {/*
         * Volume stands down below `xl` for the same reason the extremes stand down below `2xl`:
         * measured at 1024px, Price, volume and a claim-noted balance pair overrun the row by
         * ~40px, and the metrics box is the one that gives — clipping "24h Volume 1" mid-figure.
         * Price is the figure worth keeping at every width the metrics show at all.
         */}
        <HeaderMetric className="hidden xl:flex" label="24h Volume">
          {publication.volume24hLabel}
        </HeaderMetric>
        {/*
         * The extremes stood down below `2xl` to pay for the account balance pair that used to sit
         * beside the deposit control — roughly 150px, more once a claim note was on it. That pair
         * now lives in the balance summary under the order ticket, so they come back up alongside
         * the volume metric. Gated on width alone, never on the wallet: tying header structure to
         * `hasWallet` rearranged the row at the moment of connecting, which reads as a glitch.
         */}
        <HeaderMetric className="hidden xl:flex" label="24h High">
          {formatPrice(publication.high24h)}
        </HeaderMetric>
        <HeaderMetric className="hidden xl:flex" label="24h Low">
          {formatPrice(publication.low24h)}
        </HeaderMetric>
      </div>
    );
  }
  return (
    /*
     * As many figures as the width holds, whole: the row wraps, and the wrap is clipped to one
     * row's height with a gap tall enough that nothing of a second row shows. Breakpoints
     * could not say how many fit, since the wallet button's width is not knowable in advance.
     */
    <div
      className={cn(
        "hidden h-9 min-w-0 flex-wrap content-start items-start gap-x-4 gap-y-10 overflow-hidden lg:flex",
        seeded && "opacity-50"
      )}
      {...provisional}
    >
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
  );
}

export function TerminalHeaderBar({
  market,
  publication,
}: {
  /** Which market the selector shows: the route's, whatever the panels have published. */
  market: TerminalMarket;
  /** The selected market's figures and controls, or null until its panels publish them. */
  publication: TerminalHeaderPublication | null;
}) {
  const price = publication?.price ?? null;
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
    //
    // From `lg`, where the figures show, one fixed height for every market: spot's price carries a
    // second line (₦ per USDC) and the perp's figures do not, so a header sized to its content was
    // 78px on spot and 65px on the perp, and every panel under it jumped 13px on a switch. 80px
    // holds spot's three lines inside the padding; the perp's row centres in the same height.
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-panel-border border-b px-4 py-3 transition-colors duration-300 md:flex-nowrap lg:h-20">
      <SmartImage<string>
        alt="Numo"
        className="h-7 w-24 shrink-0"
        imgClassName="object-left"
        priority
        src={theme === "light" ? "/numo_logo_black.png" : "/numo_logo_white.png"}
      />

      {/* The only rule in the bar: everything right of it belongs to the market, not the app. */}
      <div className="w-px shrink-0 self-stretch bg-panel-border" />

      <MarketSelectDialog
        changePercent24h={publication?.changePercent24h ?? null}
        market={market}
        price={price}
      />

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
      <HeaderMetrics publication={publication} />

      {/*
       * Below `lg` the cluster may wrap inside itself, as the header around it does on a phone.
       * From `lg` it stays on one line and never shrinks: the wallet button carries an address whose width is
       * not knowable in advance, and a cluster that wrapped inside itself dropped that button under
       * the others. The metrics beside it are what give way, since they clip rather than paint over.
       */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 lg:shrink-0 lg:flex-nowrap">
        {/* Keyed by market: a control published by one market never keeps its state under another. */}
        {publication?.depositControl == null ? (
          <HeaderActionPlaceholders />
        ) : (
          <Fragment key={publication.market}>{publication.depositControl}</Fragment>
        )}
        <button
          aria-label="Toggle theme"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-panel-border bg-input-bg text-panel-text-active transition-all duration-300 hover:bg-input-hover"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "light" ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </button>
        <PrivyWalletButton onPortfolioSelect={publication?.onPortfolioSelect} />
      </div>
    </header>
  );
}
