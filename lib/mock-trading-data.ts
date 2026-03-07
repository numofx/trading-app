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
  Candle,
  ChartTool,
  ContractTab,
  DeliveryTerm,
  MarketStat,
  OrderBookLevel,
} from "@/lib/trading.types";

export const MARKET_STATS = [
  { label: "Contract", value: "USD/NGN JUN 2026" },
  { label: "Mark", value: "1,605.25" },
  { label: "Index (Spot)", value: "1,603.90" },
  { label: "Basis (Mark - Spot)", tone: "accent", value: "+1.35" },
  { label: "24H Volume", value: "$6.2M" },
  { label: "Open Interest", value: "$48.3M" },
  { label: "Time to Expiry", value: "101d 06h" },
] satisfies MarketStat[];

export const CONTRACT_TABS = [
  { label: "MAR 2026" },
  { active: true, label: "JUN 2026" },
  { label: "SEP 2026" },
  { label: "DEC 2026" },
] satisfies ContractTab[];

const CANDLE_VALUES = [
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

export const CHART_CANDLES = CANDLE_VALUES.map(([open, high, low, close, volume], index) => ({
  close,
  high,
  low,
  open,
  time: `${String(index + 8).padStart(2, "0")}:00`,
  volume,
})) satisfies Candle[];

export const ORDER_BOOK_ASKS = [
  { price: 1605.6, size: 50_000, total: 1_305_000 },
  { price: 1605.7, size: 75_000, total: 1_255_000 },
  { price: 1605.8, size: 100_000, total: 1_180_000 },
  { price: 1605.9, size: 125_000, total: 1_080_000 },
  { price: 1606.0, size: 150_000, total: 955_000 },
  { price: 1606.1, size: 180_000, total: 805_000 },
  { price: 1606.2, size: 220_000, total: 625_000 },
] satisfies OrderBookLevel[];

export const ORDER_BOOK_BIDS = [
  { price: 1605.1, size: 240_000, total: 240_000 },
  { price: 1605.0, size: 210_000, total: 450_000 },
  { price: 1604.9, size: 180_000, total: 630_000 },
  { price: 1604.8, size: 150_000, total: 780_000 },
  { price: 1604.7, size: 120_000, total: 900_000 },
  { price: 1604.6, size: 90_000, total: 990_000 },
  { price: 1604.5, size: 70_000, total: 1_060_000 },
] satisfies OrderBookLevel[];

export const BOTTOM_TABS = [
  { id: "balances", label: "Balances" },
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "calendar-roll", label: "Calendar Roll" },
  { id: "trade-history", label: "Trade History" },
  { id: "deliveries", label: "Deliveries" },
  { id: "order-history", label: "Order History" },
] satisfies ActivityTab[];

export const FOOTER_LINKS = [
  { href: "#", label: "Docs" },
  { href: "#", label: "Support" },
  { href: "#", label: "Terms" },
  { href: "#", label: "Privacy Policy" },
] as const;

export const CHART_RANGE_BUTTONS = ["5y", "1y", "6m", "3m", "1m", "5d", "1d"] as const;

export const CHART_CONTEXT_TABS = ["Futures", "Spot", "Basis"] as const;

export const CONTRACT_DETAILS = [
  { label: "Contract", value: "USD/NGN JUN 2026" },
  { label: "Contract Size", value: "10,000 USD" },
  { label: "Tick Size", value: "0.1 NGN" },
  { label: "Tick Value", value: "$0.62 / 1.0 NGN" },
  { label: "Expiry", value: "June 17, 2026, 16:00 UTC" },
  { label: "Settlement", value: "Physical stablecoin delivery" },
  { label: "Long receives", value: "cNGN" },
  { label: "Short receives", value: "USDC" },
] satisfies DeliveryTerm[];

export const POSITION_OVERVIEW = [
  { label: "Position (USD)", value: "+50,000 USD" },
  { label: "Entry Price", value: "1,600.0" },
  { label: "Mark Price", value: "1,605.2" },
  { label: "Unrealized PnL", value: "+$156" },
] satisfies DeliveryTerm[];

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
