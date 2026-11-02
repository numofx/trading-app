"use client";

import { Fragment } from "react";
import { impliedVol } from "@/lib/black76";
import { cn } from "@/lib/cn";
import { optionSeriesPath } from "@/lib/market-routes";
import type { OptionChain, OptionOverviewRow } from "@/lib/option-chain";
import {
  formatExpiryDay,
  formatExpiryTab,
  formatPremium,
  formatTimeToExpiry,
  formatVol,
} from "@/lib/option-chain";
import type { OptionSeriesPage } from "@/lib/option-chain-read";
import { SmartLink } from "@/ui/SmartLink";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { usePublishTerminalHeader } from "@/ui/trading-terminal/TerminalHeaderSlot";
import { useOptionSeries } from "@/ui/trading-terminal/useOptionSeries";

const PREMIUM_DECIMALS = 8;

/** Bid IV, bid, mark, ask, ask IV for calls, the strike, then the same five for puts. */
const CHAIN_MIN_WIDTH = "min-w-[900px]";
const CHAIN_GRID = `grid ${CHAIN_MIN_WIDTH} grid-cols-[0.8fr_1fr_1fr_1fr_0.8fr_88px_0.8fr_1fr_1fr_1fr_0.8fr] items-stretch gap-x-2 px-4`;
const CHAIN_FIGURE = "flex items-center text-[13px] text-panel-text tabular-nums";
const CHAIN_HEADERS = ["Bid IV", "Bid", "Mark", "Ask", "Ask IV"] as const;

/**
 * A resting price. The colour is what taking it does, by the one rule for a side: a bid is hit by selling,
 * so it takes the sell colour, and an ask is lifted by buying, so it takes the buy colour.
 */
function PriceCell({ side, value }: { side: "bid" | "ask"; value: number | null }) {
  const premium = formatPremium(value);
  return (
    <span
      className={cn(
        "my-1 flex items-center rounded-md px-2 py-1.5 text-[13px] tabular-nums",
        premium === "—" && "bg-input-bg text-panel-text-muted",
        premium !== "—" && side === "bid" && "bg-ask-bg text-ask-text",
        premium !== "—" && side === "ask" && "bg-bid-bg text-bid-text"
      )}
    >
      {premium}
    </span>
  );
}

function OptionSideCells({
  forward,
  nowMs,
  row,
}: {
  forward: number | null;
  nowMs: number;
  row: OptionOverviewRow | null;
}) {
  // A side the venue does not list, or lists closed, rests nothing: only its mark means anything.
  const open = row?.tradingOpen === true;
  const bid = open ? (row?.bid ?? null) : null;
  const ask = open ? (row?.ask ?? null) : null;
  const pricing =
    row === null || forward === null
      ? null
      : {
          forward,
          isCall: row.optionType === "call",
          seconds: (row.expiryMs - nowMs) / 1000,
          strike: row.strike,
        };
  const vol = (premium: number | null) => (pricing === null ? null : impliedVol(pricing, premium));
  return (
    <>
      <span className={CHAIN_FIGURE}>{formatVol(vol(bid))}</span>
      <PriceCell side="bid" value={bid} />
      <span className={CHAIN_FIGURE}>{formatPremium(row?.mark ?? null)}</span>
      <PriceCell side="ask" value={ask} />
      <span className={CHAIN_FIGURE}>{formatVol(vol(ask))}</span>
    </>
  );
}

/** The dotted rule at the forward, between the strikes either side of it. */
function ForwardRule({ baseSymbol, forward }: { baseSymbol: string; forward: number }) {
  return (
    <div className={cn("relative flex items-center justify-center py-1.5", CHAIN_MIN_WIDTH)}>
      <span className="absolute inset-x-0 border-panel-text-muted border-t border-dotted" />
      <span className="relative rounded-md bg-panel-text-active px-3 py-1 font-medium text-[12px] text-dialog-bg tabular-nums">
        {baseSymbol} forward {formatPremium(forward)}
      </span>
    </div>
  );
}

function OptionChainTable({ chain, nowMs }: { chain: OptionChain; nowMs: number }) {
  const { forward } = chain;
  const headerClass = "flex items-center py-2 text-[12px] text-panel-text-muted";
  const baseSymbol = chain.baseSymbol || "cNGN";
  const forwardAt =
    forward === null ? -1 : chain.strikes.filter((strike) => strike.strike < forward).length;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div
        className={cn(
          "grid grid-cols-[1fr_auto_1fr] border-panel-border border-b py-2.5 text-[13px]",
          CHAIN_MIN_WIDTH
        )}
      >
        <span className="text-center font-medium text-panel-text-active">Calls</span>
        <span className="text-center font-medium text-panel-text-active tabular-nums">
          {formatExpiryDay(chain.expiryMs)}{" "}
          <span className="font-normal text-panel-text-muted">
            {formatTimeToExpiry(chain.expiryMs, nowMs)}
          </span>
        </span>
        <span className="text-center font-medium text-panel-text-active">Puts</span>
      </div>
      <div className={cn(CHAIN_GRID, "border-panel-border border-b")}>
        {CHAIN_HEADERS.map((header) => (
          <span className={headerClass} key={`call-${header}`}>
            {header}
          </span>
        ))}
        <span className={cn(headerClass, "justify-center bg-input-bg")}>Strike</span>
        {CHAIN_HEADERS.map((header) => (
          <span className={headerClass} key={`put-${header}`}>
            {header}
          </span>
        ))}
      </div>
      {chain.strikes.map((strike, index) => (
        <Fragment key={strike.strikeLabel}>
          {forward !== null && index === forwardAt ? (
            <ForwardRule baseSymbol={baseSymbol} forward={forward} />
          ) : null}
          <div className={cn(CHAIN_GRID, "border-panel-border border-b")}>
            <OptionSideCells forward={forward} nowMs={nowMs} row={strike.call} />
            <span className="flex items-center justify-center bg-input-bg text-[13px] text-panel-text-active tabular-nums">
              {strike.strikeLabel}
            </span>
            <OptionSideCells forward={forward} nowMs={nowMs} row={strike.put} />
          </div>
        </Fragment>
      ))}
      {forward !== null && forwardAt === chain.strikes.length ? (
        <ForwardRule baseSymbol={baseSymbol} forward={forward} />
      ) : null}
    </div>
  );
}

/** One tab per listed series: each is its own page, so a tab is a link. */
function ExpiryTabs({
  active,
  baseSymbol,
  nowMs,
  series,
}: {
  active: string;
  baseSymbol: string;
  nowMs: number;
  series: OptionSeriesPage["series"];
}) {
  const manyBases = new Set(series.map((item) => item.baseSymbol)).size > 1;
  return (
    <div className="flex items-center gap-4 border-panel-border border-b px-4">
      <span className="rounded-md bg-input-bg px-3 py-1.5 font-medium text-[13px] text-panel-text-active">
        {baseSymbol}
      </span>
      <nav aria-label="Expiry" className="flex min-w-0 flex-1 gap-5 overflow-x-auto">
        {series.map((item) => (
          <SmartLink
            aria-current={item.series === active ? "page" : undefined}
            className={cn(
              "-mb-px cursor-pointer whitespace-nowrap border-b-2 py-2.5 text-[13px] transition-colors",
              item.series === active
                ? "border-panel-text-active text-panel-text-active"
                : "border-transparent text-panel-text-muted hover:text-panel-text"
            )}
            href={optionSeriesPath(item.series)}
            key={item.series}
          >
            {manyBases ? `${item.baseSymbol} ` : ""}
            {formatExpiryTab(item.expiryMs, nowMs)}
          </SmartLink>
        ))}
      </nav>
      <span className="shrink-0 text-[12px] text-panel-text-muted">USDC per {baseSymbol}</span>
    </div>
  );
}

/**
 * A series' options page: its chain, calls and puts by strike, under the shell's header. Read only: there is
 * no option ticket yet, so a price is not a control.
 */
export function OptionChainPanels({ series }: { series: string }) {
  const { failed, page, readAtMs: nowMs } = useOptionSeries(series);
  const chain = page?.chain ?? null;
  const forward = chain?.forward ?? null;
  usePublishTerminalHeader({
    changePercent24h: null,
    high24h: null,
    low24h: null,
    market: "option",
    price: forward,
    volume24hLabel: "—",
    metrics: [
      {
        label: "Forward",
        tone: null,
        tooltip: "The forward the engine prices this expiry on, in USDC per cNGN.",
        value: formatPremium(forward),
      },
      {
        label: "Expiry",
        tone: null,
        value: chain === null ? "—" : formatExpiryDay(chain.expiryMs),
      },
      {
        label: "Time to expiry",
        tone: null,
        value: chain === null ? "—" : formatTimeToExpiry(chain.expiryMs, nowMs),
      },
      { label: "Strikes", tone: null, value: chain === null ? "—" : `${chain.strikes.length}` },
    ],
  });
  return (
    <div className="flex min-w-0 flex-1 flex-col p-3 md:min-h-0 md:overflow-hidden md:px-4">
      <MarketDocumentTitle digits={PREMIUM_DECIMALS} pair={`${series} options`} price={forward} />
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel-bg-muted ring-1 ring-panel-ring">
        {chain === null || page === null ? (
          <p className="py-16 text-center text-[13px] text-panel-text-muted">
            {failed || page !== null
              ? `${series} options could not be read right now`
              : `Loading ${series} options`}
          </p>
        ) : (
          <>
            <ExpiryTabs
              active={series}
              baseSymbol={chain.baseSymbol || "cNGN"}
              nowMs={nowMs}
              series={page.series}
            />
            <OptionChainTable chain={chain} nowMs={nowMs} />
          </>
        )}
      </section>
    </div>
  );
}
