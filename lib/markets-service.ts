import "server-only";

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
  /**
   * The venue's fee schedule, in basis points of the quote notional. Served by /v1/markets so
   * this app never carries its own copy: a fee that lives in two repos disagrees the first time
   * one of them changes, and the trader sees the wrong number in the one place they look.
   *
   * Optional only because an older markets-service will omit them; treat absent as unknown, not
   * as zero.
   */
  taker_fee_bps?: number;
  maker_fee_bps?: number;
  tick_size?: string;
};

export type PresentedOrder = {
  created_at: string;
  /** Identity of the resting order. `owner_address` + `nonce` is what `POST /v1/orders/cancel` takes. */
  /** Unix seconds after which the engine stops matching the order. */
  expiry?: number;
  nonce?: string;
  order_id?: string;
  owner_address?: string;
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
  /** The 24h fill notional in the quote asset (USDC). Absent from a service that predates it. */
  quote_volume?: string;
  /** The 24h fill size in the engine's traded unit (whole cNGN) — not the USDC a ticker shows. */
  volume?: string;
};

export type TradesResponse = {
  market_presentation?: MarketPresentation;
  next_before_trade_id?: number;
  stats_24h?: TradeStats24h;
  trades?: PresentedTrade[];
};

const DEFAULT_MARKETS_SERVICE_URL = "http://127.0.0.1:8080";

function isLocalMarketsServiceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return value.includes("127.0.0.1") || value.includes("localhost");
  }
}

export function getMarketsServiceUrl() {
  const configuredUrl = process.env.MARKETS_SERVICE_URL?.trim();
  const resolvedUrl = configuredUrl || DEFAULT_MARKETS_SERVICE_URL;

  if (
    process.env.NODE_ENV === "production" &&
    (!configuredUrl || isLocalMarketsServiceUrl(resolvedUrl))
  ) {
    throw new Error(
      "MARKETS_SERVICE_URL must point to the live markets-service in production and must not be localhost"
    );
  }

  return resolvedUrl;
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

export async function getLiveSpotMarket() {
  const markets = await getMarketsServiceMarkets();

  return (
    markets.find((market) => {
      return (
        market.contract_type === "spot" &&
        market.base_asset_symbol === "USDC" &&
        market.quote_asset_symbol === "cNGN"
      );
    }) ?? null
  );
}

export async function getMarketBook(assetAddress: string, subId: string) {
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/book?asset_address=${assetAddress}&sub_id=${subId}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    }
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
    }
  );

  if (!response.ok) {
    throw new Error(`markets-service trades returned ${response.status}`);
  }

  const payload = (await response.json()) as TradesResponse;
  return {
    // The stats travel with the spec their prices are quoted under, read from the same response, so
    // they are never inverted under another contract than the one they were computed in.
    stats24h:
      payload.stats_24h === undefined
        ? null
        : {
            orderEntrySpec: payload.market_presentation?.order_entry_spec ?? null,
            stats: payload.stats_24h,
          },
    trades: payload.trades ?? [],
  };
}

export type PresentedCandle = {
  bucket_start: string;
  close: string;
  high: string;
  low: string;
  open: string;
  quote_volume: string;
  trade_count: number;
  volume: string;
};

export type CandlesResponse = {
  candles?: PresentedCandle[];
  interval?: string;
};

/** Candle bucket widths supported by markets-service `/v1/candles`. */
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * Real OHLCV aggregated from the venue's own fills. Prices are raw engine values —
 * the same convention as `/v1/trades` — so spot still needs the 1/price inversion
 * applied client-side. Buckets with no trades are absent rather than zero-filled.
 */
export async function getMarketCandles(
  assetAddress: string,
  subId: string,
  interval: CandleInterval = "1h",
  limit = 200
) {
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/candles?asset_address=${assetAddress}&sub_id=${subId}&interval=${interval}&limit=${limit}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`markets-service candles returned ${response.status}`);
  }

  const payload = (await response.json()) as CandlesResponse;
  return payload.candles ?? [];
}
