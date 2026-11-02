import { NextResponse } from "next/server";
import { parseAbi, parseUnits } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import {
  futureMarkSource,
  futureOpenInterestUsd,
  futureSizeUsdc,
  parseFutureState,
} from "@/lib/future-market";
import type { FutureState } from "@/lib/future-market.types";
import { buildOverviewRow, emptyOverviewRow } from "@/lib/market-overview";
import type { MarketOverviewResponse, TerminalMarketId } from "@/lib/market-overview.types";
import { findPerpMarket, findSpotMarket, listLiveFutures } from "@/lib/market-pickers";
import type { MarketPresentation } from "@/lib/markets-service";
import { getMarketBook, getMarketsServiceUrl, getMarketTrades } from "@/lib/markets-service";
import type { OptionOverviewRow } from "@/lib/option-chain";
import { buildOptionRow, listLiveOptions } from "@/lib/option-chain";
import { parsePerpState } from "@/lib/perp-market";
import { buildSpotMarket } from "@/lib/spot-market";

/**
 * The market selector's table: every market the terminal offers, with the venue's own price,
 * 24h change and volume (the perp's open interest, funding and leverage; each future series' mark,
 * index, open interest from chain and times), read the same way
 * each terminal's header reads them. Never cached: the selector opens on demand and shows the
 * venue as it is now. A market the venue is not serving, or one whose reads fail, keeps its row
 * with every figure null; the selector still lists it, with dashes, since the route exists.
 */
export async function GET() {
  let markets: MarketPresentation[] = [];
  try {
    const response = await fetch(`${getMarketsServiceUrl()}/v1/markets`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      markets = (await response.json()) as MarketPresentation[];
    }
  } catch {
    markets = [];
  }

  // The same pickers the terminals use, so the selector can never look for a market under an
  // orientation the venue no longer reports and show dashes for one it is serving.
  const spot = findSpotMarket(markets);
  const eurc = findSpotMarket(markets, "EURC");
  const perp = findPerpMarket(markets);
  // Every offered series not yet expired, nearest first: the v2 series, open or awaiting their enable.
  const futures = listLiveFutures(markets, Date.now());
  // Every listed option strike and side not yet expired, with its book's best levels.
  const options = listLiveOptions(markets, Date.now());

  const [spotRow, eurcRow, perpRow, futureRows, optionRows] = await Promise.all([
    readRow("spot", spot ?? undefined, null),
    // Listed only once the venue serves it: the row's presence is what puts it in the selector.
    eurc === null ? Promise.resolve(null) : readRow("eurc", eurc, null),
    readRow("perp", perp ?? undefined, parsePerpState(perp?.perp)),
    Promise.all(futures.map((future) => readRow("future", future, null, parseFutureState(future)))),
    readOptionMarks(options).then((marks) =>
      Promise.all(options.map((option) => readOptionRow(option, marks.get(option.market) ?? null)))
    ),
  ]);

  return NextResponse.json(
    {
      futures: futureRows,
      options: optionRows,
      rows: [
        spotRow,
        ...(eurcRow === null ? [] : [eurcRow]),
        perpRow,
        futureRows[0] ?? emptyOverviewRow("future"),
      ],
    } satisfies MarketOverviewResponse,
    {
      headers: { "cache-control": "no-store" },
    }
  );
}

async function readRow(
  id: TerminalMarketId,
  presentation: MarketPresentation | undefined,
  perpState: ReturnType<typeof parsePerpState>,
  futureState: ReturnType<typeof parseFutureState> = null
) {
  if (!presentation?.asset_address) {
    return emptyOverviewRow(id);
  }
  const assetAddress = presentation.asset_address;
  const subId = presentation.sub_id ?? "0";
  // Independent reads, run together; one failing still yields the others' figures.
  const [bookResult, tradesResult, openInterestResult] = await Promise.allSettled([
    getMarketBook(assetAddress, subId),
    getMarketTrades(assetAddress, subId),
    futureState === null ? Promise.resolve(null) : readTotalPosition(presentation),
  ]);
  const market = buildSpotMarket({
    book: bookResult.status === "fulfilled" ? bookResult.value : null,
    candles: [],
    stats24h: tradesResult.status === "fulfilled" ? tradesResult.value.stats24h : null,
    trades: tradesResult.status === "fulfilled" ? tradesResult.value.trades : [],
  });
  const volumeUnits = Number(
    tradesResult.status === "fulfilled" ? tradesResult.value.stats24h?.volume : Number.NaN
  );
  const openInterestUsd =
    futureState !== null &&
    openInterestResult.status === "fulfilled" &&
    openInterestResult.value !== null
      ? futureOpenInterestUsd(openInterestResult.value, futureState)
      : null;
  return buildOverviewRow(
    id,
    market,
    perpState,
    futureState === null
      ? null
      : {
          expiryMs: futureState.expiryMs,
          indexPrice: futureState.indexPrice,
          lastTradeAtMs: futureState.lastTradeAtMs,
          markPrice: futureState.markPrice,
          markSource: futureMarkSource({
            asks: depthUsdc(market.orderBookAsks, futureState),
            bids: depthUsdc(market.orderBookBids, futureState),
          }),
          futureQuoting: {
            baseSymbol: futureState.baseSymbol,
            priceDecimals: futureState.priceDecimals,
            priceUnit: futureState.priceUnit,
            terms: futureState.terms,
          },
          openInterestUsd,
          settled: futureState.settled,
          symbol: presentation.market,
          // The venue's units at their size, valued at the mark on a v2 series.
          volumeUsd: Number.isFinite(volumeUnits)
            ? futureSizeUsdc(volumeUnits * futureState.unitSize, futureState.markPrice, futureState)
            : null,
        }
  );
}

const positionTrackingAbi = parseAbi([
  "function totalPosition(address manager) view returns (uint256)",
]);

/** The future's tracked |positions| under its margin manager, from chain; null without the manager. */
async function readTotalPosition(presentation: MarketPresentation) {
  const asset = presentation.asset_address;
  const manager = presentation.margin_manager_address;
  if (!(asset && manager)) {
    return null;
  }
  return await createBasePublicClient().readContract({
    abi: positionTrackingAbi,
    address: asset as `0x${string}`,
    args: [manager as `0x${string}`],
    functionName: "totalPosition",
  });
}

/** One side's resting notional in USDC: the venue's sizes count `unitSize` of `sizeSymbol` each. */
function depthUsdc(levels: readonly { price: number; size: number }[], state: FutureState) {
  return levels.reduce(
    (sum, level) => sum + (futureSizeUsdc(level.size * state.unitSize, level.price, state) ?? 0),
    0
  );
}

const optionEngineAbi = parseAbi([
  "function assetDetails(address asset) view returns ((bool isWhitelisted, uint8 assetType, uint256 marketId))",
  "function getIsolatedMargin(uint256 marketId, uint256 strike, uint256 expiry, bool isCall, int256 balance, bool isInitial) view returns (int256 margin, int256 markToMarket)",
]);

const ONE_BASE_UNIT = 10n ** 18n;

/**
 * The engine's mark per base unit for each option, by symbol: its mark-to-market of holding one. One multicall,
 * so every mark is of one block and put-call parity holds across a strike. A read that fails marks nothing.
 */
async function readOptionMarks(options: readonly MarketPresentation[]) {
  const marks = new Map<string, number>();
  const first = options[0];
  if (!(first?.asset_address && first.margin_manager_address)) {
    return marks;
  }
  const engine = first.margin_manager_address as `0x${string}`;
  try {
    const client = createBasePublicClient();
    const { marketId } = await client.readContract({
      abi: optionEngineAbi,
      address: engine,
      args: [first.asset_address as `0x${string}`],
      functionName: "assetDetails",
    });
    const results = await client.multicall({
      contracts: options.map((option) => ({
        abi: optionEngineAbi,
        address: engine,
        functionName: "getIsolatedMargin" as const,
        args: [
          marketId,
          parseUnits(option.option?.strike ?? "0", 18),
          BigInt(option.option?.expiry_timestamp ?? option.expiry_timestamp ?? 0),
          option.option?.option_type === "call",
          ONE_BASE_UNIT,
          false,
        ],
      })),
    });
    results.forEach((result, index) => {
      const symbol = options[index]?.market;
      if (result.status === "success" && symbol !== undefined) {
        marks.set(symbol, Number(result.result[1]) / 1e18);
      }
    });
  } catch {
    return marks;
  }
  return marks;
}

/** One option's row: its listing, its mark and its book's best bid and ask; a book that fails to read shows dashes. */
async function readOptionRow(
  presentation: MarketPresentation,
  mark: number | null
): Promise<OptionOverviewRow> {
  const assetAddress = presentation.asset_address;
  if (!assetAddress) {
    return buildOptionRow(presentation, { ask: null, bid: null, mark });
  }
  try {
    const market = buildSpotMarket({
      book: await getMarketBook(assetAddress, presentation.sub_id ?? "0"),
      candles: [],
      stats24h: null,
      trades: [],
    });
    return buildOptionRow(presentation, {
      ask: market.orderBookAsks[0] ?? null,
      bid: market.orderBookBids[0] ?? null,
      mark,
    });
  } catch {
    return buildOptionRow(presentation, { ask: null, bid: null, mark });
  }
}
