"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  buildAssetsActivityView,
  buildOpenOrdersActivityView,
  getOwnedOpenOrders,
} from "@/lib/account-activity-views";
import { getAnchorPrice, getBestPrices } from "@/lib/spot-market";
import {
  ACTIVITY_VIEWS,
  FOOTER_LINKS,
  SPOT_BOTTOM_TABS,
  SPOT_TIMEFRAME_OPTIONS,
} from "@/lib/spot-terminal-config";
import { get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { Candle, SpotMarket } from "@/lib/trading.types";
import { SpotBalanceSummary } from "@/ui/trading-terminal/SpotBalanceSummary";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderFormPanel } from "@/ui/trading-terminal/SpotOrderFormPanel";
import { TerminalHeaderBar } from "@/ui/trading-terminal/TerminalHeaderBar";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useMarketOrderBook } from "@/ui/trading-terminal/useMarketOrderBook";

/** The venue's symbol for this market; markets-service resolves the stream subscription from it. */
const SPOT_MARKET_SYMBOL = "USDCcNGN-SPOT";

export function SpotTradingTerminal({
  candles,
  spotMarket,
  usdcBalanceLabel,
  cngnBalanceLabel = null,
  accountUsdcLabel = null,
  accountCngnLabel = null,
  accountCngn = null,
  accountUsdc = null,
  walletAddress = null,
  depositControl,
  onDepositRequest,
  onSubmitOrder,
  hasWallet = false,
  isSignedIn = false,
  isPreparingAccount = false,
  isSubmitting = false,
  lastAction = null,
}: {
  candles: Candle[];
  spotMarket: SpotMarket;
  /** Wallet USDC balance — what's available to deposit. */
  usdcBalanceLabel: string | null;
  /** Wallet cNGN balance, or null when the cNGN token address isn't configured for this chain. */
  cngnBalanceLabel?: string | null;
  /** Subaccount USDC cash balance — what's held in the trading account. */
  accountUsdcLabel?: string | null;
  /** Subaccount cNGN balance. */
  accountCngnLabel?: string | null;
  /** Subaccount balances as numbers — the ticket sizes a percentage of what the account can spend. */
  accountCngn?: number | null;
  accountUsdc?: number | null;
  /** Connected wallet, used to pick this trader's own orders out of the public book. */
  walletAddress?: string | null;
  /** The deposit dialog trigger, hosted in the header bar. */
  depositControl?: ReactNode;
  /** Opens the deposit dialog; the ticket CTA calls it while there is no funded account. */
  onDepositRequest?: () => void;
  onSubmitOrder: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market";
    /** The touch as displayed when the trader submitted; a market order crosses against it. */
    book: { bestAsk: number | null; bestBid: number | null };
  }) => void;
  /** Whether a wallet is connected; gates the order ticket's submit CTA. */
  hasWallet?: boolean;
  /** Whether a wallet session is active; gates account-scoped rows in the activity panel. */
  isSignedIn?: boolean;
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
}) {
  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("D");
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<string>("positions");
  const [liveCandles, setLiveCandles] = useState<Candle[]>(candles);
  const [cancellingNonce, setCancellingNonce] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setLiveCandles(candles);
  }, [candles]);

  // No simulated ticking: candles are real venue OHLCV.

  const spotBook = useMarketOrderBook({
    market: SPOT_MARKET_SYMBOL,
    orderEntrySpec: spotMarket.orderEntrySpec,
    type: "spot",
  });
  // Both sources are the venue's own depth: the stream when it is live, and the server-rendered
  // REST snapshot while the socket is unavailable, one-sided, crossed, or still connecting. When
  // the venue has no resting orders both are empty and the panel says so.
  const bookBids = spotBook.isLive ? spotBook.bids : spotMarket.orderBookBids;
  const bookAsks = spotBook.isLive ? spotBook.asks : spotMarket.orderBookAsks;
  const bookTrades =
    spotBook.isLive && spotBook.trades.length > 0 ? spotBook.trades : spotMarket.trades;

  const lastPrice = getVenueLastPrice(bookTrades, liveCandles, spotMarket.mark);
  // The touch the trader is actually looking at. It drives the ticket's prefill and cost estimate
  // and rides along on submission, so an order can never be priced off a book that is no longer
  // on screen — the server-rendered snapshot goes stale the moment the stream moves.
  const { bestAsk, bestBid } = getBestPrices(bookAsks, bookBids);
  const anchorPrice = getAnchorPrice(bestAsk, bestBid, lastPrice);

  function handleSubmitOrder(args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market";
  }) {
    onSubmitOrder({ ...args, book: { bestAsk, bestBid } });
  }
  const { changePercent, high, low, volumeLabel } = get24hStats(liveCandles, lastPrice, Date.now());
  // Assets is the one bottom tab with a real data source today, so it's built from live balances
  // instead of the placeholder-free static views.
  const ownedOpenOrders = getOwnedOpenOrders(spotMarket.openOrders, walletAddress);

  function buildActivityView() {
    if (bottomTab === "assets") {
      return buildAssetsActivityView({
        accountCngnLabel,
        accountUsdcLabel,
        walletCngnLabel: cngnBalanceLabel,
        walletUsdcLabel: usdcBalanceLabel,
      });
    }
    if (bottomTab === "open-orders") {
      return buildOpenOrdersActivityView(spotMarket.openOrders, walletAddress);
    }
    return ACTIVITY_VIEWS[bottomTab as keyof typeof ACTIVITY_VIEWS] ?? { columns: [], rows: [] };
  }

  const activityView = buildActivityView();

  /**
   * Cancels by `(owner_address, nonce)` — what markets-service takes — then refreshes the server
   * render so the book and this list reflect the removal rather than showing an order that is gone.
   */
  async function handleCancelOrder(nonce: string, ownerAddress: string) {
    setCancelError(null);
    setCancellingNonce(nonce);
    try {
      const response = await fetch("/api/orders/cancel", {
        body: JSON.stringify({ nonce, owner_address: ownerAddress }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setCancelError(body?.error ?? `Cancel failed (${response.status})`);
        return;
      }
      router.refresh();
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setCancellingNonce(null);
    }
  }

  return (
    <>
      <TerminalHeaderBar
        changePercent24h={changePercent}
        depositControl={depositControl}
        high24h={high}
        lastPrice={lastPrice}
        low24h={low}
        volume24hLabel={volumeLabel}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:overflow-hidden xl:px-4">
        {/*
         * One grid, two rows: the chart and order book take the top row, the activity panel spans the
         * bottom row beneath them, and the ticket column runs the full height alongside both. The
         * ticket used to be boxed into the top row's height, which cut its Amount field off mid-box
         * on the ~700-900px viewports most of this app's desktop traffic uses.
         *
         * The bottom row takes 3/10 rather than 2/10: at 2/10 the activity panel was a ~144px sliver
         * whose own empty state ran past its bottom edge, so it read as a strip of tab labels rather
         * than a panel holding anything.
         */}
        <div className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_270px_320px] xl:grid-rows-[minmax(0,7fr)_minmax(0,3fr)] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
          <SpotChartPanel
            asks={bookAsks}
            bids={bookBids}
            candles={liveCandles}
            chartTab={chartTab}
            indicatorsEnabled={indicatorsEnabled}
            onChartTabChange={setChartTab}
            onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
            onTimeframeChange={setTimeframe}
            onToolSelect={setSelectedTool}
            selectedTimeframe={timeframe}
            selectedTool={selectedTool}
            timeframes={SPOT_TIMEFRAME_OPTIONS}
          />

          <SpotOrderBookPanel
            asks={bookAsks}
            bids={bookBids}
            lastPrice={lastPrice}
            onTabChange={setBookTab}
            tab={bookTab}
            trades={bookTrades}
          />

          {/*
           * `order-first` on phones only: in the stacked single column the ticket would sit
           * below the chart and order book, putting the submit button ~2.5 screens down the
           * document. The xl grid places columns explicitly, so order resets there.
           */}
          <div className="order-first flex min-h-[420px] flex-col gap-3 xl:order-0 xl:row-span-2 xl:min-h-0 xl:overflow-hidden">
            <SpotOrderFormPanel
              anchorPrice={anchorPrice}
              availableCngn={accountCngn}
              availableCngnLabel={accountCngnLabel ?? "— cNGN"}
              availableUsdc={accountUsdc}
              availableUsdcLabel={accountUsdcLabel ?? "— USDC"}
              bestAsk={bestAsk}
              bestBid={bestBid}
              hasWallet={hasWallet}
              isPreparingAccount={isPreparingAccount}
              isSubmitting={isSubmitting}
              lastAction={lastAction}
              onDepositRequest={onDepositRequest}
              onSubmitOrder={handleSubmitOrder}
            />
            <SpotBalanceSummary
              cngnBalanceLabel={accountCngnLabel ?? "— cNGN"}
              usdcBalanceLabel={accountUsdcLabel ?? "— USDC"}
            />
          </div>

          <div className="min-h-[200px] xl:col-span-2 xl:min-h-0">
            <TradingActivityPanel
              activityView={activityView}
              footerLinks={FOOTER_LINKS}
              isSignedIn={isSignedIn}
              onTabSelect={setBottomTab}
              rowAction={
                bottomTab === "open-orders"
                  ? (rowIndex) => {
                      const order = ownedOpenOrders[rowIndex];
                      if (!order) {
                        return null;
                      }
                      return (
                        <button
                          className="cursor-pointer rounded-lg bg-input-bg px-2 py-1 font-medium text-[10px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active disabled:cursor-wait disabled:opacity-60"
                          disabled={cancellingNonce === order.nonce}
                          onClick={() => handleCancelOrder(order.nonce, order.ownerAddress)}
                          type="button"
                        >
                          {cancellingNonce === order.nonce ? "Cancelling…" : "Cancel"}
                        </button>
                      );
                    }
                  : undefined
              }
              selectedTab={bottomTab}
              tabs={SPOT_BOTTOM_TABS}
            />
            {cancelError === null ? null : (
              <p className="px-4 pt-1 text-[10px] text-sell">{cancelError}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
