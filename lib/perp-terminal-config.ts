import type { ActivityTab, ActivityView } from "@/lib/trading.types";

/** The venue's symbol for the perp, as the market selector and document title name it. */
export const PERP_MARKET_LABEL = "USDC-cNGN-PERP";

export const PERP_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "order-history", label: "Order History" },
] satisfies ActivityTab[];

/**
 * Column headers only. markets-service serves no perp market, so there are no positions or orders
 * to list — any row here would read as a trader's own when it is not.
 */
export const PERP_ACTIVITY_VIEWS = {
  "open-orders": {
    columns: ["Instrument", "Direction", "Type", "Size", "Price", "Leverage"],
    rows: [],
  },
  "order-history": {
    columns: ["Time", "Instrument", "Direction", "Filled", "Avg price", "Limit", "Status"],
    rows: [],
  },
  positions: {
    columns: ["Instrument", "Size", "Entry price", "Mark price", "Liq. price", "Unrealized PnL"],
    rows: [],
  },
} satisfies Record<(typeof PERP_BOTTOM_TABS)[number]["id"], ActivityView>;

/**
 * The ticket's leverage ceiling. A UI limit, not the venue's: there is no perp risk config to read
 * one from yet, so replace this with the market's served maximum when it exists.
 */
export const PERP_MAX_LEVERAGE = 10;

/** Quick picks under the leverage slider; each must sit within `PERP_MAX_LEVERAGE`. */
export const PERP_LEVERAGE_PRESETS = [1, 2, 3, 5, 10] as const;
