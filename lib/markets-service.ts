import "server-only";
import { selectLiveUSDCCNGNSpotMarket } from "@/lib/spot-market-discovery";

export type MarketPresentation = {
  asset_address?: string;
  base_asset_symbol?: string;
  contract_type?: string;
  display_label?: string;
  display_name?: string;
  display_price_kind?: string;
  display_semantics?: string;
  expiry_timestamp?: number;
  last_trade_timestamp?: number;
  market: string;
  price_semantics?: string;
  pricing_model?: string;
  quote_asset_symbol?: string;
  order_entry_spec?: string;
  ui_price_unit?: string;
  ui_size_unit?: string;
  ui_side_meaning?: string;
  engine_price_unit?: string;
  engine_amount_unit?: string;
  engine_side_policy?: string;
  ui_price_to_engine?: string;
  ui_size_to_engine?: string;
  settlement_note?: string;
  settlement_type?: string;
  sub_id?: string;
  tick_size?: string;
};

export type PresentedOrder = {
  created_at: string;
  desired_amount: string;
  filled_amount: string;
  limit_price: string;
  side: "buy" | "sell";
  spot_contract?: {
    balance_delta: {
      cngn: string;
      usdc: string;
    };
    engine_order: {
      amount: string;
      price: string;
      side: "buy" | "sell";
    };
    spec: string;
    ui_intent: {
      price: string;
      side: "buy" | "sell";
      size: string;
    };
  };
};

export type BookResponse = {
  asks?: PresentedOrder[];
  bids?: PresentedOrder[];
  market_presentation?: MarketPresentation;
};

export type PresentedTrade = {
  aggressor_side: "buy" | "sell";
  asset_address: string;
  created_at: string;
  maker_order_id?: string;
  market?: string;
  price: string;
  settlement_type?: string;
  size: string;
  sub_id: string;
  taker_order_id?: string;
  trade_id: number;
  spot_contract?: {
    balance_delta: {
      cngn: string;
      usdc: string;
    };
    engine_order: {
      amount: string;
      price: string;
      side: "buy" | "sell";
    };
    spec: string;
    ui_intent: {
      price: string;
      side: "buy" | "sell";
      size: string;
    };
  };
};

export type TradeStats24h = {
  change?: string;
  high?: string;
  last?: string;
  low?: string;
  volume?: string;
};

export type TradesResponse = {
  next_before_trade_id?: number;
  stats_24h?: TradeStats24h;
  trades?: PresentedTrade[];
};

const DEFAULT_MARKETS_SERVICE_URL = "http://127.0.0.1:8080";
export function getMarketsServiceUrl() {
  return process.env.MARKETS_SERVICE_URL?.trim() || DEFAULT_MARKETS_SERVICE_URL;
}

export async function getMarketsServiceMarkets() {
  const response = await fetch(`${getMarketsServiceUrl()}/v1/markets`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`markets-service returned ${response.status}`);
  }

  return (await response.json()) as MarketPresentation[];
}

export async function getLiveDeliverableFXFutures() {
  const markets = await getMarketsServiceMarkets();

  return markets
    .filter((market) => {
      return (
        market.contract_type === "deliverable_fx_future" &&
        market.settlement_type === "physical_delivery" &&
        market.base_asset_symbol === "USDC" &&
        market.quote_asset_symbol === "cNGN"
      );
    })
    .sort((left, right) => {
      const leftExpiry = left.expiry_timestamp ?? Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiry_timestamp ?? Number.MAX_SAFE_INTEGER;

      return leftExpiry - rightExpiry;
    });
}

export async function getLiveUSDCCNGNSpotMarket() {
  const markets = await getMarketsServiceMarkets();

  return selectLiveUSDCCNGNSpotMarket(markets);
}

export async function getMarketBook(assetAddress: string, subId: string) {
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/book?asset_address=${assetAddress}&sub_id=${subId}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`markets-service book returned ${response.status}`);
  }

  return (await response.json()) as BookResponse;
}

export async function getMarketTrades(assetAddress: string, subId: string, limit = 50) {
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/trades?asset_address=${assetAddress}&sub_id=${subId}&limit=${limit}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`markets-service trades returned ${response.status}`);
  }

  const payload = (await response.json()) as TradesResponse;
  return payload.trades ?? [];
}
