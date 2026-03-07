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
import type {
  ActivityTab,
  ActivityView,
  Candle,
  ChartTool,
  ContractMarket,
  ContractTab,
  MarketOption,
  TradePrint,
} from "@/lib/trading.types";

const BASE_NGN_CANDLES = [
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

const BASE_EUR_CANDLES = [
  [1.0812, 1.0818, 1.0809, 1.0815, 180],
  [1.0815, 1.0824, 1.0811, 1.0820, 192],
  [1.0820, 1.0829, 1.0816, 1.0825, 201],
  [1.0825, 1.0833, 1.0821, 1.0828, 205],
  [1.0828, 1.0831, 1.0820, 1.0823, 188],
  [1.0823, 1.0830, 1.0819, 1.0826, 183],
  [1.0826, 1.0834, 1.0822, 1.0831, 208],
  [1.0831, 1.0839, 1.0826, 1.0835, 219],
  [1.0835, 1.0842, 1.0830, 1.0839, 224],
  [1.0839, 1.0848, 1.0834, 1.0844, 237],
  [1.0844, 1.0851, 1.0840, 1.0848, 249],
  [1.0848, 1.0856, 1.0844, 1.0851, 258],
  [1.0851, 1.0859, 1.0847, 1.0855, 267],
  [1.0855, 1.0862, 1.0851, 1.0858, 274],
  [1.0858, 1.0866, 1.0853, 1.0861, 283],
  [1.0861, 1.0865, 1.0854, 1.0857, 278],
  [1.0857, 1.0860, 1.0850, 1.0854, 270],
  [1.0854, 1.0857, 1.0848, 1.0850, 261],
  [1.0850, 1.0855, 1.0845, 1.0848, 255],
  [1.0848, 1.0853, 1.0844, 1.0850, 248],
  [1.0850, 1.0854, 1.0846, 1.0852, 242],
  [1.0852, 1.0857, 1.0848, 1.0850, 239],
  [1.0850, 1.0853, 1.0845, 1.0847, 233],
  [1.0847, 1.0851, 1.0842, 1.0845, 228],
  [1.0845, 1.0850, 1.0840, 1.0848, 225],
  [1.0848, 1.0854, 1.0844, 1.0851, 231],
  [1.0851, 1.0857, 1.0847, 1.0850, 229],
  [1.0850, 1.0856, 1.0846, 1.0852, 235],
] as const;

const BASE_NGN_ASKS = [
  { price: 1605.6, size: 50_000, total: 1_305_000 },
  { price: 1605.7, size: 75_000, total: 1_255_000 },
  { price: 1605.8, size: 100_000, total: 1_180_000 },
  { price: 1605.9, size: 125_000, total: 1_080_000 },
  { price: 1606.0, size: 150_000, total: 955_000 },
  { price: 1606.1, size: 180_000, total: 805_000 },
  { price: 1606.2, size: 220_000, total: 625_000 },
] as const;

const BASE_NGN_BIDS = [
  { price: 1605.1, size: 240_000, total: 240_000 },
  { price: 1605.0, size: 210_000, total: 450_000 },
  { price: 1604.9, size: 180_000, total: 630_000 },
  { price: 1604.8, size: 150_000, total: 780_000 },
  { price: 1604.7, size: 120_000, total: 900_000 },
  { price: 1604.6, size: 90_000, total: 990_000 },
  { price: 1604.5, size: 70_000, total: 1_060_000 },
] as const;

const BASE_EUR_ASKS = [
  { price: 1.0853, size: 250_000, total: 2_950_000 },
  { price: 1.0854, size: 500_000, total: 2_700_000 },
  { price: 1.0855, size: 750_000, total: 2_200_000 },
  { price: 1.0856, size: 900_000, total: 1_450_000 },
  { price: 1.0857, size: 1_100_000, total: 550_000 },
  { price: 1.0858, size: 1_400_000, total: 450_000 },
  { price: 1.0859, size: 1_800_000, total: 300_000 },
] as const;

const BASE_EUR_BIDS = [
  { price: 1.0852, size: 1_900_000, total: 1_900_000 },
  { price: 1.0851, size: 1_500_000, total: 3_400_000 },
  { price: 1.0850, size: 1_200_000, total: 4_600_000 },
  { price: 1.0849, size: 950_000, total: 5_550_000 },
  { price: 1.0848, size: 700_000, total: 6_250_000 },
  { price: 1.0847, size: 550_000, total: 6_800_000 },
  { price: 1.0846, size: 400_000, total: 7_200_000 },
] as const;

const NGN_CONTRACT_META = {
  "DEC 2026": {
    basis: "+4.10",
    id: "DEC 2026",
    index: "1,603.90",
    mark: "1,608.00",
    openInterest: "$34.1M",
    timeToExpiry: "284d",
    volume: "$2.9M",
  },
  "JUN 2026": {
    basis: "+1.35",
    id: "JUN 2026",
    index: "1,603.90",
    mark: "1,605.25",
    openInterest: "$48.3M",
    timeToExpiry: "101d",
    volume: "$6.2M",
  },
  "MAR 2026": {
    basis: "+0.55",
    id: "MAR 2026",
    index: "1,603.90",
    mark: "1,604.45",
    openInterest: "$22.4M",
    timeToExpiry: "11d",
    volume: "$3.8M",
  },
  "SEP 2026": {
    basis: "+2.65",
    id: "SEP 2026",
    index: "1,603.90",
    mark: "1,606.55",
    openInterest: "$39.7M",
    timeToExpiry: "193d",
    volume: "$4.7M",
  },
} as const satisfies Record<
  string,
  {
    basis: string;
    id: string;
    index: string;
    mark: string;
    openInterest: string;
    timeToExpiry: string;
    volume: string;
  }
>;

const EUR_CONTRACT_META = {
  "DEC 2026": {
    basis: "+0.0032",
    id: "DEC 2026",
    index: "1.0849",
    mark: "1.0881",
    openInterest: "$91.4M",
    timeToExpiry: "284d",
    volume: "$18.6M",
  },
  "JUN 2026": {
    basis: "+0.0011",
    id: "JUN 2026",
    index: "1.0841",
    mark: "1.0852",
    openInterest: "$128.7M",
    timeToExpiry: "101d",
    volume: "$24.9M",
  },
  "MAR 2026": {
    basis: "+0.0004",
    id: "MAR 2026",
    index: "1.0839",
    mark: "1.0843",
    openInterest: "$74.5M",
    timeToExpiry: "11d",
    volume: "$15.2M",
  },
  "SEP 2026": {
    basis: "+0.0019",
    id: "SEP 2026",
    index: "1.0844",
    mark: "1.0863",
    openInterest: "$109.2M",
    timeToExpiry: "193d",
    volume: "$21.1M",
  },
} as const satisfies Record<
  string,
  {
    basis: string;
    id: string;
    index: string;
    mark: string;
    openInterest: string;
    timeToExpiry: string;
    volume: string;
  }
>;

export const CONTRACT_LABELS = ["MAR 2026", "JUN 2026", "SEP 2026", "DEC 2026"] as const;

export const CONTRACT_TABS = CONTRACT_LABELS.map((label) => ({
  active: label === "JUN 2026",
  label,
})) satisfies ContractTab[];

export const MARKET_OPTIONS = [
  {
    frontMonth: "MAR26",
    id: "ngn-usd-futures",
    lastPrice: "1,576.80",
    marketType: "Futures",
    region: "Africa",
    symbol: "NGN/USD",
  },
  {
    frontMonth: "SPOT",
    id: "ngn-usd-spot",
    lastPrice: "1,603.90",
    marketType: "Spot",
    region: "Africa",
    symbol: "NGN/USD",
  },
  {
    frontMonth: "JUN26",
    id: "eur-usd-futures",
    lastPrice: "1.08520",
    marketType: "Futures",
    region: "Europe",
    symbol: "EUR/USD",
  },
  {
    frontMonth: "SPOT",
    id: "eur-usd-spot",
    lastPrice: "1.08410",
    marketType: "Spot",
    region: "Europe",
    symbol: "EUR/USD",
  },
] satisfies MarketOption[];

function getExpiryLabel(label: keyof typeof NGN_CONTRACT_META) {
  if (label === "MAR 2026") {
    return "March 18";
  }

  if (label === "JUN 2026") {
    return "June 17";
  }

  if (label === "SEP 2026") {
    return "September 16";
  }

  return "December 16";
}

function getPositionSize(label: keyof typeof NGN_CONTRACT_META) {
  if (label === "MAR 2026") {
    return "+20,000 USD";
  }

  if (label === "DEC 2026") {
    return "+10,000 USD";
  }

  return "+50,000 USD";
}

function getUnrealizedPnl(label: keyof typeof NGN_CONTRACT_META) {
  if (label === "DEC 2026") {
    return "+$84";
  }

  if (label === "MAR 2026") {
    return "+$61";
  }

  return "+$156";
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

function buildNgnTrades(mark: string, basis: string) {
  const markNumber = parseNumber(mark);
  const basisNumber = parseNumber(basis);

  return [
    { price: markNumber + 0.05, side: "buy", size: 50_000, time: "10:08:14" },
    { price: markNumber, side: "sell", size: 35_000, time: "10:08:06" },
    { price: markNumber - 0.05, side: "sell", size: 75_000, time: "10:07:53" },
    { price: markNumber + basisNumber / 10, side: "buy", size: 20_000, time: "10:07:41" },
    { price: markNumber, side: "buy", size: 15_000, time: "10:07:17" },
  ] satisfies TradePrint[];
}

function buildEurTrades(mark: string, basis: string) {
  const markNumber = parseNumber(mark);
  const basisNumber = parseNumber(basis);

  return [
    { price: Number((markNumber + 0.0001).toFixed(4)), side: "buy", size: 2_000_000, time: "10:08:14" },
    { price: Number(markNumber.toFixed(4)), side: "sell", size: 1_250_000, time: "10:08:06" },
    { price: Number((markNumber - 0.0001).toFixed(4)), side: "sell", size: 1_800_000, time: "10:07:53" },
    { price: Number((markNumber + basisNumber / 8).toFixed(4)), side: "buy", size: 950_000, time: "10:07:41" },
    { price: Number(markNumber.toFixed(4)), side: "buy", size: 800_000, time: "10:07:17" },
  ] satisfies TradePrint[];
}

function buildNgnContractMarket(
  symbol: string,
  label: keyof typeof NGN_CONTRACT_META,
  offset: number,
  sizeMultiplier: number,
) {
  const meta = NGN_CONTRACT_META[label];

  return {
    basis: meta.basis,
    candles: buildCandles(BASE_NGN_CANDLES, offset, 1),
    contractDetails: [
      { label: "Contract", value: `${symbol} ${label}` },
      { label: "Contract Size", value: "10,000 USD" },
      { label: "Tick Size", value: "0.1 NGN" },
      { label: "Tick Value", value: "$0.62 / 1.0 NGN" },
      { label: "Expiry", value: `${getExpiryLabel(label)}, 2026, 16:00 UTC` },
      { label: "Settlement", value: "Physical stablecoin delivery" },
      { label: "Long receives", value: "cNGN" },
      { label: "Short receives", value: "USDC" },
    ],
    id: label,
    index: meta.index,
    infoBar: [
      { label: "Contract", value: `${symbol} ${label}` },
      { label: "Mark", value: meta.mark },
      { label: "Index", value: meta.index },
      { label: "Basis", tone: "accent", value: meta.basis },
      { label: "Vol", value: meta.volume },
      { label: "OI", value: meta.openInterest },
      { label: "Time to Expiry", value: meta.timeToExpiry },
    ],
    mark: meta.mark,
    orderBookAsks: buildBook(BASE_NGN_ASKS, offset, sizeMultiplier, 2),
    orderBookBids: buildBook(BASE_NGN_BIDS, offset, sizeMultiplier, 2),
    positionOverview: [
      { label: "Position (USD)", value: getPositionSize(label) },
      { label: "Entry Price", value: Number(parseNumber(meta.mark) - 5.2).toFixed(1) },
      { label: "Mark Price", value: Number(parseNumber(meta.mark)).toFixed(1) },
      { label: "Unrealized PnL", value: getUnrealizedPnl(label) },
    ],
    ticker: `${symbol} ${label}`,
    timeToExpiry: meta.timeToExpiry,
    trades: buildNgnTrades(meta.mark, meta.basis),
  } satisfies ContractMarket;
}

function buildEurContractMarket(
  symbol: string,
  label: keyof typeof EUR_CONTRACT_META,
  offset: number,
  sizeMultiplier: number,
) {
  const meta = EUR_CONTRACT_META[label];

  return {
    basis: meta.basis,
    candles: buildCandles(BASE_EUR_CANDLES, offset, 4),
    contractDetails: [
      { label: "Contract", value: `${symbol} ${label}` },
      { label: "Contract Size", value: "125,000 EUR" },
      { label: "Tick Size", value: "0.00005 USD" },
      { label: "Tick Value", value: "$6.25 / tick" },
      { label: "Expiry", value: `${getExpiryLabel(label)}, 2026, 16:00 UTC` },
      { label: "Settlement", value: "Physically deliverable FX future" },
      { label: "Long receives", value: "USD" },
      { label: "Short receives", value: "EUR" },
    ],
    id: label,
    index: meta.index,
    infoBar: [
      { label: "Contract", value: `${symbol} ${label}` },
      { label: "Mark", value: meta.mark },
      { label: "Index", value: meta.index },
      { label: "Basis", tone: "accent", value: meta.basis },
      { label: "Vol", value: meta.volume },
      { label: "OI", value: meta.openInterest },
      { label: "Time to Expiry", value: meta.timeToExpiry },
    ],
    mark: meta.mark,
    orderBookAsks: buildBook(BASE_EUR_ASKS, offset, sizeMultiplier, 4),
    orderBookBids: buildBook(BASE_EUR_BIDS, offset, sizeMultiplier, 4),
    positionOverview: [
      { label: "Position (EUR)", value: "+375,000 EUR" },
      { label: "Entry Price", value: Number(parseNumber(meta.mark) - 0.0024).toFixed(4) },
      { label: "Mark Price", value: Number(parseNumber(meta.mark)).toFixed(4) },
      { label: "Unrealized PnL", value: "+$1,125" },
    ],
    ticker: `${symbol} ${label}`,
    timeToExpiry: meta.timeToExpiry,
    trades: buildEurTrades(meta.mark, meta.basis),
  } satisfies ContractMarket;
}

function buildInstrumentMarkets(symbol: "EUR/USD" | "NGN/USD") {
  if (symbol === "EUR/USD") {
    return {
      "DEC 2026": buildEurContractMarket(symbol, "DEC 2026", 0.0029, 0.92),
      "JUN 2026": buildEurContractMarket(symbol, "JUN 2026", 0, 1),
      "MAR 2026": buildEurContractMarket(symbol, "MAR 2026", -0.0009, 0.86),
      "SEP 2026": buildEurContractMarket(symbol, "SEP 2026", 0.0012, 0.95),
    } satisfies Record<string, ContractMarket>;
  }

  return {
    "DEC 2026": buildNgnContractMarket(symbol, "DEC 2026", 2.75, 0.72),
    "JUN 2026": buildNgnContractMarket(symbol, "JUN 2026", 0, 1),
    "MAR 2026": buildNgnContractMarket(symbol, "MAR 2026", -0.8, 0.78),
    "SEP 2026": buildNgnContractMarket(symbol, "SEP 2026", 1.3, 0.88),
  } satisfies Record<string, ContractMarket>;
}

export const INSTRUMENT_MARKETS = {
  "EUR/USD": buildInstrumentMarkets("EUR/USD"),
  "NGN/USD": buildInstrumentMarkets("NGN/USD"),
} satisfies Record<string, Record<string, ContractMarket>>;

export const DEFAULT_SYMBOL = "NGN/USD";
export const DEFAULT_CONTRACT = "JUN 2026";
export const DEFAULT_TIMEFRAME = "1h";
export const DEFAULT_ORDER_TYPE = "Market";
export const DEFAULT_CHART_CONTEXT = "Futures";
export const DEFAULT_BOTTOM_TAB = "positions";
export const DEFAULT_FILTER = "All";

export const BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "trade-history", label: "Trade History" },
] satisfies ActivityTab[];

export const ACTIVITY_VIEWS = {
  "open-orders": {
    columns: ["Instrument", "Side", "Type", "Size", "Price"],
    rows: [{ cells: ["NGN/USD JUN 2026", "Buy USD", "Limit", "25,000", "1,604.80"] }],
  },
  positions: {
    columns: ["Instrument", "Position", "Entry Price", "Mark", "PnL"],
    rows: [{ cells: ["NGN/USD JUN 2026", "+50,000 USD", "1,600.0", "1,605.2", "+$156"], positiveCellIndexes: [4] }],
  },
  "trade-history": {
    columns: ["Time", "Instrument", "Side", "Size", "Price"],
    rows: [
      { cells: ["10:08:14", "NGN/USD JUN 2026", "Buy USD", "50,000", "1,605.30"] },
      { cells: ["10:08:06", "NGN/USD JUN 2026", "Sell USD", "35,000", "1,605.20"] },
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
export const CHART_CONTEXT_TABS = ["Futures", "Spot", "Basis"] as const;
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
