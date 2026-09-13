/**
 * The signed login `GET /v1/orders` requires — markets-service's `wsauth.AuthFrame`, sent as the
 * `X-Numo-Auth` header. Times are unix seconds.
 */
export type OrderHistoryAuthFrame = {
  address: string;
  expiry: number;
  issued_at: number;
  nonce: string;
  signature: string;
};

/** An order's outcome as markets-service records it. */
export type OrderHistoryStatus = "active" | "matching" | "filled" | "cancelled" | "expired";

/** One order as `GET /v1/orders` returns it: the book's order fields plus how it ended. */
export type OrderHistoryOrder = {
  cancel_reason?: string;
  cancelled_at?: string;
  created_at: string;
  /** Engine amount, in whole cNGN. */
  desired_amount: string;
  display_name?: string;
  /** Engine amount filled, in whole cNGN. */
  filled_amount: string;
  /**
   * What actually traded, in USDC: the sum of fill price × size over the order's fills. Absent when
   * the order has no fills — or when the service predates the field, which only matters if
   * `filled_amount` is above zero.
   */
  filled_quote?: string;
  limit_price: string;
  market?: string;
  order_id: string;
  /** The engine side, which is the inverse of the trader's side on this pair. */
  side: "buy" | "sell";
  spot_contract?: {
    /** What the trader asked for: side, cNGN-per-USDC price and USDC size. */
    ui_intent: { price: string; side: "buy" | "sell"; size: string };
  };
  status: OrderHistoryStatus;
};

export type OrderHistoryResponse = {
  /** Pass back as `before` for older orders; absent on the last page. */
  next_before?: string;
  orders: OrderHistoryOrder[];
};

/** Where the Order History tab is: every step between opening it and seeing rows. */
export type OrderHistoryState =
  /** Not requested: the tab is closed or no wallet is connected. */
  | { status: "idle" }
  /** No usable login for this wallet; loading needs a signature first. */
  | { status: "needs-signature" }
  | { status: "signing" }
  | { status: "loading" }
  | { orders: OrderHistoryOrder[]; status: "ready" }
  | { error: string; status: "error" };
