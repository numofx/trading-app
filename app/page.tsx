import { getChainlinkNgnUsdSpot } from "@/lib/chainlink-ngn-usd";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import { getSpotHistorySnapshots } from "@/lib/exchange-api-history";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import type { BookResponse, PresentedTrade } from "@/lib/markets-service";
import {
  getLiveDeliverableFXFutures,
  getLiveUSDCCNGNSpotMarket,
  getMarketBook,
  getMarketTrades,
} from "@/lib/markets-service";
import {
  buildMarketSelectionAliasMap,
  resolveInitialMarketSelection,
  resolveMarketSelection,
} from "@/lib/market-selection";
import {
  buildDeliverableFutureDefinition,
  buildSpotDefinition,
  buildTradingTerminalMarkets,
} from "@/lib/mock-orderbook-terminal-data";
import { OrderBookTradingTerminal } from "@/ui/trading-terminal/OrderBookTradingTerminal";

const APR_2026_EXPIRY_TIMESTAMP = 1_777_507_200;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

function getAprFutureOverrides() {
  const assetAddress = process.env.NEXT_PUBLIC_USDCCNGN_APR_FUTURE_ASSET_ADDRESS?.trim() ?? "";
  const subId = process.env.NEXT_PUBLIC_USDCCNGN_APR_FUTURE_SUB_ID?.trim() ?? "";

  return {
    assetAddress: ADDRESS_PATTERN.test(assetAddress) ? assetAddress : null,
    subId: UNSIGNED_INTEGER_PATTERN.test(subId) ? subId : null,
  };
}

function applyAprFutureOverrides<T extends { asset_address?: string; expiry_timestamp?: number; sub_id?: string }>(market: T) {
  if (market.expiry_timestamp !== APR_2026_EXPIRY_TIMESTAMP) {
    return market;
  }

  const overrides = getAprFutureOverrides();

  return {
    ...market,
    asset_address: overrides.assetAddress ?? market.asset_address,
    sub_id: overrides.subId ?? market.sub_id,
  };
}

type HomeProps = {
  searchParams?: Promise<{
    market?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  let chainlinkSpot: ChainlinkSpotSnapshot | null = null;
  let liveSpot: {
    book: BookResponse | null;
    definition: ReturnType<typeof buildSpotDefinition>;
    trades: PresentedTrade[];
  } | null = null;
  let liveFutures: {
    book: BookResponse | null;
    definition: ReturnType<typeof buildDeliverableFutureDefinition>;
    trades: PresentedTrade[];
  }[] = [];
  let spotHistory: Record<SpotHistorySnapshot["pair"], SpotHistorySnapshot> | null = null;

  try {
    chainlinkSpot = await getChainlinkNgnUsdSpot();
  } catch {
    chainlinkSpot = null;
  }

  try {
    spotHistory = await getSpotHistorySnapshots();
  } catch {
    spotHistory = null;
  }

  try {
    const liveSpotMarket = await getLiveUSDCCNGNSpotMarket();

    if (liveSpotMarket?.asset_address && liveSpotMarket.sub_id) {
      const definition = buildSpotDefinition({
        assetAddress: liveSpotMarket.asset_address,
        market: liveSpotMarket.market,
        subId: liveSpotMarket.sub_id,
        tickSize: liveSpotMarket.tick_size ?? "1",
      });

      let book: BookResponse | null = null;
      let trades: PresentedTrade[] = [];

      try {
        book = await getMarketBook(liveSpotMarket.asset_address, liveSpotMarket.sub_id);
      } catch {
        book = null;
      }

      try {
        trades = await getMarketTrades(liveSpotMarket.asset_address, liveSpotMarket.sub_id);
      } catch {
        trades = [];
      }

      liveSpot = {
        book,
        definition,
        trades,
      };
    }
  } catch {
    liveSpot = null;
  }

  try {
    const liveFutureMarkets = await getLiveDeliverableFXFutures();
    const validLiveFutures = liveFutureMarkets.map(applyAprFutureOverrides).filter((market) => {
      return Boolean(market.asset_address && market.sub_id && market.expiry_timestamp);
    });

    liveFutures = await Promise.all(
      validLiveFutures.map(async (liveFuture) => {
        const definition = buildDeliverableFutureDefinition({
          assetAddress: liveFuture.asset_address as string,
          contractMultiplier: "10000",
          expiryTimestamp: liveFuture.expiry_timestamp as number,
          lastTradeTimestamp: liveFuture.last_trade_timestamp,
          market: liveFuture.market,
          minSize: "0.001",
          subId: liveFuture.sub_id as string,
          tickSize: liveFuture.tick_size ?? "1",
        });

        let book: BookResponse | null = null;
        let trades: PresentedTrade[] = [];

        try {
          book = await getMarketBook(liveFuture.asset_address as string, liveFuture.sub_id as string);
        } catch {
          book = null;
        }

        try {
          trades = await getMarketTrades(liveFuture.asset_address as string, liveFuture.sub_id as string);
        } catch {
          trades = [];
        }

        return {
          book,
          definition,
          trades,
        };
      }),
    );
  } catch {
    liveFutures = [];
  }

  const { defaultContract, defaultMarketId, marketData, marketDefinitions } = buildTradingTerminalMarkets(liveSpot, liveFutures);
  const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
  const requestedMarket = Array.isArray(resolvedSearchParams.market)
    ? resolvedSearchParams.market[0]
    : resolvedSearchParams.market;
  const initialMarketId = resolveInitialMarketSelection(requestedMarket, marketSelectionAliases, defaultMarketId);
  const initialContract =
    marketDefinitions.find((marketDefinition) => marketDefinition.id === initialMarketId)?.contractLabel ??
    defaultContract;

  return (
    <OrderBookTradingTerminal
      chainlinkSpot={chainlinkSpot}
      defaultMarketId={defaultMarketId}
      initialContract={initialContract}
      initialMarketId={initialMarketId}
      marketData={marketData}
      marketDefinitions={marketDefinitions}
      spotHistory={spotHistory}
    />
  );
}
