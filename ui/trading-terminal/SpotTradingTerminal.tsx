"use client";

import { useEffect, useState } from "react";
import { buildAssetsActivityView } from "@/lib/account-activity-views";
import { CANONICAL_SPOT_SYMBOL } from "@/lib/market-selection";
import {
  ACTIVITY_VIEWS,
  FOOTER_LINKS,
  SPOT_BOTTOM_TABS,
  SPOT_TIMEFRAME_OPTIONS,
} from "@/lib/mock-orderbook-terminal-data";
import { get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { Candle, ContractMarket } from "@/lib/trading.types";
import { SpotBalanceSummary } from "@/ui/trading-terminal/SpotBalanceSummary";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderFormPanel } from "@/ui/trading-terminal/SpotOrderFormPanel";
import { SpotTickerBar } from "@/ui/trading-terminal/SpotTickerBar";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useMarketOrderBook } from "@/ui/trading-terminal/useMarketOrderBook";

function parseMarkPrice(mark: string) {
  const parsed = Number(mark.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function SpotTradingTerminal({
  candles,
  spotMarket,
  usdcBalanceLabel,
  cngnBalanceLabel = null,
  accountUsdcLabel = null,
  accountCngnLabel = null,
  onSubmitOrder,
  isSignedIn = false,
  isPreparingAccount = false,
  isSubmitting = false,
  lastAction = null,
}: {
  candles: Candle[];
  spotMarket: ContractMarket;
  /** Wallet USDC balance — what's available to deposit. */
  usdcBalanceLabel: string | null;
  /** Wallet cNGN balance, or null when the cNGN token address isn't configured for this chain. */
  cngnBalanceLabel?: string | null;
  /** Subaccount USDC cash balance — what's held in the trading account. */
  accountUsdcLabel?: string | null;
  /** Subaccount cNGN balance. */
  accountCngnLabel?: string | null;
  onSubmitOrder?: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market" | "Stop Limit";
  }) => void;
  /** Whether a wallet session is active; gates account-scoped rows in the activity panel. */
  isSignedIn?: boolean;
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
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

  const spotBook = useMarketOrderBook({
    market: CANONICAL_SPOT_SYMBOL,
    orderEntrySpec: spotMarket.orderEntrySpec,
    type: "spot",
  });
  // Fall back to the simulated preview book whenever the live exchange book is
  // unavailable, one-sided, crossed, or still connecting.
  const bookBids = spotBook.isLive ? spotBook.bids : spotMarket.orderBookBids;
  const bookAsks = spotBook.isLive ? spotBook.asks : spotMarket.orderBookAsks;
  const bookTrades =
    spotBook.isLive && spotBook.trades.length > 0 ? spotBook.trades : spotMarket.trades;

  const lastPrice = getVenueLastPrice(bookTrades, liveCandles, parseMarkPrice(spotMarket.mark));
  const { changePercent, volumeLabel } = get24hStats(liveCandles, lastPrice, Date.now());
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
        lastPrice={lastPrice}
        volume24hLabel={volumeLabel}
      />

      <div className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-8 xl:grid-cols-[minmax(0,1fr)_270px_320px] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
        <SpotChartPanel
          asks={bookAsks}
          bids={bookBids}
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

        {/*
         * `order-first` on phones only: in the stacked single column the ticket would sit
         * below the chart and order book, putting the submit button ~2.5 screens down the
         * document. The xl grid places columns explicitly, so order resets there.
         */}
        <div className="order-first flex min-h-[420px] flex-col gap-3 xl:order-0 xl:min-h-0 xl:overflow-hidden">
          <SpotOrderFormPanel
            availableCngnLabel="0.00 cNGN"
            availableUsdcLabel={usdcBalanceLabel ?? "— USDC"}
            isPreparingAccount={isPreparingAccount}
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
