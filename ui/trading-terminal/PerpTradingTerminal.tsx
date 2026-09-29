"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import {
  PERP_ACTIVITY_VIEWS,
  PERP_BOTTOM_TABS,
  PERP_MARKET_LABEL,
} from "@/lib/perp-terminal-config";
import { FOOTER_LINKS, SPOT_TIMEFRAME_OPTIONS } from "@/lib/spot-terminal-config";
import { get24hStats } from "@/lib/ticker-stats";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { PerpOrderFormPanel } from "@/ui/trading-terminal/PerpOrderFormPanel";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { TerminalHeaderBar } from "@/ui/trading-terminal/TerminalHeaderBar";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";

type PerpBottomTab = keyof typeof PERP_ACTIVITY_VIEWS;

const NO_24H_STATS = get24hStats(null, null);

/**
 * The USDC-cNGN perpetual terminal, laid out on the spot terminal's grid so switching markets does
 * not move the panels.
 *
 * markets-service serves no perp market, so there is no book, trade tape, candle history or account
 * activity to show: every panel renders its empty state, and the ticket cannot submit. Wire the
 * market in here — from `/v1/markets` on the server, then the book stream — once the venue lists
 * one, rather than filling these panels with anything else.
 */
export function PerpTradingTerminal() {
  const { authenticated, ready } = usePrivy();
  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("D");
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<PerpBottomTab>("positions");

  return (
    <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground transition-colors duration-300 md:h-dvh md:overflow-hidden">
      <MarketDocumentTitle pair={PERP_MARKET_LABEL} price={null} />

      <TerminalHeaderBar
        changePercent24h={NO_24H_STATS.changePercent}
        high24h={NO_24H_STATS.high}
        low24h={NO_24H_STATS.low}
        market="perp"
        onPortfolioSelect={() => setBottomTab("positions")}
        price={null}
        volume24hLabel={NO_24H_STATS.volumeLabel}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:min-h-0 md:overflow-hidden md:px-4">
        {/* The spot terminal's grid, unchanged; see SpotTradingTerminal for why it is shaped so. */}
        <div className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,3fr)] md:overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_270px_320px] lg:grid-rows-[minmax(0,7fr)_minmax(0,3fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
          <div className="md:col-start-1 md:row-start-1 md:min-h-0 md:overflow-hidden lg:row-start-1">
            <SpotChartPanel
              asks={[]}
              bids={[]}
              candles={[]}
              chartTab={chartTab}
              indicatorsEnabled={indicatorsEnabled}
              onChartTabChange={setChartTab}
              onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
              onTimeframeChange={setTimeframe}
              onToolSelect={setSelectedTool}
              selectedTimeframe={timeframe}
              selectedTool={selectedTool}
              timeframes={SPOT_TIMEFRAME_OPTIONS}
            />
          </div>

          <div className="md:col-start-1 md:row-start-2 md:min-h-0 md:overflow-hidden lg:col-start-2 lg:row-start-1">
            <SpotOrderBookPanel
              asks={[]}
              bids={[]}
              lastPrice={null}
              onTabChange={setBookTab}
              tab={bookTab}
              trades={[]}
            />
          </div>

          <div className="order-first flex min-h-[420px] flex-col gap-3 md:order-0 md:col-start-2 md:row-span-3 md:row-start-1 md:min-h-0 md:gap-2 md:overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
            <PerpOrderFormPanel />
          </div>

          <div className="min-h-[200px] md:col-start-1 md:row-start-3 md:min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <TradingActivityPanel
              activityView={PERP_ACTIVITY_VIEWS[bottomTab]}
              emptyState={{
                body: "Perp trading isn't live yet.",
                title: bottomTab === "positions" ? "No positions" : "No orders",
              }}
              footerLinks={FOOTER_LINKS}
              isSignedIn={ready && authenticated}
              onTabSelect={(tab) => setBottomTab(tab as PerpBottomTab)}
              selectedTab={bottomTab}
              tabs={PERP_BOTTOM_TABS}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
