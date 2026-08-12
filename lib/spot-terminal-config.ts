import type { LucideIcon } from "lucide-react";
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
import type { ActivityTab, ActivityView, ChartTool } from "@/lib/trading.types";

export const SPOT_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "order-history", label: "Order History" },
  { id: "trade-history", label: "Trade History" },
  { id: "assets", label: "Assets" },
] satisfies ActivityTab[];

export const SPOT_TIMEFRAME_OPTIONS = ["1m", "30m", "1h", "D", "W", "M"] as const;

/**
 * Bottom-panel column sets. The account-scoped tabs (open orders, positions, trade history, order
 * history) ship with no rows on purpose: there is no per-account API behind them yet, so any row
 * here renders as a trader's own order or position when it is not. They stay empty until real
 * account data is wired in — the panel's empty state is the honest render. The Assets tab is the
 * exception and is built from live balances by {@link buildAssetsActivityView}.
 */
// TODO: populate the account-scoped views from markets-service once it exposes per-account endpoints.
export const ACTIVITY_VIEWS = {
  "open-orders": {
    columns: ["Instrument", "Direction", "Type", "Size", "Price"],
    rows: [],
  },
  "order-history": {
    columns: ["Time", "Instrument", "Direction", "Type", "Size", "Price", "Status"],
    rows: [],
  },
  positions: {
    columns: ["Instrument", "Position", "Entry Price", "Mark Price", "Unrealized PnL"],
    rows: [],
  },
  "trade-history": {
    columns: ["Time", "Instrument", "Direction", "Size", "Price"],
    rows: [],
  },
} satisfies Record<string, ActivityView>;

export const FOOTER_LINKS = [
  { href: "#", label: "Docs" },
  { href: "#", label: "Support" },
  { href: "#", label: "Terms" },
  { href: "#", label: "Privacy Policy" },
] as const;

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
