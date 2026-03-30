import {
  ArrowRightLeft,
  Brush,
  ChartCandlestick,
  Crosshair,
  Eraser,
  Highlighter,
  Minus,
  PenLine,
  Ruler,
  Search,
  SquareDashedMousePointer,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatFxDisplayPair } from "@/lib/market-display";
import { calculateAnnualizedBasisPercent, formatAnnualizedBasis, formatBasis } from "@/lib/market-formatting";
import { buildCanonicalMarketId, buildLegacyDerivedMarketId, getMarketSymbolAliases } from "@/lib/market-selection";
import type {
  ActivityTab,
  ActivityView,
  Candle,
  ChartTool,
  ContractMarket,
  DeliveryTerm,
  MarketDefinition,
  MarketAvailability,
  MarketId,
  TradePrint,
} from "@/lib/trading.types";
import type { BookResponse, PresentedTrade } from "@/lib/markets-service";

const BASE_SPOT_CANDLES = [
  [1598.8, 1600.2, 1598.1, 1599.6, 260],
  [1599.6, 1600.9, 1598.8, 1600.4, 274],
  [1600.4, 1601.8, 1599.7, 1601.1, 288],
  [1601.1, 1602.5, 1600.3, 1601.8, 302],
  [1601.8, 1603.0, 1601.0, 1602.2, 316],
  [1602.2, 1603.6, 1601.4, 1602.9, 334],
  [1602.9, 1604.2, 1602.1, 1603.4, 349],
  [1603.4, 1604.6, 1602.8, 1603.8, 361],
  [1603.8, 1605.0, 1603.0, 1604.1, 374],
  [1604.1, 1605.3, 1603.4, 1604.5, 390],
  [1604.5, 1605.7, 1603.8, 1604.8, 403],
  [1604.8, 1606.0, 1604.0, 1605.1, 416],
  [1605.1, 1606.2, 1604.3, 1605.3, 429],
  [1605.3, 1606.5, 1604.6, 1605.5, 441],
  [1605.5, 1606.6, 1604.8, 1605.6, 437],
  [1605.6, 1606.4, 1604.7, 1605.2, 421],
  [1605.2, 1606.0, 1604.4, 1604.9, 402],
  [1604.9, 1605.8, 1604.0, 1604.6, 384],
  [1604.6, 1605.3, 1603.9, 1604.3, 369],
  [1604.3, 1605.1, 1603.6, 1604.1, 352],
  [1604.1, 1605.0, 1603.4, 1604.0, 341],
  [1604.0, 1604.8, 1603.2, 1603.8, 333],
  [1603.8, 1604.6, 1603.1, 1603.7, 325],
  [1603.7, 1604.5, 1603.0, 1603.6, 319],
  [1603.6, 1604.7, 1603.1, 1603.8, 324],
  [1603.8, 1604.9, 1603.3, 1604.1, 338],
  [1604.1, 1605.1, 1603.5, 1604.4, 347],
  [1604.4, 1605.3, 1603.8, 1604.6, 358],
] as const;

const BASE_FUTURES_CANDLES = [
  [1594.8, 1596.4, 1594.1, 1595.9, 220],
  [1595.9, 1597.3, 1595.0, 1596.8, 245],
  [1596.8, 1598.6, 1596.4, 1597.9, 260],
  [1597.9, 1599.2, 1597.1, 1598.4, 272],
  [1598.4, 1599.8, 1597.8, 1598.0, 255],
  [1598.0, 1599.5, 1597.4, 1598.9, 249],
  [1598.9, 1600.6, 1598.2, 1600.1, 281],
  [1600.1, 1601.5, 1599.6, 1600.8, 296],
  [1600.8, 1602.1, 1600.2, 1601.4, 308],
  [1601.4, 1603.2, 1600.9, 1602.6, 325],
  [1602.6, 1604.1, 1601.8, 1603.7, 356],
  [1603.7, 1605.2, 1603.1, 1604.8, 372],
  [1604.8, 1606.3, 1604.0, 1605.5, 390],
  [1605.5, 1607.0, 1604.9, 1606.4, 406],
  [1606.4, 1608.2, 1605.8, 1607.6, 422],
  [1607.6, 1608.8, 1606.9, 1607.1, 401],
  [1607.1, 1608.4, 1606.1, 1606.6, 384],
  [1606.6, 1607.2, 1605.4, 1605.9, 362],
  [1605.9, 1606.6, 1604.8, 1605.1, 348],
  [1605.1, 1606.0, 1604.5, 1605.4, 333],
  [1605.4, 1606.3, 1604.9, 1605.8, 321],
  [1605.8, 1606.2, 1604.6, 1605.0, 316],
  [1605.0, 1605.8, 1604.2, 1604.7, 305],
  [1604.7, 1605.6, 1603.9, 1604.4, 299],
  [1604.4, 1605.3, 1603.8, 1604.9, 292],
  [1604.9, 1605.9, 1604.4, 1605.3, 310],
  [1605.3, 1606.0, 1604.7, 1605.1, 304],
  [1605.1, 1606.1, 1604.5, 1605.2, 318],
] as const;

const BASE_SPOT_ASKS = [
  { price: 1604.1, size: 45_000, total: 1_090_000 },
  { price: 1604.2, size: 60_000, total: 1_045_000 },
  { price: 1604.3, size: 80_000, total: 985_000 },
  { price: 1604.4, size: 110_000, total: 905_000 },
  { price: 1604.5, size: 130_000, total: 795_000 },
  { price: 1604.6, size: 155_000, total: 665_000 },
  { price: 1604.7, size: 190_000, total: 510_000 },
] as const;

const BASE_SPOT_BIDS = [
  { price: 1603.8, size: 200_000, total: 200_000 },
  { price: 1603.7, size: 170_000, total: 370_000 },
  { price: 1603.6, size: 145_000, total: 515_000 },
  { price: 1603.5, size: 120_000, total: 635_000 },
  { price: 1603.4, size: 95_000, total: 730_000 },
  { price: 1603.3, size: 72_000, total: 802_000 },
  { price: 1603.2, size: 58_000, total: 860_000 },
] as const;

const BASE_FUTURES_ASKS = [
  { price: 1605.6, size: 50_000, total: 1_305_000 },
  { price: 1605.7, size: 75_000, total: 1_255_000 },
  { price: 1605.8, size: 100_000, total: 1_180_000 },
  { price: 1605.9, size: 125_000, total: 1_080_000 },
  { price: 1606.0, size: 150_000, total: 955_000 },
  { price: 1606.1, size: 180_000, total: 805_000 },
  { price: 1606.2, size: 220_000, total: 625_000 },
] as const;

const BASE_FUTURES_BIDS = [
  { price: 1605.1, size: 240_000, total: 240_000 },
  { price: 1605.0, size: 210_000, total: 450_000 },
  { price: 1604.9, size: 180_000, total: 630_000 },
  { price: 1604.8, size: 150_000, total: 780_000 },
  { price: 1604.7, size: 120_000, total: 900_000 },
  { price: 1604.6, size: 90_000, total: 990_000 },
  { price: 1604.5, size: 70_000, total: 1_060_000 },
] as const;

const BASE_OPTIONS_CANDLES = [
  [61.2, 63.4, 60.8, 62.7, 180],
  [62.7, 64.1, 61.9, 63.6, 196],
  [63.6, 64.7, 62.8, 64.1, 208],
  [64.1, 65.4, 63.7, 64.8, 219],
  [64.8, 65.9, 64.2, 65.2, 224],
  [65.2, 66.4, 64.7, 65.9, 238],
  [65.9, 67.1, 65.4, 66.5, 247],
  [66.5, 67.8, 66.0, 67.2, 256],
  [67.2, 68.5, 66.8, 67.9, 268],
  [67.9, 69.4, 67.2, 68.8, 279],
  [68.8, 70.1, 68.1, 69.5, 286],
  [69.5, 71.0, 68.9, 70.3, 295],
  [70.3, 71.7, 69.6, 70.9, 304],
  [70.9, 72.4, 70.2, 71.5, 318],
  [71.5, 72.8, 70.8, 71.9, 327],
  [71.9, 72.5, 70.7, 71.2, 314],
  [71.2, 72.0, 70.4, 70.9, 301],
  [70.9, 71.6, 69.9, 70.4, 289],
  [70.4, 71.1, 69.2, 69.9, 276],
  [69.9, 70.8, 69.0, 69.5, 264],
] as const;

const BASE_OPTIONS_ASKS = [
  { price: 72.2, size: 180, total: 2120 },
  { price: 72.5, size: 220, total: 1940 },
  { price: 72.8, size: 260, total: 1720 },
  { price: 73.1, size: 320, total: 1460 },
  { price: 73.4, size: 380, total: 1140 },
  { price: 73.7, size: 420, total: 760 },
  { price: 74.0, size: 520, total: 340 },
] as const;

const BASE_OPTIONS_BIDS = [
  { price: 71.8, size: 410, total: 410 },
  { price: 71.5, size: 360, total: 770 },
  { price: 71.2, size: 310, total: 1080 },
  { price: 70.9, size: 280, total: 1360 },
  { price: 70.6, size: 240, total: 1600 },
  { price: 70.3, size: 200, total: 1800 },
  { price: 70.0, size: 160, total: 1960 },
] as const;

const SPOT_MARKET_META = {
  executable: "Preview only",
  id: "cngn-usdc-spot",
  mark: "1,603.90",
  settlement: "Immediate spot-style settlement",
} as const;

const OPTIONS_MARKET_META = {
  "JUN 2026": {
    id: "cngn-usdc-jun-2026-options",
    mark: "72.15",
    settlement: "Cash settled option premium",
    timeToExpiry: "101d",
  },
  "MAR 2026": {
    id: "cngn-usdc-mar-2026-options",
    mark: "38.40",
    settlement: "Cash settled option premium",
    timeToExpiry: "11d",
  },
} as const;

export const MARKET_DEFINITIONS = [
  {
    contractLabel: null,
    expiryDays: null,
    expiryLabel: null,
    flagSrc: "/flags/ng.svg",
    id: "cngn-usdc-spot",
    strikeLabel: null,
    type: "spot",
    pair: "USDCcNGN",
    region: "Africa",
    sortOrder: 0,
  },
  {
    contractLabel: "MAR 2026",
    expiryDays: 11,
    expiryLabel: "Mar 2026",
    flagSrc: "/flags/ng.svg",
    id: "cngn-usdc-mar-2026-options",
    strikeLabel: null,
    type: "option",
    pair: "USDCcNGN",
    region: "Africa",
    sortOrder: 1,
  },
  {
    contractLabel: "JUN 2026",
    expiryDays: 101,
    expiryLabel: "Jun 2026",
    flagSrc: "/flags/ng.svg",
    id: "cngn-usdc-jun-2026-options",
    strikeLabel: null,
    type: "option",
    pair: "USDCcNGN",
    region: "Africa",
    sortOrder: 2,
  },
] satisfies MarketDefinition[];

export const DEFAULT_MARKET_ID = "cngn-usdc-spot" satisfies MarketId;
export const DEFAULT_SYMBOL = "USDCcNGN";
export const DEFAULT_CONTRACT = "";
export const DEFAULT_TIMEFRAME = "1h";
export const DEFAULT_ORDER_TYPE = "Market";
export const DEFAULT_CHART_CONTEXT = "Price";
export const DEFAULT_BOTTOM_TAB = "positions";
export const DEFAULT_FILTER = "All";

function getContractDisplayLabel(label: string) {
  const [month, year] = label.split(" ");

  if (!month || !year) {
    return label;
  }

  return `${month[0]}${month.slice(1).toLowerCase()} ${year}`;
}

function parseNumber(value: string) {
  return Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));
}

function buildCandles(
  baseCandles: readonly (readonly [number, number, number, number, number])[],
  offset: number,
  digits: number,
) {
  return baseCandles.map(([open, high, low, close, volume], index) => ({
    close: Number((close + offset).toFixed(digits)),
    high: Number((high + offset).toFixed(digits)),
    low: Number((low + offset).toFixed(digits)),
    open: Number((open + offset).toFixed(digits)),
    time: `${String((index + 8) % 24).padStart(2, "0")}:00`,
    volume: volume + Math.round(offset * 8),
  })) satisfies Candle[];
}

function buildBook(
  levels: readonly { price: number; size: number; total: number }[],
  priceOffset: number,
  sizeMultiplier: number,
  digits: number,
) {
  return levels.map((level) => ({
    price: Number((level.price + priceOffset).toFixed(digits)),
    size: Math.round(level.size * sizeMultiplier),
    total: Math.round(level.total * sizeMultiplier),
  }));
}

function buildSpotTrades(mark: string) {
  const markNumber = parseNumber(mark);

  return [
    { price: markNumber + 0.05, side: "buy", size: 60_000, time: "10:08:14" },
    { price: markNumber, side: "sell", size: 35_000, time: "10:08:05" },
    { price: markNumber - 0.1, side: "buy", size: 42_000, time: "10:07:48" },
    { price: markNumber + 0.1, side: "buy", size: 28_000, time: "10:07:31" },
    { price: markNumber - 0.05, side: "sell", size: 30_000, time: "10:07:12" },
  ] satisfies TradePrint[];
}

function buildFuturesTrades(mark: string, basis: number) {
  const markNumber = parseNumber(mark);

  return [
    { price: markNumber + 0.05, side: "buy", size: 50_000, time: "10:08:14" },
    { price: markNumber, side: "sell", size: 35_000, time: "10:08:06" },
    { price: markNumber - 0.05, side: "sell", size: 75_000, time: "10:07:53" },
    { price: markNumber + basis / 10, side: "buy", size: 20_000, time: "10:07:41" },
    { price: markNumber, side: "buy", size: 15_000, time: "10:07:17" },
  ] satisfies TradePrint[];
}

function formatPriceWithConvention(value: string) {
  return `${value} cNGN per USDC`;
}

function getMarketAvailability({
  asks,
  bids,
  mark,
  trades,
}: {
  asks: { price: number }[];
  bids: { price: number }[];
  mark: string | null;
  trades: TradePrint[];
}) {
  return {
    bookAvailable: asks.length > 0 || bids.length > 0,
    markAvailable: mark !== null,
    tradesAvailable: trades.length > 0,
  } satisfies MarketAvailability;
}

function getSpotPositionOverview(mark: string) {
  return [
    { label: "Position", value: "+80,000 USDC" },
    { label: "Entry Price", value: formatPriceWithConvention(Number(parseNumber(mark) - 1.2).toFixed(2)) },
    { label: "Mark Price", value: formatPriceWithConvention(Number(parseNumber(mark)).toFixed(2)) },
    { label: "Unrealized PnL", value: "+$96" },
    { label: "Return %", value: "+0.12%" },
  ] satisfies DeliveryTerm[];
}

function getOptionsPositionOverview(label: keyof typeof OPTIONS_MARKET_META, mark: string) {
  return [
    { label: "Position (Contracts)", value: label === "MAR 2026" ? "+80 Calls" : "+120 Calls" },
    { label: "Entry Premium", value: Number(parseNumber(mark) - 1.1).toFixed(2) },
    { label: "Mark Premium", value: Number(parseNumber(mark)).toFixed(2) },
    { label: "Unrealized PnL", value: label === "MAR 2026" ? "+$420" : "+$690" },
  ] satisfies DeliveryTerm[];
}

function buildSpotMarket() {
  const displayPair = formatFxDisplayPair("USDCcNGN");

  return {
    availability: {
      bookAvailable: true,
      markAvailable: true,
      tradesAvailable: true,
    },
    candles: buildCandles(BASE_SPOT_CANDLES, 0, 2),
    contractDetails: [
      { label: "Market", value: `${displayPair} Spot` },
      { label: "Quote Convention", value: "cNGN per USDC" },
      { label: "Price", value: formatPriceWithConvention(SPOT_MARKET_META.mark) },
      { label: "Executable", value: SPOT_MARKET_META.executable },
      { label: "Settlement", value: SPOT_MARKET_META.settlement },
    ],
    id: SPOT_MARKET_META.id,
    infoBar: [
      { label: "Mark Price", value: formatPriceWithConvention(SPOT_MARKET_META.mark) },
      { label: "Basis", value: "—" },
      { label: "Basis %", value: "—" },
      { label: "Implied Carry", value: "—" },
      { label: "Expiry", value: "Spot" },
    ],
    mark: SPOT_MARKET_META.mark,
    orderBookAsks: buildBook(BASE_SPOT_ASKS, 0, 1, 2),
    orderBookBids: buildBook(BASE_SPOT_BIDS, 0, 1, 2),
    positionOverview: getSpotPositionOverview(SPOT_MARKET_META.mark),
    referencePrice: SPOT_MARKET_META.mark,
    ticker: `${displayPair} Spot`,
    timeToExpiry: "Spot",
    trades: buildSpotTrades(SPOT_MARKET_META.mark),
  } satisfies ContractMarket;
}

function buildOptionsMarket(label: keyof typeof OPTIONS_MARKET_META, offset: number, sizeMultiplier: number) {
  const meta = OPTIONS_MARKET_META[label];
  const displayLabel = getContractDisplayLabel(label);
  const displayPair = formatFxDisplayPair("USDCcNGN");

  return {
    availability: {
      bookAvailable: true,
      markAvailable: true,
      tradesAvailable: true,
    },
    candles: buildCandles(BASE_OPTIONS_CANDLES, offset, 2),
    contractDetails: [
      { label: "Contract", value: `${displayPair} Options` },
      { label: "Premium", value: meta.mark },
      { label: "Style", value: "European" },
      { label: "Days to expiry", value: meta.timeToExpiry.replace("d", "") },
      { label: "Settlement", value: meta.settlement },
    ],
    id: meta.id,
    infoBar: [
      { label: "Mark Price", value: meta.mark },
      { label: "Basis", value: "—" },
      { label: "Basis %", value: "—" },
      { label: "Implied Carry", value: "—" },
      { label: "Expiry", value: displayLabel },
    ],
    mark: meta.mark,
    orderBookAsks: buildBook(BASE_OPTIONS_ASKS, offset, sizeMultiplier, 2),
    orderBookBids: buildBook(BASE_OPTIONS_BIDS, offset, sizeMultiplier, 2),
    positionOverview: getOptionsPositionOverview(label, meta.mark),
    referencePrice: SPOT_MARKET_META.mark,
    ticker: `${displayPair} Options`,
    timeToExpiry: meta.timeToExpiry,
    trades: buildSpotTrades(meta.mark),
  } satisfies ContractMarket;
}

export const MARKET_DATA = {
  "cngn-usdc-spot": buildSpotMarket(),
  "cngn-usdc-jun-2026-options": buildOptionsMarket("JUN 2026", 0, 1),
  "cngn-usdc-mar-2026-options": buildOptionsMarket("MAR 2026", -6.4, 0.84),
} satisfies Record<MarketId, ContractMarket>;

type LiveDeliverableFutureConfig = {
  assetAddress: string;
  contractMultiplier?: string | null;
  expiryTimestamp: number;
  lastTradeTimestamp?: number | null;
  market: string;
  minSize?: string | null;
  subId: string;
  tickSize?: string | null;
};

type LiveDeliverableFutureRuntime = {
  book: BookResponse | null;
  definition: MarketDefinition;
  trades: PresentedTrade[];
};

type LiveSpotConfig = {
  assetAddress: string;
  market: string;
  subId: string;
  tickSize?: string | null;
};

type LiveSpotRuntime = {
  book: BookResponse | null;
  definition: MarketDefinition;
  trades: PresentedTrade[];
};

function formatExpiryLabelFromTimestamp(expiryTimestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(expiryTimestamp * 1000));
}

function formatContractLabelFromTimestamp(expiryTimestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })
    .format(new Date(expiryTimestamp * 1000))
    .toUpperCase();
}

function getExpiryDays(expiryTimestamp: number) {
  const millisecondsToExpiry = expiryTimestamp * 1000 - Date.now();

  return Math.max(0, Math.ceil(millisecondsToExpiry / (24 * 60 * 60 * 1000)));
}

export function buildDeliverableFutureDefinition(config: LiveDeliverableFutureConfig) {
  return {
    assetAddress: config.assetAddress,
    contractLabel: formatContractLabelFromTimestamp(config.expiryTimestamp),
    contractMultiplier: config.contractMultiplier ?? "10000",
    contractType: "deliverable_fx_future",
    expiryDays: getExpiryDays(config.expiryTimestamp),
    expiryLabel: formatExpiryLabelFromTimestamp(config.expiryTimestamp),
    expiryTimestamp: config.expiryTimestamp,
    flagSrc: "/flags/ng.svg",
    id: buildCanonicalMarketId(config.assetAddress, config.subId),
    lastTradeTimestamp: config.lastTradeTimestamp ?? null,
    marketIdAliases: [buildLegacyDerivedMarketId(config.market, config.subId)],
    marketSymbol: config.market,
    marketSymbolAliases: getMarketSymbolAliases(config.market),
    minSize: config.minSize ?? "0.001",
    pair: "USDCcNGN",
    region: "Africa",
    settlementType: "physical_delivery",
    sortOrder: config.expiryTimestamp,
    strikeLabel: null,
    subId: config.subId,
    tickSize: config.tickSize ?? "1",
    type: "future",
  } satisfies MarketDefinition;
}

export function buildSpotDefinition(config: LiveSpotConfig) {
  return {
    assetAddress: config.assetAddress,
    contractLabel: null,
    contractMultiplier: "1",
    contractType: "spot",
    expiryDays: null,
    expiryLabel: null,
    expiryTimestamp: null,
    flagSrc: "/flags/ng.svg",
    id: SPOT_MARKET_META.id,
    lastTradeTimestamp: null,
    marketSymbol: config.market,
    marketSymbolAliases: getMarketSymbolAliases(config.market),
    minSize: "0.000001",
    pair: "USDCcNGN",
    region: "Africa",
    settlementType: "spot",
    sortOrder: 0,
    strikeLabel: null,
    subId: config.subId,
    tickSize: config.tickSize ?? "1",
    type: "spot",
  } satisfies MarketDefinition;
}

export function buildDeliverableFutureMarket(definition: MarketDefinition) {
  const displayPair = formatFxDisplayPair(definition.pair);
  const displayLabel = definition.expiryLabel ?? "—";
  const mark = "1,605.25";
  const spot = SPOT_MARKET_META.mark;
  const basis = parseNumber(mark) - parseNumber(spot);
  const annualizedBasis = calculateAnnualizedBasisPercent(
    parseNumber(mark),
    parseNumber(spot),
    definition.expiryDays,
  );

  return {
    availability: {
      bookAvailable: true,
      markAvailable: true,
      tradesAvailable: true,
    },
    candles: buildCandles(BASE_FUTURES_CANDLES, 0, 2),
    contractDetails: [
      { label: "Contract", value: `${displayPair} Futures · ${displayLabel}` },
      { label: "Settlement", value: "Physical delivery" },
      { label: "Manager", value: "Dedicated DeliverableFXManager" },
      { label: "Contract Size", value: `${definition.contractMultiplier ?? "10000"} USDC` },
      { label: "Min Size", value: `${definition.minSize ?? "0.001"} contracts` },
      { label: "Tick Size", value: `${definition.tickSize ?? "1"} cNGN per USDC` },
      { label: "Mark Price", value: formatPriceWithConvention(mark) },
    ],
    id: definition.id,
    infoBar: [
      { label: "Mark Price", value: formatPriceWithConvention(mark) },
      { label: "Spot", value: formatPriceWithConvention(spot) },
      { label: "Basis", tone: "accent", value: formatBasis(basis) },
      { label: "Basis %", tone: "accent", value: `${((basis / parseNumber(spot)) * 100).toFixed(2)}%` },
      { label: "Implied Carry", tone: "accent", value: formatAnnualizedBasis(annualizedBasis) },
      { label: "Expiry", value: displayLabel },
    ],
    mark,
    orderBookAsks: buildBook(BASE_FUTURES_ASKS, 0, 1, 2),
    orderBookBids: buildBook(BASE_FUTURES_BIDS, 0, 1, 2),
    positionOverview: [
      { label: "Position", value: "Long USDC · 0.500 contracts" },
      { label: "Entry Price", value: formatPriceWithConvention("1,600.00") },
      { label: "Mark Price", value: formatPriceWithConvention(mark) },
      { label: "Unrealized PnL", value: "+$156" },
      { label: "Return %", value: "+0.64%" },
    ],
    referencePrice: spot,
    ticker: `${displayPair} Futures`,
    timeToExpiry: `${definition.expiryDays ?? 0}d`,
    trades: buildFuturesTrades(mark, basis),
  } satisfies ContractMarket;
}

export function buildLiveSpotMarketFromBook(
  definition: MarketDefinition,
  book: BookResponse | null,
  trades: PresentedTrade[],
) {
  const base = buildSpotMarket();
  const asks = buildLiveBookSide(book?.asks ?? [], "ask");
  const bids = buildLiveBookSide(book?.bids ?? [], "bid");
  const derivedMark = deriveMarkFromBook(asks, bids);
  const liveTrades = trades
    .map((trade) => ({
      price: Number(trade.spot_contract?.ui_intent.price ?? decimalStringToNumber(trade.price)),
      side: trade.spot_contract?.ui_intent.side ?? trade.aggressor_side,
      size: Math.round(Number(trade.spot_contract?.ui_intent.size ?? decimalStringToNumber(trade.size))),
      time: new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date(trade.created_at)),
    }))
    .filter((trade) => Number.isFinite(trade.price) && trade.price > 0 && Number.isFinite(trade.size) && trade.size > 0);

  return {
    ...base,
    availability: getMarketAvailability({
      asks,
      bids,
      mark: derivedMark,
      trades: liveTrades,
    }),
    contractDetails: [
      { label: "Market", value: `${formatFxDisplayPair(definition.pair)} Spot` },
      { label: "Quote Convention", value: "cNGN per USDC" },
      { label: "Price", value: derivedMark ? formatPriceWithConvention(derivedMark) : "—" },
      { label: "Executable", value: "Live on orderbook" },
      { label: "Settlement", value: "Immediate spot-style settlement" },
    ],
    id: definition.id,
    infoBar: base.infoBar.map((item) => {
      if (item.label === "Mark Price") {
        return {
          ...item,
          value: derivedMark ? formatPriceWithConvention(derivedMark) : "—",
        };
      }

      return item;
    }),
    mark: derivedMark ?? "—",
    orderBookAsks: asks,
    orderBookBids: bids,
    positionOverview: base.positionOverview.map((item) => {
      if (item.label === "Mark Price") {
        return {
          ...item,
          value: derivedMark ? formatPriceWithConvention(derivedMark) : "—",
        };
      }

      return item;
    }),
    trades: liveTrades,
  } satisfies ContractMarket;
}

function decimalStringToNumber(value: string, decimals = 18) {
  const normalized = value.trim();

  if (!normalized) {
    return 0;
  }

  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals, -decimals + 2);
  const formatted = `${negative ? "-" : ""}${whole}.${fraction}`;

  return Number(formatted);
}

function buildLiveBookSide(
  items: NonNullable<BookResponse["asks"]>,
  side: "ask" | "bid",
) {
  const levels = items
    .map((item) => ({
      price: Number(item.spot_contract?.ui_intent.price ?? decimalStringToNumber(item.limit_price)),
      size: Number(item.spot_contract?.ui_intent.size ?? decimalStringToNumber(item.desired_amount) * 10_000),
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.size) && level.size > 0);

  const ordered = [...levels].sort((left, right) => {
    return side === "ask" ? left.price - right.price : right.price - left.price;
  });

  if (side === "ask") {
    let runningTotal = 0;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      runningTotal += ordered[index]?.size ?? 0;
      if (ordered[index]) {
        ordered[index].size = Math.round(ordered[index].size);
        (ordered[index] as { total?: number }).total = Math.round(runningTotal);
      }
    }
  } else {
    let runningTotal = 0;
    for (const level of ordered) {
      runningTotal += level.size;
      level.size = Math.round(level.size);
      (level as { total?: number }).total = Math.round(runningTotal);
    }
  }

  return ordered.map((level) => ({
    price: level.price,
    size: level.size,
    total: (level as { total?: number }).total ?? level.size,
  }));
}

function deriveMarkFromBook(asks: { price: number }[], bids: { price: number }[]) {
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;

  if (bestAsk !== null && bestBid !== null) {
    return ((bestAsk + bestBid) / 2).toFixed(2);
  }

  if (bestAsk !== null) {
    return bestAsk.toFixed(2);
  }

  if (bestBid !== null) {
    return bestBid.toFixed(2);
  }

  return null;
}

function buildLiveDeliverableFutureMarket(
  definition: MarketDefinition,
  asks: ReturnType<typeof buildLiveBookSide>,
  bids: ReturnType<typeof buildLiveBookSide>,
  trades: TradePrint[],
) {
  const displayPair = formatFxDisplayPair(definition.pair);
  const displayLabel = definition.expiryLabel ?? "—";
  const spot = SPOT_MARKET_META.mark;
  const derivedMark = deriveMarkFromBook(asks, bids);
  const markValue = derivedMark ? formatPriceWithConvention(derivedMark) : "—";

  return {
    availability: getMarketAvailability({
      asks,
      bids,
      mark: derivedMark,
      trades,
    }),
    candles: buildCandles(BASE_FUTURES_CANDLES, 0, 2),
    contractDetails: [
      { label: "Contract", value: `${displayPair} Futures · ${displayLabel}` },
      { label: "Settlement", value: "Physical delivery" },
      { label: "Manager", value: "Dedicated DeliverableFXManager" },
      { label: "Contract Size", value: `${definition.contractMultiplier ?? "10000"} USDC` },
      { label: "Min Size", value: `${definition.minSize ?? "0.001"} contracts` },
      { label: "Tick Size", value: `${definition.tickSize ?? "1"} cNGN per USDC` },
      { label: "Mark Price", value: markValue },
    ],
    id: definition.id,
    infoBar: [
      { label: "Mark Price", value: markValue },
      { label: "Spot", value: formatPriceWithConvention(spot) },
      { label: "Basis", tone: "accent", value: "—" },
      { label: "Basis %", tone: "accent", value: "—" },
      { label: "Implied Carry", tone: "accent", value: "—" },
      { label: "Expiry", value: displayLabel },
    ],
    mark: derivedMark ?? "—",
    orderBookAsks: asks,
    orderBookBids: bids,
    positionOverview: [
      { label: "Position", value: "Long USDC · 0.500 contracts" },
      { label: "Entry Price", value: formatPriceWithConvention("1,600.00") },
      { label: "Mark Price", value: markValue },
      { label: "Unrealized PnL", value: "—" },
      { label: "Return %", value: "—" },
    ],
    referencePrice: spot,
    ticker: `${displayPair} Futures`,
    timeToExpiry: `${definition.expiryDays ?? 0}d`,
    trades,
  } satisfies ContractMarket;
}

export function buildDeliverableFutureMarketFromBook(
  definition: MarketDefinition,
  book: BookResponse | null,
  trades: PresentedTrade[],
) {
  const asks = buildLiveBookSide(book?.asks ?? [], "ask");
  const bids = buildLiveBookSide(book?.bids ?? [], "bid");
  const liveTrades = trades
    .map((trade) => ({
      price: decimalStringToNumber(trade.price),
      side: trade.aggressor_side,
      size: Math.round(decimalStringToNumber(trade.size) * 10_000),
      time: new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date(trade.created_at)),
    }))
    .filter((trade) => Number.isFinite(trade.price) && trade.price > 0 && Number.isFinite(trade.size) && trade.size > 0);

  return buildLiveDeliverableFutureMarket(definition, asks, bids, liveTrades);
}

export function buildTradingTerminalMarkets(
  liveSpot: LiveSpotRuntime | null,
  liveFutures: LiveDeliverableFutureRuntime[],
) {
  const fallbackSpotDefinition =
    MARKET_DEFINITIONS.find((marketDefinition) => marketDefinition.id === "cngn-usdc-spot") ?? null;
  const spotDefinition = liveSpot?.definition ?? fallbackSpotDefinition;
  const spotMarketData = liveSpot
    ? buildLiveSpotMarketFromBook(liveSpot.definition, liveSpot.book, liveSpot.trades)
    : MARKET_DATA["cngn-usdc-spot"];

  if (!liveFutures.length) {
    return {
      defaultContract: "",
      defaultMarketId: DEFAULT_MARKET_ID,
      marketData: {
        "cngn-usdc-spot": spotMarketData,
      } satisfies Record<MarketId, ContractMarket>,
      marketDefinitions: [spotDefinition].filter(Boolean) as MarketDefinition[],
    };
  }

  const sortedLiveFutures = [...liveFutures].sort((left, right) => {
    const leftExpiry = left.definition.expiryTimestamp ?? Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.definition.expiryTimestamp ?? Number.MAX_SAFE_INTEGER;

    return leftExpiry - rightExpiry;
  });
  const defaultFuture = sortedLiveFutures[0];
  const marketDefinitions = [
    spotDefinition,
    ...sortedLiveFutures.map((future) => future.definition),
  ].filter(Boolean) as MarketDefinition[];

  const marketData = {
    "cngn-usdc-spot": spotMarketData,
    ...Object.fromEntries(
      sortedLiveFutures.map((future) => [
        future.definition.id,
        buildDeliverableFutureMarketFromBook(future.definition, future.book, future.trades),
      ]),
    ),
  } satisfies Record<MarketId, ContractMarket>;

  return {
    defaultContract: defaultFuture?.definition.contractLabel ?? DEFAULT_CONTRACT,
    defaultMarketId: defaultFuture?.definition.id ?? DEFAULT_MARKET_ID,
    marketData,
    marketDefinitions,
  };
}

export const BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "trade-history", label: "Trade History" },
] satisfies ActivityTab[];

export const ACTIVITY_VIEWS = {
  "open-orders": {
    columns: ["Instrument", "Direction", "Type", "Size", "Price"],
    rows: [{ cells: ["USDC/cNGN Futures · Jun 2026", "Long cNGN", "Limit", "25,000 contracts", "1,604.80 cNGN per USDC"] }],
  },
  positions: {
    columns: ["Instrument", "Position", "Entry Price", "Mark Price", "Unrealized PnL", "Return %"],
    rows: [
      {
        cells: ["USDC/cNGN Futures · Jun 2026", "Long cNGN · 50,000 contracts", "1,600.00 cNGN per USDC", "1,605.20 cNGN per USDC", "+$156", "+0.64%"],
        positiveCellIndexes: [4, 5],
      },
    ],
  },
  "trade-history": {
    columns: ["Time", "Instrument", "Direction", "Size", "Price"],
    rows: [
      { cells: ["10:08:14", "USDC/cNGN Futures · Jun 2026", "Long cNGN", "50,000 contracts", "1,605.30 cNGN per USDC"] },
      { cells: ["10:08:06", "USDC/cNGN Futures · Jun 2026", "Short cNGN", "35,000 contracts", "1,605.20 cNGN per USDC"] },
    ],
  },
} satisfies Record<string, ActivityView>;

export const FILTER_OPTIONS = ["All", "Active", "Filled"] as const;
export const FOOTER_LINKS = [
  { href: "#", label: "Docs" },
  { href: "#", label: "Support" },
  { href: "#", label: "Terms" },
  { href: "#", label: "Privacy Policy" },
] as const;

export const CHART_RANGE_BUTTONS = ["5y", "1y", "6m", "3m", "1m", "5d", "1d"] as const;
export const CHART_CONTEXT_TABS = ["Price", "Spot", "Basis"] as const;
export const TIMEFRAME_OPTIONS = ["5m", "1h", "D"] as const;

export const CHART_TOOLS = [
  { id: "crosshair", label: "Crosshair" },
  { id: "cursor", label: "Select" },
  { id: "trend", label: "Trend Line" },
  { id: "horizontal", label: "Horizontal Line" },
  { id: "brush", label: "Brush" },
  { id: "highlighter", label: "Highlight" },
  { id: "measure", label: "Measure" },
  { id: "text", label: "Text" },
  { id: "compare", label: "Compare" },
  { id: "search", label: "Search" },
  { id: "erase", label: "Erase" },
  { id: "candles", label: "Candles" },
] satisfies ChartTool[];

export const CHART_TOOL_ICONS: Record<ChartTool["id"], LucideIcon> = {
  brush: Brush,
  candles: ChartCandlestick,
  compare: ArrowRightLeft,
  crosshair: Crosshair,
  cursor: SquareDashedMousePointer,
  erase: Eraser,
  highlighter: Highlighter,
  horizontal: Minus,
  measure: Ruler,
  search: Search,
  text: Type,
  trend: PenLine,
};
