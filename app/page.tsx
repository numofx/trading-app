import { getChainlinkNgnUsdSpot } from "@/lib/chainlink-ngn-usd";
import type { ChainlinkSpotSnapshot } from "@/lib/chainlink-ngn-usd";
import { TradingTerminal } from "@/ui/trading-terminal/TradingTerminal";

export default async function Home() {
  let chainlinkSpot: ChainlinkSpotSnapshot | null = null;

  try {
    chainlinkSpot = await getChainlinkNgnUsdSpot();
  } catch {
    chainlinkSpot = null;
  }

  return <TradingTerminal chainlinkSpot={chainlinkSpot} />;
}
