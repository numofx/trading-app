"use client";

import { Duration } from "effect";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { formatOverviewVolume } from "@/lib/market-overview";
import type { MarketOverviewRow, TerminalMarketId } from "@/lib/market-overview.types";
import { marketIdForSlug } from "@/lib/market-routes";
import { buildPerpOverviewMetrics } from "@/lib/perp-market";
import { TerminalHeaderBar } from "@/ui/trading-terminal/TerminalHeaderBar";
import type { TerminalHeaderPublication } from "@/ui/trading-terminal/TerminalHeaderSlot";
import {
  TerminalHeaderSlotProvider,
  useTerminalHeaderPublication,
} from "@/ui/trading-terminal/TerminalHeaderSlot";
import { TerminalSessionProvider } from "@/ui/trading-terminal/TerminalSession";
import { loadOverview, useCachedOverviewRow } from "@/ui/trading-terminal/useMarketOverview";

/**
 * The part of the terminal that outlives a market switch: the frame, the header (branding, the
 * market selector, the wallet button) and the session behind them. Rendered by the `/trade`
 * layout, above the `[market]` segment, so Next keeps it mounted while the market's panels under
 * it are swapped; a layout inside the segment would remount with the slug.
 *
 * `market` is read from the segment. A fixture rendered outside `/trade` names it instead.
 */
export function TerminalShell({
  children,
  market: marketOverride,
}: {
  children: ReactNode;
  market?: TerminalMarketId;
}) {
  const segment = useSelectedLayoutSegment();
  const market = marketOverride ?? marketIdForSlug(segment) ?? "spot";

  return (
    <TerminalHeaderSlotProvider>
      <TerminalSessionProvider>
        <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground transition-colors duration-300 md:h-dvh md:overflow-hidden">
          <ShellHeader market={market} />
          {children}
        </main>
      </TerminalSessionProvider>
    </TerminalHeaderSlotProvider>
  );
}

/** How old a selector read may be and still seed the header; a switch's own read is seconds old. */
const OVERVIEW_SEED_MAX_AGE_MS = Duration.toMillis("2 minutes");
/**
 * How long the header waits unpublished before reading the overview itself (a back-button
 * navigation, a read too old to seed from). On a fresh page load the panels publish in the
 * commit right after hydration, well inside this, so the load never fires a read of its own.
 */
const SEED_READ_DELAY_MS = Duration.toMillis("50 millis");

/**
 * The header's figures for a market whose panels have not published yet, from the selector's last
 * read of the venue: the price and change it showed on the row that was just clicked, the volume,
 * and the perp's own figures. No Deposit or Withdraw: those are the mounted panel's alone. Null
 * without a recent read, or one that carried no price, and the header shows its skeleton.
 */
function seedFromOverview(
  market: TerminalMarketId,
  row: MarketOverviewRow | null
): TerminalHeaderPublication | null {
  if (row === null || row.price === null) {
    return null;
  }
  return {
    changePercent24h: row.changePercent24h,
    high24h: null,
    low24h: null,
    market,
    metrics: market === "perp" ? buildPerpOverviewMetrics(row) : undefined,
    price: row.price,
    seeded: true,
    volume24hLabel: formatOverviewVolume(row.volume24hUsd),
  };
}

/**
 * Its own component so a publication re-renders the header alone. The figures shown are only
 * ever the selected market's: another market's publication (its panels still unmounting, or a
 * stale one) reads as "not published yet", and the header shows the selector's figures for the
 * selected market, or its skeleton, until the panels publish the live set.
 */
function ShellHeader({ market }: { market: TerminalMarketId }) {
  const publication = useTerminalHeaderPublication();
  const live = publication?.market === market ? publication : null;
  const cachedRow = useCachedOverviewRow(market, OVERVIEW_SEED_MAX_AGE_MS);
  const unpublished = live === null;

  useEffect(() => {
    if (!unpublished) {
      return;
    }
    const timer = window.setTimeout(() => void loadOverview(), SEED_READ_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [unpublished]);

  return (
    <TerminalHeaderBar market={market} publication={live ?? seedFromOverview(market, cachedRow)} />
  );
}
