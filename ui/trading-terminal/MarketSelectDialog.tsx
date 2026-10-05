"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Duration } from "effect";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import {
  emptyOverviewRow,
  filterTerminalMarkets,
  formatFundingRate,
  formatMaxLeverage,
  formatOpenInterest,
  formatOverviewVolume,
  getTerminalMarket,
  TERMINAL_MARKETS,
} from "@/lib/market-overview";
import type {
  MarketOverviewResponse,
  MarketOverviewRow,
  TerminalMarketEntry,
  TerminalMarketId,
  TerminalMarketKind,
} from "@/lib/market-overview.types";
import { SmartImage } from "@/ui/SmartImage";
import { SmartLink } from "@/ui/SmartLink";

const TABS = [
  { kind: "spot", label: "Spot" },
  { kind: "perp", label: "Perp" },
] as const satisfies readonly { kind: TerminalMarketKind; label: string }[];

/**
 * Column templates per tab. The perp-only figures and the volume stand down below `md`, where a
 * phone's width holds the market, its price and the change and no more.
 */
const GRID_CLASS = {
  perp: "grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]",
  spot: "grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)]",
} satisfies Record<TerminalMarketKind, string>;

const CELL_CLASS = "min-w-0 truncate text-right font-mono text-[12px] tabular-nums";
const HIDDEN_ON_PHONE = "hidden md:block";

/** The paired token marks and symbol, shared by the header pill and the selector's rows. */
export function MarketIdentity({
  compact,
  subtitle,
  symbol,
}: {
  compact?: boolean;
  subtitle?: string | null;
  symbol: string;
}) {
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
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-semibold text-[13px] text-panel-text-active leading-none">
          {symbol}
        </span>
        {subtitle ? (
          <span className="truncate text-[10px] text-panel-text-muted leading-none">
            {subtitle}
          </span>
        ) : null}
      </span>
    </>
  );
}

function ChangeCell({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn(CELL_CLASS, "text-panel-text-muted")}>—</span>;
  }
  const negative = value < 0;
  const Arrow = negative ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={cn(
        CELL_CLASS,
        "inline-flex items-center justify-end gap-0.5",
        negative ? "text-ask-text" : "text-bid-text"
      )}
    >
      <Arrow aria-hidden className="size-3.5 shrink-0" />
      {negative ? "-" : "+"}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function ColumnHeaders({ kind }: { kind: TerminalMarketKind }) {
  const headerClass =
    "truncate text-right text-[10px] text-panel-text-muted uppercase tracking-wide";
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-panel-border border-b px-3 pb-2",
        GRID_CLASS[kind]
      )}
    >
      <span className={cn(headerClass, "text-left")}>Market</span>
      <span className={headerClass}>Price</span>
      <span className={headerClass}>24h Change</span>
      <span className={cn(headerClass, HIDDEN_ON_PHONE)}>24h Volume</span>
      {kind === "perp" ? (
        <>
          <span className={cn(headerClass, HIDDEN_ON_PHONE)}>Open Interest</span>
          <span className={cn(headerClass, HIDDEN_ON_PHONE)}>1h Funding</span>
        </>
      ) : null}
    </div>
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
  const subtitle = entry.kind === "perp" ? formatMaxLeverage(row.maxLeverage) : "Spot";
  return (
    // Rows are links, not state: spot and perp are separate routes, so switching never carries
    // one terminal's ticket or book into the other, and each has its own URL.
    <SmartLink
      aria-current={selected ? "page" : undefined}
      className={cn(
        "grid cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-panel-text-active transition-colors hover:bg-input-hover focus-visible:bg-input-hover focus-visible:outline-none",
        GRID_CLASS[entry.kind],
        selected && "bg-input-bg"
      )}
      href={entry.href}
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-center gap-2">
        <MarketIdentity compact subtitle={subtitle} symbol={entry.symbol} />
        {selected ? (
          <Check aria-label="Selected market" className="size-3.5 shrink-0 text-panel-text-muted" />
        ) : null}
      </span>
      <span className={CELL_CLASS}>{formatNaira(row.price)}</span>
      <ChangeCell value={row.changePercent24h} />
      <span className={cn(CELL_CLASS, HIDDEN_ON_PHONE, "text-panel-text")}>
        {formatOverviewVolume(row.volume24hUsd)}
      </span>
      {entry.kind === "perp" ? (
        <>
          <span className={cn(CELL_CLASS, HIDDEN_ON_PHONE, "text-panel-text")}>
            {formatOpenInterest(row.openInterestUsd)}
          </span>
          <span className={cn(CELL_CLASS, HIDDEN_ON_PHONE, "text-panel-text")}>
            {formatFundingRate(row.fundingRate1h)}
          </span>
        </>
      ) : null}
    </SmartLink>
  );
}

/**
 * A read is reused for this long across openings: reopening the selector within it shows the
 * same rows without another round trip, and the figures are at most this stale.
 */
const OVERVIEW_TTL_MS = Duration.toMillis("10 seconds");

let overviewCache: { readAt: number; rows: MarketOverviewRow[] } | null = null;

/**
 * The selector's table from `/api/markets-overview`, read when the dialog opens and never while it
 * is closed: no read on page load and no polling. A read younger than `OVERVIEW_TTL_MS` is reused.
 * The row for the market on screen takes the header's live price and change over the read, so the
 * two never disagree while the selector is open.
 */
function useMarketOverview(open: boolean, live: MarketOverviewRow) {
  const [rows, setRows] = useState<MarketOverviewRow[]>(() => overviewCache?.rows ?? []);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (overviewCache !== null && Date.now() - overviewCache.readAt < OVERVIEW_TTL_MS) {
      setRows(overviewCache.rows);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/markets-overview", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as MarketOverviewResponse;
        overviewCache = { readAt: Date.now(), rows: body.rows ?? [] };
        if (!cancelled) {
          setRows(overviewCache.rows);
        }
      } catch {
        // Keep the last read; the rows show dashes until one succeeds.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (id: TerminalMarketId): MarketOverviewRow => {
    const fetched = rows.find((row) => row.id === id) ?? emptyOverviewRow(id);
    if (id !== live.id) {
      return fetched;
    }
    return {
      ...fetched,
      changePercent24h: live.changePercent24h ?? fetched.changePercent24h,
      price: live.price ?? fetched.price,
    };
  };
}

/**
 * The header's market pill and the "Select a market" dialog it opens: a search box, a Spot/Perp
 * tab row and a table of the markets under the active tab with the venue's figures. Choosing a
 * row navigates to that market's route. Escape, the backdrop and the X all close it; the body
 * does not scroll behind it. Below `md` it rises as a bottom sheet rather than a centred card.
 */
export function MarketSelectDialog({
  changePercent24h,
  market,
  price,
}: {
  /** The header's live figures for the market on screen. */
  changePercent24h: number | null;
  market: TerminalMarketId;
  price: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TerminalMarketKind>(getTerminalMarket(market).kind);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const rowFor = useMarketOverview(open, {
    ...emptyOverviewRow(market),
    changePercent24h,
    price,
  });
  const selected = getTerminalMarket(market);
  const entries = filterTerminalMarkets(TERMINAL_MARKETS, kind, query);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Each opening lands on the tab of the market on screen, with a clean search box.
      setKind(selected.kind);
      setQuery("");
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
          className="md:-translate-1/2 fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[20px] bg-dialog-bg text-foreground shadow-[0_28px_90px_var(--panel-shadow)] outline-none ring-1 ring-panel-ring transition-all data-ending-style:opacity-0 data-starting-style:opacity-0 max-md:data-ending-style:translate-y-4 max-md:data-starting-style:translate-y-4 md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[min(80dvh,620px)] md:w-[min(92vw,760px)] md:rounded-[20px] md:data-ending-style:scale-95 md:data-starting-style:scale-95"
          initialFocus={searchRef}
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
            <Dialog.Title className="font-semibold text-[15px] text-panel-text-active">
              Select a market
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3 px-5 pb-3">
            <label className="flex h-10 items-center gap-2 rounded-sm border border-input-border bg-input-bg px-3 transition-colors focus-within:border-panel-text-muted">
              <Search aria-hidden className="size-4 shrink-0 text-panel-text-muted" />
              <input
                aria-label="Search markets"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-panel-text-active outline-none placeholder:text-panel-text-muted"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search markets"
                ref={searchRef}
                spellCheck={false}
                type="search"
                value={query}
              />
            </label>

            <div
              aria-label="Market type"
              className="flex gap-1 rounded-sm bg-input-bg p-0.5"
              role="tablist"
            >
              {TABS.map((tab) => (
                <button
                  aria-selected={tab.kind === kind}
                  className={cn(
                    "h-8 cursor-pointer rounded-sm px-4 font-semibold text-[12px] transition-colors",
                    tab.kind === kind
                      ? "bg-panel-bg-darker text-panel-text-active ring-1 ring-panel-border"
                      : "text-panel-text-muted hover:text-panel-text"
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <ColumnHeaders kind={kind} />
            {entries.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12px] text-panel-text-muted">
                No markets found
              </p>
            ) : (
              <div className="pt-1">
                {entries.map((entry) => (
                  <MarketRow
                    entry={entry}
                    key={entry.id}
                    onSelect={() => setOpen(false)}
                    row={rowFor(entry.id)}
                    selected={entry.id === market}
                  />
                ))}
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
