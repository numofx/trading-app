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

export type MarketId = string;

export type MarketDefinition = {
  assetAddress?: string | null;
  contractLabel: string | null;
  contractMultiplier?: string | null;
  contractType?: string | null;
  expiryDays: number | null;
  expiryLabel: string | null;
  expiryTimestamp?: number | null;
  flagSrc: string;
  id: MarketId;
  lastTradeTimestamp?: number | null;
  marketIdAliases?: string[] | null;
  marketSymbol?: string | null;
  marketSymbolAliases?: string[] | null;
  minSize?: string | null;
  settlementType?: string | null;
  strikeLabel: string | null;
  subId?: string | null;
  type: MarketType;
  pair: string;
  region: string;
  sortOrder: number;
  tickSize?: string | null;
};

export type DeliveryTerm = {
  label: string;
  value: string;
};

export type MarketAvailability = {
  bookAvailable: boolean;
  markAvailable: boolean;
  tradesAvailable: boolean;
};

export type ContractMarket = {
  availability: MarketAvailability;
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

export type SpotUIOrderIntent = {
  price: number;
  side: "buy" | "sell";
  size: number;
};

export type SpotEngineOrder = {
  amount: number;
  price: number;
  side: "buy" | "sell";
};

export type SpotFillDeltas = {
  cngn: number;
  usdc: number;
};

export type SpotOrderTranslation = {
  deltas: SpotFillDeltas;
  engine: SpotEngineOrder;
  ui: SpotUIOrderIntent;
};
