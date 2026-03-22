"use client";

import { startTransition, useEffect, useState } from "react";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import {
  formatFxDisplayPair,
  getInstrumentDisplayLabel,
  getProductDisplayName,
} from "@/lib/market-display";
import {
  calculateAnnualizedBasisPercent,
  calculateBasis,
  formatAnnualizedBasis,
  formatBasis,
  formatMarketPrice,
} from "@/lib/market-formatting";
import type { CHART_CONTEXT_TABS, CHART_RANGE_BUTTONS, TIMEFRAME_OPTIONS } from "@/lib/mock-orderbook-terminal-data";
import type { CONTRACT_LABELS } from "@/lib/mock-orderbook-terminal-data";
import type { Candle, MarketDefinition, MarketId, MarketStat } from "@/lib/trading.types";
import {
  ACTIVITY_VIEWS,
  CHART_TOOLS,
  CONTRACT_TABS,
  DEFAULT_BOTTOM_TAB,
  DEFAULT_CHART_CONTEXT,
  DEFAULT_CONTRACT,
  DEFAULT_MARKET_ID,
  DEFAULT_ORDER_TYPE,
  DEFAULT_SYMBOL,
  DEFAULT_TIMEFRAME,
  MARKET_DATA,
  MARKET_DEFINITIONS,
} from "@/lib/mock-orderbook-terminal-data";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { OrderBookPanel } from "@/ui/trading-terminal/OrderBookPanel";
import { OrderEntryPanel } from "@/ui/trading-terminal/OrderEntryPanel";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { TradingChartPanel } from "@/ui/trading-terminal/TradingChartPanel";
import { TradingMarketHeader } from "@/ui/trading-terminal/TradingMarketHeader";

function parseNumericString(value: string) {
  return Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));
}

function formatPriceDisplay(value: number | string) {
  const numericValue = typeof value === "number" ? value : parseNumericString(value);
  return `${formatMarketPrice(numericValue)} cNGN per USDC`;
}

function getDirectionalLabel(side: "buy" | "sell") {
  return side === "buy" ? "Long cNGN" : "Short cNGN";
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

function buildActivityViews(
  ticker: string,
  positionValue: string,
  entryPrice: string,
  markPrice: string,
  pnl: string,
  returnValue: string,
) {
  return {
    "open-orders": {
      ...ACTIVITY_VIEWS["open-orders"],
      rows: [{ cells: [ticker, "Long cNGN", "Limit", "25,000 contracts", entryPrice] }],
    },
    positions: {
      ...ACTIVITY_VIEWS.positions,
      rows: [{ cells: [ticker, positionValue, entryPrice, markPrice, pnl, returnValue], positiveCellIndexes: [4, 5] }],
    },
    "trade-history": {
      ...ACTIVITY_VIEWS["trade-history"],
      rows: [
        { cells: ["10:08:14", ticker, "Long cNGN", "50,000 contracts", markPrice] },
        { cells: ["10:08:06", ticker, "Short cNGN", "35,000 contracts", entryPrice] },
      ],
    },
  };
}

function getDisplayTicker(marketDefinition: MarketDefinition) {
  return getInstrumentDisplayLabel(marketDefinition);
}

function getDefaultContractForMarket(market: MarketDefinition) {
  if (market.contractLabel) {
    return market.contractLabel;
  }

  return DEFAULT_CONTRACT;
}

function getContractTabsForProduct(type: MarketDefinition["type"]) {
  if (type === "future" || type === "option") {
    return CONTRACT_TABS;
  }

  return [];
}

function getMarketIdForSelection(type: MarketDefinition["type"], contract: SelectedContract) {
  if (type === "option") {
    return contract === "MAR 2026" ? "cngn-usdc-mar-2026-options" : "cngn-usdc-jun-2026-options";
  }

  if (type === "future") {
    return contract === "MAR 2026" ? "cngn-usdc-mar-2026-futures" : "cngn-usdc-jun-2026-futures";
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
  const liveBasisPercent =
    marketDefinition.type === "future" && liveBasis !== null && liveSpotPrice > 0
      ? (liveBasis / liveSpotPrice) * 100
      : null;

  return infoBar.map((item: MarketStat) => {
    if (item.label === "Mark Price") {
      return { ...item, value: formatPriceDisplay(marketPrice) };
    }

    if (item.label === "Spot") {
      return { ...item, value: formatPriceDisplay(liveSpotPrice) };
    }

    if (item.label === "Basis") {
      return { ...item, value: formatBasis(liveBasis) };
    }

    if (item.label === "Basis %") {
      return { ...item, value: liveBasisPercent === null ? "—" : `${liveBasisPercent.toFixed(2)}%` };
    }

    if (item.label === "Implied Carry") {
      return { ...item, value: formatAnnualizedBasis(liveAnnualizedBasis) };
    }

    return item;
  });
}

function buildSelectorMetrics(liveSpotPrice: number) {
  const spotChangeByMarketId = {
    "cngn-usdc-jun-2026-futures": null,
    "cngn-usdc-jun-2026-options": null,
    "cngn-usdc-mar-2026-futures": null,
    "cngn-usdc-mar-2026-options": null,
    "cngn-usdc-spot": "+0.18%",
  } satisfies Record<string, string | null>;
  const optionAtmIvByMarketId = {
    "cngn-usdc-jun-2026-futures": null,
    "cngn-usdc-jun-2026-options": "61.8%",
    "cngn-usdc-mar-2026-futures": null,
    "cngn-usdc-mar-2026-options": "54.2%",
    "cngn-usdc-spot": null,
  } satisfies Record<string, string | null>;
  const optionOpenInterestByMarketId = {
    "cngn-usdc-jun-2026-futures": null,
    "cngn-usdc-jun-2026-options": "$3.1M",
    "cngn-usdc-mar-2026-futures": null,
    "cngn-usdc-mar-2026-options": "$1.4M",
    "cngn-usdc-spot": null,
  } satisfies Record<string, string | null>;
  const selectorLastByMarketId = Object.fromEntries(
    MARKET_DEFINITIONS.map((marketDefinition) => [
      marketDefinition.id,
      marketDefinition.type === "spot" || marketDefinition.type === "future"
        ? parseNumericString(MARKET_DATA[marketDefinition.id as MarketId].mark)
        : null,
    ]),
  ) satisfies Record<string, number | null>;
  const selectorBasisByMarketId = Object.fromEntries(
    MARKET_DEFINITIONS.map((marketDefinition) => {
      if (marketDefinition.type !== "future") {
        return [marketDefinition.id, null];
      }

      const futuresPrice = parseNumericString(MARKET_DATA[marketDefinition.id as MarketId].mark);
      return [marketDefinition.id, calculateBasis(futuresPrice, liveSpotPrice)];
    }),
  ) satisfies Record<string, number | null>;
  const selectorAnnualizedBasisByMarketId = Object.fromEntries(
    MARKET_DEFINITIONS.map((marketDefinition) => {
      if (marketDefinition.type !== "future") {
        return [marketDefinition.id, null];
      }

      const futuresPrice = parseNumericString(MARKET_DATA[marketDefinition.id as MarketId].mark);
      return [
        marketDefinition.id,
        calculateAnnualizedBasisPercent(futuresPrice, liveSpotPrice, marketDefinition.expiryDays),
      ];
    }),
  ) satisfies Record<string, number | null>;

  return {
    optionAtmIvByMarketId,
    optionOpenInterestByMarketId,
    selectorAnnualizedBasisByMarketId,
    selectorBasisByMarketId,
    selectorLastByMarketId,
    spotChangeByMarketId,
  };
}

function getPositionMetrics(marketId: MarketId, livePrice: number) {
  const activePosition = MARKET_DATA[marketId].positionOverview;

  return {
    entryPrice: activePosition.find((item) => item.label === "Entry Price")?.value ?? "—",
    markPrice: activePosition.find((item) => item.label === "Mark Price")?.value ?? formatPriceDisplay(livePrice),
    pnl: activePosition.find((item) => item.label === "Unrealized PnL")?.value ?? "—",
    positionOverview: activePosition,
    positionValue: activePosition.find((item) => item.label === "Position")?.value ?? "—",
    returnPercent: activePosition.find((item) => item.label === "Return %")?.value ?? "—",
  };
}

function getOrderMetrics(
  limitPrice: string,
  marketMark: string,
  orderType: "Limit" | "Market" | "Stop",
  size: string,
  livePrice: number,
  tradeSide: "buy" | "sell",
) {
  const sizeNumber = Number(size || "0");
  const limitPriceNumber = parseNumericString(limitPrice || marketMark);
  const orderValue = sizeNumber * limitPriceNumber;
  const estimatedFill = orderType === "Market" ? livePrice + (tradeSide === "buy" ? 0.12 : -0.12) : limitPriceNumber;
  const averageExecution = orderType === "Market" ? estimatedFill + (tradeSide === "buy" ? 0.05 : -0.05) : limitPriceNumber;

  return {
    averageExecution,
    estimatedFill,
    fees: orderValue * 0.0002,
    initialMargin: orderValue * 0.05,
    liquidationPrice: tradeSide === "buy" ? limitPriceNumber - 62.4 : limitPriceNumber + 62.4,
    orderValue,
  };
}

type SelectedContract = (typeof CONTRACT_LABELS)[number];

export function OrderBookTradingTerminal({
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
  const [limitPrice, setLimitPrice] = useState("1605.25");
  const [allocation, setAllocation] = useState(20);
  const [postOnly, setPostOnly] = useState(false);
  const [atExpiryDeliver, setAtExpiryDeliver] = useState(true);
  const [selectedBottomTab, setSelectedBottomTab] =
    useState<keyof typeof ACTIVITY_VIEWS>(DEFAULT_BOTTOM_TAB);
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
  const {
    optionAtmIvByMarketId,
    optionOpenInterestByMarketId,
    selectorAnnualizedBasisByMarketId,
    selectorBasisByMarketId,
    selectorLastByMarketId,
    spotChangeByMarketId,
  } = buildSelectorMetrics(liveSpotPrice);
  const dynamicActivityViews = buildActivityViews(
    getDisplayTicker(selectedMarket),
    market.positionOverview[0]?.value ?? "",
    market.positionOverview[1]?.value ?? "",
    market.positionOverview[2]?.value ?? "",
    market.positionOverview[3]?.value ?? "",
    market.positionOverview[4]?.value ?? "",
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
  const { entryPrice, markPrice, pnl: unrealizedPnl, positionOverview, positionValue, returnPercent } =
    getPositionMetrics(selectedMarketId, livePrice);
  const { averageExecution, estimatedFill, fees, initialMargin, liquidationPrice, orderValue } = getOrderMetrics(
    limitPrice,
    market.mark,
    orderType,
    size,
    livePrice,
    tradeSide,
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
      const nextMarketId = getMarketIdForSelection(selectedMarket.type, nextContract);

      setSelectedContract(nextContract);
      setSelectedMarketId(nextMarketId);
      setChartContext(DEFAULT_CHART_CONTEXT);
      setLimitPrice(MARKET_DATA[nextMarketId].mark.replaceAll(",", ""));
      setLastAction(`Switched to ${formatFxDisplayPair(DEFAULT_SYMBOL)} ${getProductDisplayName(selectedMarket.type)} ${contract}`);
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
        setSelectedContract(getDefaultContractForMarket(nextMarket) as SelectedContract);
      }
      setChartContext(nextMarket.type === "spot" ? "Spot" : DEFAULT_CHART_CONTEXT);
      setLimitPrice(MARKET_DATA[marketId as MarketId].mark.replaceAll(",", ""));
      setLastAction(`Switched to ${getDisplayTicker(nextMarket)}`);
    });
  }

  function handleSubmit(side: "buy" | "sell") {
    setTradeSide(side);
    setLastAction(
      `${getDirectionalLabel(side)} ${Number(size || "0").toLocaleString("en-US")} contracts on ${market.ticker}`,
    );
  }

  return (
    <main className="min-h-screen bg-transparent text-[#D7DEE8] xl:h-[100dvh] xl:overflow-hidden">
      <MarketDocumentTitle pair={formatFxDisplayPair(selectedMarket.pair)} price={liveCandles.at(-1)?.close ?? null} />

      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col px-2.5 py-3 xl:h-[100dvh] xl:overflow-hidden xl:px-4">
        <TradingMarketHeader
          atmIvByMarketId={optionAtmIvByMarketId}
          annualizedBasisByMarketId={selectorAnnualizedBasisByMarketId}
          basisByMarketId={selectorBasisByMarketId}
          contractTabs={getContractTabsForProduct(selectedMarket.type)}
          currentContract={selectedContract}
          currentMarketId={selectedMarketId}
          infoBar={liveInfoBar}
          lastByMarketId={selectorLastByMarketId}
          marketOptions={MARKET_DEFINITIONS}
          openInterestByMarketId={optionOpenInterestByMarketId}
          onContractSelect={handleContractSelect}
          onMarketSelect={handleMarketSelect}
          selectedMarket={selectedMarket}
          spotChangeByMarketId={spotChangeByMarketId}
        />

        <section className="mt-3 grid grid-cols-1 gap-3 xl:h-[500px] xl:flex-none xl:min-h-0 xl:grid-cols-[minmax(0,1.9fr)_minmax(270px,0.72fr)_minmax(320px,0.86fr)] xl:overflow-hidden 2xl:h-[560px] 2xl:grid-cols-[minmax(0,1.95fr)_minmax(290px,0.76fr)_minmax(340px,0.9fr)]">
          <div className="min-h-[340px] xl:min-h-0 xl:overflow-hidden">
            <TradingChartPanel
              candles={liveCandles}
              chartContext={chartContext}
              entryPrice={entryPrice}
              expandedChart={expandedChart}
              indicatorsEnabled={indicatorsEnabled}
              markPrice={markPrice}
              selectedRange={selectedRange}
              selectedTimeframe={timeframe}
              selectedTool={selectedTool}
              ticker={getDisplayTicker(selectedMarket)}
              onChartContextChange={setChartContext}
              onExpandedToggle={() => setExpandedChart((current) => !current)}
              onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
              onRangeChange={setSelectedRange}
              onTimeframeChange={setTimeframe}
              onToolSelect={setSelectedTool}
            />
          </div>

          <div className="min-h-[320px] xl:min-h-0 xl:overflow-hidden">
            <OrderBookPanel
              asks={market.orderBookAsks}
              bids={market.orderBookBids}
              contractLabel={selectedMarket.expiryLabel ?? "Spot"}
              trades={market.trades}
              view={orderBookView}
              onViewChange={setOrderBookView}
            />
          </div>

          <div className="min-h-[320px] xl:min-h-0 xl:overflow-hidden">
            <OrderEntryPanel
              allocation={allocation}
              atExpiryDeliver={atExpiryDeliver}
              buyingPower="$250,000"
              contractDetails={market.contractDetails}
              contractLabel={getDisplayTicker(selectedMarket)}
              estimatedAverageExecution={formatPriceDisplay(averageExecution)}
              estimatedFillPrice={formatPriceDisplay(estimatedFill)}
              fees={`$${fees.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              initialMargin={`$${initialMargin.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              lastAction={lastAction}
              limitPrice={limitPrice}
              liquidationPrice={formatPriceDisplay(liquidationPrice)}
              orderValue={`${orderValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} cNGN`}
              orderType={orderType}
              pnl={unrealizedPnl}
              positionOverview={positionOverview}
              positionValue={positionValue}
              postOnly={postOnly}
              returnPercent={returnPercent}
              size={size}
              slippageEstimate="0.01% / max 0.25%"
              tradeSide={tradeSide}
              onAllocationChange={setAllocation}
              onAtExpiryDeliverToggle={() => setAtExpiryDeliver((current) => !current)}
              onLimitPriceChange={setLimitPrice}
              onOrderTypeChange={setOrderType}
              onPostOnlyToggle={() => setPostOnly((current) => !current)}
              onSideChange={setTradeSide}
              onSizeChange={setSize}
              onSubmit={handleSubmit}
            />
          </div>
        </section>

        <div className="mt-3 min-h-[220px] flex-1 xl:min-h-[260px] xl:shrink-0">
          <TradingActivityPanel
            activityView={dynamicActivityViews[selectedBottomTab]}
            footerLinks={[]}
            selectedTab={selectedBottomTab}
            tabs={[
              { id: "positions", label: "Positions" },
              { id: "open-orders", label: "Open Orders" },
              { id: "trade-history", label: "Trade History" },
            ]}
            onTabSelect={(tabId) => setSelectedBottomTab(tabId as keyof typeof ACTIVITY_VIEWS)}
          />
        </div>
      </div>
    </main>
  );
}
