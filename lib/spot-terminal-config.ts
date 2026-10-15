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
  { id: "open-orders", label: "Open Orders" },
  { id: "order-history", label: "Order History" },
  { id: "trade-history", label: "Trade History" },
] satisfies ActivityTab[];

/**
 * Bottom-panel column sets, with no rows on purpose: any row here would render as a trader's own
 * order or trade when it is not. Every tab is built from live data (see `account-activity-views`);
 * these entries are only the headers shown before that data arrives.
 *
 * There is no Positions tab. It came with the removed futures terminal: on spot a fill changes the
 * account's balances, which Assets shows, and opens nothing with an entry price or PnL.
 */
export const ACTIVITY_VIEWS = {
  "open-orders": {
    columns: ["Instrument", "Direction", "Type", "Size", "Price"],
    rows: [],
  },
  "order-history": {
    columns: ["Time", "Instrument", "Direction", "Filled", "Avg price", "Limit", "Status"],
    rows: [],
  },
  "trade-history": {
    columns: ["Time", "Instrument", "Direction", "Price", "Size", "Total", "Fee", "Role", ""],
    rows: [],
  },
} satisfies Record<string, ActivityView>;

export const FOOTER_LINKS = [
  { href: "https://docs.numofx.com", label: "Docs" },
  { href: "https://support.numofx.com", label: "Support" },
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
