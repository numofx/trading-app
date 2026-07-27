"use client";

import posthog from "posthog-js";
import { useWallets } from "@privy-io/react-auth";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import { buildFutureOrderEnvelope, canSubmitFutureOrder } from "@/lib/future-order-submission";
import { buildSpotOrderEnvelope } from "@/lib/spot-order-submission";
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
  buildMarketUrlSlug,
  isSpotMarketSelection,
  resolveHydratedMarketSelection,
  resolveMarketSelection,
  SPOT_URL_SLUG,
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
import { CNGN_CONFIG, TradingChartPanel } from "@/ui/trading-terminal/TradingChartPanel";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";
import { TradingMarketHeader } from "@/ui/trading-terminal/TradingMarketHeader";
import { DepositDialog } from "@/ui/trading-terminal/DepositDialog";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";
import { formatUsdcBalanceLabel, useUsdcBalance } from "@/ui/trading-terminal/useUsdcBalance";
import {
  formatSubaccountCngnLabel,
  formatSubaccountUsdcLabel,
  useSubaccountBalance,
} from "@/ui/trading-terminal/useSubaccountBalance";

const SELECTED_MARKET_STORAGE_KEY = "trading-terminal-selected-market";
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


function getDisplayTicker(marketDefinition: MarketDefinition) {
  return getInstrumentDisplayLabel(marketDefinition);
}


function getDisplayCandles(
  chartContext: (typeof CHART_CONTEXT_TABS)[number],
  marketCandles: Candle[]
) {
  // Every branch returns this venue's own fills, or nothing.
  //
  // Two things this deliberately no longer does:
  //   - substitute `selectedSpotHistory` for spot. That is an *external* NGN/USD
  //     reference feed, not this exchange's trades, so showing it as the venue
  //     chart misrepresents where the prices came from.
  //   - shift the price series to the live basis/carry value. That produced a
  //     chart with the shape of price history and the label of basis history,
  //     where only the final point was real. The live basis and carry readouts
  //     are unaffected — they are computed values, not history.
  if (chartContext === "Basis" || chartContext === "Carry") {
    return [];
  }

  return marketCandles;
}

function getDefaultChartContextForMarket(marketDefinition: MarketDefinition) {
  if (marketDefinition.type === "spot") {
    return "Price" as const;
  }

  return DEFAULT_CHART_CONTEXT;
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
  return market.type === "spot" ? 0 : 1;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This component coordinates terminal state across chart, book, order entry, and URL persistence.
export function OrderBookTradingTerminal({
  chainlinkSpot,
  defaultMarketId,
  initialMarketId,
  marketData,
  marketDefinitions,
  spotReferencePrice,
}: {
  chainlinkSpot: ChainlinkSpotSnapshot | null;
  defaultMarketId: MarketId;
  initialMarketId: MarketId;
  marketData: Record<MarketId, ContractMarket>;
  marketDefinitions: MarketDefinition[];
  /** External NGN/USD reference price used only to sanity-check the live spot
   * mark. Never charted — the chart shows this venue's own fills. */
  spotReferencePrice: number | null;
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
  const [size, setSize] = useState("1");
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

    if (index !== 1) {
      return;
    }

    const targetFuture = marketDefinitions.find(
      (m) => m.pair === currentPair && m.type === "future" && m.contractLabel === "SEP 2026"
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

    posthog.capture("market_selected", {
      market_id: targetMarket.id,
      market_type: targetMarket.type,
      market_pair: targetMarket.pair,
      market_label: getInstrumentDisplayLabel(targetMarket),
    });

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

  function handleTradingLayoutChange(layout: TradingLayout) {
    posthog.capture("trading_layout_changed", { layout });
    setTradingLayout(layout);
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
  const { balance: subaccountBalance, refresh: refreshSubaccountBalance } = useSubaccountBalance(tradingSubaccountId);
  const accountUsdcLabel = formatSubaccountUsdcLabel(subaccountBalance?.cashUnits ?? null);
  const accountCngnLabel = formatSubaccountCngnLabel(subaccountBalance?.cngnUnits ?? null);

  function handleDeposited(depositedSubaccountId: string) {
    adoptSubaccountId(depositedSubaccountId);
    refreshUsdcBalance();
    refreshSubaccountBalance();
  }

  const market = marketData[selectedMarketId];
  const referenceSpotPrice = parseNumericString(marketData["cngn-usdc-spot"].mark);
  const liveSpotPrice = getCompatibleSpotPrice(
    spotReferencePrice ?? chainlinkSpot?.priceNgnPerUsd ?? null,
    referenceSpotPrice
  );
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
  const displayCandles = getDisplayCandles(chartContext, market.candles);
  const candleResetKey = [
    selectedMarketId,
    chartContext,
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

  // The futures ticket is denominated in contracts (matching the order book). Order economics and
  // on-chain submission work in USDC notional: 1 contract = contractMultiplier USDC.
  const futureContractMultiplier =
    Number((selectedMarket.contractMultiplier ?? "10000").replaceAll(",", "")) || 10_000;
  const sizeUsdcNotional = String((Number(size) || 0) * futureContractMultiplier);

  const { averageExecution, estimatedFill, fees, initialMargin, liquidationPrice } =
    getOrderMetrics(
      limitPrice,
      market.mark,
      orderType,
      sizeUsdcNotional,
      safeLivePrice,
      orderSide
    );
  const quoteCurrency = getQuoteCurrency(selectedMarket.pair);

  const orderSummaryRows = getOrderSummaryRows({
    contracts: Number(sizeUsdcNotional || "0"),
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
    contracts: Number(sizeUsdcNotional || "0"),
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
    function markSelectionHydrated() {
      if (!hasHydratedSelection) {
        setHasHydratedSelection(true);
      }
    }

    const storedMarket = window.localStorage.getItem(SELECTED_MARKET_STORAGE_KEY);
    const selectionToken =
      requestedMarketParam && requestedMarketParam.trim() !== "" ? requestedMarketParam : storedMarket;

    // Spot is a view mode, not a row in marketDefinitions, so resolve it up front.
    if (isSpotMarketSelection(selectionToken)) {
      setActiveSection("spot");
      markSelectionHydrated();
      return;
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const resolution = resolveHydratedMarketSelection({
      aliases: marketSelectionAliases,
      defaultMarketId,
      requestedMarket: requestedMarketParam,
      storedMarket,
    });

    if (resolution.shouldIgnoreInvalidRequestedMarket) {
      markSelectionHydrated();
      return;
    }

    if (!resolution.selectedMarketId) {
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

    // Only an explicit non-spot selection switches into the futures view; a bare
    // visit with no token keeps the default spot section.
    const hasExplicitSelection = Boolean(selectionToken && selectionToken.trim() !== "");
    if (hasExplicitSelection && nextMarket.type !== "spot") {
      setActiveSection("derivatives");
    }

    if (resolution.selectedMarketId !== selectedMarketIdRef.current) {
      setSelectedMarketId(resolution.selectedMarketId);
      setChartContext(getDefaultChartContextForMarket(nextMarket));
      setLimitPrice(getRenderablePriceInput(marketData[resolution.selectedMarketId].mark));
      setActiveIndex(getActiveIndexForMarket(nextMarket));
    }

    markSelectionHydrated();
  }, [defaultMarketId, hasHydratedSelection, marketData, marketDefinitions, requestedMarketParam]);

  useEffect(() => {
    if (!hasHydratedSelection) {
      return;
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const canonicalMarketId =
      resolveMarketSelection(selectedMarketId, marketSelectionAliases) ?? selectedMarketId;
    const selectedMarketDefinition = marketDefinitions.find((option) => option.id === canonicalMarketId);
    // Spot is a view mode with no marketDefinitions row, so its URL is the bare
    // pair slug; the futures view uses the selected contract's symbol.
    const viewUrlSlug =
      activeSection === "spot"
        ? SPOT_URL_SLUG
        : buildMarketUrlSlug(selectedMarketDefinition) || canonicalMarketId;
    const currentSearchParams = new URLSearchParams(window.location.search);
    const requestedMarket = currentSearchParams.get("market");
    const isResolvableRequest =
      isSpotMarketSelection(requestedMarket) ||
      Boolean(
        requestedMarket &&
          requestedMarket.trim() !== "" &&
          resolveMarketSelection(requestedMarket, marketSelectionAliases)
      );

    if (requestedMarket && requestedMarket.trim() !== "" && !isResolvableRequest) {
      return;
    }

    window.localStorage.setItem(SELECTED_MARKET_STORAGE_KEY, viewUrlSlug);

    // Already showing the preferred slug — nothing to do. Any other form (a raw
    // `address:subId`, a legacy alias, or a dated futures symbol while on spot)
    // gets canonicalized so the URL always matches the visible view.
    if (requestedMarket === viewUrlSlug) {
      return;
    }

    currentSearchParams.set("market", viewUrlSlug);
    window.history.replaceState(null, "", `${pathname}?${currentSearchParams.toString()}`);
  }, [activeSection, hasHydratedSelection, marketDefinitions, pathname, selectedMarketId]);

  useEffect(() => {
    if (lastCandleResetKeyRef.current === candleResetKey) {
      return;
    }

    lastCandleResetKeyRef.current = candleResetKey;
    setLiveCandles(getDisplayCandles(chartContext, market.candles));
  }, [
    candleResetKey,
    chartContext,
    market.candles,
  ]);

  // Candles come from the venue's own fills via markets-service; there is no
  // client-side ticking. A random walk here would overwrite real price history
  // with invented movement.

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

      const appChain = getAppChain();
      await primaryWallet.switchChain(appChain.id);

      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: appChain,
        transport: custom(provider),
      });
      const envelope = buildFutureOrderEnvelope({
        limitPrice: executionLimitPrice,
        market: selectedMarket,
        side: orderSide,
        size: sizeUsdcNotional,
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
        posthog.capture("order_rejected", {
          order_side: orderSide,
          order_type: orderType,
          market_id: selectedMarketId,
          market_pair: selectedMarket.pair,
          size_contracts: size,
          size_usdc_notional: sizeUsdcNotional,
          limit_price: executionLimitPrice,
          error_message: payload?.error ?? null,
          http_status: response.status,
        });
        setLastAction(payload?.error ?? "Futures order submission failed");
        return;
      }

      posthog.capture("order_submitted", {
        order_id: payload?.order?.order_id ?? null,
        order_side: orderSide,
        order_type: orderType,
        market_id: selectedMarketId,
        market_pair: selectedMarket.pair,
        size_contracts: size,
        size_usdc_notional: sizeUsdcNotional,
        limit_price: executionLimitPrice,
        position_after: positionAfter,
      });
      setLastAction(
        `Futures order accepted: ${orderSide.toUpperCase()} ${size} contracts (${sizeUsdcNotional} USDC notional) @ ${executionLimitPrice} cNGN/USDC on ${market.ticker}; position after: ${positionAfter}`
      );
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Futures order submission failed";
      posthog.captureException(error, {
        properties: {
          order_side: orderSide,
          order_type: orderType,
          market_id: selectedMarketId,
          size_contracts: size,
          limit_price: executionLimitPrice,
        },
      });
      posthog.capture("order_failed", {
        order_side: orderSide,
        order_type: orderType,
        market_id: selectedMarketId,
        market_pair: selectedMarket.pair,
        size_contracts: size,
        size_usdc_notional: sizeUsdcNotional,
        limit_price: executionLimitPrice,
        error_message: errorMessage,
      });
      setLastAction(errorMessage);
      return;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function handleSubmitSpot({
    side,
    price,
    size,
    orderType,
  }: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market" | "Stop Limit";
  }) {
    if (!walletsReady) {
      setLastAction("Wallet is still loading");
      return;
    }
    if (!primaryWallet?.address) {
      setLastAction("Connect a wallet before submitting an order");
      return;
    }
    // Market spot orders derive a crossing price from the opposing book side.
    let executionPrice = price;
    if (orderType === "Market") {
      const spotMarketData = marketData["cngn-usdc-spot"];
      const opposing = side === "buy" ? spotMarketData.orderBookAsks[0] : spotMarketData.orderBookBids[0];
      if (!opposing) {
        setLastAction("No opposing spot liquidity to cross. Use a limit order.");
        return;
      }
      executionPrice = String(opposing.price);
    }

    try {
      setIsSubmittingOrder(true);
      setLastAction(
        tradingSubaccountId
          ? `Submitting spot order on trading account #${tradingSubaccountId}`
          : "Preparing trading account..."
      );
      const resolvedTradingSubaccountId =
        tradingSubaccountId ?? (await ensureTradingSubaccount(primaryWallet));

      const appChain = getAppChain();
      await primaryWallet.switchChain(appChain.id);
      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });

      const envelope = buildSpotOrderEnvelope({
        side,
        subaccountId: resolvedTradingSubaccountId,
        uiPrice: executionPrice,
        uiSize: size,
        walletAddress: primaryWallet.address,
      });
      setLastAction(`Awaiting wallet signature for trading account #${resolvedTradingSubaccountId}`);
      const signature = await walletClient.signTypedData({
        account: primaryWallet.address as `0x${string}`,
        ...envelope.typedData,
      });
      const response = await fetch("/api/orders", {
        body: JSON.stringify({ ...envelope.payload, signature }),
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        order?: { order_id?: string };
      } | null;
      if (!response.ok) {
        posthog.capture("order_rejected", {
          market_id: "cngn-usdc-spot",
          order_side: side,
          order_type: orderType,
          size_usdc_notional: size,
          limit_price: executionPrice,
          error_message: payload?.error ?? null,
          http_status: response.status,
        });
        setLastAction(payload?.error ?? "Spot order submission failed");
        return;
      }
      posthog.capture("order_submitted", {
        market_id: "cngn-usdc-spot",
        order_id: payload?.order?.order_id ?? null,
        order_side: side,
        order_type: orderType,
        size_usdc_notional: size,
        limit_price: executionPrice,
      });
      setLastAction(
        `Spot order accepted: ${side.toUpperCase()} ${size} USDC @ ${executionPrice} cNGN/USDC`
      );
      refreshUsdcBalance();
      refreshSubaccountBalance();
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Spot order submission failed";
      posthog.captureException(error, {
        properties: { market_id: "cngn-usdc-spot", order_side: side, order_type: orderType },
      });
      setLastAction(errorMessage);
      return;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  const safeLiveSpotPrice = Number.isFinite(liveSpotPrice) ? liveSpotPrice : null;
  // The spot chart shows this venue's own fills. It previously charted an external
  // NGN/USD reference series whenever that series happened to sit within 8% of the
  // live price — agreeing with the price does not make it this exchange's trades.
  const spotCandles = marketData["cngn-usdc-spot"].candles;

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
          depositControl={
            <DepositDialog
              onDeposited={handleDeposited}
              subaccountId={tradingSubaccountId}
              triggerClassName="flex h-8 cursor-pointer items-center whitespace-nowrap rounded-lg bg-input-bg px-2.5 font-semibold text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-60"
              triggerId="header-deposit-trigger"
              wallet={primaryWallet}
            />
          }
          layoutControl={
            <TradingLayoutMenu layout={tradingLayout} onLayoutChange={handleTradingLayoutChange} />
          }
        />

        {activeSection === "spot" ? (
          <SpotTradingTerminal
            accountCngnLabel={accountCngnLabel}
            accountUsdcLabel={accountUsdcLabel}
            candles={spotCandles}
            isSubmitting={isSubmittingOrder || isResolvingTradingSubaccount}
            lastAction={lastAction}
            liveSpotPrice={safeLiveSpotPrice}
            onSubmitOrder={handleSubmitSpot}
            spotMarket={marketData["cngn-usdc-spot"]}
            usdcBalanceLabel={formatUsdcBalanceLabel(usdcBalance)}
          />
        ) : null}

        {activeSection === "derivatives" && tradingLayout === "advanced" ? (
          <FuturesTradingTerminal
            accountCngnLabel={accountCngnLabel}
            accountUsdcLabel={accountUsdcLabel}
            basisLabel={formatSignedPercent(liveCarry)}
            candles={market.candles}
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
              futureSizeUnit={selectedMarket.type === "future" ? "contracts" : undefined}
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

      </div>
    </main>
  );
}
