import { getChainlinkNgnUsdSpot } from "@/lib/chainlink-ngn-usd";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import { getSpotHistorySnapshots } from "@/lib/exchange-api-history";
import type { SpotHistorySnapshot } from "@/lib/exchange-api-history";
import {
  type BookResponse,
  getLiveDeliverableFXFuture,
  getMarketBook,
  getMarketTrades,
  type PresentedTrade,
} from "@/lib/markets-service";
import {
  buildDeliverableFutureDefinition,
  buildTradingTerminalMarkets,
} from "@/lib/mock-orderbook-terminal-data";
import { OrderBookTradingTerminal } from "@/ui/trading-terminal/OrderBookTradingTerminal";

export default async function Home() {
  let chainlinkSpot: ChainlinkSpotSnapshot | null = null;
  let liveFutureBook: BookResponse | null = null;
  let liveFutureDefinition = null;
  let liveFutureTrades: PresentedTrade[] = [];
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
    const liveFuture = await getLiveDeliverableFXFuture();

    if (liveFuture?.asset_address && liveFuture?.sub_id && liveFuture?.expiry_timestamp) {
      liveFutureDefinition = buildDeliverableFutureDefinition({
        assetAddress: liveFuture.asset_address,
        contractMultiplier: "10000",
        expiryTimestamp: liveFuture.expiry_timestamp,
        lastTradeTimestamp: liveFuture.last_trade_timestamp,
        market: liveFuture.market,
        minSize: "0.001",
        subId: liveFuture.sub_id,
        tickSize: liveFuture.tick_size ?? "1",
      });

      try {
        liveFutureBook = await getMarketBook(liveFuture.asset_address, liveFuture.sub_id);
      } catch {
        liveFutureBook = null;
      }

      try {
        liveFutureTrades = await getMarketTrades(liveFuture.asset_address, liveFuture.sub_id);
      } catch {
        liveFutureTrades = [];
      }
    }
  } catch {
    liveFutureDefinition = null;
  }

  const { defaultContract, defaultMarketId, marketData, marketDefinitions } =
    buildTradingTerminalMarkets(liveFutureDefinition, liveFutureBook, liveFutureTrades);

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
