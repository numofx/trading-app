"use client";

import { useWallets } from "@privy-io/react-auth";
import { startTransition, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import {
  formatFxDisplayPair,
  getInstrumentDisplayLabel,
  getProductDisplayName,
} from "@/lib/market-display";
import {
  buildMarketSelectionAliasMap,
  resolveHydratedMarketSelection,
  resolveMarketSelection,
} from "@/lib/market-selection";
import {
  calculateAnnualizedBasisPercent,
  calculateBasis,
  formatAnnualizedBasis,
  formatBasis,
  formatMarketPrice,
} from "@/lib/market-formatting";
import type { CHART_CONTEXT_TABS, CHART_RANGE_BUTTONS, TIMEFRAME_OPTIONS } from "@/lib/mock-orderbook-terminal-data";
import type { Candle, ContractMarket, MarketDefinition, MarketId, MarketStat, TradePrint } from "@/lib/trading.types";
import { buildSpotOrderEnvelope, canSubmitSpotOrder } from "@/lib/spot-order-submission";
import { isUSDCCNGNSpotMarket } from "@/lib/usdccngn-spot-order";
import {
  ACTIVITY_VIEWS,
  CHART_TOOLS,
  DEFAULT_BOTTOM_TAB,
  DEFAULT_CHART_CONTEXT,
  DEFAULT_ORDER_TYPE,
  DEFAULT_SYMBOL,
  DEFAULT_TIMEFRAME,
} from "@/lib/mock-orderbook-terminal-data";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { OrderBookPanel } from "@/ui/trading-terminal/OrderBookPanel";
import { OrderEntryPanel } from "@/ui/trading-terminal/OrderEntryPanel";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { TradingChartPanel } from "@/ui/trading-terminal/TradingChartPanel";
import { TradingMarketHeader } from "@/ui/trading-terminal/TradingMarketHeader";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";

const SELECTED_MARKET_STORAGE_KEY = "trading-terminal-selected-market";
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";
type SpotSizeCurrency = "USDC" | "cNGN";
const TRAILING_ZERO_DECIMALS_PATTERN = /\.?0+$/;

function parseNumericString(value: string) {
  const parsed = Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatPriceDisplay(value: number | string | null) {
  if (value === null) {
    return "—";
  }

  const numericValue = typeof value === "number" ? value : parseNumericString(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  return `${formatMarketPrice(numericValue)} cNGN per USDC`;
}

function getRenderablePriceInput(mark: string) {
  const parsedMark = parseNumericString(mark);
  return Number.isFinite(parsedMark) ? mark.replaceAll(",", "") : "";
}

function getDirectionalLabel(side: "buy" | "sell", marketDefinition: MarketDefinition) {
  if (isUSDCCNGNSpotMarket(marketDefinition)) {
    return side === "buy" ? "Buy USDC" : "Sell USDC";
  }

  const [base] = formatFxDisplayPair(marketDefinition.pair).split("/");

  if (!base) {
    return side === "buy" ? "Long" : "Short";
  }

  return side === "buy" ? `Long ${base}` : `Short ${base}`;
}

function getSpotMarketCrossingPrice(
  side: "buy" | "sell",
  orderType: "Limit" | "Market" | "Stop",
  market: ContractMarket,
) {
  if (orderType !== "Market") {
    return null;
  }

  const bestOpposingLevel = side === "buy" ? market.orderBookBids[0] : market.orderBookAsks[0];

  if (!bestOpposingLevel) {
    return null;
  }

  return bestOpposingLevel.price.toString();
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

function shiftCandles(candles: Candle[], targetClose: number) {
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
  buyDirection: string,
  sellDirection: string,
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
      rows: [{ cells: [ticker, buyDirection, "Limit", "25,000 contracts", entryPrice] }],
    },
    positions: {
      ...ACTIVITY_VIEWS.positions,
      rows: [{ cells: [ticker, positionValue, entryPrice, markPrice, pnl, returnValue], positiveCellIndexes: [4, 5] }],
    },
    "trade-history": {
      ...ACTIVITY_VIEWS["trade-history"],
      rows: [
        { cells: ["10:08:14", ticker, buyDirection, "50,000 contracts", markPrice] },
        { cells: ["10:08:06", ticker, sellDirection, "35,000 contracts", entryPrice] },
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

  return "";
}

function getContractTabsForProduct(type: MarketDefinition["type"], marketDefinitions: MarketDefinition[]) {
  if (type === "future" || type === "option") {
    return Array.from(
      new Set(
        marketDefinitions
          .filter((marketDefinition) => marketDefinition.type === type && marketDefinition.contractLabel)
          .map((marketDefinition) => marketDefinition.contractLabel as string),
      ),
    ).map((label) => ({ label }));
  }

  return [];
}

function getMarketIdForSelection(
  type: MarketDefinition["type"],
  contract: string,
  marketDefinitions: MarketDefinition[],
  fallbackMarketId: MarketId,
) {
  return (
    marketDefinitions.find((marketDefinition) => {
      return marketDefinition.type === type && marketDefinition.contractLabel === contract;
    })?.id ?? fallbackMarketId
  );
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
  liveBasis: number | null,
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
    if (liveBasis === null) {
      return marketCandles;
    }

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
  marketData: Record<MarketId, { mark: string }>,
  liveSpotPrice: number,
) {
  const marketPrice =
    marketDefinition.type === "spot"
      ? liveSpotPrice
      : parseNumericString(marketData[marketDefinition.id as MarketId].mark);
  const safeMarketPrice = Number.isFinite(marketPrice) ? marketPrice : null;
  const liveAnnualizedBasis =
    marketDefinition.type === "future" && safeMarketPrice !== null
      ? calculateAnnualizedBasisPercent(
          safeMarketPrice,
          liveSpotPrice,
          marketDefinition.expiryDays,
        )
      : null;
  const liveBasisPercent =
    marketDefinition.type === "future" && liveBasis !== null && liveSpotPrice > 0 && safeMarketPrice !== null
      ? (liveBasis / liveSpotPrice) * 100
      : null;

  return infoBar.map((item: MarketStat) => {
    if (item.label === "Mark Price") {
      return { ...item, value: formatPriceDisplay(safeMarketPrice ?? "—") };
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

function buildSelectorMetrics(
  liveSpotPrice: number,
  marketDefinitions: MarketDefinition[],
  marketData: Record<MarketId, { mark: string; trades: TradePrint[] }>,
) {
  const spotChangeByMarketId = {
    "cngn-usdc-jun-2026-options": null,
    "cngn-usdc-mar-2026-options": null,
    "cngn-usdc-spot": "+0.18%",
  } as Record<string, string | null>;
  const optionAtmIvByMarketId = {
    "cngn-usdc-jun-2026-options": "61.8%",
    "cngn-usdc-mar-2026-options": "54.2%",
    "cngn-usdc-spot": null,
  } as Record<string, string | null>;
  const optionOpenInterestByMarketId = {
    "cngn-usdc-jun-2026-options": "$3.1M",
    "cngn-usdc-mar-2026-options": "$1.4M",
    "cngn-usdc-spot": null,
  } as Record<string, string | null>;
  for (const marketDefinition of marketDefinitions) {
    if (marketDefinition.type === "future") {
      spotChangeByMarketId[marketDefinition.id] = null;
      optionAtmIvByMarketId[marketDefinition.id] = null;
      optionOpenInterestByMarketId[marketDefinition.id] = null;
    }
  }

  function getSelectorLastPrice(marketDefinition: MarketDefinition) {
    if (marketDefinition.type === "spot") {
      const parsed = parseNumericString(marketData[marketDefinition.id as MarketId].mark);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (marketDefinition.type === "future") {
      return marketData[marketDefinition.id as MarketId].trades[0]?.price ?? null;
    }

    return null;
  }

  const selectorLastByMarketId = Object.fromEntries(
    marketDefinitions.map((marketDefinition) => [
      marketDefinition.id,
      getSelectorLastPrice(marketDefinition),
    ]),
  ) satisfies Record<string, number | null>;
  const selectorBasisByMarketId = Object.fromEntries(
    marketDefinitions.map((marketDefinition) => {
      if (marketDefinition.type !== "future") {
        return [marketDefinition.id, null];
      }

      const futuresPrice = parseNumericString(marketData[marketDefinition.id as MarketId].mark);
      if (!Number.isFinite(futuresPrice)) {
        return [marketDefinition.id, null];
      }
      return [marketDefinition.id, calculateBasis(futuresPrice, liveSpotPrice)];
    }),
  ) satisfies Record<string, number | null>;
  const selectorAnnualizedBasisByMarketId = Object.fromEntries(
    marketDefinitions.map((marketDefinition) => {
      if (marketDefinition.type !== "future") {
        return [marketDefinition.id, null];
      }

      const futuresPrice = parseNumericString(marketData[marketDefinition.id as MarketId].mark);
      if (!Number.isFinite(futuresPrice)) {
        return [marketDefinition.id, null];
      }
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

function getPositionMetrics(
  marketData: Record<MarketId, { positionOverview: { label: string; value: string }[] }>,
  marketId: MarketId,
  livePrice: number | null,
) {
  const activePosition = marketData[marketId].positionOverview;

  return {
    entryPrice: activePosition.find((item) => item.label === "Entry Price")?.value ?? "—",
    markPrice: activePosition.find((item) => item.label === "Mark Price")?.value ?? formatPriceDisplay(livePrice ?? "—"),
    pnl: activePosition.find((item) => item.label === "Unrealized PnL")?.value ?? "—",
    positionOverview: activePosition,
    positionValue: activePosition.find((item) => item.label === "Position")?.value ?? "—",
    returnPercent: activePosition.find((item) => item.label === "Return %")?.value ?? "—",
  };
}

function getOrderMetrics(
  marketDefinition: MarketDefinition,
  limitPrice: string,
  marketMark: string,
  orderType: "Limit" | "Market" | "Stop",
  size: string,
  livePrice: number | null,
  tradeSide: "buy" | "sell",
) {
  const sizeNumber = Number(size || "0");
  const limitPriceNumber = parseNumericString(limitPrice || marketMark);
  const safeLimitPrice = Number.isFinite(limitPriceNumber) ? limitPriceNumber : null;

  function getEstimatedFill() {
    if (orderType !== "Market") {
      return safeLimitPrice;
    }

    if (livePrice === null) {
      return safeLimitPrice;
    }

    return livePrice + (tradeSide === "buy" ? 0.12 : -0.12);
  }

  function getAverageExecution(estimatedFill: number | null) {
    if (orderType !== "Market") {
      return safeLimitPrice;
    }

    if (estimatedFill === null) {
      return null;
    }

    return estimatedFill + (tradeSide === "buy" ? 0.05 : -0.05);
  }

  const estimatedFill = getEstimatedFill();
  const averageExecution = getAverageExecution(estimatedFill);

  if (isUSDCCNGNSpotMarket(marketDefinition)) {
    const orderValue = sizeNumber;

    return {
      averageExecution,
      estimatedFill,
      fees: orderValue * 0.0002,
      initialMargin: 0,
      liquidationPrice: null,
      orderValue,
    };
  }

  const orderValue = safeLimitPrice === null ? 0 : sizeNumber * safeLimitPrice;
  let liquidationPrice: number | null = null;

  if (safeLimitPrice !== null) {
    liquidationPrice = tradeSide === "buy" ? safeLimitPrice - 62.4 : safeLimitPrice + 62.4;
  }

  return {
    averageExecution,
    estimatedFill,
    fees: orderValue * 0.0002,
    initialMargin: orderValue * 0.05,
    liquidationPrice,
    orderValue,
  };
}

function getSpotSizeReferencePrice(
  orderType: "Limit" | "Market" | "Stop",
  limitPrice: string,
  livePrice: number | null,
  tradeSide: "buy" | "sell",
) {
  const limitPriceNumber = parseNumericString(limitPrice);
  const safeLimitPrice = Number.isFinite(limitPriceNumber) ? limitPriceNumber : livePrice;

  if (orderType !== "Market") {
    return safeLimitPrice ?? 0;
  }

  if (livePrice === null) {
    return safeLimitPrice ?? 0;
  }

  return livePrice + (tradeSide === "buy" ? 0.12 : -0.12);
}

function convertSpotSizeInputToUSDC(
  sizeInput: string,
  sizeCurrency: SpotSizeCurrency,
  referencePrice: number,
) {
  const sizeNumber = Number(sizeInput || "0");

  if (!Number.isFinite(sizeNumber) || sizeNumber <= 0) {
    return 0;
  }

  if (sizeCurrency === "USDC") {
    return sizeNumber;
  }

  return referencePrice > 0 ? sizeNumber / referencePrice : 0;
}

function convertUSDCSizeToSpotInput(
  canonicalUSDCSize: string,
  sizeCurrency: SpotSizeCurrency,
  referencePrice: number,
) {
  if (sizeCurrency === "USDC") {
    return canonicalUSDCSize;
  }

  const sizeNumber = Number(canonicalUSDCSize || "0");
  if (!Number.isFinite(sizeNumber) || sizeNumber <= 0 || referencePrice <= 0) {
    return "";
  }

  return (sizeNumber * referencePrice).toFixed(2).replace(TRAILING_ZERO_DECIMALS_PATTERN, "");
}

type SelectedContract = string;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This component coordinates terminal state across chart, book, order entry, and URL persistence.
export function OrderBookTradingTerminal({
  chainlinkSpot,
  defaultMarketId,
  initialContract,
  initialMarketId,
  marketData,
  marketDefinitions,
  spotHistory,
}: {
  chainlinkSpot: ChainlinkSpotSnapshot | null;
  defaultMarketId: MarketId;
  initialContract: string;
  initialMarketId: MarketId;
  marketData: Record<MarketId, ContractMarket>;
  marketDefinitions: MarketDefinition[];
  spotHistory: Record<SpotHistorySnapshot["pair"], SpotHistorySnapshot> | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedMarketParam = searchParams.get("market");
  const [selectedMarketId, setSelectedMarketId] = useState<MarketId>(initialMarketId);
  const [selectedContract, setSelectedContract] = useState<SelectedContract>(initialContract);
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
  const [spotSizeCurrency, setSpotSizeCurrency] = useState<SpotSizeCurrency>("USDC");
  const [limitPrice, setLimitPrice] = useState("1605.25");
  const [allocation, setAllocation] = useState(20);
  const [postOnly, setPostOnly] = useState(false);
  const [atExpiryDeliver, setAtExpiryDeliver] = useState(true);
  const [selectedBottomTab, setSelectedBottomTab] =
    useState<keyof typeof ACTIVITY_VIEWS>(DEFAULT_BOTTOM_TAB);
  const [lastAction, setLastAction] = useState("Ready");
  const [isSubmittingSpotOrder, setIsSubmittingSpotOrder] = useState(false);
  const [hasHydratedSelection, setHasHydratedSelection] = useState(false);
  const selectedMarketIdRef = useRef(initialMarketId);
  const { ready: walletsReady, wallets } = useWallets();
  const primaryWallet = wallets[0] ?? null;
  const {
    ensureTradingSubaccount,
    isLoading: isResolvingTradingSubaccount,
    subaccountId: tradingSubaccountId,
  } = useTradingSubaccount(primaryWallet?.address ?? null);

  const selectedMarket =
    marketDefinitions.find((marketOption) => marketOption.id === selectedMarketId) ??
    marketDefinitions[0];
  const market = marketData[selectedMarketId];
  const isLiveSpotExecutionAvailable = !isUSDCCNGNSpotMarket(selectedMarket) || canSubmitSpotOrder(selectedMarket);
  const referenceSpotPrice = parseNumericString(marketData["cngn-usdc-spot"].mark);
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
  const safeLivePrice = Number.isFinite(livePrice) ? livePrice : null;
  let liveBasis: number | null = null;

  if (selectedMarket.type !== "spot" && selectedMarket.type !== "option" && safeLivePrice !== null) {
    liveBasis = calculateBasis(safeLivePrice, liveSpotPrice);
  }
  const {
    optionAtmIvByMarketId,
    optionOpenInterestByMarketId,
    selectorAnnualizedBasisByMarketId,
    selectorBasisByMarketId,
    selectorLastByMarketId,
    spotChangeByMarketId,
  } = buildSelectorMetrics(liveSpotPrice, marketDefinitions, marketData);
  const dynamicActivityViews = buildActivityViews(
    getDirectionalLabel("buy", selectedMarket),
    getDirectionalLabel("sell", selectedMarket),
    getDisplayTicker(selectedMarket),
    market.positionOverview[0]?.value ?? "",
    market.positionOverview[1]?.value ?? "",
    market.positionOverview[2]?.value ?? "",
    market.positionOverview[3]?.value ?? "",
    market.positionOverview[4]?.value ?? "",
  );
  const displayCandles = getDisplayCandles(
    chartContext,
    liveBasis,
    liveSpotPrice,
    market.candles,
    selectedMarket.type,
    selectedSpotHistory,
  );
  const candleResetKey = [
    selectedMarketId,
    chartContext,
    liveBasis ?? "null",
    liveSpotPrice,
    selectedSpotHistory?.latestPrice ?? "none",
    market.candles.length,
    market.candles[0]?.time ?? "start",
    market.candles.at(-1)?.time ?? "end",
    market.candles.at(-1)?.close ?? "close",
  ].join("|");

  const liveInfoBar = buildLiveInfoBar(
    market.infoBar,
    selectedMarket,
    liveBasis,
    marketData,
    liveSpotPrice,
  );
  const { entryPrice, markPrice, pnl: unrealizedPnl, positionOverview, positionValue, returnPercent } =
    getPositionMetrics(marketData, selectedMarketId, safeLivePrice);
  const spotSizeReferencePrice = getSpotSizeReferencePrice(orderType, limitPrice, safeLivePrice, tradeSide);
  const canonicalSpotSize = convertSpotSizeInputToUSDC(size, spotSizeCurrency, spotSizeReferencePrice);
  const effectiveSize = isUSDCCNGNSpotMarket(selectedMarket) ? String(canonicalSpotSize) : size;
  const displayedSpotOrderValue = spotSizeCurrency === "USDC" ? canonicalSpotSize : Number(size || "0");
  const { averageExecution, estimatedFill, fees, initialMargin, liquidationPrice, orderValue } = getOrderMetrics(
    selectedMarket,
    limitPrice,
    market.mark,
    orderType,
    effectiveSize,
    safeLivePrice,
    tradeSide,
  );
  const marketDiagnostics = {
    asksCount: market.orderBookAsks.length,
    bidsCount: market.orderBookBids.length,
    bookAvailable: market.availability.bookAvailable,
    instrumentKey: selectedMarket.id,
    markAvailable: market.availability.markAvailable,
    tradesAvailable: market.availability.tradesAvailable,
    tradesCount: market.trades.length,
  };
  const [liveCandles, setLiveCandles] = useState<Candle[]>(displayCandles);
  const lastCandleResetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    selectedMarketIdRef.current = selectedMarketId;
  }, [selectedMarketId]);

  useEffect(() => {
    function markSelectionHydrated() {
      if (!hasHydratedSelection) {
        setHasHydratedSelection(true);
      }
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const resolution = resolveHydratedMarketSelection({
      aliases: marketSelectionAliases,
      defaultMarketId,
      requestedMarket: requestedMarketParam,
      storedMarket: window.localStorage.getItem(SELECTED_MARKET_STORAGE_KEY),
    });

    if (resolution.shouldIgnoreInvalidRequestedMarket) {
      markSelectionHydrated();
      return;
    }

    if (!resolution.selectedMarketId) {
      markSelectionHydrated();
      return;
    }

    if (resolution.selectedMarketId === selectedMarketIdRef.current) {
      markSelectionHydrated();
      return;
    }

    const nextMarket = marketDefinitions.find((marketOption) => marketOption.id === resolution.selectedMarketId);
    if (!nextMarket) {
      markSelectionHydrated();
      return;
    }

    setSelectedMarketId(resolution.selectedMarketId);
    setSelectedContract(nextMarket.contractLabel ?? getDefaultContractForMarket(nextMarket));
    setChartContext(nextMarket.type === "spot" ? "Spot" : DEFAULT_CHART_CONTEXT);
    setLimitPrice(getRenderablePriceInput(marketData[resolution.selectedMarketId].mark));
    markSelectionHydrated();
  }, [defaultMarketId, hasHydratedSelection, marketData, marketDefinitions, requestedMarketParam]);

  useEffect(() => {
    if (!hasHydratedSelection) {
      return;
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const canonicalMarketId = resolveMarketSelection(selectedMarketId, marketSelectionAliases) ?? selectedMarketId;
    const currentSearchParams = new URLSearchParams(window.location.search);
    const requestedMarket = currentSearchParams.get("market");
    const resolvedRequestedMarket =
      requestedMarket && requestedMarket.trim() !== ""
        ? resolveMarketSelection(requestedMarket, marketSelectionAliases)
        : null;

    if (requestedMarket && requestedMarket.trim() !== "" && !resolvedRequestedMarket) {
      return;
    }

    window.localStorage.setItem(SELECTED_MARKET_STORAGE_KEY, canonicalMarketId);

    if (currentSearchParams.get("market") === canonicalMarketId) {
      return;
    }

    currentSearchParams.set("market", canonicalMarketId);
    window.history.replaceState(null, "", `${pathname}?${currentSearchParams.toString()}`);
  }, [hasHydratedSelection, marketDefinitions, pathname, selectedMarketId]);

  useEffect(() => {
    if (lastCandleResetKeyRef.current === candleResetKey) {
      return;
    }

    lastCandleResetKeyRef.current = candleResetKey;
    setLiveCandles(
      getDisplayCandles(
        chartContext,
        liveBasis,
        liveSpotPrice,
        market.candles,
        selectedMarket.type,
        selectedSpotHistory,
      ),
    );
  }, [candleResetKey, chartContext, liveBasis, liveSpotPrice, market.candles, selectedMarket.type, selectedSpotHistory]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveCandles((currentCandles) => simulateLiveCandles(currentCandles, timeframe));
    }, getChartUpdateInterval(timeframe));

    return () => window.clearInterval(intervalId);
  }, [selectedMarketId, timeframe, chartContext]);

  function handleContractSelect(contract: string) {
    startTransition(() => {
      const nextMarketId = getMarketIdForSelection(
        selectedMarket.type,
        contract,
        marketDefinitions,
        selectedMarketId,
      );

      setSelectedContract(contract);
      setSelectedMarketId(nextMarketId);
      setChartContext(DEFAULT_CHART_CONTEXT);
      setLimitPrice(getRenderablePriceInput(marketData[nextMarketId].mark));
      setLastAction(`Switched to ${formatFxDisplayPair(selectedMarket.pair)} ${getProductDisplayName(selectedMarket.type)} ${contract}`);
    });
  }

  function handleMarketSelect(marketId: string) {
    const nextMarket = marketDefinitions.find((marketOption) => marketOption.id === marketId);

    if (!nextMarket) {
      return;
    }

    startTransition(() => {
      setSelectedMarketId(marketId as MarketId);
      if (nextMarket.contractLabel) {
        setSelectedContract(nextMarket.contractLabel);
      } else {
        setSelectedContract(getDefaultContractForMarket(nextMarket));
      }
      setChartContext(nextMarket.type === "spot" ? "Spot" : DEFAULT_CHART_CONTEXT);
      setLimitPrice(getRenderablePriceInput(marketData[marketId as MarketId].mark));
      setLastAction(`Switched to ${getDisplayTicker(nextMarket)}`);
    });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Spot execution needs wallet, env, signing, and backend submission checks in one submit path.
  async function handleSubmit(side: "buy" | "sell") {
    setTradeSide(side);

    if (isUSDCCNGNSpotMarket(selectedMarket)) {
      if (!walletsReady) {
        setLastAction("Wallet is still loading");
        return;
      }

      if (!primaryWallet?.address) {
        setLastAction("Connect a wallet before submitting a spot order");
        return;
      }

      if (!canSubmitSpotOrder(selectedMarket)) {
        setLastAction("Live spot execution is unavailable because markets-service did not expose a spot asset");
        return;
      }

      const derivedCrossingPrice = getSpotMarketCrossingPrice(side, orderType, market);
      const executionLimitPrice = derivedCrossingPrice ?? limitPrice;

      if (orderType === "Market" && !derivedCrossingPrice) {
        setLastAction("No opposing spot liquidity is available. Market orders need a live bid/ask to cross.");
        return;
      }

      try {
        setIsSubmittingSpotOrder(true);
        setLastAction(
          tradingSubaccountId
            ? `Submitting spot order on trading account #${tradingSubaccountId}`
            : "Preparing trading account...",
        );

        const resolvedTradingSubaccountId =
          tradingSubaccountId ?? (await ensureTradingSubaccount(primaryWallet));

        await primaryWallet.switchChain(base.id);

        const provider = await primaryWallet.getEthereumProvider();
        const walletClient = createWalletClient({
          chain: base,
          transport: custom(provider),
        });
        const envelope = buildSpotOrderEnvelope({
          limitPrice: executionLimitPrice,
          market: selectedMarket,
          side,
          size: effectiveSize,
          subaccountId: resolvedTradingSubaccountId,
          walletAddress: primaryWallet.address,
        });
        setLastAction(`Awaiting wallet signature for trading account #${resolvedTradingSubaccountId}`);
        const signature = await walletClient.signTypedData({
          account: primaryWallet.address as `0x${string}`,
          ...envelope.typedData,
        });
        const response = await fetch("/api/orders", {
          body: JSON.stringify({
            ...envelope.payload,
            signature,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              order?: {
                spot_contract?: {
                  balance_delta?: {
                    cngn?: string;
                    usdc?: string;
                  };
                  engine_order?: {
                    amount?: string;
                    price?: string;
                    side?: "buy" | "sell";
                  };
                  ui_intent?: {
                    price?: string;
                    side?: "buy" | "sell";
                    size?: string;
                  };
                };
              };
            }
          | null;

        if (!response.ok) {
          setLastAction(payload?.error ?? "Spot order submission failed");
          return;
        }

        const translated = payload?.order?.spot_contract;

        if (!translated) {
          setLastAction(`Spot order accepted for ${effectiveSize} USDC @ ${executionLimitPrice} cNGN/USDC`);
          return;
        }

        setLastAction(
          `Spot order accepted: ${translated.ui_intent?.side?.toUpperCase() ?? side.toUpperCase()} ${translated.ui_intent?.size ?? effectiveSize} USDC @ ${translated.ui_intent?.price ?? executionLimitPrice} cNGN/USDC -> engine ${translated.engine_order?.side?.toUpperCase() ?? "—"} ${translated.engine_order?.amount ?? "—"} cNGN @ ${translated.engine_order?.price ?? "—"} USDC/cNGN | dUSDC ${translated.balance_delta?.usdc ?? "—"} | dcNGN ${translated.balance_delta?.cngn ?? "—"}`,
        );
        return;
      } catch (error) {
        setLastAction(error instanceof Error ? error.message : "Invalid spot order");
        return;
      } finally {
        setIsSubmittingSpotOrder(false);
      }
    }

    setLastAction(
      `${getDirectionalLabel(side, selectedMarket)} ${Number(size || "0").toLocaleString("en-US")} contracts on ${market.ticker}`,
    );
  }

  return (
    <main className="min-h-screen bg-transparent text-[#D7DEE8] xl:h-dvh xl:overflow-hidden">
      <MarketDocumentTitle pair={formatFxDisplayPair(selectedMarket.pair)} price={liveCandles.at(-1)?.close ?? null} />

      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col px-2 py-2.5 xl:h-dvh xl:overflow-hidden xl:px-3">
        <TradingMarketHeader
          atmIvByMarketId={optionAtmIvByMarketId}
          annualizedBasisByMarketId={selectorAnnualizedBasisByMarketId}
          basisByMarketId={selectorBasisByMarketId}
          contractTabs={getContractTabsForProduct(selectedMarket.type, marketDefinitions)}
          currentContract={selectedContract}
          currentMarketId={selectedMarketId}
          infoBar={liveInfoBar}
          lastByMarketId={selectorLastByMarketId}
          marketOptions={marketDefinitions}
          openInterestByMarketId={optionOpenInterestByMarketId}
          onContractSelect={handleContractSelect}
          onMarketSelect={handleMarketSelect}
          selectedMarket={selectedMarket}
          spotChangeByMarketId={spotChangeByMarketId}
        />

        <section className="mt-2.5 grid grid-cols-1 gap-2.5 xl:h-[460px] xl:min-h-0 xl:flex-none xl:grid-cols-[minmax(0,1.9fr)_minmax(250px,0.68fr)_minmax(300px,0.82fr)] xl:overflow-hidden 2xl:h-[520px] 2xl:grid-cols-[minmax(0,1.95fr)_minmax(270px,0.72fr)_minmax(320px,0.86fr)]">
          <div className="min-h-[320px] xl:min-h-0 xl:overflow-hidden">
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

          <div className="min-h-[300px] xl:min-h-0 xl:overflow-hidden">
            <OrderBookPanel
              asks={market.orderBookAsks}
              bids={market.orderBookBids}
              contractLabel={selectedMarket.expiryLabel ?? "Spot"}
              trades={market.trades}
              view={orderBookView}
              onViewChange={setOrderBookView}
            />
          </div>

          <div className="min-h-[300px] xl:min-h-0 xl:overflow-hidden">
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
              isSubmitDisabled={!isLiveSpotExecutionAvailable}
              isSubmitting={isSubmittingSpotOrder || isResolvingTradingSubaccount}
              isSpotUSDIntent={isUSDCCNGNSpotMarket(selectedMarket)}
              lastAction={lastAction}
              limitPrice={limitPrice}
              liquidationPrice={formatPriceDisplay(liquidationPrice)}
              orderValue={
                isUSDCCNGNSpotMarket(selectedMarket)
                  ? `${displayedSpotOrderValue.toLocaleString("en-US", {
                      maximumFractionDigits: spotSizeCurrency === "USDC" ? 2 : 0,
                    })} ${spotSizeCurrency}`
                  : `${orderValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} cNGN`
              }
              orderType={orderType}
              pnl={unrealizedPnl}
              positionOverview={positionOverview}
              positionValue={positionValue}
              postOnly={postOnly}
              returnPercent={returnPercent}
              size={size}
              spotSizeCurrency={spotSizeCurrency}
              slippageEstimate="0.01% / max 0.25%"
              tradeSide={tradeSide}
              onAllocationChange={setAllocation}
              onAtExpiryDeliverToggle={() => setAtExpiryDeliver((current) => !current)}
              onLimitPriceChange={setLimitPrice}
              onOrderTypeChange={setOrderType}
              onPostOnlyToggle={() => setPostOnly((current) => !current)}
              onSideChange={setTradeSide}
              onSizeChange={setSize}
              onSpotSizeCurrencyChange={(nextCurrency) => {
                if (nextCurrency === spotSizeCurrency) {
                  return;
                }

                setSize(convertUSDCSizeToSpotInput(String(canonicalSpotSize), nextCurrency, spotSizeReferencePrice));
                setSpotSizeCurrency(nextCurrency);
              }}
              onSubmit={handleSubmit}
            />
          </div>
        </section>

        {IS_DEVELOPMENT ? (
          <section className="mt-2.5 rounded-md border border-[#1F2937] bg-[#0B1220]/80 px-3 py-2.5 text-[#9CA3AF] text-[11px]">
            <div className="mb-2 font-medium text-[#E5E7EB] uppercase tracking-[0.18em]">Live Market Diagnostics</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
              <div>{`instrumentKey: ${marketDiagnostics.instrumentKey}`}</div>
              <div>{`markAvailable: ${marketDiagnostics.markAvailable}`}</div>
              <div>{`bookAvailable: ${marketDiagnostics.bookAvailable}`}</div>
              <div>{`tradesAvailable: ${marketDiagnostics.tradesAvailable}`}</div>
              <div>{`parsedBids: ${marketDiagnostics.bidsCount}`}</div>
              <div>{`parsedAsks: ${marketDiagnostics.asksCount}`}</div>
              <div>{`parsedTrades: ${marketDiagnostics.tradesCount}`}</div>
            </div>
          </section>
        ) : null}

        <div className="mt-2.5 min-h-[200px] flex-1 xl:min-h-[230px] xl:shrink-0">
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
