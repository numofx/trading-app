"use client";

import { useWallets } from "@privy-io/react-auth";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";
import { simulateLiveCandles } from "@/lib/candle-simulation";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import { buildFutureOrderEnvelope, canSubmitFutureOrder } from "@/lib/future-order-submission";
import {
  formatFxDisplayPair,
  getInstrumentDisplayLabel,
  getProductDisplayName,
} from "@/lib/market-display";
import {
  calculateAnnualizedBasisPercent,
  calculateBasis,
  formatMarketPrice,
} from "@/lib/market-formatting";
import {
  buildMarketSelectionAliasMap,
  resolveHydratedMarketSelection,
  resolveMarketSelection,
} from "@/lib/market-selection";
import type {
  CHART_CONTEXT_TABS,
  CHART_RANGE_BUTTONS,
  TIMEFRAME_OPTIONS,
} from "@/lib/mock-orderbook-terminal-data";
import {
  ACTIVITY_VIEWS,
  BOTTOM_TABS,
  CHART_TOOLS,
  DEFAULT_CHART_CONTEXT,
  DEFAULT_ORDER_TYPE,
  DEFAULT_SYMBOL,
  DEFAULT_TIMEFRAME,
  FOOTER_LINKS,
} from "@/lib/mock-orderbook-terminal-data";
import type {
  Candle,
  ContractMarket,
  DeliveryTerm,
  MarketDefinition,
  MarketId,
  TradePrint,
  TradingLayout,
} from "@/lib/trading.types";
import type { AppSection } from "@/ui/app-sidebar.types";
import { AppSidebar } from "@/ui/AppSidebar";
import { FuturesTradingTerminal } from "@/ui/trading-terminal/FuturesTradingTerminal";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { OrderEntryPanel } from "@/ui/trading-terminal/OrderEntryPanel";
import { TradingLayoutMenu } from "@/ui/trading-terminal/TradingLayoutMenu";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { CNGN_CONFIG, FORWARD_POINTS, TradingChartPanel } from "@/ui/trading-terminal/TradingChartPanel";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";
import { TerminalSectionPanel } from "@/ui/trading-terminal/TerminalSectionPanel";
import { TradingMarketHeader } from "@/ui/trading-terminal/TradingMarketHeader";
import { DepositDialog } from "@/ui/trading-terminal/DepositDialog";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";
import { formatUsdcBalanceLabel, useUsdcBalance } from "@/ui/trading-terminal/useUsdcBalance";

const SELECTED_MARKET_STORAGE_KEY = "trading-terminal-selected-market";
const TRADING_LAYOUT_STORAGE_KEY = "trading-terminal-futures-layout";

function isTradingLayout(value: string | null): value is TradingLayout {
  return value === "advanced" || value === "analytics";
}
const CONTRACT_COUNT_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s+contracts/i;

function parseNumericString(value: string) {
  const parsed = Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getQuoteCurrency(pairOrLabel: string) {
  if (pairOrLabel.includes("EURC")) {
    return "EURC";
  }
  if (pairOrLabel.includes("BRZ")) {
    return "BRZ";
  }
  return "cNGN";
}

function formatPriceDisplay(value: number | string | null, quoteCurrency = "cNGN") {
  if (value === null) {
    return "—";
  }

  const numericValue = typeof value === "number" ? value : parseNumericString(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  const digits = quoteCurrency === "EURC" || quoteCurrency === "BRZ" ? 4 : 2;
  const formatted = numericValue.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  return `${formatted} ${quoteCurrency} per USDC`;
}

function formatSignedUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  let sign = "";
  if (value > 0) {
    sign = "+";
  } else if (value < 0) {
    sign = "-";
  }
  const absoluteValue = Math.abs(value);

  return `${sign}$${absoluteValue.toLocaleString("en-US", {
    maximumFractionDigits: absoluteValue >= 100 ? 0 : 2,
    minimumFractionDigits: absoluteValue > 0 && absoluteValue < 100 ? 2 : 0,
  })}`;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  let sign = "";
  if (value > 0) {
    sign = "+";
  } else if (value < 0) {
    sign = "-";
  }

  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatContractQuantity(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 3,
    minimumFractionDigits: value % 1 === 0 ? 0 : 3,
  });
}

function formatAssetAmount(value: number, asset: string, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  let minimumFractionDigits = 2;
  if (maximumFractionDigits === 0 || value % 1 === 0) {
    minimumFractionDigits = 0;
  }

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  })} ${asset}`;
}

function getRenderablePriceInput(mark: string) {
  const parsedMark = parseNumericString(mark);
  return Number.isFinite(parsedMark) ? mark.replaceAll(",", "") : "";
}

function _getDirectionalLabel(orderSide: "buy" | "sell", marketDefinition: MarketDefinition) {
  if (
    marketDefinition.type === "future" &&
    formatFxDisplayPair(marketDefinition.pair) === "USDC/cNGN"
  ) {
    return orderSide === "buy" ? "Long" : "Short";
  }

  const [base] = formatFxDisplayPair(marketDefinition.pair).split("/");

  if (!base) {
    return orderSide === "buy" ? "Long" : "Short";
  }

  return orderSide === "buy" ? `Long ${base}` : `Short ${base}`;
}

function getFutureMarketCrossingPrice(
  orderSide: "buy" | "sell",
  orderType: "Limit" | "Market" | "Stop",
  market: ContractMarket
) {
  if (orderType !== "Market") {
    return null;
  }

  const bestOpposingLevel = orderSide === "buy" ? market.orderBookAsks[0] : market.orderBookBids[0];

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

function getDisplayTicker(marketDefinition: MarketDefinition) {
  return getInstrumentDisplayLabel(marketDefinition);
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
  liveCarry: number | null,
  marketCandles: Candle[],
  marketType: MarketDefinition["type"],
  selectedSpotHistory: SpotHistorySnapshot | null
) {
  if (marketType === "spot" && selectedSpotHistory?.series) {
    return selectedSpotHistory.series;
  }

  if (chartContext === "Basis") {
    if (liveBasis === null) {
      return marketCandles;
    }

    return shiftCandles(marketCandles, liveBasis);
  }

  if (chartContext === "Carry") {
    if (liveCarry === null) {
      return marketCandles;
    }

    return shiftCandles(marketCandles, liveCarry);
  }

  return marketCandles;
}

function getDefaultChartContextForMarket(marketDefinition: MarketDefinition) {
  if (marketDefinition.type === "spot") {
    return "Price" as const;
  }

  return DEFAULT_CHART_CONTEXT;
}

function getCandleSimulationOptions(timeframe: (typeof TIMEFRAME_OPTIONS)[number]) {
  if (timeframe === "5m") {
    return { rollChance: 0.36, timeframeScale: 0.7 };
  }

  if (timeframe === "D") {
    return { rollChance: 0.18, timeframeScale: 1.8 };
  }

  return {};
}

function buildSelectorMetrics(
  liveSpotPrice: number,
  marketDefinitions: MarketDefinition[],
  marketData: Record<MarketId, { mark: string; trades: TradePrint[] }>
) {
  const spotChangeByMarketId = {
    "cngn-usdc-july-2026-options": null,
    "cngn-usdc-mar-2026-options": null,
    "cngn-usdc-spot": "+0.18%",
  } as Record<string, string | null>;
  const optionAtmIvByMarketId = {
    "cngn-usdc-july-2026-options": "61.8%",
    "cngn-usdc-mar-2026-options": "54.2%",
    "cngn-usdc-spot": null,
  } as Record<string, string | null>;
  const optionOpenInterestByMarketId = {
    "cngn-usdc-july-2026-options": "$3.1M",
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
    ])
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
    })
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
    })
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
  marketData: Record<MarketId, ContractMarket>,
  marketDefinition: MarketDefinition,
  marketId: MarketId,
  livePrice: number | null
) {
  const quoteCurrency = getQuoteCurrency(marketDefinition.pair);
  const activePosition = marketData[marketId].positionOverview;
  const entryPrice = activePosition.find((item) => item.label === "Entry Price")?.value ?? "—";
  const markPrice =
    activePosition.find((item) => item.label === "Mark Price")?.value ??
    formatPriceDisplay(livePrice ?? "—", quoteCurrency);
  const fallbackReturnValue =
    activePosition.find((item) => item.label === "Return on Margin")?.value ??
    activePosition.find((item) => item.label === "Return %")?.value ??
    "—";

  if (marketDefinition.type !== "future") {
    return {
      entryPrice,
      exposureLabel: activePosition.find((item) => item.label === "Position")?.value ?? "—",
      markPrice,
      pnl: activePosition.find((item) => item.label === "Unrealized PnL")?.value ?? "—",
      positionOverview: activePosition,
      positionValue: activePosition.find((item) => item.label === "Position")?.value ?? "—",
      returnLabel: activePosition.some((item) => item.label === "Return on Margin")
        ? "Return on Margin"
        : "Return %",
      returnValue: fallbackReturnValue,
    };
  }

  return getFuturePositionMetrics(
    activePosition,
    entryPrice,
    markPrice,
    livePrice,
    marketDefinition,
    quoteCurrency
  );
}

function getResolvedMarkPrice(markPrice: string, livePrice: number | null) {
  if (livePrice !== null && Number.isFinite(livePrice)) {
    return livePrice;
  }

  const fallbackMarkPrice = parseNumericString(markPrice);
  if (Number.isFinite(fallbackMarkPrice)) {
    return fallbackMarkPrice;
  }

  return Number.NaN;
}

function getFuturePositionContext(rawPosition: string, marketDefinition: MarketDefinition) {
  const contractsMatch = rawPosition.match(CONTRACT_COUNT_PATTERN);
  const contracts = contractsMatch ? Number(contractsMatch[1]?.replaceAll(",", "")) : Number.NaN;
  const contractMultiplier = parseNumericString(marketDefinition.contractMultiplier ?? "1");
  const pairLabel = formatFxDisplayPair(marketDefinition.pair);
  const [baseAsset = "Base", quoteAsset = "Quote"] = pairLabel.split("/");
  const isShortBase = rawPosition.toLowerCase().includes("short");
  const sideLabel = isShortBase
    ? `Short ${baseAsset} / Long ${quoteAsset}`
    : `Long ${baseAsset} / Short ${quoteAsset}`;

  return {
    baseAsset,
    contractMultiplier,
    contracts,
    isShortBase,
    sideLabel,
  };
}

function getFutureExposureLabel(contracts: number, contractMultiplier: number, baseAsset: string) {
  const baseExposure = contracts * contractMultiplier;
  const formattedContracts = formatContractQuantity(contracts);
  const formattedMultiplier = contractMultiplier.toLocaleString("en-US");
  const formattedBaseExposure = `${baseExposure.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${baseAsset}`;

  return {
    baseExposure,
    exposureLabel: `${formattedContracts} contracts x ${formattedMultiplier} ${baseAsset} = ${formattedBaseExposure} notional`,
    formattedBaseExposure,
    formattedContracts,
    formattedMultiplier,
  };
}

function getFuturePnlMetrics(
  baseExposure: number,
  isShortBase: boolean,
  parsedEntryPrice: number,
  resolvedMarkPrice: number
) {
  const directionalDelta = isShortBase
    ? parsedEntryPrice - resolvedMarkPrice
    : resolvedMarkPrice - parsedEntryPrice;
  const pnlInQuote = directionalDelta * baseExposure;
  const pnlInBase = resolvedMarkPrice > 0 ? pnlInQuote / resolvedMarkPrice : Number.NaN;
  const initialMargin = baseExposure * 0.05;
  const returnOnMargin = initialMargin > 0 ? (pnlInBase / initialMargin) * 100 : Number.NaN;

  return {
    pnl: formatSignedUsd(Number.isFinite(pnlInBase) ? pnlInBase : null),
    returnValue: formatSignedPercent(Number.isFinite(returnOnMargin) ? returnOnMargin : null),
  };
}

function buildFuturePositionOverview(
  sideLabel: string,
  exposure: ReturnType<typeof getFutureExposureLabel> | null,
  baseAsset: string,
  parsedEntryPrice: number,
  resolvedMarkPrice: number,
  pnl: string,
  returnValue: string,
  quoteCurrency: string
) {
  return [
    { label: "Side", value: sideLabel },
    { label: "Contracts", value: `${exposure?.formattedContracts ?? "—"} contracts` },
    {
      label: "Contract Multiplier",
      value: `${exposure?.formattedMultiplier ?? "—"} ${baseAsset} per contract`,
    },
    { label: "Base Exposure", value: `${exposure?.formattedBaseExposure ?? "—"} notional` },
    { label: "Entry Price", value: formatPriceDisplay(parsedEntryPrice, quoteCurrency) },
    { label: "Mark Price", value: formatPriceDisplay(resolvedMarkPrice, quoteCurrency) },
    { label: "Unrealized PnL", value: pnl },
    { label: "Return on Margin", value: returnValue },
  ];
}

function getFuturePositionMetrics(
  activePosition: { label: string; value: string }[],
  entryPrice: string,
  markPrice: string,
  livePrice: number | null,
  marketDefinition: MarketDefinition,
  quoteCurrency: string
) {
  const rawPosition = activePosition.find((item) => item.label === "Position")?.value ?? "";
  const { baseAsset, contractMultiplier, contracts, isShortBase, sideLabel } =
    getFuturePositionContext(rawPosition, marketDefinition);
  const parsedEntryPrice = parseNumericString(entryPrice);
  const resolvedMarkPrice = getResolvedMarkPrice(markPrice, livePrice);
  const exposure =
    Number.isFinite(contracts) && Number.isFinite(contractMultiplier)
      ? getFutureExposureLabel(contracts, contractMultiplier, baseAsset)
      : null;
  const metrics =
    exposure && Number.isFinite(parsedEntryPrice) && Number.isFinite(resolvedMarkPrice)
      ? getFuturePnlMetrics(exposure.baseExposure, isShortBase, parsedEntryPrice, resolvedMarkPrice)
      : { pnl: "—", returnValue: "—" };
  const computedPositionOverview = buildFuturePositionOverview(
    sideLabel,
    exposure,
    baseAsset,
    parsedEntryPrice,
    resolvedMarkPrice,
    metrics.pnl,
    metrics.returnValue,
    quoteCurrency
  );

  return {
    entryPrice: computedPositionOverview[4]?.value ?? "—",
    exposureLabel: exposure?.exposureLabel ?? "—",
    markPrice: computedPositionOverview[5]?.value ?? "—",
    pnl: metrics.pnl,
    positionOverview: computedPositionOverview,
    positionValue: computedPositionOverview[0]?.value ?? "—",
    returnLabel: "Return on Margin",
    returnValue: metrics.returnValue,
  };
}

function getOrderSummaryRows({
  contracts,
  estimatedFill,
  fees,
  initialMargin,
  liquidationPrice,
  quoteCurrency,
}: {
  contracts: number;
  estimatedFill: number | null;
  fees: number;
  initialMargin: number;
  liquidationPrice: number | null;
  quoteCurrency: string;
}) {
  const orderValue =
    estimatedFill !== null && Number.isFinite(estimatedFill) ? contracts * estimatedFill : 0;
  const liquidationDistancePercent = getLiquidationBufferPercent(estimatedFill, liquidationPrice);
  let liquidationDistanceLabel = "—";

  if (
    liquidationDistancePercent !== null &&
    estimatedFill !== null &&
    liquidationPrice !== null &&
    Number.isFinite(estimatedFill) &&
    Number.isFinite(liquidationPrice)
  ) {
    const direction = liquidationPrice < estimatedFill ? "below mark" : "above mark";
    liquidationDistanceLabel = `${liquidationDistancePercent.toFixed(1)}% ${direction}`;
  }

  const digits = quoteCurrency === "EURC" || quoteCurrency === "BRZ" ? 4 : 0;

  return [
    {
      label: "Notional",
      value: `${orderValue.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${quoteCurrency}`,
    },
    {
      label: "Margin Required",
      value: `$${initialMargin.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    },
    { label: "Est. Fill Price", value: formatPriceDisplay(estimatedFill, quoteCurrency) },
    { label: "Fees", value: `$${fees.toLocaleString("en-US", { maximumFractionDigits: 2 })}` },
    { label: "Liquidation Price", value: formatPriceDisplay(liquidationPrice, quoteCurrency) },
    { label: "Est. Distance to Liquidation", value: liquidationDistanceLabel },
  ] satisfies DeliveryTerm[];
}

function getAdvancedSummaryRows({
  averageExecution,
  buyingPower,
  quoteCurrency,
}: {
  averageExecution: number | null;
  buyingPower: string;
  quoteCurrency: string;
}) {
  return [
    { label: "Available Buying Power", value: buyingPower },
    { label: "Estimated Avg Execution", value: formatPriceDisplay(averageExecution, quoteCurrency) },
  ] satisfies DeliveryTerm[];
}

function getLiquidationBufferPercent(
  estimatedFill: number | null,
  liquidationPrice: number | null
) {
  if (
    estimatedFill === null ||
    liquidationPrice === null ||
    !Number.isFinite(estimatedFill) ||
    !Number.isFinite(liquidationPrice) ||
    estimatedFill <= 0
  ) {
    return null;
  }

  return (Math.abs(estimatedFill - liquidationPrice) / estimatedFill) * 100;
}

function formatSignedAssetAmount(value: number | null, asset: string, maximumFractionDigits = 0) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const absoluteValue = Math.abs(value);
  const formatted = formatAssetAmount(absoluteValue, asset, maximumFractionDigits);

  if (value > 0) {
    return `+${formatted}`;
  }

  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

function getSlippageEstimate(
  averageExecution: number | null,
  estimatedFill: number | null,
  orderType: "Limit" | "Market" | "Stop"
) {
  if (
    orderType !== "Market" ||
    averageExecution === null ||
    estimatedFill === null ||
    !Number.isFinite(averageExecution) ||
    !Number.isFinite(estimatedFill) ||
    estimatedFill <= 0
  ) {
    return "0.00% / max 0.25%";
  }

  const slippagePercent = (Math.abs(averageExecution - estimatedFill) / estimatedFill) * 100;
  return `${slippagePercent.toFixed(2)}% / max 0.25%`;
}

function getPositionBuilderRows({
  contracts,
  estimatedFill,
  liquidationPrice,
  liveSpotPrice,
  marketDefinition,
  orderSide,
}: {
  contracts: number;
  estimatedFill: number | null;
  liquidationPrice: number | null;
  liveSpotPrice: number;
  marketDefinition: MarketDefinition;
  orderSide: "buy" | "sell";
}) {
  if (marketDefinition.type !== "future") {
    return [] satisfies DeliveryTerm[];
  }

  const quoteCurrency = getQuoteCurrency(marketDefinition.pair);
  const digits = quoteCurrency === "EURC" || quoteCurrency === "BRZ" ? 2 : 0;

  const safeContracts = Number.isFinite(contracts) ? contracts : 0;
  const safeEstimatedFill =
    estimatedFill !== null && Number.isFinite(estimatedFill) ? estimatedFill : null;
  const directionMultiplier = orderSide === "buy" ? 1 : -1;
  const expiryPnl =
    safeEstimatedFill === null
      ? null
      : (liveSpotPrice - safeEstimatedFill) * safeContracts * directionMultiplier;
  const annualizedCarry =
    safeEstimatedFill === null || !marketDefinition.expiryDays || marketDefinition.expiryDays <= 0
      ? null
      : ((liveSpotPrice - safeEstimatedFill) / safeEstimatedFill) *
        (365 / marketDefinition.expiryDays) *
        100 *
        directionMultiplier;
  const liquidationBufferPercent = getLiquidationBufferPercent(safeEstimatedFill, liquidationPrice);

  return [
    { label: "Est. PnL @ Expiry", value: formatSignedAssetAmount(expiryPnl, quoteCurrency, digits) },
    { label: "Carry Earned (annualized)", value: formatSignedPercent(annualizedCarry) },
    { label: "Liquidation Buffer (% move)", value: formatSignedPercent(liquidationBufferPercent) },
  ] satisfies DeliveryTerm[];
}

function getOrderMetrics(
  limitPrice: string,
  marketMark: string,
  orderType: "Limit" | "Market" | "Stop",
  size: string,
  livePrice: number | null,
  orderSide: "buy" | "sell"
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

    return livePrice + (orderSide === "buy" ? 0.12 : -0.12);
  }

  function getAverageExecution(estimatedFill: number | null) {
    if (orderType !== "Market") {
      return safeLimitPrice;
    }

    if (estimatedFill === null) {
      return null;
    }

    return estimatedFill + (orderSide === "buy" ? 0.05 : -0.05);
  }

  const estimatedFill = getEstimatedFill();
  const averageExecution = getAverageExecution(estimatedFill);

  const orderValue = safeLimitPrice === null ? 0 : sizeNumber * safeLimitPrice;
  let liquidationPrice: number | null = null;

  if (safeLimitPrice !== null) {
    liquidationPrice = orderSide === "buy" ? safeLimitPrice - 62.4 : safeLimitPrice + 62.4;
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

function getActiveIndexForMarket(market: MarketDefinition) {
  if (market.type === "spot") {
    return 0;
  }
  if (market.contractLabel?.includes("JULY 2026")) {
    return 1;
  }
  if (market.contractLabel?.includes("NOV 2026")) {
    return 2;
  }
  if (market.contractLabel?.includes("MAY 2027")) {
    return 3;
  }
  return 1;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This component coordinates terminal state across chart, book, order entry, and URL persistence.
export function OrderBookTradingTerminal({
  chainlinkSpot,
  defaultMarketId,
  initialMarketId,
  marketData,
  marketDefinitions,
  spotHistory,
}: {
  chainlinkSpot: ChainlinkSpotSnapshot | null;
  defaultMarketId: MarketId;
  initialMarketId: MarketId;
  marketData: Record<MarketId, ContractMarket>;
  marketDefinitions: MarketDefinition[];
  spotHistory: Record<SpotHistorySnapshot["pair"], SpotHistorySnapshot> | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedMarketParam = searchParams.get("market");
  const [selectedMarketId, setSelectedMarketId] = useState<MarketId>(initialMarketId);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAME_OPTIONS)[number]>(DEFAULT_TIMEFRAME);
  const [chartContext, setChartContext] =
    useState<(typeof CHART_CONTEXT_TABS)[number]>(DEFAULT_CHART_CONTEXT);
  const [selectedRange, setSelectedRange] = useState<(typeof CHART_RANGE_BUTTONS)[number]>("1d");
  const [selectedTool, setSelectedTool] = useState(CHART_TOOLS[0]?.id ?? "crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [expandedChart, setExpandedChart] = useState(false);
  const [orderType, setOrderType] = useState<"Limit" | "Market" | "Stop">(DEFAULT_ORDER_TYPE);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [size, setSize] = useState("10000");
  const [limitPrice, setLimitPrice] = useState("1545");
  const [activeIndex, setActiveIndex] = useState(1);
  const [allocation, setAllocation] = useState(5);
  const [postOnly, setPostOnly] = useState(false);
  const [atExpiryDeliver, setAtExpiryDeliver] = useState(true);
  const [selectedActivityTab, setSelectedActivityTab] = useState<string>("positions");
  const [activeSection, setActiveSection] = useState<AppSection>("spot");
  const [tradingLayout, setTradingLayout] = useState<TradingLayout>("advanced");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [lastAction, setLastAction] = useState("Ready");
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [hasHydratedSelection, setHasHydratedSelection] = useState(false);
  const selectedMarketIdRef = useRef(initialMarketId);

  const selectedMarket =
    marketDefinitions.find((marketOption) => marketOption.id === selectedMarketId) ??
    marketDefinitions[0];

  const handleActiveIndexChange = (index: number) => {
    setActiveIndex(index);
    const currentPair = selectedMarket.pair;
    const point = CNGN_CONFIG.forwardPoints[index];
    if (point) {
      setLimitPrice(String(point.rate));
    }

    let label = "MAY 2027";
    if (index === 1) {
      label = "JULY 2026";
    } else if (index === 2) {
      label = "NOV 2026";
    }
    const targetFuture = marketDefinitions.find(
      (m) => m.pair === currentPair && m.type === "future" && m.contractLabel === label
    );
    if (targetFuture) {
      setSelectedMarketId(targetFuture.id);
    }
  };

  const handlePairChange = (_newPair: "USDCcNGN") => {
    const isFuture = selectedMarket.type === "future";

    const targetFuture = marketDefinitions.find(
      (m) => m.pair === "USDCcNGN" && m.type === "future" && (!isFuture || m.contractLabel === selectedMarket.contractLabel)
    ) || marketDefinitions.find((m) => m.pair === "USDCcNGN" && m.type === "future");

    if (targetFuture) {
      setSelectedMarketId(targetFuture.id);
      setLimitPrice(getRenderablePriceInput(marketData[targetFuture.id].mark));
      setActiveIndex(getActiveIndexForMarket(targetFuture));
    }
  };
  const selectMarketForSection = (targetMarket: MarketDefinition) => {
    if (targetMarket.id === selectedMarketId) {
      return;
    }

    setSelectedMarketId(targetMarket.id);
    setChartContext(getDefaultChartContextForMarket(targetMarket));
    setLimitPrice(getRenderablePriceInput(marketData[targetMarket.id].mark));
    setActiveIndex(getActiveIndexForMarket(targetMarket));
  };

  const handleSectionChange = (section: AppSection) => {
    setActiveSection(section);

    if (section !== "spot" && section !== "derivatives") {
      return;
    }

    const targetMarket =
      section === "spot"
        ? marketDefinitions.find((marketOption) => marketOption.type === "spot")
        : (marketDefinitions.find(
            (marketOption) => marketOption.id === defaultMarketId && marketOption.type === "future"
          ) ?? marketDefinitions.find((marketOption) => marketOption.type === "future"));

    if (targetMarket) {
      selectMarketForSection(targetMarket);
    }
  };

  const handleOpenMarketFromSection = (marketId: MarketId) => {
    const targetMarket = marketDefinitions.find((marketOption) => marketOption.id === marketId);

    if (!targetMarket) {
      return;
    }

    setActiveSection(targetMarket.type === "spot" ? "spot" : "derivatives");
    selectMarketForSection(targetMarket);
  };

  const isTradingSection = activeSection === "spot" || activeSection === "derivatives";

  function handleTradingLayoutChange(layout: TradingLayout) {
    setTradingLayout(layout);
    window.localStorage.setItem(TRADING_LAYOUT_STORAGE_KEY, layout);
  }

  const { ready: walletsReady, wallets } = useWallets();
  const primaryWallet = wallets[0] ?? null;
  const {
    adoptSubaccountId,
    ensureTradingSubaccount,
    isLoading: isResolvingTradingSubaccount,
    subaccountId: tradingSubaccountId,
  } = useTradingSubaccount(primaryWallet?.address ?? null);
  const { balance: usdcBalance, refresh: refreshUsdcBalance } = useUsdcBalance(primaryWallet?.address ?? null);

  function handleDeposited(depositedSubaccountId: string) {
    adoptSubaccountId(depositedSubaccountId);
    refreshUsdcBalance();
  }

  const market = marketData[selectedMarketId];
  const referenceSpotPrice = parseNumericString(marketData["cngn-usdc-spot"].mark);
  const liveSpotPrice = getCompatibleSpotPrice(
    spotHistory?.["NGN/USD"]?.latestPrice ?? chainlinkSpot?.priceNgnPerUsd ?? null,
    referenceSpotPrice
  );
  const selectedSpotHistory =
    selectedMarket.type === "spot" ? (spotHistory?.["NGN/USD"] ?? null) : null;
  const livePrice =
    selectedMarket.type === "spot" ? liveSpotPrice : parseNumericString(market.mark);
  const safeLivePrice = Number.isFinite(livePrice) ? livePrice : null;
  let liveBasis: number | null = null;

  if (
    selectedMarket.type !== "spot" &&
    selectedMarket.type !== "option" &&
    safeLivePrice !== null
  ) {
    liveBasis = calculateBasis(safeLivePrice, liveSpotPrice);
  }
  const { selectorAnnualizedBasisByMarketId } = buildSelectorMetrics(
    liveSpotPrice,
    marketDefinitions,
    marketData
  );
  const liveCarry = selectorAnnualizedBasisByMarketId[selectedMarket.id] ?? null;
  const displayCandles = getDisplayCandles(
    chartContext,
    liveBasis,
    liveCarry,
    market.candles,
    selectedMarket.type,
    selectedSpotHistory
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

  const {
    entryPrice,
    markPrice,
    pnl: unrealizedPnl,
    positionOverview,
    positionValue: _positionValue,
    exposureLabel,
    returnLabel,
    returnValue,
  } = getPositionMetrics(marketData, selectedMarket, selectedMarketId, safeLivePrice);

  const { averageExecution, estimatedFill, fees, initialMargin, liquidationPrice } =
    getOrderMetrics(
      limitPrice,
      market.mark,
      orderType,
      size,
      safeLivePrice,
      orderSide
    );
  const quoteCurrency = getQuoteCurrency(selectedMarket.pair);

  const orderSummaryRows = getOrderSummaryRows({
    contracts: Number(size || "0"),
    estimatedFill,
    fees,
    initialMargin,
    liquidationPrice,
    quoteCurrency,
  });
  const advancedSummaryRows = getAdvancedSummaryRows({
    averageExecution,
    buyingPower: "$250,000",
    quoteCurrency,
  });
  const positionBuilderRows = getPositionBuilderRows({
    contracts: Number(size || "0"),
    estimatedFill,
    liquidationPrice,
    liveSpotPrice,
    marketDefinition: selectedMarket,
    orderSide,
  });
  const slippageEstimate = getSlippageEstimate(averageExecution, estimatedFill, orderType);
  const [liveCandles, setLiveCandles] = useState<Candle[]>(displayCandles);
  const lastCandleResetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    selectedMarketIdRef.current = selectedMarketId;
  }, [selectedMarketId]);

  useEffect(() => {
    const storedLayout = window.localStorage.getItem(TRADING_LAYOUT_STORAGE_KEY);

    if (isTradingLayout(storedLayout)) {
      setTradingLayout(storedLayout);
    }
  }, []);

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

    const nextMarket = marketDefinitions.find(
      (marketOption) => marketOption.id === resolution.selectedMarketId
    );
    if (!nextMarket) {
      markSelectionHydrated();
      return;
    }

    setSelectedMarketId(resolution.selectedMarketId);
    setChartContext(getDefaultChartContextForMarket(nextMarket));
    setLimitPrice(getRenderablePriceInput(marketData[resolution.selectedMarketId].mark));
    setActiveIndex(getActiveIndexForMarket(nextMarket));
    markSelectionHydrated();
  }, [defaultMarketId, hasHydratedSelection, marketData, marketDefinitions, requestedMarketParam]);

  useEffect(() => {
    if (!hasHydratedSelection) {
      return;
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const canonicalMarketId =
      resolveMarketSelection(selectedMarketId, marketSelectionAliases) ?? selectedMarketId;
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
        liveCarry,
        market.candles,
        selectedMarket.type,
        selectedSpotHistory
      )
    );
  }, [
    candleResetKey,
    chartContext,
    liveBasis,
    liveCarry,
    liveSpotPrice,
    market.candles,
    selectedMarket.type,
    selectedSpotHistory,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveCandles((currentCandles) =>
        simulateLiveCandles(currentCandles, getCandleSimulationOptions(timeframe))
      );
    }, getChartUpdateInterval(timeframe));

    return () => window.clearInterval(intervalId);
  }, [selectedMarketId, timeframe, chartContext]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Order submission needs wallet, env, signing, and backend submission checks in one submit path.
  async function handleSubmit(orderSide: "buy" | "sell") {
    setOrderSide(orderSide);
    const positionAfter = orderSide === "buy" ? "long" : "short";

    if (!walletsReady) {
      setLastAction("Wallet is still loading");
      return;
    }

    if (!primaryWallet?.address) {
      setLastAction("Connect a wallet before submitting an order");
      return;
    }

    if (!canSubmitFutureOrder(selectedMarket)) {
      setLastAction(
        "Live futures execution is unavailable because markets-service did not expose the future asset"
      );
      return;
    }

    const derivedCrossingPrice = getFutureMarketCrossingPrice(orderSide, orderType, market);
    const executionLimitPrice = derivedCrossingPrice ?? limitPrice;

    if (orderType === "Market" && !derivedCrossingPrice) {
      setLastAction(
        "No opposing futures liquidity is available. Market orders need a live bid/ask to cross."
      );
      return;
    }

    try {
      setIsSubmittingOrder(true);
      setLastAction(
        tradingSubaccountId
          ? `Submitting futures order on trading account #${tradingSubaccountId}`
          : "Preparing trading account..."
      );

      const resolvedTradingSubaccountId =
        tradingSubaccountId ?? (await ensureTradingSubaccount(primaryWallet));

      await primaryWallet.switchChain(baseSepolia.id);

      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: baseSepolia,
        transport: custom(provider),
      });
      const envelope = buildFutureOrderEnvelope({
        limitPrice: executionLimitPrice,
        market: selectedMarket,
        side: orderSide,
        size,
        subaccountId: resolvedTradingSubaccountId,
        walletAddress: primaryWallet.address,
      });
      setLastAction(
        `Awaiting wallet signature for trading account #${resolvedTradingSubaccountId}`
      );
      const signature = await walletClient.signTypedData({
        account: primaryWallet.address as `0x${string}`,
        ...envelope.typedData,
      });
      const response = await fetch("/api/orders", {
        body: JSON.stringify({
          ...envelope.payload,
          signature,
        }),
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        order?: {
          order_id?: string;
        };
      } | null;

      if (!response.ok) {
        setLastAction(payload?.error ?? "Futures order submission failed");
        return;
      }

      setLastAction(
        `Futures order accepted: ${orderSide.toUpperCase()} ${size} USDC notional @ ${executionLimitPrice} cNGN/USDC on ${market.ticker}; position after: ${positionAfter}`
      );
      return;
    } catch (error) {
      setLastAction(
        error instanceof Error ? error.message : "Futures order submission failed"
      );
      return;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  const safeLiveSpotPrice = Number.isFinite(liveSpotPrice) ? liveSpotPrice : null;
  const spotHistorySnapshot = spotHistory?.["NGN/USD"] ?? null;
  // Only chart the external history series when it agrees with the reconciled spot price;
  // otherwise fall back to the reference candles so the ticker, book, and chart stay consistent.
  const isSpotHistoryCompatible =
    spotHistorySnapshot !== null &&
    safeLiveSpotPrice !== null &&
    safeLiveSpotPrice > 0 &&
    Math.abs(spotHistorySnapshot.latestPrice - safeLiveSpotPrice) / safeLiveSpotPrice <= 0.08;
  const spotCandles = isSpotHistoryCompatible
    ? spotHistorySnapshot.series
    : marketData["cngn-usdc-spot"].candles;

  const futuresChartPanel = (
    <TradingChartPanel
      activeIndex={activeIndex}
      candles={liveCandles}
      chartContext={chartContext}
      entryPrice={entryPrice}
      expandedChart={expandedChart}
      indicatorsEnabled={indicatorsEnabled}
      markPrice={markPrice}
      onActiveIndexChange={handleActiveIndexChange}
      onChartContextChange={setChartContext}
      onExpandedToggle={() => setExpandedChart((current) => !current)}
      onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
      onRangeChange={setSelectedRange}
      onTimeframeChange={setTimeframe}
      onToolSelect={setSelectedTool}
      selectedRange={selectedRange}
      selectedTimeframe={timeframe}
      selectedTool={selectedTool}
      ticker={getDisplayTicker(selectedMarket)}
      onPairChange={handlePairChange}
    />
  );
  const futuresActivityPanel = (
    <TradingActivityPanel
      activityView={
        ACTIVITY_VIEWS[selectedActivityTab as keyof typeof ACTIVITY_VIEWS] || {
          columns: [],
          rows: [],
        }
      }
      footerLinks={FOOTER_LINKS}
      onTabSelect={setSelectedActivityTab}
      selectedTab={selectedActivityTab}
      tabs={BOTTOM_TABS}
    />
  );

  return (
    <main className="flex min-h-screen bg-terminal-bg text-foreground transition-colors duration-300 xl:h-dvh xl:overflow-hidden">
      <MarketDocumentTitle
        pair={activeSection === "spot" ? "USDC/cNGN" : formatFxDisplayPair(selectedMarket.pair)}
        price={activeSection === "spot" ? safeLiveSpotPrice : safeLivePrice}
      />

      <AppSidebar
        activeSection={activeSection}
        collapsed={sidebarCollapsed}
        onCollapsedToggle={() => setSidebarCollapsed((current) => !current)}
        onSectionChange={handleSectionChange}
      />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col gap-3 p-3 xl:h-dvh xl:overflow-hidden xl:px-4">
        <TradingMarketHeader
          layoutControl={
            activeSection === "derivatives" ? (
              <TradingLayoutMenu layout={tradingLayout} onLayoutChange={handleTradingLayoutChange} />
            ) : null
          }
        />

        {activeSection === "spot" ? (
          <SpotTradingTerminal
            candles={spotCandles}
            depositControl={
              <DepositDialog
                onDeposited={handleDeposited}
                subaccountId={tradingSubaccountId}
                triggerId="spot-deposit-trigger"
                wallet={primaryWallet}
              />
            }
            liveSpotPrice={safeLiveSpotPrice}
            marketDefinitions={marketDefinitions}
            onManageFunds={() => handleSectionChange("portfolio")}
            onSelectMarket={handleOpenMarketFromSection}
            spotMarket={marketData["cngn-usdc-spot"]}
            usdcBalanceLabel={formatUsdcBalanceLabel(usdcBalance)}
          />
        ) : null}

        {activeSection === "derivatives" && tradingLayout === "advanced" ? (
          <FuturesTradingTerminal
            basisLabel={formatSignedPercent(liveCarry)}
            candles={market.candles}
            depositControl={
              <DepositDialog
                onDeposited={handleDeposited}
                subaccountId={tradingSubaccountId}
                triggerId="futures-ticker-deposit-trigger"
                wallet={primaryWallet}
              />
            }
            isSubmitting={isSubmittingOrder || isResolvingTradingSubaccount}
            lastAction={lastAction}
            lastPrice={safeLivePrice}
            limitPrice={limitPrice}
            market={market}
            marketDefinition={selectedMarket}
            marketDefinitions={marketDefinitions}
            onLimitPriceChange={setLimitPrice}
            onOrderTypeChange={setOrderType}
            onSelectMarket={handleOpenMarketFromSection}
            onSideChange={setOrderSide}
            onSizeChange={setSize}
            onSubmit={handleSubmit}
            orderSide={orderSide}
            orderSummaryRows={orderSummaryRows}
            orderType={orderType}
            size={size}
            usdcBalanceLabel={formatUsdcBalanceLabel(usdcBalance)}
          />
        ) : null}

        {activeSection === "derivatives" && tradingLayout === "analytics" ? (
        <section className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_360px] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-h-[700px] flex-col gap-3 xl:min-h-0 xl:overflow-hidden">
            <div className="min-h-[320px] xl:min-h-0 xl:flex-7">{futuresChartPanel}</div>

            <div className="min-h-[220px] xl:min-h-0 xl:flex-3">{futuresActivityPanel}</div>
          </div>

          <div className="min-h-[300px] xl:min-h-0 xl:overflow-hidden">
            <OrderEntryPanel
              advancedSummaryRows={advancedSummaryRows}
              allocation={allocation}
              atExpiryDeliver={atExpiryDeliver}
              balanceLabel={formatUsdcBalanceLabel(usdcBalance)}
              contractDetails={market.contractDetails}
              contractLabel={getDisplayTicker(selectedMarket)}
              depositControl={
                <DepositDialog
                  onDeposited={handleDeposited}
                  subaccountId={tradingSubaccountId}
                  triggerId="order-entry-deposit-trigger"
                  wallet={primaryWallet}
                />
              }
              exposureLabel={exposureLabel}
              futureSizeUnit={selectedMarket.type === "future" ? "USDC" : undefined}
              isFXFuture={selectedMarket.type === "future"}
              isSubmitting={isSubmittingOrder || isResolvingTradingSubaccount}
              lastAction={lastAction}
              limitPrice={limitPrice}
              onAllocationChange={setAllocation}
              onAtExpiryDeliverToggle={() => setAtExpiryDeliver((current) => !current)}
              onLimitPriceChange={setLimitPrice}
              onOrderTypeChange={setOrderType}
              onPostOnlyToggle={() => setPostOnly((current) => !current)}
              onSideChange={setOrderSide}
              onSizeChange={setSize}
              onSubmit={handleSubmit}
              orderSide={orderSide}
              orderSummaryRows={orderSummaryRows}
              orderType={orderType}
              pnl={unrealizedPnl}
              positionBuilderRows={positionBuilderRows}
              positionOverview={positionOverview}
              postOnly={postOnly}
              returnLabel={returnLabel}
              returnValue={returnValue}
              size={size}
              slippageEstimate={slippageEstimate}
            />
          </div>
        </section>
        ) : null}

        {isTradingSection ? null : (
          <section className="min-h-[400px] xl:min-h-0 xl:flex-1 xl:overflow-hidden">
            <TerminalSectionPanel
              marketData={marketData}
              marketDefinitions={marketDefinitions}
              onOpenMarket={handleOpenMarketFromSection}
              section={activeSection}
            />
          </section>
        )}
      </div>
    </main>
  );
}
