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
    const validLiveFutures = liveFutureMarkets.filter((market) => {
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
      defaultContract={defaultContract}
      defaultMarketId={defaultMarketId}
      initialContract={initialContract}
      initialMarketId={initialMarketId}
      marketData={marketData}
      marketDefinitions={marketDefinitions}
      spotHistory={spotHistory}
    />
  );
}
