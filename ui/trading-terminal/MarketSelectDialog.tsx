"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, ChevronDown, X } from "lucide-react";
import { Fragment, useState } from "react";
import { impliedVol } from "@/lib/black76";
import { cn } from "@/lib/cn";
import { buildFutureOverviewMetrics } from "@/lib/future-market";
import { formatPrice } from "@/lib/market-formatting";
import {
  emptyOverviewRow,
  filterTerminalMarkets,
  formatFundingRate,
  formatOpenInterest,
  formatOverviewVolume,
  getTerminalMarket,
  listedFutureSymbols,
  listedSpotMarkets,
  selectorMarkets,
} from "@/lib/market-overview";
import type {
  MarketOverviewRow,
  TerminalMarketEntry,
  TerminalMarketId,
  TerminalMarketKind,
} from "@/lib/market-overview.types";
import type { OptionChain, OptionOverviewRow } from "@/lib/option-chain";
import {
  buildOptionChains,
  formatExpiryDay,
  formatExpiryTab,
  formatPremium,
  formatTimeToExpiry,
  formatVol,
} from "@/lib/option-chain";
import { isSpotMarketId, SPOT_PAIRS } from "@/lib/spot-pairs";
import { SmartImage } from "@/ui/SmartImage";
import { SmartLink } from "@/ui/SmartLink";
import { useMarketOverview } from "@/ui/trading-terminal/useMarketOverview";

/**
 * The dialog's tabs: the market kinds a row links to, and Options, which lists the venue's option chains.
 * Options has no terminal route yet, so its rows show the book and link nowhere.
 */
type SelectorTab = TerminalMarketKind | "options";

/** No Perp tab: the perp is winding down and reachable only at `/perp`. */
const TABS = [
  { kind: "spot", label: "Spot" },
  { kind: "futures", label: "Futures" },
  { kind: "options", label: "Options" },
] as const satisfies readonly { kind: SelectorTab; label: string }[];

/** The tab a market lists under; the perp's page opens the selector on Spot. */
function tabFor(kind: TerminalMarketKind): TerminalMarketKind {
  return kind === "perp" ? "spot" : kind;
}

/**
 * Column templates per tab, ending in a fixed column for the selected-market check. The perp-only
 * figures and the volume stand down below `md`, where a phone's width holds the market, its price
 * and the change and no more.
 */
const GRID_CLASS = {
  futures:
    "grid-cols-[minmax(0,2.8fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:grid-cols-[minmax(0,2.3fr)_minmax(0,0.9fr)_minmax(0,1.35fr)_minmax(0,0.8fr)_minmax(0,1fr)_1rem]",
  perp: "grid-cols-[minmax(0,2.8fr)_minmax(0,1.05fr)_minmax(0,1.15fr)_1rem] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_1rem]",
  spot: "grid-cols-[minmax(0,2.8fr)_minmax(0,1.05fr)_minmax(0,1.15fr)_1rem] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_1rem]",
} satisfies Record<TerminalMarketKind, string>;

/** The one radius the dialog, its controls and its selected row share. */
const RADIUS = "rounded-lg";

const CELL_CLASS = "min-w-0 truncate text-right text-[13px] text-panel-text tabular-nums";
const HIDDEN_ON_PHONE = "hidden md:block";

/** The token marks a symbol carries, in the order its name reads: "cNGN-USDC" shows both, "cNGN-PERP" the one. */
const TOKEN_MARKS = {
  cNGN: "/tokens/cngn.svg",
  EURC: "/tokens/eurc.png",
  USDC: "/tokens/usdc.svg",
} as const satisfies Record<string, string>;

function marksFor(symbol: string) {
  return symbol
    .split("-")
    .filter((part): part is keyof typeof TOKEN_MARKS => part in TOKEN_MARKS)
    .map((part) => ({ alt: part, src: TOKEN_MARKS[part] }));
}

/**
 * The symbol with the marks of the tokens it names, shared by the header pill and the selector's
 * rows: the pair's two on spot, the perp's one. `compact` is the row form: smaller marks beside a
 * symbol one step larger than the pill's.
 */
export function MarketIdentity({ compact, symbol }: { compact?: boolean; symbol: string }) {
  return (
    <>
      <span className="flex shrink-0 items-center -space-x-1.5">
        {marksFor(symbol).map((mark) => (
          <SmartImage<string>
            alt={mark.alt}
            className={cn(
              "animate-none rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border",
              compact ? "size-5" : "size-6"
            )}
            key={mark.alt}
            src={mark.src}
          />
        ))}
      </span>
      <span
        className={cn(
          "truncate font-semibold text-panel-text-active leading-none",
          compact ? "text-[14px]" : "text-[13px]"
        )}
      >
        {symbol}
      </span>
    </>
  );
}

function ChangeCell({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn(CELL_CLASS, "text-panel-text-muted")}>—</span>;
  }
  // No move is neither a rise nor a fall: grey, unsigned, no arrow.
  if (Number(value.toFixed(2)) === 0) {
    return <span className={cn(CELL_CLASS, "text-panel-text-muted")}>0.00%</span>;
  }
  const negative = value < 0;
  return (
    <span
      className={cn(
        CELL_CLASS,
        "inline-flex items-center justify-end gap-1",
        negative ? "text-ask-text" : "text-bid-text"
      )}
    >
      {negative ? "-" : "+"}
      {Math.abs(value).toFixed(2)}%
      <span aria-hidden className="text-[8px] leading-none">
        {negative ? "▼" : "▲"}
      </span>
    </span>
  );
}

/** The Futures tab's figures, in the stats bar's order. */
const FUTURE_COLUMNS = ["Mark", "Basis", "APR", "Open Interest"] as const;

/** What a phone's width holds beside the series name: the mark and the APR, short figures both. */
const FUTURE_PHONE_COLUMNS = new Set<string>(["Mark", "APR"]);

/** The column tooltips: the stats bar's own, from a series with nothing served. */
const FUTURE_COLUMN_TOOLTIPS = Object.fromEntries(
  buildFutureOverviewMetrics(emptyOverviewRow("future"), 0).map((metric) => [
    metric.label,
    metric.tooltip,
  ])
);

function ColumnHeaders({ kind }: { kind: TerminalMarketKind }) {
  const headerClass = "truncate text-right text-[12px] text-panel-text-muted";
  if (kind === "futures") {
    return (
      <div
        className={cn(
          "grid items-center gap-2 border-panel-border border-b pb-2 md:gap-3",
          GRID_CLASS.futures
        )}
      >
        <span className={cn(headerClass, "text-left")}>Market</span>
        {FUTURE_COLUMNS.map((label) => (
          <span
            className={cn(
              headerClass,
              "cursor-help",
              !FUTURE_PHONE_COLUMNS.has(label) && HIDDEN_ON_PHONE
            )}
            key={label}
            title={FUTURE_COLUMN_TOOLTIPS[label]}
          >
            {label}
          </span>
        ))}
        <span aria-hidden className={HIDDEN_ON_PHONE} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "grid items-center gap-2 border-panel-border border-b pb-2 md:gap-3",
        GRID_CLASS[kind]
      )}
    >
      <span className={cn(headerClass, "text-left")}>Market</span>
      <span className={headerClass}>Price</span>
      <span className={headerClass}>24h change</span>
      <span className={cn(headerClass, HIDDEN_ON_PHONE)}>24h volume</span>
      {kind === "perp" ? (
        <>
          <span className={cn(headerClass, HIDDEN_ON_PHONE)}>Open interest</span>
          <span className={cn(headerClass, HIDDEN_ON_PHONE)}>1h funding</span>
        </>
      ) : null}
      <span aria-hidden />
    </div>
  );
}

const ZERO_FIGURE = /^[+-]?0(\.0+)?%?$/;

/** A figure that reads as zero, or nothing at all: shown neutral grey, neither a rise nor a fall. */
function isZeroOrBlank(value: string) {
  const first = value.split(" ")[0]?.replace(/[$,]/g, "") ?? "";
  return value === "—" || ZERO_FIGURE.test(first);
}

/** A series' figures, as the stats bar computes, words and colours them, with its tooltips. */
function FutureCells({ row }: { row: MarketOverviewRow }) {
  const metrics = buildFutureOverviewMetrics(row, Date.now());
  return (
    <>
      {FUTURE_COLUMNS.map((label) => {
        const metric = metrics.find((candidate) => candidate.label === label);
        const value = metric?.value ?? "—";
        return (
          <span
            className={cn(
              CELL_CLASS,
              !FUTURE_PHONE_COLUMNS.has(label) && HIDDEN_ON_PHONE,
              label === "Mark" && "text-panel-text-active",
              metric?.tone === "up" && "text-bid-text",
              metric?.tone === "down" && "text-ask-text",
              metric?.tone == null && isZeroOrBlank(value) && "text-panel-text-muted"
            )}
            key={label}
            title={metric?.tooltip}
          >
            {value}
          </span>
        );
      })}
    </>
  );
}

/** A spot row's price as its pair shows it, the perp's in USDC per cNGN. */
function formatRowPrice(entry: TerminalMarketEntry, price: number | null) {
  return isSpotMarketId(entry.id)
    ? formatPrice(price, SPOT_PAIRS[entry.id].priceDecimals)
    : formatPrice(price);
}

/** Spot's and the perp's figures: price, the day's change and volume, and the perp's own. */
function MarketCells({ entry, row }: { entry: TerminalMarketEntry; row: MarketOverviewRow }) {
  return (
    <>
      <span className={cn(CELL_CLASS, "text-panel-text-active")}>
        {/* USDC-cNGN is quoted cNGN per USDC, EURC-USDC USDC per EURC; the perp keeps USDC per cNGN. */}
        {formatRowPrice(entry, row.price)}
      </span>
      <ChangeCell value={row.changePercent24h} />
      <span className={cn(CELL_CLASS, HIDDEN_ON_PHONE)}>
        {formatOverviewVolume(row.volume24hUsd)}
      </span>
      {entry.kind === "perp" ? (
        <>
          <span className={cn(CELL_CLASS, HIDDEN_ON_PHONE)}>
            {formatOpenInterest(row.openInterestUsd)}
          </span>
          <span className={cn(CELL_CLASS, HIDDEN_ON_PHONE)}>
            {formatFundingRate(row.fundingRate1h)}
          </span>
        </>
      ) : null}
    </>
  );
}

function MarketRow({
  entry,
  onSelect,
  row,
  selected,
}: {
  entry: TerminalMarketEntry;
  onSelect: () => void;
  row: MarketOverviewRow;
  selected: boolean;
}) {
  return (
    // Rows are links, not state: every market is its own route, so switching never carries
    // one terminal's ticket or book into the other, and each has its own URL.
    <SmartLink
      aria-current={selected ? "page" : undefined}
      className={cn(
        "-mx-3 grid cursor-pointer items-center gap-2 px-3 py-2.5 text-panel-text-active transition-colors hover:bg-input-hover focus-visible:bg-input-hover focus-visible:outline-none md:gap-3",
        RADIUS,
        GRID_CLASS[entry.kind],
        selected && "bg-input-bg"
      )}
      href={entry.href}
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-center gap-2">
        <MarketIdentity compact symbol={entry.symbol} />
      </span>
      {entry.kind === "futures" ? (
        <FutureCells row={row} />
      ) : (
        <MarketCells entry={entry} row={row} />
      )}
      {/* A phone's Futures row spends this column on the series name; the row's fill marks it. */}
      <span className={cn("flex justify-end", entry.kind === "futures" && "max-md:hidden")}>
        {selected ? (
          <Check aria-label="Selected market" className="size-4 shrink-0 text-panel-text-muted" />
        ) : null}
      </span>
    </SmartLink>
  );
}

/** Bid IV, bid, mark, ask, ask IV for calls, the strike, then the same five for puts. */
const CHAIN_GRID =
  "grid min-w-[900px] grid-cols-[0.8fr_1fr_1fr_1fr_0.8fr_88px_0.8fr_1fr_1fr_1fr_0.8fr] items-stretch gap-x-2";
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
    <div className="relative flex min-w-[900px] items-center justify-center py-1.5">
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
    <div className="overflow-x-auto">
      <div className="grid min-w-[900px] grid-cols-[1fr_auto_1fr] border-panel-border border-b py-2.5 text-[13px]">
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

/** The Options tab: one chain at a time under its expiry's tab, nearest first. */
function OptionChains({ rows }: { rows: readonly OptionOverviewRow[] }) {
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const chains = buildOptionChains(rows);
  const chain = chains.find((candidate) => candidate.series === selectedSeries) ?? chains[0];
  if (chain === undefined) {
    return (
      <p className="py-8 text-center text-[13px] text-panel-text-muted">
        No options listed right now
      </p>
    );
  }
  const nowMs = Date.now();
  const manyBases = new Set(chains.map((candidate) => candidate.baseSymbol)).size > 1;
  return (
    <>
      <div className="flex items-center gap-4 border-panel-border border-b">
        <span className="rounded-md bg-input-bg px-3 py-1.5 font-medium text-[13px] text-panel-text-active">
          {chain.baseSymbol || "cNGN"}
        </span>
        <div
          aria-label="Expiry"
          className="flex min-w-0 flex-1 gap-5 overflow-x-auto"
          role="tablist"
        >
          {chains.map((candidate) => (
            <button
              aria-selected={candidate.series === chain.series}
              className={cn(
                "-mb-px cursor-pointer whitespace-nowrap border-b-2 py-2.5 text-[13px] transition-colors",
                candidate.series === chain.series
                  ? "border-panel-text-active text-panel-text-active"
                  : "border-transparent text-panel-text-muted hover:text-panel-text"
              )}
              key={candidate.series}
              onClick={() => setSelectedSeries(candidate.series)}
              role="tab"
              type="button"
            >
              {manyBases ? `${candidate.baseSymbol} ` : ""}
              {formatExpiryTab(candidate.expiryMs, nowMs)}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-[12px] text-panel-text-muted">
          USDC per {chain.baseSymbol || "cNGN"}
        </span>
      </div>
      <OptionChainTable chain={chain} nowMs={nowMs} />
    </>
  );
}

/**
 * The header's market pill and the market dialog it opens: a Spot/Futures tab row with the close
 * control, and a table of the markets under the active tab with the venue's figures. Futures lists
 * the front-month series the venue serves, so a roll needs no deploy. Choosing a row navigates to
 * that market's route. Escape, the backdrop and the X all close it; the body does not scroll behind
 * it. Below `md` it rises as a bottom sheet rather than a centred card.
 */
export function MarketSelectDialog({
  changePercent24h,
  futureSymbol,
  market,
  price,
}: {
  /** The header's live figures for the market on screen. */
  changePercent24h: number | null;
  /** The series on screen when `market` is a future, from the route; null otherwise. */
  futureSymbol: string | null;
  market: TerminalMarketId;
  price: number | null;
}) {
  const selected = getTerminalMarket(market, futureSymbol);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SelectorTab>(tabFor(selected.kind));
  const overview = useMarketOverview(open, {
    ...emptyOverviewRow(market),
    changePercent24h,
    price,
  });
  // Every series the venue lists, nearest expiry first, and the one on screen if it is not among them.
  const entries =
    kind === "options"
      ? []
      : filterTerminalMarkets(
          selectorMarkets(
            listedFutureSymbols(overview.futures, futureSymbol),
            listedSpotMarkets(overview.rows, market)
          ),
          kind,
          ""
        );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Each opening lands on the tab of the market on screen.
      setKind(tabFor(selected.kind));
    }
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      {/* Stable id: auto-generated useId values can shift when async state (e.g. Privy init) races hydration. */}
      <Dialog.Trigger
        className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-input-bg px-2.5 outline-none ring-1 ring-panel-border transition-colors hover:bg-input-hover focus-visible:ring-2 focus-visible:ring-panel-text-muted"
        id="spot-ticker-market-trigger"
      >
        <MarketIdentity symbol={selected.symbol} />
        <ChevronDown
          className={cn(
            "size-4 text-panel-text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cn(
            "md:-translate-1/2 fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-lg bg-dialog-bg text-foreground outline-none ring-1 ring-panel-ring transition-all data-ending-style:opacity-0 data-starting-style:opacity-0 max-md:data-ending-style:translate-y-4 max-md:data-starting-style:translate-y-4 md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[min(80dvh,620px)] md:rounded-lg md:data-ending-style:scale-95 md:data-starting-style:scale-95",
            kind === "options" ? "md:w-[min(96vw,1040px)]" : "md:w-[min(92vw,760px)]"
          )}
        >
          {/* No visible heading: the tabs and the table say what this is. Named for screen readers. */}
          <Dialog.Title className="sr-only">Select a market</Dialog.Title>

          {/*
           * The Spot/Futures tabs in the terminal's own tab style (see PanelTabs): underlined text on
           * one rule, left-aligned, the active tab bright, never a filled pill. The close control
           * rides the right end of the same row.
           */}
          <div className="mx-5 my-3 flex items-center justify-between gap-3 border-panel-border border-b">
            <div aria-label="Market type" className="flex gap-6" role="tablist">
              {TABS.map((tab) => (
                <button
                  aria-selected={tab.kind === kind}
                  className={cn(
                    "-mb-px cursor-pointer whitespace-nowrap border-b-2 py-3 font-medium text-[14px] transition-colors",
                    tab.kind === kind
                      ? "border-panel-text-active text-panel-text-active"
                      : "border-transparent text-panel-text-muted hover:text-panel-text"
                  )}
                  key={tab.kind}
                  onClick={() => setKind(tab.kind)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <Dialog.Close
              aria-label="Close"
              className={cn(
                "flex size-8 shrink-0 cursor-pointer items-center justify-center text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active",
                RADIUS
              )}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {kind === "options" ? (
              <OptionChains rows={overview.options} />
            ) : (
              <>
                <ColumnHeaders kind={kind} />
                {entries.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-panel-text-muted">
                    {kind === "futures" ? "No futures listed right now" : "No markets found"}
                  </p>
                ) : (
                  <div className="pt-1">
                    {entries.map((entry) => (
                      <MarketRow
                        entry={entry}
                        key={entry.href}
                        onSelect={() => setOpen(false)}
                        row={
                          entry.kind === "futures"
                            ? overview.futureRow(entry.symbol)
                            : overview.rowFor(entry.id)
                        }
                        selected={entry.href === selected.href}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
