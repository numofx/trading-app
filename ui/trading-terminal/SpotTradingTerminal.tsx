"use client";

import { useEffect, useState } from "react";
import type { CandleSimulationOptions } from "@/lib/candle-simulation";
import { simulateLiveCandles } from "@/lib/candle-simulation";
import { ACTIVITY_VIEWS, FOOTER_LINKS, SPOT_BOTTOM_TABS, SPOT_TIMEFRAME_OPTIONS } from "@/lib/mock-orderbook-terminal-data";
import type { Candle, ContractMarket } from "@/lib/trading.types";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotBalanceSummary } from "@/ui/trading-terminal/SpotBalanceSummary";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderFormPanel } from "@/ui/trading-terminal/SpotOrderFormPanel";
import { SpotTickerBar } from "@/ui/trading-terminal/SpotTickerBar";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { CANONICAL_SPOT_SYMBOL } from "@/lib/market-selection";
import { useMarketOrderBook } from "@/ui/trading-terminal/useMarketOrderBook";

const SPOT_SIMULATION_OPTIONS = {
  "1m": { rollChance: 0.4, timeframeScale: 0.45 },
  "30m": { rollChance: 0.3, timeframeScale: 0.8 },
  "1h": {},
  D: { rollChance: 0.18, timeframeScale: 1.8 },
  W: { rollChance: 0.12, timeframeScale: 2.6 },
  M: { rollChance: 0.08, timeframeScale: 3.2 },
} satisfies Record<SpotTimeframe, CandleSimulationOptions>;

const SPOT_UPDATE_INTERVALS_MS = {
  "1m": 900,
  "30m": 1300,
  "1h": 1700,
  D: 2400,
  W: 3000,
  M: 3600,
} satisfies Record<SpotTimeframe, number>;

function parseMarkPrice(mark: string) {
  const parsed = Number(mark.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCompactVolume(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M USDC`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K USDC`;
  }

  return `${Math.round(value).toLocaleString("en-US")} USDC`;
}

function get24hStats(candles: Candle[], lastPrice: number | null) {
  const firstCandle = candles[0];
  const lastCandle = candles.at(-1);

  if (!firstCandle || !lastCandle) {
    return { changePercent: null, high: null, low: null, volumeLabel: "—" };
  }

  const resolvedLast = lastPrice ?? lastCandle.close;
  const changePercent = firstCandle.open > 0 ? ((resolvedLast - firstCandle.open) / firstCandle.open) * 100 : null;

  return {
    changePercent,
    high: Math.max(...candles.map((candle) => candle.high), resolvedLast),
    low: Math.min(...candles.map((candle) => candle.low), resolvedLast),
    volumeLabel: formatCompactVolume(candles.reduce((sum, candle) => sum + candle.volume, 0)),
  };
}

export function SpotTradingTerminal({
  candles,
  liveSpotPrice,
  spotMarket,
  usdcBalanceLabel,
  onSubmitOrder,
  isSubmitting = false,
  lastAction = null,
}: {
  candles: Candle[];
  liveSpotPrice: number | null;
  spotMarket: ContractMarket;
  usdcBalanceLabel: string | null;
  onSubmitOrder?: (args: { side: "buy" | "sell"; price: string; size: string; orderType: "Limit" | "Market" | "Stop Limit" }) => void;
  isSubmitting?: boolean;
  lastAction?: string | null;
}) {
  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("1h");
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<string>("positions");
  const [liveCandles, setLiveCandles] = useState<Candle[]>(candles);

  useEffect(() => {
    setLiveCandles(candles);
  }, [candles]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveCandles((currentCandles) =>
        simulateLiveCandles(currentCandles, SPOT_SIMULATION_OPTIONS[timeframe])
      );
    }, SPOT_UPDATE_INTERVALS_MS[timeframe]);

    return () => window.clearInterval(intervalId);
  }, [timeframe]);

  const spotBook = useMarketOrderBook({ market: CANONICAL_SPOT_SYMBOL, type: "spot" });
  // Fall back to the simulated preview book whenever the live exchange book is
  // unavailable, one-sided, crossed, or still connecting.
  const bookBids = spotBook.isLive ? spotBook.bids : spotMarket.orderBookBids;
  const bookAsks = spotBook.isLive ? spotBook.asks : spotMarket.orderBookAsks;
  const bookTrades = spotBook.isLive && spotBook.trades.length > 0 ? spotBook.trades : spotMarket.trades;

  const lastPrice = liveSpotPrice ?? parseMarkPrice(spotMarket.mark);
  const { changePercent, high, low, volumeLabel } = get24hStats(liveCandles, lastPrice);
  const activityView = ACTIVITY_VIEWS[bottomTab as keyof typeof ACTIVITY_VIEWS] ?? { columns: [], rows: [] };

  return (
    <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
      <SpotTickerBar
        changePercent24h={changePercent}
        high24h={high}
        lastPrice={lastPrice}
        low24h={low}
        volume24hLabel={volumeLabel}
      />

      <div className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-7 xl:grid-cols-[minmax(0,1fr)_270px_320px] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
        <SpotChartPanel
          asks={spotMarket.orderBookAsks}
          bids={spotMarket.orderBookBids}
          candles={liveCandles}
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

        <SpotOrderBookPanel
          asks={bookAsks}
          bids={bookBids}
          lastPrice={lastPrice}
          liquiditySource={spotBook.isLive ? "live" : "preview"}
          liveBadgeTitle="Live spot order book depth from markets-service"
          onTabChange={setBookTab}
          tab={bookTab}
          trades={bookTrades}
        />

        <div className="flex min-h-[420px] flex-col gap-3 xl:min-h-0 xl:overflow-y-auto">
          <SpotOrderFormPanel
            availableCngnLabel="0.00 cNGN"
            availableUsdcLabel={usdcBalanceLabel ?? "— USDC"}
            isSubmitting={isSubmitting}
            lastAction={lastAction}
            markPrice={lastPrice}
            onSubmitOrder={onSubmitOrder}
          />
          <SpotBalanceSummary
            cngnBalanceLabel="0.00 cNGN"
            marginRatioPercent={0}
            usdcBalanceLabel={usdcBalanceLabel ?? "— USDC"}
          />
        </div>
      </div>

      <div className="min-h-[200px] xl:min-h-0 xl:flex-3">
        <TradingActivityPanel
          activityView={activityView}
          footerLinks={FOOTER_LINKS}
          onTabSelect={setBottomTab}
          selectedTab={bottomTab}
          tabs={SPOT_BOTTOM_TABS}
        />
      </div>
    </div>
  );
}
