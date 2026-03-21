"use client";

import { startTransition, useEffect, useState } from "react";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import {
  calculateAnnualizedBasisPercent,
  calculateBasis,
  formatAnnualizedBasis,
  formatBasis,
  formatMarketPrice,
} from "@/lib/market-formatting";
import type { CHART_CONTEXT_TABS, CHART_RANGE_BUTTONS, TIMEFRAME_OPTIONS } from "@/lib/mock-trading-data";
import type { CONTRACT_LABELS } from "@/lib/mock-trading-data";
import type { Candle, MarketDefinition, MarketId, MarketStat } from "@/lib/trading.types";
import {
  ACTIVITY_VIEWS,
  CHART_TOOLS,
  CONTRACT_TABS,
  DEFAULT_BOTTOM_TAB,
  DEFAULT_CHART_CONTEXT,
  DEFAULT_CONTRACT,
  DEFAULT_FILTER,
  DEFAULT_MARKET_ID,
  DEFAULT_ORDER_TYPE,
  DEFAULT_SYMBOL,
  DEFAULT_TIMEFRAME,
  FILTER_OPTIONS,
  MARKET_DATA,
  MARKET_DEFINITIONS,
} from "@/lib/mock-trading-data";
import { BottomTabs } from "@/ui/trading-terminal/BottomTabs";
import { ChartPanel } from "@/ui/trading-terminal/ChartPanel";
import { LiveTabTitle } from "@/ui/trading-terminal/LiveTabTitle";
import { MarketHeader } from "@/ui/trading-terminal/MarketHeader";
import { OrderBook } from "@/ui/trading-terminal/OrderBook";
import { TradePanel } from "@/ui/trading-terminal/TradePanel";

function parseNumericString(value: string) {
  return Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));
}

function getCompatibleSpotPrice(candidatePrice: number | null, referencePrice: number) {
  if (candidatePrice === null || !Number.isFinite(candidatePrice) || candidatePrice <= 0) {
    return referencePrice;
  }

  const deviation = Math.abs(candidatePrice - referencePrice) / referencePrice;

  if (deviation > 0.08) {
    return referencePrice;
  }

  return candidatePrice;
}

function shiftCandles(
  candles: (typeof MARKET_DATA)[keyof typeof MARKET_DATA]["candles"],
  targetClose: number,
) {
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

function buildActivityViews(ticker: string, positionValue: string, entryPrice: string, markPrice: string, pnl: string) {
  return {
    "open-orders": {
      ...ACTIVITY_VIEWS["open-orders"],
      rows: [{ cells: [ticker, "Buy USD", "Limit", "25,000", entryPrice] }],
    },
    positions: {
      ...ACTIVITY_VIEWS.positions,
      rows: [{ cells: [ticker, positionValue, entryPrice, markPrice, pnl], positiveCellIndexes: [4] }],
    },
    "trade-history": {
      ...ACTIVITY_VIEWS["trade-history"],
      rows: [
        { cells: ["10:08:14", ticker, "Buy USD", "50,000", markPrice] },
        { cells: ["10:08:06", ticker, "Sell USD", "35,000", entryPrice] },
      ],
    },
  };
}

function getDisplayTicker(marketDefinition: MarketDefinition, ticker: string) {
  if (marketDefinition.type === "spot") {
    return `${marketDefinition.pair} Spot`;
  }

  return ticker;
}

function getDefaultContractForMarket(marketId: string) {
  if (marketId === "cngn-usdc-spot") {
    return DEFAULT_CONTRACT;
  }

  if (marketId === "cngn-usdc-mar-2026-futures") {
    return "MAR 2026";
  }

  return DEFAULT_CONTRACT;
}

function getContractTabsForSymbol() {
  return CONTRACT_TABS.filter((tab) => tab.label === "MAR 2026" || tab.label === "JUN 2026");
}

function getMarketIdForContract(contract: SelectedContract) {
  if (contract === "MAR 2026") {
    return "cngn-usdc-mar-2026-futures";
  }

  if (contract === "JUN 2026") {
    return "cngn-usdc-jun-2026-futures";
  }

  return DEFAULT_MARKET_ID;
}

function getChartUpdateInterval(timeframe: (typeof TIMEFRAME_OPTIONS)[number]) {
  if (timeframe === "5m") {
    return 1100;
  }

  if (timeframe === "D") {
    return 2400;
  }

  return 1700;
}

function getDisplayCandles(
  chartContext: (typeof CHART_CONTEXT_TABS)[number],
  liveBasis: number,
  liveIndex: number,
  marketCandles: Candle[],
  marketType: MarketDefinition["type"],
  selectedSpotHistory: SpotHistorySnapshot | null,
) {
  if (marketType === "spot" && selectedSpotHistory?.series) {
    return selectedSpotHistory.series;
  }

  if (chartContext === "Spot") {
    return shiftCandles(marketCandles, liveIndex);
  }

  if (chartContext === "Basis") {
    return shiftCandles(marketCandles, liveBasis);
  }

  return marketCandles;
}

function getNextCandleTimeLabel(currentLabel: string) {
  if (currentLabel.includes(":")) {
    const [hoursString] = currentLabel.split(":");
    const hours = Number(hoursString);
    return `${String((hours + 1) % 24).padStart(2, "0")}:00`;
  }

  const [monthString, dayString] = currentLabel.split("-");

  if (!monthString || !dayString) {
    return currentLabel;
  }

  const nextDay = Number(dayString) + 1;
  return `${monthString}-${String(nextDay).padStart(2, "0")}`;
}

function simulateLiveCandles(
  candles: Candle[],
  timeframe: (typeof TIMEFRAME_OPTIONS)[number],
) {
  const lastCandle = candles.at(-1);

  if (!lastCandle) {
    return candles;
  }

  const precision = 2;
  let timeframeScale = 1;

  if (timeframe === "5m") {
    timeframeScale = 0.7;
  } else if (timeframe === "D") {
    timeframeScale = 1.8;
  }

  const drift = 0.28 * timeframeScale;
  const volatility = 0.42 * timeframeScale;
  const directionalBias = Math.random() > 0.5 ? drift : -drift;
  const delta = directionalBias + (Math.random() - 0.5) * volatility;
  const nextClose = Number((lastCandle.close + delta).toFixed(precision));
  const nextHigh = Number((Math.max(lastCandle.high, nextClose) + Math.random() * volatility * 0.3).toFixed(precision));
  const nextLow = Number((Math.min(lastCandle.low, nextClose) - Math.random() * volatility * 0.3).toFixed(precision));
  const nextVolume = Math.max(1, Math.round(lastCandle.volume + (Math.random() - 0.5) * lastCandle.volume * 0.18));

  const updatedCurrent = {
    ...lastCandle,
    close: nextClose,
    high: nextHigh,
    low: nextLow,
    volume: nextVolume,
  } satisfies Candle;

  let rollChance = 0.28;

  if (timeframe === "5m") {
    rollChance = 0.36;
  } else if (timeframe === "D") {
    rollChance = 0.18;
  }

  if (Math.random() < rollChance) {
    const nextOpen = nextClose;
    const seededClose = Number((nextOpen + (Math.random() - 0.5) * volatility).toFixed(precision));
    const nextCandle = {
      close: seededClose,
      high: Number((Math.max(nextOpen, seededClose) + Math.random() * volatility * 0.35).toFixed(precision)),
      low: Number((Math.min(nextOpen, seededClose) - Math.random() * volatility * 0.35).toFixed(precision)),
      open: nextOpen,
      time: getNextCandleTimeLabel(lastCandle.time),
      volume: Math.max(1, Math.round(lastCandle.volume * (0.88 + Math.random() * 0.24))),
    } satisfies Candle;

    return [...candles.slice(1, -1), updatedCurrent, nextCandle];
  }

  return [...candles.slice(0, -1), updatedCurrent];
}

function buildLiveInfoBar(
  infoBar: MarketStat[],
  marketDefinition: MarketDefinition,
  liveBasis: number | null,
  liveSpotPrice: number,
) {
  const marketPrice =
    marketDefinition.type === "spot"
      ? liveSpotPrice
      : parseNumericString(MARKET_DATA[marketDefinition.id as MarketId].mark);
  const liveAnnualizedBasis = calculateAnnualizedBasisPercent(
    marketPrice,
    liveSpotPrice,
    marketDefinition.type === "future" ? marketDefinition.expiryDays : null,
  );

  return infoBar.map((item: MarketStat) => {
    if (item.label === "Price") {
      return { ...item, value: formatMarketPrice(marketPrice) };
    }

    if (item.label === "Basis") {
      return { ...item, value: formatBasis(liveBasis) };
    }

    if (item.label === "Basis %") {
      return { ...item, value: formatAnnualizedBasis(liveAnnualizedBasis) };
    }

    return item;
  });
}

type SelectedContract = (typeof CONTRACT_LABELS)[number];

export function TradingTerminal({
  chainlinkSpot,
  spotHistory,
}: {
  chainlinkSpot: ChainlinkSpotSnapshot | null;
  spotHistory: Record<SpotHistorySnapshot["pair"], SpotHistorySnapshot> | null;
}) {
  const [selectedMarketId, setSelectedMarketId] = useState<MarketId>(DEFAULT_MARKET_ID);
  const [selectedContract, setSelectedContract] = useState<SelectedContract>(DEFAULT_CONTRACT);
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

  const selectedMarket =
    MARKET_DEFINITIONS.find((marketOption) => marketOption.id === selectedMarketId) ??
    MARKET_DEFINITIONS[0];
  const market = MARKET_DATA[selectedMarketId];
  const referenceSpotPrice = parseNumericString(MARKET_DATA["cngn-usdc-spot"].mark);
  const liveSpotPrice = getCompatibleSpotPrice(
    spotHistory?.["NGN/USD"]?.latestPrice ?? chainlinkSpot?.priceNgnPerUsd ?? null,
    referenceSpotPrice,
  );
  const selectedSpotHistory =
    selectedMarket.type === "spot"
      ? (spotHistory?.["NGN/USD"] ?? null)
      : null;
  const livePrice =
    selectedMarket.type === "spot"
      ? liveSpotPrice
      : parseNumericString(market.mark);
  const liveBasis =
    selectedMarket.type === "spot" || selectedMarket.type === "option"
      ? null
      : calculateBasis(livePrice, liveSpotPrice);
  const selectorLastByMarketId = Object.fromEntries(
    MARKET_DEFINITIONS.map((marketDefinition) => [
      marketDefinition.id,
      marketDefinition.type === "spot" ? liveSpotPrice : null,
    ]),
  ) satisfies Record<string, number | null>;
  const selectorBasisByMarketId = Object.fromEntries(
    MARKET_DEFINITIONS.map((marketDefinition) => {
      if (marketDefinition.type === "spot") {
        return [marketDefinition.id, null];
      }

      if (marketDefinition.type === "option") {
        return [marketDefinition.id, null];
      }

      const futuresPrice = parseNumericString(MARKET_DATA[marketDefinition.id as MarketId].mark);
      return [marketDefinition.id, calculateBasis(futuresPrice, liveSpotPrice)];
    }),
  ) satisfies Record<string, number | null>;
  const selectorAnnualizedBasisByMarketId = Object.fromEntries(
    MARKET_DEFINITIONS.map((marketDefinition) => {
      if (marketDefinition.type === "spot") {
        return [marketDefinition.id, null];
      }

      if (marketDefinition.type === "option") {
        return [marketDefinition.id, null];
      }

      const futuresPrice = parseNumericString(MARKET_DATA[marketDefinition.id as MarketId].mark);
      return [
        marketDefinition.id,
        calculateAnnualizedBasisPercent(futuresPrice, liveSpotPrice, marketDefinition.expiryDays),
      ];
    }),
  ) satisfies Record<string, number | null>;
  const dynamicActivityViews = buildActivityViews(
    getDisplayTicker(selectedMarket, market.ticker),
    market.positionOverview[0]?.value ?? "",
    market.positionOverview[1]?.value ?? "",
    market.positionOverview[2]?.value ?? "",
    market.positionOverview[3]?.value ?? "",
  );
  const displayCandles = getDisplayCandles(
    chartContext,
    liveBasis ?? 0,
    liveSpotPrice,
    market.candles,
    selectedMarket.type,
    selectedSpotHistory,
  );

  const liveInfoBar = buildLiveInfoBar(
    market.infoBar,
    selectedMarket,
    liveBasis,
    liveSpotPrice,
  );
  const [liveCandles, setLiveCandles] = useState<Candle[]>(displayCandles);

  useEffect(() => {
    setLiveCandles(
      getDisplayCandles(
        chartContext,
        liveBasis ?? 0,
        liveSpotPrice,
        market.candles,
        selectedMarket.type,
        selectedSpotHistory,
      ),
    );
  }, [
    chartContext,
    liveBasis,
    liveSpotPrice,
    market.candles,
    selectedContract,
    selectedMarket.type,
    selectedMarketId,
    selectedSpotHistory,
    timeframe,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveCandles((currentCandles) => simulateLiveCandles(currentCandles, timeframe));
    }, getChartUpdateInterval(timeframe));

    return () => window.clearInterval(intervalId);
  }, [selectedMarketId, timeframe, chartContext]);

  function handleContractSelect(contract: string) {
    startTransition(() => {
      const nextContract = contract as SelectedContract;
      const nextMarketId = getMarketIdForContract(nextContract);

      setSelectedContract(nextContract);
      setSelectedMarketId(nextMarketId);
      setChartContext(DEFAULT_CHART_CONTEXT);
      setLastAction(`Switched to ${DEFAULT_SYMBOL} ${contract}`);
    });
  }

  function handleMarketSelect(marketId: string) {
    const nextMarket = MARKET_DEFINITIONS.find((marketOption) => marketOption.id === marketId);

    if (!nextMarket) {
      return;
    }

    startTransition(() => {
      setSelectedMarketId(marketId as MarketId);
      if (nextMarket.contractLabel) {
        setSelectedContract(nextMarket.contractLabel as SelectedContract);
      } else {
        setSelectedContract(getDefaultContractForMarket(marketId) as SelectedContract);
      }
      setChartContext(nextMarket.type === "spot" ? "Spot" : DEFAULT_CHART_CONTEXT);
      setLastAction(`Switched to ${getDisplayTicker(nextMarket, MARKET_DATA[nextMarket.id as MarketId].ticker)}`);
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
      `${side === "buy" ? "Buy USD" : "Sell USD"} ${Number(size || "0").toLocaleString("en-US")} on ${market.ticker}`,
    );
  }

  return (
    <main className="min-h-screen bg-[#0B1118] text-[#D1D5DB] xl:h-screen xl:overflow-hidden">
      <LiveTabTitle pair={selectedMarket.pair} price={liveCandles.at(-1)?.close ?? null} />

      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col p-2 xl:h-screen xl:overflow-hidden">
        <MarketHeader
          annualizedBasisByMarketId={selectorAnnualizedBasisByMarketId}
          basisByMarketId={selectorBasisByMarketId}
          contractTabs={getContractTabsForSymbol()}
          currentContract={selectedContract}
          currentMarketId={selectedMarketId}
          currentSymbol={selectedMarket.pair}
          infoBar={liveInfoBar}
          lastByMarketId={selectorLastByMarketId}
          marketOptions={MARKET_DEFINITIONS}
          onContractSelect={handleContractSelect}
          onMarketSelect={handleMarketSelect}
        />

        <section className="mt-2 grid flex-1 grid-cols-1 gap-2 xl:min-h-0 xl:grid-cols-[minmax(0,65fr)_minmax(280px,20fr)_minmax(250px,15fr)] xl:overflow-hidden">
          <div className="min-h-[540px] xl:min-h-0 xl:overflow-hidden">
            <ChartPanel
              candles={liveCandles}
              chartContext={chartContext}
              expandedChart={expandedChart}
              indicatorsEnabled={indicatorsEnabled}
              selectedRange={selectedRange}
              selectedTimeframe={timeframe}
              selectedTool={selectedTool}
              ticker={getDisplayTicker(selectedMarket, market.ticker)}
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
              contractLabel={selectedMarket.expiryLabel ?? "Spot"}
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
              contractLabel={getDisplayTicker(selectedMarket, market.ticker)}
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
            activityView={dynamicActivityViews[selectedBottomTab]}
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
