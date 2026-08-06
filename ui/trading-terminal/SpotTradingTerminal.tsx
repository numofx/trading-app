"use client";

import { useEffect, useState } from "react";
import { buildAssetsActivityView } from "@/lib/account-activity-views";
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
  cngnBalanceLabel = null,
  accountUsdcLabel = null,
  accountCngnLabel = null,
  onSubmitOrder,
  isSignedIn = false,
  isSubmitting = false,
  lastAction = null,
}: {
  candles: Candle[];
  liveSpotPrice: number | null;
  spotMarket: ContractMarket;
  /** Wallet USDC balance — what's available to deposit. */
  usdcBalanceLabel: string | null;
  /** Wallet cNGN balance, or null when the cNGN token address isn't configured for this chain. */
  cngnBalanceLabel?: string | null;
  /** Subaccount USDC cash balance — what's held in the trading account. */
  accountUsdcLabel?: string | null;
  /** Subaccount cNGN balance. */
  accountCngnLabel?: string | null;
  onSubmitOrder?: (args: { side: "buy" | "sell"; price: string; size: string; orderType: "Limit" | "Market" | "Stop Limit" }) => void;
  /** Whether a wallet session is active; gates account-scoped rows in the activity panel. */
  isSignedIn?: boolean;
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

  // No simulated ticking: candles are real venue OHLCV.

  const spotBook = useMarketOrderBook({ market: CANONICAL_SPOT_SYMBOL, type: "spot" });
  // Fall back to the simulated preview book whenever the live exchange book is
  // unavailable, one-sided, crossed, or still connecting.
  const bookBids = spotBook.isLive ? spotBook.bids : spotMarket.orderBookBids;
  const bookAsks = spotBook.isLive ? spotBook.asks : spotMarket.orderBookAsks;
  const bookTrades = spotBook.isLive && spotBook.trades.length > 0 ? spotBook.trades : spotMarket.trades;

  const lastPrice = liveSpotPrice ?? parseMarkPrice(spotMarket.mark);
  const { changePercent, high, low, volumeLabel } = get24hStats(liveCandles, lastPrice);
  // Assets is the one bottom tab with a real data source today, so it's built from live balances
  // instead of the placeholder-free static views.
  const activityView =
    bottomTab === "assets"
      ? buildAssetsActivityView({
          accountCngnLabel,
          accountUsdcLabel,
          walletCngnLabel: cngnBalanceLabel,
          walletUsdcLabel: usdcBalanceLabel,
        })
      : (ACTIVITY_VIEWS[bottomTab as keyof typeof ACTIVITY_VIEWS] ?? { columns: [], rows: [] });

  return (
    <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
      <SpotTickerBar
        changePercent24h={changePercent}
        high24h={high}
        lastPrice={lastPrice}
        low24h={low}
        volume24hLabel={volumeLabel}
      />

      <div className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-8 xl:grid-cols-[minmax(0,1fr)_270px_320px] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
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
          onTabChange={setBookTab}
          tab={bookTab}
          trades={bookTrades}
        />

        <div className="flex min-h-[420px] flex-col gap-3 xl:min-h-0 xl:overflow-hidden">
          <SpotOrderFormPanel
            availableCngnLabel="0.00 cNGN"
            availableUsdcLabel={usdcBalanceLabel ?? "— USDC"}
            isSubmitting={isSubmitting}
            lastAction={lastAction}
            markPrice={lastPrice}
            onSubmitOrder={onSubmitOrder}
          />
          <SpotBalanceSummary
            cngnBalanceLabel={accountCngnLabel ?? "0.00 cNGN"}
            marginRatioPercent={0}
            usdcBalanceLabel={accountUsdcLabel ?? "— USDC"}
          />
        </div>
      </div>

      <div className="min-h-[200px] xl:min-h-0 xl:flex-2">
        <TradingActivityPanel
          activityView={activityView}
          footerLinks={FOOTER_LINKS}
          isSignedIn={isSignedIn}
          onTabSelect={setBottomTab}
          selectedTab={bottomTab}
          tabs={SPOT_BOTTOM_TABS}
        />
      </div>
    </div>
  );
}
