import type { ActivityTab, ActivityView } from "@/lib/trading.types";

/** The venue's symbol for the perp, as the market selector and document title name it. */
export const PERP_MARKET_LABEL = "USDC-cNGN-PERP";

/** The perp's stream and book symbol in markets-service. */
export const PERP_MARKET_SYMBOL = "USDCcNGN-PERP";

export const PERP_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "margin", label: "Margin" },
] satisfies ActivityTab[];

/**
 * Column headers for each tab before data arrives. No "Entry price": the SRM marks positions to
 * market and keeps no entry price on chain, so the column could only be invented.
 */
export const PERP_ACTIVITY_VIEWS = {
  margin: {
    columns: ["Cash", "Initial margin headroom", "Maintenance margin headroom"],
    rows: [],
  },
  "open-orders": {
    columns: ["Side", "Price", "Size", "Filled"],
    rows: [],
  },
  positions: {
    columns: ["Instrument", "Side", "Size", "Mark price", "Liq. price", "Unrealized PnL"],
    rows: [],
  },
} satisfies Record<(typeof PERP_BOTTOM_TABS)[number]["id"], ActivityView>;

/**
 * Quick picks under the leverage slider. The ceiling itself is the SRM's (1 / initial margin, from
 * /v1/markets); presets above it are not shown.
 */
export const PERP_LEVERAGE_PRESETS = [1, 2, 3, 5, 10] as const;
