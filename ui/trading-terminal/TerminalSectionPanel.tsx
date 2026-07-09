"use client";

import { cn } from "@/lib/cn";
import { getInstrumentDisplayLabel } from "@/lib/market-display";
import { ACTIVITY_VIEWS, FOOTER_LINKS } from "@/lib/mock-orderbook-terminal-data";
import type { ActivityView, ContractMarket, MarketDefinition, MarketId } from "@/lib/trading.types";
import type { AppSection } from "@/ui/app-sidebar.types";

type OverviewSection = Exclude<AppSection, "derivatives" | "spot">;

const SECTION_COPY = {
  markets: {
    description: "All USDC/cNGN instruments available on Numo.",
    title: "Markets",
  },
  more: {
    description: "Resources and support.",
    title: "More",
  },
  orders: {
    description: "Open orders resting on the book.",
    title: "Orders",
  },
  portfolio: {
    description: "Open positions across your trading account.",
    title: "Portfolio",
  },
} satisfies Record<OverviewSection, { description: string; title: string }>;

export function TerminalSectionPanel({
  marketData,
  marketDefinitions,
  onOpenMarket,
  section,
}: {
  marketData: Record<MarketId, ContractMarket>;
  marketDefinitions: MarketDefinition[];
  onOpenMarket: (marketId: MarketId) => void;
  section: OverviewSection;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-panel-bg/72 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <header className="px-5 py-4">
        <h2 className="font-medium text-panel-text-active text-sm">{SECTION_COPY[section].title}</h2>
        <p className="mt-0.5 text-[11px] text-panel-text-muted">{SECTION_COPY[section].description}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {section === "markets" ? (
          <MarketsList
            marketData={marketData}
            marketDefinitions={marketDefinitions}
            onOpenMarket={onOpenMarket}
          />
        ) : null}
        {section === "portfolio" ? <SectionTable view={ACTIVITY_VIEWS.positions} /> : null}
        {section === "orders" ? <SectionTable view={ACTIVITY_VIEWS["open-orders"]} /> : null}
        {section === "more" ? <MoreLinks /> : null}
      </div>
    </section>
  );
}

const MARKETS_GRID_COLUMNS = "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)";

function MarketsList({
  marketData,
  marketDefinitions,
  onOpenMarket,
}: {
  marketData: Record<MarketId, ContractMarket>;
  marketDefinitions: MarketDefinition[];
  onOpenMarket: (marketId: MarketId) => void;
}) {
  return (
    <>
      <div
        className="grid gap-2 px-4 text-[8px] text-panel-text-muted uppercase tracking-[0.16em]"
        style={{ gridTemplateColumns: MARKETS_GRID_COLUMNS }}
      >
        <span>Instrument</span>
        <span>Type</span>
        <span>Expiry</span>
        <span className="text-right">Mark</span>
      </div>

      <div className="mt-2 overflow-hidden rounded-[20px] bg-input-bg/50">
        {marketDefinitions.map((marketDefinition) => (
          <button
            className="grid w-full cursor-pointer items-center gap-2 border-panel-border border-b px-4 py-3 text-left text-[11px] transition-colors last:border-b-0 hover:bg-input-hover"
            key={marketDefinition.id}
            onClick={() => onOpenMarket(marketDefinition.id)}
            style={{ gridTemplateColumns: MARKETS_GRID_COLUMNS }}
            type="button"
          >
            <span className="font-medium text-panel-text-active">
              {getInstrumentDisplayLabel(marketDefinition)}
            </span>
            <span className="text-panel-text-muted capitalize">{marketDefinition.type}</span>
            <span className="text-panel-text-muted">{marketDefinition.expiryLabel ?? "—"}</span>
            <span className="text-right text-panel-text">
              {marketData[marketDefinition.id]?.mark ?? "—"}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function SectionTable({ view }: { view: ActivityView }) {
  const gridTemplateColumns = `repeat(${view.columns.length}, minmax(0, 1fr))`;

  return (
    <>
      <div
        className="grid gap-2 px-4 text-[8px] text-panel-text-muted uppercase tracking-[0.16em]"
        style={{ gridTemplateColumns }}
      >
        {view.columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>

      <div className="mt-2 overflow-hidden rounded-[20px] bg-input-bg/50">
        {view.rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-panel-text-muted">
            Nothing here yet.
          </div>
        ) : (
          view.rows.map((row, rowIndex) => (
            <div
              className="grid min-h-10 items-center gap-2 border-panel-border border-b px-4 py-2 text-[11px] last:border-b-0"
              key={`${row.cells[0]}-${rowIndex}`}
              style={{ gridTemplateColumns }}
            >
              {row.cells.map((cell, cellIndex) => (
                <span
                  className={cn(
                    "text-panel-text",
                    cellIndex === 0 && "font-medium text-panel-text-active",
                    cell.startsWith("-") && "text-sell",
                    row.positiveCellIndexes?.includes(cellIndex) && "font-medium text-buy"
                  )}
                  key={`${cell}-${cellIndex}`}
                >
                  {cell}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function MoreLinks() {
  return (
    <div className="overflow-hidden rounded-[20px] bg-input-bg/50">
      {FOOTER_LINKS.map((link) => (
        <a
          className="flex items-center justify-between border-panel-border border-b px-4 py-3 text-[11px] text-panel-text transition-colors last:border-b-0 hover:bg-input-hover hover:text-panel-text-active"
          href={link.href}
          key={link.label}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
