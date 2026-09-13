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
  { id: "assets", label: "Assets" },
] satisfies ActivityTab[];

/**
 * The one interval the chart actually renders.
 *
 * Candles are fetched server-side at a fixed `1d` and there is no client-side refetch, so
 * `selectedTimeframe` only ever styled the active pill. The list used to read
 * `1m / 30m / 1h / D / W / M` with `1h` selected by default — a daily chart labelled hourly,
 * which misstates every range and volume bar on it by a factor of 24. Two of those options
 * (`30m`, `W`) are not intervals markets-service serves at all.
 *
 * Restore the full list when the interval is wired through to `getMarketCandles`, which does
 * support `1m`, `5m`, `15m`, `1h`, `4h` and `1d`.
 */
export const SPOT_TIMEFRAME_OPTIONS = ["D"] as const;

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
    columns: ["Time", "Instrument", "Direction", "Price", "Size", "Total", "Fee", "Role"],
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
