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
import { calculateAnnualizedBasisPercent, formatAnnualizedBasis, formatBasis } from "@/lib/market-formatting";
import type {
  ActivityTab,
  ActivityView,
  Candle,
  ChartTool,
  ContractMarket,
  ContractTab,
  DeliveryTerm,
  MarketDefinition,
  MarketId,
  TradePrint,
} from "@/lib/trading.types";

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
  executable: "Live on venue",
  id: "cngn-usdc-spot",
  mark: "1,603.90",
  settlement: "Physical (cNGN/USDC)",
} as const;

const FUTURES_MARKET_META = {
  "JUN 2026": {
    id: "cngn-usdc-jun-2026-futures",
    mark: "1,605.25",
    openInterest: "$48.3M",
    settlement: "Physical (cNGN/USDC)",
    timeToExpiry: "101d",
    volume: "$6.2M",
  },
  "MAR 2026": {
    id: "cngn-usdc-mar-2026-futures",
    mark: "1,604.45",
    openInterest: "$22.4M",
    settlement: "Physical (cNGN/USDC)",
    timeToExpiry: "11d",
    volume: "$3.8M",
  },
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

export const CONTRACT_LABELS = ["MAR 2026", "JUN 2026"] as const;

export const CONTRACT_TABS = CONTRACT_LABELS.map((label) => ({
  active: label === "JUN 2026",
  label,
})) satisfies ContractTab[];

export const MARKET_DEFINITIONS = [
  {
    contractLabel: null,
    expiryDays: null,
    expiryLabel: null,
    flagSrc: "/flags/ng.cvg.svg",
    id: "cngn-usdc-spot",
    type: "spot",
    pair: "cNGN/USDC",
    region: "Africa",
    sortOrder: 0,
  },
  {
    contractLabel: "MAR 2026",
    expiryDays: 11,
    expiryLabel: "Mar 2026",
    flagSrc: "/flags/ng.cvg.svg",
    id: "cngn-usdc-mar-2026-futures",
    type: "future",
    pair: "cNGN/USDC",
    region: "Africa",
    sortOrder: 1,
  },
  {
    contractLabel: "JUN 2026",
    expiryDays: 101,
    expiryLabel: "Jun 2026",
    flagSrc: "/flags/ng.cvg.svg",
    id: "cngn-usdc-jun-2026-futures",
    type: "future",
    pair: "cNGN/USDC",
    region: "Africa",
    sortOrder: 2,
  },
  {
    contractLabel: "MAR 2026",
    expiryDays: 11,
    expiryLabel: "Mar 2026",
    flagSrc: "/flags/ng.cvg.svg",
    id: "cngn-usdc-mar-2026-options",
    type: "option",
    pair: "cNGN/USDC",
    region: "Africa",
    sortOrder: 3,
  },
  {
    contractLabel: "JUN 2026",
    expiryDays: 101,
    expiryLabel: "Jun 2026",
    flagSrc: "/flags/ng.cvg.svg",
    id: "cngn-usdc-jun-2026-options",
    type: "option",
    pair: "cNGN/USDC",
    region: "Africa",
    sortOrder: 4,
  },
] satisfies MarketDefinition[];

export const DEFAULT_MARKET_ID = "cngn-usdc-jun-2026-futures" satisfies MarketId;
export const DEFAULT_SYMBOL = "cNGN/USDC";
export const DEFAULT_CONTRACT = "JUN 2026";
export const DEFAULT_TIMEFRAME = "1h";
export const DEFAULT_ORDER_TYPE = "Market";
export const DEFAULT_CHART_CONTEXT = "Futures";
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

function getSpotPositionOverview(mark: string) {
  return [
    { label: "Position (USDC)", value: "+80,000 USDC" },
    { label: "Entry Price", value: Number(parseNumber(mark) - 1.2).toFixed(2) },
    { label: "Mark Price", value: Number(parseNumber(mark)).toFixed(2) },
    { label: "Unrealized PnL", value: "+$96" },
  ] satisfies DeliveryTerm[];
}

function getFuturesPositionOverview(label: keyof typeof FUTURES_MARKET_META, mark: string) {
  return [
    { label: "Position (USD)", value: label === "MAR 2026" ? "+20,000 USD" : "+50,000 USD" },
    { label: "Entry Price", value: Number(parseNumber(mark) - 5.2).toFixed(2) },
    { label: "Mark Price", value: Number(parseNumber(mark)).toFixed(2) },
    { label: "Unrealized PnL", value: label === "MAR 2026" ? "+$61" : "+$156" },
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
  return {
    candles: buildCandles(BASE_SPOT_CANDLES, 0, 2),
    contractDetails: [
      { label: "Market", value: "cNGN/USDC Spot" },
      { label: "Price", value: SPOT_MARKET_META.mark },
      { label: "Executable", value: SPOT_MARKET_META.executable },
      { label: "Settlement", value: SPOT_MARKET_META.settlement },
    ],
    id: SPOT_MARKET_META.id,
    infoBar: [
      { label: "Price", value: SPOT_MARKET_META.mark },
      { label: "Basis", value: "—" },
      { label: "Basis %", value: "—" },
      { label: "Expiry", value: "Spot" },
    ],
    mark: SPOT_MARKET_META.mark,
    orderBookAsks: buildBook(BASE_SPOT_ASKS, 0, 1, 2),
    orderBookBids: buildBook(BASE_SPOT_BIDS, 0, 1, 2),
    positionOverview: getSpotPositionOverview(SPOT_MARKET_META.mark),
    referencePrice: SPOT_MARKET_META.mark,
    ticker: "cNGN/USDC Spot",
    timeToExpiry: "Spot",
    trades: buildSpotTrades(SPOT_MARKET_META.mark),
  } satisfies ContractMarket;
}

function buildFuturesMarket(label: keyof typeof FUTURES_MARKET_META, offset: number, sizeMultiplier: number) {
  const meta = FUTURES_MARKET_META[label];
  const daysToExpiry = Number(meta.timeToExpiry.replace("d", ""));
  const displayLabel = getContractDisplayLabel(label);
  const mark = parseNumber(meta.mark);
  const spot = parseNumber(SPOT_MARKET_META.mark);
  const basis = mark - spot;
  const annualizedBasis = calculateAnnualizedBasisPercent(mark, spot, daysToExpiry);

  return {
    candles: buildCandles(BASE_FUTURES_CANDLES, offset, 2),
    contractDetails: [
      { label: "Contract", value: `cNGN/USDC ${displayLabel}` },
      { label: "Price", value: meta.mark },
      { label: "Basis vs spot", value: formatBasis(basis) },
      { label: "Days to expiry", value: String(daysToExpiry) },
      { label: "Settlement", value: meta.settlement },
    ],
    id: meta.id,
    infoBar: [
      { label: "Price", value: meta.mark },
      { label: "Basis", tone: "accent", value: formatBasis(basis) },
      { label: "Basis %", tone: "accent", value: formatAnnualizedBasis(annualizedBasis) },
      { label: "Expiry", value: displayLabel },
    ],
    mark: meta.mark,
    orderBookAsks: buildBook(BASE_FUTURES_ASKS, offset, sizeMultiplier, 2),
    orderBookBids: buildBook(BASE_FUTURES_BIDS, offset, sizeMultiplier, 2),
    positionOverview: getFuturesPositionOverview(label, meta.mark),
    referencePrice: SPOT_MARKET_META.mark,
    ticker: `cNGN/USDC ${displayLabel}`,
    timeToExpiry: meta.timeToExpiry,
    trades: buildFuturesTrades(meta.mark, basis),
  } satisfies ContractMarket;
}

function buildOptionsMarket(label: keyof typeof OPTIONS_MARKET_META, offset: number, sizeMultiplier: number) {
  const meta = OPTIONS_MARKET_META[label];
  const displayLabel = getContractDisplayLabel(label);

  return {
    candles: buildCandles(BASE_OPTIONS_CANDLES, offset, 2),
    contractDetails: [
      { label: "Contract", value: `cNGN/USDC ${displayLabel} Options` },
      { label: "Premium", value: meta.mark },
      { label: "Style", value: "European" },
      { label: "Days to expiry", value: meta.timeToExpiry.replace("d", "") },
      { label: "Settlement", value: meta.settlement },
    ],
    id: meta.id,
    infoBar: [
      { label: "Price", value: meta.mark },
      { label: "Basis", value: "—" },
      { label: "Basis %", value: "—" },
      { label: "Expiry", value: displayLabel },
    ],
    mark: meta.mark,
    orderBookAsks: buildBook(BASE_OPTIONS_ASKS, offset, sizeMultiplier, 2),
    orderBookBids: buildBook(BASE_OPTIONS_BIDS, offset, sizeMultiplier, 2),
    positionOverview: getOptionsPositionOverview(label, meta.mark),
    referencePrice: SPOT_MARKET_META.mark,
    ticker: `cNGN/USDC ${displayLabel} Options`,
    timeToExpiry: meta.timeToExpiry,
    trades: buildSpotTrades(meta.mark),
  } satisfies ContractMarket;
}

export const MARKET_DATA = {
  "cngn-usdc-jun-2026-futures": buildFuturesMarket("JUN 2026", 0, 1),
  "cngn-usdc-mar-2026-futures": buildFuturesMarket("MAR 2026", -0.8, 0.78),
  "cngn-usdc-spot": buildSpotMarket(),
  "cngn-usdc-jun-2026-options": buildOptionsMarket("JUN 2026", 0, 1),
  "cngn-usdc-mar-2026-options": buildOptionsMarket("MAR 2026", -6.4, 0.84),
} satisfies Record<MarketId, ContractMarket>;

export const BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "trade-history", label: "Trade History" },
] satisfies ActivityTab[];

export const ACTIVITY_VIEWS = {
  "open-orders": {
    columns: ["Instrument", "Side", "Type", "Size", "Price"],
    rows: [{ cells: ["cNGN/USDC Jun 2026", "Buy USD", "Limit", "25,000", "1,604.80"] }],
  },
  positions: {
    columns: ["Instrument", "Position", "Entry Price", "Mark", "PnL"],
    rows: [{ cells: ["cNGN/USDC Jun 2026", "+50,000 USD", "1,600.0", "1,605.2", "+$156"], positiveCellIndexes: [4] }],
  },
  "trade-history": {
    columns: ["Time", "Instrument", "Side", "Size", "Price"],
    rows: [
      { cells: ["10:08:14", "cNGN/USDC Jun 2026", "Buy USD", "50,000", "1,605.30"] },
      { cells: ["10:08:06", "cNGN/USDC Jun 2026", "Sell USD", "35,000", "1,605.20"] },
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
