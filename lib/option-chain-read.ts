import { parseAbi, parseUnits } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import type { MarketPresentation } from "@/lib/markets-service";
import { getMarketBook, getMarketsServiceMarkets, getMarketTrades } from "@/lib/markets-service";
import type { OptionChain, OptionOverviewRow } from "@/lib/option-chain";
import {
  buildOptionChains,
  buildOptionRow,
  listLiveOptions,
  optionSeries,
} from "@/lib/option-chain";
import { buildSpotMarket } from "@/lib/spot-market";
import type { SpotMarket } from "@/lib/trading.types";

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
    // Its book carries no `ui_intent`: the engine's side, premium and units are already the trader's.
    const market = buildSpotMarket(
      {
        book: await getMarketBook(assetAddress, presentation.sub_id ?? "0"),
        candles: [],
        stats24h: null,
        trades: [],
      },
      { engineFieldOrders: true }
    );
    return buildOptionRow(presentation, {
      ask: market.orderBookAsks[0] ?? null,
      bid: market.orderBookBids[0] ?? null,
      mark,
      openOrders: market.openOrders,
    });
  } catch {
    return buildOptionRow(presentation, { ask: null, bid: null, mark });
  }
}

/** What the options page renders: its series' priced chain, and every listed series for the expiry tabs. */
export type OptionSeriesPage = {
  chain: OptionChain | null;
  series: { baseSymbol: string; expiryMs: number; series: string }[];
};

/** A series' chain with its marks and best prices, as the venue and the engine serve them now. */
export async function loadOptionSeries(series: string, nowMs: number): Promise<OptionSeriesPage> {
  const listed = listLiveOptions(await getMarketsServiceMarkets(), nowMs);
  const own = listed.filter((option) => optionSeries(option.market) === series);
  const marks = await readOptionMarks(own);
  const rows = await Promise.all(
    own.map((option) => readOptionRow(option, marks.get(option.market) ?? null))
  );
  const all = buildOptionChains(
    listed.map((option) => buildOptionRow(option, { ask: null, bid: null }))
  );
  return {
    chain: buildOptionChains(rows)[0] ?? null,
    series: all.map(({ baseSymbol, expiryMs, series: name }) => ({
      baseSymbol,
      expiryMs,
      series: name,
    })),
  };
}

/** One strike's book and tape, in the venue's units. */
export type OptionBook = Pick<
  SpotMarket,
  "mark" | "orderBookAsks" | "orderBookBids" | "stats24h" | "trades"
>;

/** A listed option's book and trades, or null for a symbol that is not one. A side that fails to read is empty. */
export async function loadOptionBook(symbol: string): Promise<OptionBook | null> {
  const listed = (await getMarketsServiceMarkets()).find(
    (market) => market.market === symbol && market.contract_type === "option"
  );
  if (!listed?.asset_address) {
    return null;
  }
  const subId = listed.sub_id ?? "0";
  const [book, trades] = await Promise.allSettled([
    getMarketBook(listed.asset_address, subId),
    getMarketTrades(listed.asset_address, subId),
  ]);
  const market = buildSpotMarket(
    {
      book: book.status === "fulfilled" ? book.value : null,
      candles: [],
      stats24h: trades.status === "fulfilled" ? trades.value.stats24h : null,
      trades: trades.status === "fulfilled" ? trades.value.trades : [],
    },
    { engineFieldOrders: true }
  );
  return {
    mark: market.mark,
    orderBookAsks: market.orderBookAsks,
    orderBookBids: market.orderBookBids,
    stats24h: market.stats24h,
    trades: market.trades,
  };
}
