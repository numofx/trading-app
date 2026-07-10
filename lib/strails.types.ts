import type { OrderBookLevel } from "@/lib/trading.types";

/** A single LP quote from strails' GET /fx/orderbook (buyOrders/sellOrders entries). */
export type StrailsLpOrder = {
  availableLiquidity?: string;
  maxAmount?: string;
  minAmount?: string;
  orderId?: string;
  price?: string;
  spread?: number;
  status?: string;
  updatedAt?: string;
};

/** The `data` object of strails' GET /fx/orderbook response. */
export type StrailsOrderBookData = {
  buyOrders?: StrailsLpOrder[];
  pair?: string;
  sellOrders?: StrailsLpOrder[];
};

/**
 * Why the live book was (or was not) usable for display:
 * - `ok`: both sides present, plausible cNGN-per-USDC prices, not crossed
 * - `empty`: one or both sides had no active liquidity
 * - `crossed`: best bid >= best ask (LP quote board, sides can cross)
 * - `implausible`: prices failed the cNGN-per-USDC sanity check (possible inverted convention)
 * - `unconfigured`: STRAILS_API_URL / STRAILS_API_KEY not set on the server
 * - `upstream_error`: strails request failed or returned a non-2xx status
 */
export type StrailsBookStatus =
  | "ok"
  | "empty"
  | "crossed"
  | "implausible"
  | "unconfigured"
  | "upstream_error";

/** Payload served by /api/strails/orderbook to the client. */
export type StrailsOrderBookPayload = {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  fetchedAt: string;
  pair: string;
  status: StrailsBookStatus;
};
