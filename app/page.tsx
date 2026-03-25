import { getChainlinkNgnUsdSpot } from "@/lib/chainlink-ngn-usd";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import { getSpotHistorySnapshots } from "@/lib/exchange-api-history";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import type { BookResponse, PresentedTrade } from "@/lib/markets-service";
import {
  getLiveDeliverableFXFutures,
  getMarketBook,
  getMarketTrades,
} from "@/lib/markets-service";
import {
  buildDeliverableFutureDefinition,
  buildTradingTerminalMarkets,
} from "@/lib/mock-orderbook-terminal-data";
import { OrderBookTradingTerminal } from "@/ui/trading-terminal/OrderBookTradingTerminal";

export default async function Home() {
  let chainlinkSpot: ChainlinkSpotSnapshot | null = null;
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

  const { defaultContract, defaultMarketId, marketData, marketDefinitions } = buildTradingTerminalMarkets(liveFutures);

  return (
    <OrderBookTradingTerminal
      chainlinkSpot={chainlinkSpot}
      defaultContract={defaultContract}
      defaultMarketId={defaultMarketId}
      marketData={marketData}
      marketDefinitions={marketDefinitions}
      spotHistory={spotHistory}
    />
  );
}
