import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { parseFutureStack, parseFutureState } from "@/lib/future-market";
import type { FutureMarket } from "@/lib/future-market.types";
import { toUiCandles } from "@/lib/market-candles";
import type { ResolvedMarket } from "@/lib/market-routes";
import { resolveMarketSlug } from "@/lib/market-routes";
import type { BookResponse, CandleInterval, MarketPresentation } from "@/lib/markets-service";
import {
  getLiveFutureMarket,
  getLivePerpMarket,
  getLiveSpotMarket,
  getMarketBook,
  getMarketCandles,
  getMarketTrades,
} from "@/lib/markets-service";
import { parsePerpStack, parsePerpState } from "@/lib/perp-market";
import type { PerpMarket } from "@/lib/perp-market.types";
import type { LiveSpotRuntime } from "@/lib/spot-market";
import { buildSpotMarket } from "@/lib/spot-market";
import type { Candle } from "@/lib/trading.types";
import { FutureMarketPanels } from "@/ui/trading-terminal/FutureMarketPanels";
import { PerpMarketPanels } from "@/ui/trading-terminal/PerpMarketPanels";
import { SpotMarketPanels } from "@/ui/trading-terminal/SpotMarketPanels";

const CHART_CANDLE_INTERVAL: CandleInterval = "1d";

type MarketDataType = "future" | "perp" | "spot";
const CHART_CANDLE_LIMIT = 120;

/**
 * The book, trades and candles below are per-request state: the venue as it is now. Without this
 * Next would prerender a build-time snapshot of the venue and serve that forever. Nothing here is
 * static, so there is no `generateStaticParams`; `dynamicParams = false` was tried and still
 * streamed an unknown slug as a 200, so the 404 lives in the segment's layout instead.
 */
export const dynamic = "force-dynamic";

/** Converts served candles for the chart; a payload it cannot read renders no candles. */
function presentCandles(
  candles: Awaited<ReturnType<typeof getMarketCandles>>,
  type: MarketDataType
): Candle[] {
  try {
    return toUiCandles(candles, type, CHART_CANDLE_INTERVAL);
  } catch {
    return [];
  }
}

/**
 * The stack `/v1/markets` serves spot on, for the ticket to sign against. Both addresses or nothing:
 * a module without its asset (or the reverse) would sign an order the venue refuses as a mismatch.
 */
function presentOrderStack(
  assetAddress: string | undefined,
  tradeModuleAddress: string | undefined
): LiveSpotRuntime["orderStack"] {
  if (
    !(
      assetAddress &&
      tradeModuleAddress &&
      isAddress(assetAddress) &&
      isAddress(tradeModuleAddress)
    )
  ) {
    return null;
  }
  return {
    assetAddress: getAddress(assetAddress),
    tradeModuleAddress: getAddress(tradeModuleAddress),
  };
}

/**
 * A market's book, candles and trades, read together: the page waits on the slowest, not the sum,
 * and each settles on its own, so one failing still renders the others' data.
 */
async function readMarketData(assetAddress: string, subId: string, type: MarketDataType) {
  const [bookResult, candlesResult, tradesResult] = await Promise.allSettled([
    getMarketBook(assetAddress, subId),
    getMarketCandles(assetAddress, subId, CHART_CANDLE_INTERVAL, CHART_CANDLE_LIMIT),
    getMarketTrades(assetAddress, subId),
  ]);
  const book: BookResponse | null = bookResult.status === "fulfilled" ? bookResult.value : null;
  const candles =
    candlesResult.status === "fulfilled" ? presentCandles(candlesResult.value, type) : [];
  const { stats24h, trades }: Pick<LiveSpotRuntime, "stats24h" | "trades"> =
    tradesResult.status === "fulfilled" ? tradesResult.value : { stats24h: null, trades: [] };
  return { book, candles, stats24h, trades };
}

async function loadSpotMarket(): Promise<LiveSpotRuntime | null> {
  try {
    const spotMarket = await getLiveSpotMarket();
    if (!(spotMarket?.asset_address && spotMarket.sub_id != null)) {
      return null;
    }
    const data = await readMarketData(spotMarket.asset_address, spotMarket.sub_id, "spot");
    return {
      ...data,
      orderStack: presentOrderStack(spotMarket.asset_address, spotMarket.trade_module_address),
    };
  } catch {
    return null;
  }
}

/**
 * The live perp, or null. Null covers every way the perp is not tradeable here: markets-service
 * does not list it, lists it without chain state, or lists it without a complete stack. The
 * panels then render their not-live state rather than guessing at any of it.
 */
async function loadPerpMarket(): Promise<PerpMarket | null> {
  let presentation: MarketPresentation | null;
  try {
    presentation = await getLivePerpMarket();
  } catch {
    return null;
  }
  if (!presentation?.asset_address) {
    return null;
  }
  const state = parsePerpState(presentation.perp);
  const stack = parsePerpStack(presentation.asset_address, presentation.perp);
  if (state === null || stack === null) {
    return null;
  }
  const data = await readMarketData(presentation.asset_address, presentation.sub_id ?? "0", "perp");
  // The perp's book and trades carry the same `spot_contract` echo spot's do, so spot's builder
  // presents them without change.
  const market = buildSpotMarket(data);
  return { ...market, stack, state, symbol: presentation.market };
}

/** Units traded in the window, from the venue's `stats_24h.volume`; null when it served none. */
function unitsTraded(stats24h: Awaited<ReturnType<typeof readMarketData>>["stats24h"]) {
  const volume = Number(stats24h?.volume);
  return Number.isFinite(volume) && volume >= 0 ? volume : null;
}

/**
 * The live future, or null when markets-service does not list it or lists it without its state or
 * a complete stack; the panels then render their not-live state. Its book carries no `ui_intent`:
 * the engine's side, cNGN-per-USDC price and size in the venue's units are already the trader's.
 */
async function loadFutureMarket(symbol: string): Promise<FutureMarket | null> {
  let presentation: MarketPresentation | null;
  try {
    presentation = await getLiveFutureMarket(symbol);
  } catch {
    return null;
  }
  const state = parseFutureState(presentation);
  const stack = parseFutureStack(presentation);
  if (presentation === null || state === null || stack === null) {
    return null;
  }
  const data = await readMarketData(stack.assetAddress, stack.subId, "future");
  const market = buildSpotMarket(data, { engineFieldOrders: true });
  return {
    ...market,
    stack,
    state,
    symbol: presentation.market,
    volumeUnits24h: unitsTraded(data.stats24h),
  };
}

async function renderMarket(resolved: ResolvedMarket) {
  if (resolved.id === "perp") {
    return <PerpMarketPanels market={await loadPerpMarket()} />;
  }
  if (resolved.id === "future") {
    return (
      <FutureMarketPanels
        market={await loadFutureMarket(resolved.symbol)}
        symbol={resolved.symbol}
      />
    );
  }
  return <SpotMarketPanels spotMarket={buildSpotMarket(await loadSpotMarket())} />;
}

/**
 * One market's panels under the `/trade` shell. Keyed by the market so a switch mounts the new
 * market's panels fresh: a ticket, a book tab or a status line never carries over. The segment's
 * layout has already answered an unknown or miscased slug; this only narrows the type.
 */
export default async function TradePage({ params }: { params: Promise<{ market: string }> }) {
  const { market: slug } = await params;
  const resolved = resolveMarketSlug(slug);
  if (resolved === null || "redirect" in resolved) {
    notFound();
  }
  return (
    <div className="contents" key={slug}>
      {await renderMarket(resolved)}
    </div>
  );
}
