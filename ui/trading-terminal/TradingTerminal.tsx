"use client";

import { startTransition, useState } from "react";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import type { CHART_CONTEXT_TABS, CHART_RANGE_BUTTONS, TIMEFRAME_OPTIONS } from "@/lib/mock-trading-data";
import {
  ACTIVITY_VIEWS,
  CHART_TOOLS,
  CONTRACT_MARKETS,
  CONTRACT_TABS,
  DEFAULT_BOTTOM_TAB,
  DEFAULT_CHART_CONTEXT,
  DEFAULT_CONTRACT,
  DEFAULT_FILTER,
  DEFAULT_ORDER_TYPE,
  DEFAULT_TIMEFRAME,
  FILTER_OPTIONS,
} from "@/lib/mock-trading-data";
import { BottomTabs } from "@/ui/trading-terminal/BottomTabs";
import { ChartPanel } from "@/ui/trading-terminal/ChartPanel";
import { MarketHeader } from "@/ui/trading-terminal/MarketHeader";
import { OrderBook } from "@/ui/trading-terminal/OrderBook";
import { TradePanel } from "@/ui/trading-terminal/TradePanel";

function formatPrice(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function parseNumericString(value: string) {
  return Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));
}

function shiftCandles(candles: typeof CONTRACT_MARKETS[keyof typeof CONTRACT_MARKETS]["candles"], targetClose: number) {
  const currentClose = candles.at(-1)?.close ?? targetClose;
  const delta = targetClose - currentClose;

  return candles.map((candle) => ({
    ...candle,
    close: Number((candle.close + delta).toFixed(2)),
    high: Number((candle.high + delta).toFixed(2)),
    low: Number((candle.low + delta).toFixed(2)),
    open: Number((candle.open + delta).toFixed(2)),
  }));
}

export function TradingTerminal({ chainlinkSpot }: { chainlinkSpot: ChainlinkSpotSnapshot | null }) {
  const [selectedContract, setSelectedContract] =
    useState<keyof typeof CONTRACT_MARKETS>(DEFAULT_CONTRACT);
  const [favorite, setFavorite] = useState(true);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAME_OPTIONS)[number]>(DEFAULT_TIMEFRAME);
  const [chartContext, setChartContext] = useState<(typeof CHART_CONTEXT_TABS)[number]>(
    DEFAULT_CHART_CONTEXT,
  );
  const [selectedRange, setSelectedRange] =
    useState<(typeof CHART_RANGE_BUTTONS)[number]>("1d");
  const [selectedTool, setSelectedTool] = useState(CHART_TOOLS[0]?.id ?? "crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [expandedChart, setExpandedChart] = useState(false);
  const [orderBookView, setOrderBookView] = useState<"Order Book" | "Trades">("Order Book");
  const [orderType, setOrderType] = useState<"Limit" | "Market" | "Stop">(DEFAULT_ORDER_TYPE);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [size, setSize] = useState("50000");
  const [allocation, setAllocation] = useState(20);
  const [postOnly, setPostOnly] = useState(false);
  const [atExpiryDeliver, setAtExpiryDeliver] = useState(true);
  const [selectedBottomTab, setSelectedBottomTab] =
    useState<keyof typeof ACTIVITY_VIEWS>(DEFAULT_BOTTOM_TAB);
  const [filter, setFilter] = useState<(typeof FILTER_OPTIONS)[number]>(DEFAULT_FILTER);
  const [lastAction, setLastAction] = useState("Ready");

  const market = CONTRACT_MARKETS[selectedContract];
  const liveIndex = chainlinkSpot?.priceNgnPerUsd ?? parseNumericString(market.index);
  const liveMark = parseNumericString(market.mark);
  const liveBasis = liveMark - liveIndex;
  let displayCandles = market.candles;

  if (chartContext === "Spot") {
    displayCandles = shiftCandles(market.candles, liveIndex);
  } else if (chartContext === "Basis") {
    displayCandles = shiftCandles(market.candles, liveBasis);
  }

  const liveInfoBar = market.infoBar.map((item) => {
    if (item.label === "Index") {
      return { ...item, value: formatPrice(liveIndex, 2) };
    }

    if (item.label === "Basis") {
      return { ...item, value: `${liveBasis >= 0 ? "+" : ""}${formatPrice(liveBasis, 2)}` };
    }

    return item;
  });

  function handleContractSelect(contract: string) {
    startTransition(() => {
      setSelectedContract(contract as keyof typeof CONTRACT_MARKETS);
      setLastAction(`Switched to ${contract}`);
    });
  }

  function handleFilterCycle() {
    const currentIndex = FILTER_OPTIONS.indexOf(filter);
    const next = FILTER_OPTIONS[(currentIndex + 1) % FILTER_OPTIONS.length];
    setFilter(next);
  }

  function handleSubmit(side: "buy" | "sell") {
    setTradeSide(side);
    setLastAction(
      `${side === "buy" ? "Buy USD" : "Sell USD"} ${Number(size || "0").toLocaleString("en-US")} on ${selectedContract}`,
    );
  }

  return (
    <main className="min-h-screen bg-[#0B1118] text-[#D1D5DB] xl:h-screen xl:overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col p-2 xl:h-screen xl:overflow-hidden">
        <MarketHeader
          contractTabs={CONTRACT_TABS}
          currentContract={selectedContract}
          favorite={favorite}
          infoBar={liveInfoBar}
          onContractSelect={handleContractSelect}
          onFavoriteToggle={() => setFavorite((current) => !current)}
        />

        <section className="mt-2 grid flex-1 grid-cols-1 gap-2 xl:min-h-0 xl:grid-cols-[minmax(0,65fr)_minmax(280px,20fr)_minmax(250px,15fr)] xl:overflow-hidden">
          <div className="min-h-[540px] xl:min-h-0 xl:overflow-hidden">
            <ChartPanel
              candles={displayCandles}
              chartContext={chartContext}
              expandedChart={expandedChart}
              indicatorsEnabled={indicatorsEnabled}
              selectedRange={selectedRange}
              selectedTimeframe={timeframe}
              selectedTool={selectedTool}
              ticker={market.ticker}
              onChartContextChange={setChartContext}
              onExpandedToggle={() => setExpandedChart((current) => !current)}
              onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
              onRangeChange={setSelectedRange}
              onTimeframeChange={setTimeframe}
              onToolSelect={setSelectedTool}
            />
          </div>

          <div className="min-h-[420px] xl:min-h-0 xl:overflow-hidden">
            <OrderBook
              asks={market.orderBookAsks}
              bids={market.orderBookBids}
              contractLabel={selectedContract.replace(" ", " ").replace("2026", "26")}
              trades={market.trades}
              view={orderBookView}
              onViewChange={setOrderBookView}
            />
          </div>

          <div className="min-h-[420px] xl:min-h-0 xl:overflow-hidden">
            <TradePanel
              allocation={allocation}
              atExpiryDeliver={atExpiryDeliver}
              contractDetails={market.contractDetails}
              contractLabel={market.ticker}
              lastAction={lastAction}
              orderType={orderType}
              positionOverview={market.positionOverview}
              postOnly={postOnly}
              size={size}
              tradeSide={tradeSide}
              onAllocationChange={setAllocation}
              onAtExpiryDeliverToggle={() => setAtExpiryDeliver((current) => !current)}
              onOrderTypeChange={setOrderType}
              onPostOnlyToggle={() => setPostOnly((current) => !current)}
              onSideChange={setTradeSide}
              onSizeChange={setSize}
              onSubmit={handleSubmit}
            />
          </div>
        </section>

        <div className="mt-2 xl:shrink-0">
          <BottomTabs
            activityView={ACTIVITY_VIEWS[selectedBottomTab]}
            filter={filter}
            footerLinks={[]}
            selectedTab={selectedBottomTab}
            tabs={[
              { id: "positions", label: "Positions" },
              { id: "open-orders", label: "Open Orders" },
              { id: "trade-history", label: "Trade History" },
            ]}
            onFilterClick={handleFilterCycle}
            onTabSelect={(tabId) => setSelectedBottomTab(tabId as keyof typeof ACTIVITY_VIEWS)}
          />
        </div>
      </div>
    </main>
  );
}
