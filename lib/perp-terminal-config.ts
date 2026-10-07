import { MARKET_LABELS } from "@/lib/market-labels";
import { PERP_POSITIONS_COLUMNS } from "@/lib/perp-market";
import { ACTIVITY_VIEWS as SPOT_ACTIVITY_VIEWS } from "@/lib/spot-terminal-config";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";

/** The perp's one display name, shared with the selector, document title, positions and history. */
export const PERP_MARKET_LABEL = MARKET_LABELS["USDCcNGN-PERP"];

/** The perp's stream and book symbol in markets-service. */
export const PERP_MARKET_SYMBOL = "USDCcNGN-PERP";

export const PERP_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "order-history", label: "Order History" },
  { id: "trade-history", label: "Trade History" },
] satisfies ActivityTab[];

/**
 * Column headers for each tab before data arrives. No "Entry price": the SRM marks positions to
 * market and keeps no entry price on chain, so the column could only be invented.
 */
export const PERP_ACTIVITY_VIEWS = {
  // The venue keeps one order and fill history per owner across every market, labelled by
  // market, so the perp's tabs share spot's columns and show the rows labelled with the perp.
  "order-history": SPOT_ACTIVITY_VIEWS["order-history"],
  "trade-history": SPOT_ACTIVITY_VIEWS["trade-history"],
  "open-orders": {
    columns: ["Side", "Price", "Size", "Filled"],
    rows: [],
  },
  positions: {
    columns: PERP_POSITIONS_COLUMNS,
    rows: [],
  },
} satisfies Record<(typeof PERP_BOTTOM_TABS)[number]["id"], ActivityView>;

/**
 * Quick picks under the leverage slider. The ceiling itself is the SRM's (1 / initial margin, from
 * /v1/markets); presets above it are not shown.
 */
export const PERP_LEVERAGE_PRESETS = [1, 2, 3, 5, 10] as const;
