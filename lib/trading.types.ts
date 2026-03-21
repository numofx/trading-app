export type MarketStat = {
  label: string;
  tone?: "accent" | "negative" | "positive" | "neutral";
  value: string;
};

export type Candle = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: string;
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

export type ContractTab = {
  active?: boolean;
  label: string;
};

export type MarketType = "spot" | "future" | "option" | "perp";

export type MarketId =
  | "cngn-usdc-spot"
  | "cngn-usdc-mar-2026-futures"
  | "cngn-usdc-jun-2026-futures"
  | "cngn-usdc-mar-2026-options"
  | "cngn-usdc-jun-2026-options";

export type MarketDefinition = {
  contractLabel: string | null;
  expiryDays: number | null;
  expiryLabel: string | null;
  flagSrc: string;
  id: MarketId;
  type: MarketType;
  pair: "cNGN/USDC";
  region: "Africa";
  sortOrder: number;
};

export type DeliveryTerm = {
  label: string;
  value: string;
};

export type ContractMarket = {
  candles: Candle[];
  contractDetails: DeliveryTerm[];
  id: string;
  infoBar: MarketStat[];
  mark: string;
  orderBookAsks: OrderBookLevel[];
  orderBookBids: OrderBookLevel[];
  positionOverview: DeliveryTerm[];
  referencePrice: string;
  ticker: string;
  timeToExpiry: string;
  trades: TradePrint[];
};

export type ActivityRow = {
  cells: string[];
  positiveCellIndexes?: number[];
};

export type ActivityView = {
  columns: string[];
  rows: ActivityRow[];
};
