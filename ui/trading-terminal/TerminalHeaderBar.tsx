"use client";

import { ArrowRight, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDollarPrice } from "@/lib/market-formatting";
import type { TerminalMarketId } from "@/lib/market-overview.types";
import { formatLeverage } from "@/lib/perp-market";
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
 * One figure in the strip: a muted label over its value, in the mono face. Every figure is these
 * two lines, so labels share one baseline and values another; the lead figure (the price or the
 * mark) is set large, and its label carries the unit it is quoted in.
 */
function HeaderMetric({
  children,
  className,
  label,
  lead = false,
  tooltip,
  unit,
}: {
  children: ReactNode;
  /** Lets a figure yield its place at narrower widths; merged over the display class. */
  className?: string;
  label: string;
  lead?: boolean;
  /** A hint on the label, shown on hover like the ticket's. */
  tooltip?: string;
  unit?: string;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col justify-center gap-1 px-5 first:pl-0", className)}>
      <span
        className={cn(
          "whitespace-nowrap text-[11px] text-panel-text-muted",
          tooltip && "cursor-help"
        )}
        data-metric-label
        title={tooltip}
      >
        {label}
        {unit === undefined ? null : <span className="opacity-80"> | {unit}</span>}
      </span>
      <span
        className={cn(
          "flex items-baseline gap-2 whitespace-nowrap font-mono text-panel-text-active",
          lead ? "font-semibold text-[18px] leading-none" : "text-[13px]"
        )}
        data-metric-value
      >
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
  tone: "up" | "down" | "accent" | null;
  /** A secondary figure shown muted after the value. */
  detail?: string;
  /** The unit the figure is quoted in, shown after the label. */
  unit?: string;
  /** "end" sets the figure at the strip's far right; "selector" leaves it out of the strip. */
  placement?: "end" | "selector";
};

/** The header's Deposit and Withdraw buttons, and their placeholders, share one look. */
export const HEADER_ACTION_CLASSES =
  "flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap bg-panel-bg px-3 font-semibold text-[13px] md:h-10 md:px-4 md:text-[14px] text-panel-text-active ring-2 ring-panel-ring transition-colors hover:bg-input-hover disabled:cursor-not-allowed disabled:opacity-60";

/** The header's Deposit: the primary action, filled. */
export const HEADER_PRIMARY_ACTION_CLASSES =
  "flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap bg-primary-bg px-3 font-semibold text-[13px] md:h-10 md:px-4 md:text-[14px] text-primary-fg transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Stand-ins for the market's Deposit and Withdraw until its panels publish them, so the action
 * cluster keeps its width and nothing in the header shifts on a switch. Disabled: they open
 * nothing. A market whose panels publish no controls (the perp before it is live) keeps them.
 */
function HeaderActionPlaceholders() {
  return (
    <div aria-hidden className="flex items-center gap-2" data-placeholder="deposit-withdraw">
      <button className={HEADER_PRIMARY_ACTION_CLASSES} disabled tabIndex={-1} type="button">
        Deposit
        <ArrowRight aria-hidden className="size-4" />
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
    <div aria-hidden className={cn("flex shrink-0 flex-col gap-1 px-5 first:pl-0", className)}>
      <span className="w-12 animate-pulse rounded-sm bg-input-bg text-[11px]">{"\u00a0"}</span>
      <span className="w-20 animate-pulse rounded-sm bg-input-bg text-[13px]">{"\u00a0"}</span>
    </div>
  );
}

/** The strip's frame: one row of figures, ruled apart, scrolling sideways rather than wrapping. */
const STRIP_CLASSES =
  "hidden min-h-14 shrink-0 items-stretch divide-x-2 divide-panel-border overflow-x-auto bg-panel-bg px-4 py-2.5 ring-2 ring-panel-ring md:flex md:px-6";

/**
 * The market's figures, in a strip of their own at the top of the terminal's frame: the spot set
 * (price, volume, high, low), or the market's own list (the future's mark, carry and expiry, the
 * perp's funding), or placeholders until the selected market's panels publish.
 */
export function TerminalMetricsStrip({
  publication,
}: {
  publication: TerminalHeaderPublication | null;
}) {
  if (publication === null) {
    return (
      <div aria-busy="true" className={STRIP_CLASSES}>
        <HeaderMetricSkeleton />
        <HeaderMetricSkeleton />
        <HeaderMetricSkeleton className="hidden sm:flex" />
        <HeaderMetricSkeleton className="hidden sm:flex" />
      </div>
    );
  }
  const { changePercent24h, metrics, price, seeded = false } = publication;
  // Seeded figures are the selector's last read, not the market's own: shown dimmed, and busy,
  // until the panels publish the live set.
  const provisional = seeded ? { "aria-busy": true, "data-seeded": true } : {};
  if (metrics === undefined) {
    return (
      <div className={cn(STRIP_CLASSES, seeded && "opacity-50")} {...provisional}>
        <HeaderMetric label="Price" lead>
          {formatDollarPrice(price)}
          <span className={cn("font-normal text-[12px]", getChangeClassName(changePercent24h))}>
            {formatChangePercent(changePercent24h)}
          </span>
        </HeaderMetric>
        <HeaderMetric label="24h Volume">{publication.volume24hLabel}</HeaderMetric>
        <HeaderMetric label="24h High">{formatDollarPrice(publication.high24h)}</HeaderMetric>
        <HeaderMetric label="24h Low">{formatDollarPrice(publication.low24h)}</HeaderMetric>
      </div>
    );
  }
  const inline = metrics.filter((metric) => metric.placement === undefined);
  const trailing = metrics.filter((metric) => metric.placement === "end");
  return (
    <div className={cn(STRIP_CLASSES, "divide-x-0", seeded && "opacity-50")} {...provisional}>
      <div className="flex items-stretch divide-x-2 divide-panel-border">
        {inline.map((metric, index) => (
          <HeaderMetric
            key={metric.label}
            label={metric.label}
            lead={index === 0}
            tooltip={metric.tooltip}
            unit={metric.unit}
          >
            <MetricValue metric={metric} />
          </HeaderMetric>
        ))}
      </div>
      {trailing.map((metric) => (
        <HeaderMetric
          className="ml-auto items-end pr-0"
          key={metric.label}
          label={metric.label}
          tooltip={metric.tooltip}
          unit={metric.unit}
        >
          <MetricValue metric={metric} />
        </HeaderMetric>
      ))}
    </div>
  );
}

function MetricValue({ metric }: { metric: HeaderMetricItem }) {
  const value = (
    <span
      className={cn(
        metric.tone === "up" && "text-bid-text",
        metric.tone === "down" && "text-ask-text",
        metric.tone === "accent" && "text-accent-text"
      )}
    >
      {metric.value}
    </span>
  );
  if (metric.detail === undefined) {
    return value;
  }
  return (
    <>
      {value}
      <span className="text-panel-text-muted">| {metric.detail}</span>
    </>
  );
}

/**
 * The terminal's top bar: branding, the market selector and the account actions. The market's
 * figures sit under it, in `TerminalMetricsStrip`.
 *
 * Rendered by the shell, above the market's panels, and never remounted by a market switch. The
 * Deposit and Withdraw controls are the market's own, published by its panels
 * (`usePublishTerminalHeader`); until the selected market's panels have published, the action
 * cluster holds disabled placeholders of the same size.
 */
export function TerminalHeaderBar({
  seriesSymbol = null,
  market,
  publication,
}: {
  /** The series on screen when `market` is a future or an option, from the route. */
  seriesSymbol?: string | null;
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
    // 64px when everything fits on one line, growing rather than overflowing when it does not —
    // the wallet button's address makes the right-hand cluster's extent unknowable.
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 p-3 transition-colors duration-300 md:flex-nowrap md:px-6">
      {/* The logo leads to the marketing site, the venue's home, not back into the terminal. */}
      <a aria-label="Numo home" className="shrink-0" href="https://numofx.com">
        <SmartImage<string>
          alt="Numo"
          className="h-7 w-24 shrink-0"
          imgClassName="object-left"
          priority
          src={theme === "light" ? "/numo_logo_black.png" : "/numo_logo_white.png"}
        />
      </a>

      <MarketSelectDialog
        changePercent24h={publication?.changePercent24h ?? null}
        market={market}
        price={price}
        seriesSymbol={seriesSymbol}
      />

      {publication?.maxLeverage == null ? null : (
        <span
          className="shrink-0 bg-input-bg px-2 py-1 font-medium font-mono text-panel-text-active text-sm leading-none ring-2 ring-panel-border"
          title="The most leverage the venue opens a position at"
        >
          {formatLeverage(publication.maxLeverage)}
        </span>
      )}

      {/*
       * Below `md` the cluster may wrap inside itself, as the header around it does on a phone.
       * From `md` it stays on one line and never shrinks: the wallet button carries an address
       * whose width is not knowable in advance, and a cluster that wrapped inside itself dropped
       * that button under the others.
       */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 md:shrink-0 md:flex-nowrap">
        {/* Keyed by market: a control published by one market never keeps its state under another. */}
        {publication?.depositControl == null ? (
          <HeaderActionPlaceholders />
        ) : (
          <Fragment key={publication.market}>{publication.depositControl}</Fragment>
        )}
        <button
          aria-label="Toggle theme"
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center bg-panel-bg text-panel-text-active ring-2 ring-panel-ring transition-colors hover:bg-input-hover md:size-10"
          onClick={toggleTheme}
          type="button"
        >
          {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
        <PrivyWalletButton />
      </div>
    </header>
  );
}
