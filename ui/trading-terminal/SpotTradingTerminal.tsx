"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  buildAssetsActivityView,
  buildOpenOrdersActivityView,
  getOwnedOpenOrders,
} from "@/lib/account-activity-views";
import {
  getAnchorPrice,
  getBestPrices,
  getCommittedBalances,
  getNextExpiryMs,
  getWorkingOrders,
  withoutCancelledOrders,
} from "@/lib/spot-market";
import {
  ACTIVITY_VIEWS,
  FOOTER_LINKS,
  SPOT_BOTTOM_TABS,
  SPOT_TIMEFRAME_OPTIONS,
} from "@/lib/spot-terminal-config";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
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
  onCancelOrder,
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
  /**
   * Opens the deposit dialog; the ticket CTA calls it while there is no funded account, or when the
   * order on screen is short of one leg. The currency is the asset that is short, so the dialog
   * opens on the one the trader was asked to deposit rather than always on USDC.
   */
  onDepositRequest?: (currency?: DepositCurrency) => void;
  onSubmitOrder: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market";
    /** The touch as displayed when the trader submitted; a market order crosses against it. */
    book: { bestAsk: number | null; bestBid: number | null };
  }) => void;
  /**
   * Signs and submits a cancel for one of this trader's resting orders, returning the outcome.
   * markets-service authorizes a cancel on a signature, so the parent (which holds the wallet) owns
   * this; the panel here only drives the per-row cancelling/error state and the server refresh.
   */
  onCancelOrder: (nonce: string, ownerAddress: string) => Promise<{ ok: boolean; error?: string }>;
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
  // Starts at 0 — "clock not known yet" — so the first client render ages nothing out and matches
  // what the server rendered. An effect supplies the real time straight after mount.
  const [nowMs, setNowMs] = useState(0);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Nonces this trader has cancelled but the server snapshot may not have caught up to. Applied as
  // an overlay so `Available` recovers and the Open Orders row disappears the instant a cancel is
  // accepted, not on the next successful refresh — a refresh fired right after a cancel can race
  // the venue and come back still listing the order.
  const [cancelledNonces, setCancelledNonces] = useState<ReadonlySet<string>>(() => new Set());
  const activityPanelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setLiveCandles(candles);
  }, [candles]);

  // Scoped to this trader's own orders: theirs are what `Available` and Open Orders depend on, and
  // a visitor with none should not be re-rendering the page on the market maker's quote cycle.
  const nextExpiryMs = getNextExpiryMs(getOwnedOpenOrders(spotMarket.openOrders, walletAddress));

  /**
   * Re-reads the clock, and the server render with it, the moment the soonest order expires.
   *
   * `useEffectEvent` keeps the router out of the effect's dependencies, which would otherwise
   * resubscribe the timer on every render.
   */
  const catchUpWithExpiries = useEffectEvent(() => {
    setNowMs(Date.now());
    router.refresh();
  });

  // Supplies the clock after mount, and again whenever the book changes.
  useEffect(() => {
    setNowMs(Date.now());
  }, [spotMarket.openOrders]);

  // Once the server snapshot stops listing a cancelled nonce, the venue and the snapshot agree, so
  // drop it from the overlay — keeping it would hide nothing and the set would only grow. Returning
  // the same set when nothing changed keeps this from looping.
  useEffect(() => {
    setCancelledNonces((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const present = new Set(spotMarket.openOrders.map((order) => order.nonce));
      const next = new Set([...prev].filter((nonce) => present.has(nonce)));
      return next.size === prev.size ? prev : next;
    });
  }, [spotMarket.openOrders]);

  useEffect(() => {
    if (nextExpiryMs === null) {
      return;
    }

    // A moment past the deadline, so the venue has certainly dropped it before we re-read.
    const delay = Math.max(0, nextExpiryMs - Date.now()) + 500;
    const timer = window.setTimeout(() => catchUpWithExpiries(), delay);

    return () => window.clearTimeout(timer);
  }, [nextExpiryMs]);

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
  // Orders leave the book when they expire and nothing announces it, so a snapshot taken while one
  // was alive keeps counting it. Ageing them out here is what lets `Available` recover on its own.
  const workingOrders = withoutCancelledOrders(
    getWorkingOrders(spotMarket.openOrders, nowMs),
    cancelledNonces
  );
  const ownedOpenOrders = getOwnedOpenOrders(workingOrders, walletAddress);
  /*
   * What a new order can actually spend: the account balance less what this trader's own resting
   * orders already claim. Showing the raw balance let an account with 1,300 cNGN and 1,382 already
   * working read as fully available.
   */
  const committed = getCommittedBalances(workingOrders, walletAddress);
  const spendableCngn = accountCngn === null ? null : Math.max(0, accountCngn - committed.cngn);
  const spendableUsdc = accountUsdc === null ? null : Math.max(0, accountUsdc - committed.usdc);

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
      return buildOpenOrdersActivityView(workingOrders, walletAddress);
    }
    return ACTIVITY_VIEWS[bottomTab as keyof typeof ACTIVITY_VIEWS] ?? { columns: [], rows: [] };
  }

  const activityView = buildActivityView();

  /**
   * The wallet menu's Portfolio item. There is no separate portfolio route — the account's holdings
   * live in the activity panel's Assets tab, so this selects that tab and brings the panel into
   * view, which matters on the short viewports most of this app's traffic uses.
   */
  function showPortfolio() {
    setBottomTab("assets");
    activityPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /**
   * Cancels by `(owner_address, nonce)` — what markets-service takes — then refreshes the server
   * render so the book and this list reflect the removal rather than showing an order that is gone.
   */
  async function handleCancelOrder(nonce: string, ownerAddress: string) {
    setCancelError(null);
    setCancellingNonce(nonce);
    try {
      const result = await onCancelOrder(nonce, ownerAddress);
      if (!result.ok) {
        setCancelError(result.error ?? "Cancel failed");
        return;
      }
      // The venue has dropped it; reflect that at once rather than waiting for the refresh to land.
      setCancelledNonces((prev) => new Set(prev).add(nonce));
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
        onPortfolioSelect={showPortfolio}
        volume24hLabel={volumeLabel}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:min-h-0 md:overflow-hidden md:px-4">
        {/*
         * One grid, two rows: the chart and order book take the top row, the activity panel spans the
         * bottom row beneath them, and the ticket column runs the full height alongside both. The
         * ticket used to be boxed into the top row's height, which cut its Amount field off mid-box
         * on the ~700-900px viewports most of this app's desktop traffic uses.
         *
         * Three layouts, because one breakpoint cannot serve a 700px window and a 1600px one:
         *
         *   <768px   one column, ticket first — a phone.
         *   768px+   two columns: chart over book on the left, ticket beside them. The page
         *            scrolls rather than being pinned to the viewport; at this width three panels
         *            stacked into a fixed height leaves each one a sliver.
         *   1024px+  the fixed-height terminal: chart | book | ticket, activity spanning beneath.
         *
         * Gated at `xl` alone, the whole terminal stacked on any window under 1280px — a browser
         * window a little under half a 27" screen got a single column with the ticket on top,
         * while the venues it is compared against still had their columns. The two fixed columns
         * and gutters cost 646px, so 1024px still leaves the chart ~378px; below that the second
         * column has to give way, which is what the 768px layout is for.
         *
         * The bottom row takes 3/10 rather than 2/10: at 2/10 the activity panel was a ~144px sliver
         * whose own empty state ran past its bottom edge, so it read as a strip of tab labels rather
         * than a panel holding anything.
         */}
        <div className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,3fr)] md:overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_270px_320px] lg:grid-rows-[minmax(0,7fr)_minmax(0,3fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
          <div className="md:col-start-1 md:row-start-1 md:min-h-0 md:overflow-hidden lg:row-start-1">
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
          </div>

          <div className="md:col-start-1 md:row-start-2 md:min-h-0 md:overflow-hidden lg:col-start-2 lg:row-start-1">
            <SpotOrderBookPanel
              asks={bookAsks}
              bids={bookBids}
              lastPrice={lastPrice}
              onTabChange={setBookTab}
              tab={bookTab}
              trades={bookTrades}
            />
          </div>

          {/*
           * `order-first` below the grid breakpoint only: in the stacked single column the ticket
           * would sit below the chart and order book, putting the submit button ~2.5 screens down
           * the document. The lg grid places columns explicitly, so order resets there.
           *
           * The ticket shares the column with the balance summary beneath it. The ticket only ever
           * reports the leg the selected side spends, so the summary is where both legs of the
           * account are readable at once while an order is being written; the header carries the
           * same two figures for the widths where this column is not on screen at all.
           */}
          <div className="order-first flex min-h-[420px] flex-col gap-3 md:order-0 md:col-start-2 md:row-span-3 md:row-start-1 md:min-h-0 md:gap-2 md:overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
            <SpotOrderFormPanel
              anchorPrice={anchorPrice}
              availableCngn={spendableCngn}
              availableUsdc={spendableUsdc}
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
              accountCngn={accountCngn}
              accountUsdc={accountUsdc}
              onDepositRequest={onDepositRequest}
            />
          </div>

          <div
            className="min-h-[200px] md:col-start-1 md:row-start-3 md:min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2"
            ref={activityPanelRef}
          >
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
