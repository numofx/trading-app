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
import type { ActivityTab, ActivityView, Candle, ChartTool, ContractMarket, ContractTab, TradePrint } from "@/lib/trading.types";

const BASE_CANDLES = [
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

const BASE_ASKS = [
  { price: 1605.6, size: 50_000, total: 1_305_000 },
  { price: 1605.7, size: 75_000, total: 1_255_000 },
  { price: 1605.8, size: 100_000, total: 1_180_000 },
  { price: 1605.9, size: 125_000, total: 1_080_000 },
  { price: 1606.0, size: 150_000, total: 955_000 },
  { price: 1606.1, size: 180_000, total: 805_000 },
  { price: 1606.2, size: 220_000, total: 625_000 },
] as const;

const BASE_BIDS = [
  { price: 1605.1, size: 240_000, total: 240_000 },
  { price: 1605.0, size: 210_000, total: 450_000 },
  { price: 1604.9, size: 180_000, total: 630_000 },
  { price: 1604.8, size: 150_000, total: 780_000 },
  { price: 1604.7, size: 120_000, total: 900_000 },
  { price: 1604.6, size: 90_000, total: 990_000 },
  { price: 1604.5, size: 70_000, total: 1_060_000 },
] as const;

const CONTRACT_META = {
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

export const CONTRACT_TABS = Object.keys(CONTRACT_META).map((label) => ({
  active: label === "JUN 2026",
  label,
})) satisfies ContractTab[];

function getExpiryLabel(label: keyof typeof CONTRACT_META) {
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

function getPositionSize(label: keyof typeof CONTRACT_META) {
  if (label === "MAR 2026") {
    return "+20,000 USD";
  }

  if (label === "DEC 2026") {
    return "+10,000 USD";
  }

  return "+50,000 USD";
}

function getUnrealizedPnl(label: keyof typeof CONTRACT_META) {
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

function buildCandles(offset: number) {
  return BASE_CANDLES.map(([open, high, low, close, volume], index) => ({
    close: Number((close + offset).toFixed(1)),
    high: Number((high + offset).toFixed(1)),
    low: Number((low + offset).toFixed(1)),
    open: Number((open + offset).toFixed(1)),
    time: `${String((index + 8) % 24).padStart(2, "0")}:00`,
    volume: volume + Math.round(offset * 8),
  })) satisfies Candle[];
}

function buildBook(
  levels: readonly { price: number; size: number; total: number }[],
  priceOffset: number,
  sizeMultiplier: number,
) {
  return levels.map((level) => ({
    price: Number((level.price + priceOffset).toFixed(2)),
    size: Math.round(level.size * sizeMultiplier),
    total: Math.round(level.total * sizeMultiplier),
  }));
}

function buildTrades(mark: string, basis: string) {
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

function buildContractMarket(label: keyof typeof CONTRACT_META, offset: number, sizeMultiplier: number) {
  const meta = CONTRACT_META[label];

  return {
    basis: meta.basis,
    candles: buildCandles(offset),
    contractDetails: [
      { label: "Contract", value: `NGN/USD ${label}` },
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
      { label: "Contract", value: `NGN/USD ${label}` },
      { label: "Mark", value: meta.mark },
      { label: "Index", value: meta.index },
      { label: "Basis", tone: "accent", value: meta.basis },
      { label: "Vol", value: meta.volume },
      { label: "OI", value: meta.openInterest },
      { label: "Time to Expiry", value: meta.timeToExpiry },
    ],
    mark: meta.mark,
    orderBookAsks: buildBook(BASE_ASKS, offset, sizeMultiplier),
    orderBookBids: buildBook(BASE_BIDS, offset, sizeMultiplier),
    positionOverview: [
      { label: "Position (USD)", value: getPositionSize(label) },
      { label: "Entry Price", value: Number(parseNumber(meta.mark) - 5.2).toFixed(1) },
      { label: "Mark Price", value: Number(parseNumber(meta.mark)).toFixed(1) },
      { label: "Unrealized PnL", value: getUnrealizedPnl(label) },
    ],
    ticker: `NGN/USD ${label}`,
    timeToExpiry: meta.timeToExpiry,
    trades: buildTrades(meta.mark, meta.basis),
  } satisfies ContractMarket;
}

export const CONTRACT_MARKETS = {
  "DEC 2026": buildContractMarket("DEC 2026", 2.75, 0.72),
  "JUN 2026": buildContractMarket("JUN 2026", 0, 1),
  "MAR 2026": buildContractMarket("MAR 2026", -0.8, 0.78),
  "SEP 2026": buildContractMarket("SEP 2026", 1.3, 0.88),
} satisfies Record<string, ContractMarket>;

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
