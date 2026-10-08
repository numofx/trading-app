import {
  PERP_ORDER_HISTORY_COLUMNS,
  PERP_TRADE_HISTORY_COLUMNS,
} from "@/lib/account-activity-views";
import { MARKET_LABELS } from "@/lib/market-labels";
import { PERP_BALANCES_COLUMNS, PERP_POSITIONS_COLUMNS } from "@/lib/perp-market";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";

/** The perp's one display name, shared with the selector, document title, positions and history. */
export const PERP_MARKET_LABEL = MARKET_LABELS["cNGN-PERP"];

/** The perp's stream and book symbol in markets-service. */
export const PERP_MARKET_SYMBOL = "cNGN-PERP";

export const PERP_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "balances", label: "Balances" },
  { id: "trade-history", label: "Trade History" },
  { id: "order-history", label: "Order History" },
  { id: "funding-history", label: "Funding History" },
] satisfies ActivityTab[];

/**
 * Column headers for each tab before data arrives. No "Entry price": the SRM marks positions to
 * market and keeps no entry price on chain, so the column could only be invented.
 */
export const PERP_ACTIVITY_VIEWS = {
  balances: { columns: [...PERP_BALANCES_COLUMNS], rows: [] },
  /**
   * Headers only, and always: the PerpAsset accrues funding continuously on chain, with no
   * settlement moments, and markets-service publishes no per-account funding payments. Until it
   * does, the tab says so rather than inventing a ledger.
   */
  "funding-history": { columns: ["Time", "Market", "Rate", "Payment", "Position"], rows: [] },
  // The venue keeps one order and fill history per owner across every market, labelled by
  // market; the perp's history tabs have their own columns over the same rows.
  "order-history": { columns: [...PERP_ORDER_HISTORY_COLUMNS], rows: [] },
  "trade-history": { columns: [...PERP_TRADE_HISTORY_COLUMNS], rows: [] },
  "open-orders": {
    columns: ["Side", "Price", "Size", "Filled"],
    rows: [],
  },
  positions: {
    columns: PERP_POSITIONS_COLUMNS,
    rows: [],
  },
} satisfies Record<(typeof PERP_BOTTOM_TABS)[number]["id"], ActivityView>;
