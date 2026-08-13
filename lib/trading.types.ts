export type Candle = {
  close: number;
  high: number;
  low: number;
  open: number;
  /** Display label for the axis, formatted for the candle's interval. */
  time: string;
  /**
   * Start of the bucket as epoch milliseconds. `time` is a formatted label and cannot be compared,
   * so windowed stats (24h high, low, volume) need this.
   */
  bucketStartMs: number;
  volume: number;
};

export type OrderBookLevel = {
  price: number;
  size: number;
  total: number;
};

export type TradePrint = {
  price: number;
  side: "buy" | "sell";
  size: number;
  time: string;
};

export type ActivityTab = {
  id: string;
  label: string;
};

export type ChartTool = {
  id: string;
  label: string;
};

export type MarketType = "spot" | "future" | "option" | "perp";

/**
 * A resting order as the public book presents it. `ownerAddress` and `nonce` are the pair
 * `POST /v1/orders/cancel` cancels by, so a client can offer cancellation from the book alone.
 */
export type SpotOpenOrder = {
  /** USDC notional already filled; the rest is still working. */
  filled: number;
  nonce: string;
  orderId: string;
  ownerAddress: string;
  price: number;
  side: "buy" | "sell";
  size: number;
};

/**
 * The USDC/cNGN spot market as the terminal renders it.
 *
 * Every field is the venue's own data or empty — there is no preview or sample state. A market
 * that has never traded renders an empty book, an empty tape and no mark, which is what is true.
 */
export type SpotMarket = {
  /** Real OHLCV from markets-service; empty when the market has not traded yet. */
  candles: Candle[];
  /**
   * Mid of the venue's best bid and ask, falling back to the single resting side and then to the
   * last trade. Null when the venue has neither a book nor a trade — never a placeholder price.
   */
  mark: number | null;
  orderBookAsks: OrderBookLevel[];
  orderBookBids: OrderBookLevel[];
  /**
   * The venue's `order_entry_spec`. Present only for contracts whose engine values differ from the
   * UI's (today just `usdc_cngn_spot_v1`); null means engine values are presented directly.
   */
  orderEntrySpec: string | null;
  /**
   * Every order resting on the book, with the identity needed to cancel one. The terminal filters
   * these to the connected wallet — the venue's private `orders` stream carries the same set, but
   * needs a signed auth frame for data the public book already exposes.
   */
  openOrders: SpotOpenOrder[];
  trades: TradePrint[];
};

export type DeliveryTerm = {
  label: string;
  value: string;
};

export type ActivityRow = {
  cells: string[];
  positiveCellIndexes?: number[];
};

export type ActivityView = {
  columns: string[];
  rows: ActivityRow[];
};
