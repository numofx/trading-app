import type { MarketType } from "@/lib/trading.types";

/** Real-time channels exposed by markets-service `GET /v1/ws`. */
export type MarketStreamChannel = "book" | "trades" | "orders";

/** Client control frame sent to the server (`wsIn`). Auth fields are omitted: the public
 * `book`/`trades` channels never require them. */
export type MarketStreamRequest = {
  op: "subscribe" | "unsubscribe" | "ping";
  channel?: MarketStreamChannel;
  market?: string;
  since_seq?: number;
};

/** Server frame (`wsOut`). Every book/trades frame carries the `seq` it reflects. */
export type MarketStreamFrame = {
  type: "snapshot" | "update" | "pong" | "ack" | "error";
  channel?: MarketStreamChannel;
  market?: string;
  seq?: number;
  data?: unknown;
  code?: string;
  message?: string;
};

/** A resting order as presented in a `book` snapshot (same shape as REST `/v1/book`). Spot orders
 * additionally carry a `spot_contract.ui_intent` with the human UI price/size the server computed. */
export type StreamBookOrder = {
  order_id: string;
  side: "buy" | "sell";
  limit_price: string;
  desired_amount: string;
  filled_amount: string;
  spot_contract?: {
    ui_intent?: {
      /** UI side, already inverted by the server — the opposite of the engine `side` above. */
      side?: "buy" | "sell";
      price: string;
      size: string;
    };
  };
};

/** `book` snapshot payload. */
export type BookSnapshotData = {
  asks?: StreamBookOrder[];
  bids?: StreamBookOrder[];
};

/** `book` update payload: a per-order resting-size delta emitted by the DB trigger. */
export type BookUpdateData = {
  order_id: string;
  side: "buy" | "sell";
  limit_price: string;
  order_open: string;
  size_delta: string;
  price_ticks?: string;
};

/** A trade as presented in a `trades` snapshot or `update`. */
export type StreamTrade = {
  trade_id: number;
  price: string;
  size: string;
  aggressor_side: "buy" | "sell";
  created_at?: string;
};

/** How much the connection can offer the UI right now, so the order-book panel can fall back to
 * preview depth on anything but `ok`. */
export type MarketStreamStatus =
  | "connecting"
  | "ok"
  | "empty"
  | "crossed"
  | "unconfigured"
  | "error";

/** Presentation config derived from the selected market. Spot inverts engine price/size into the
 * UI's cNGN-per-USDC / USDC-notional convention; futures show price and contract count directly. */
export type MarketStreamPresenter = {
  type: MarketType;
};
