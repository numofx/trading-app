"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { buildOpenOrdersActivityView, getOwnedOpenOrders } from "@/lib/account-activity-views";
import { formatBalance } from "@/lib/account-balance-display";
import type { CandleInterval } from "@/lib/markets-service";
import {
  getAnchorPrice,
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
import { get24hStats } from "@/lib/ticker-stats";
import type { Candle, SpotMarket } from "@/lib/trading.types";
import type { AccountSummaryRow } from "@/ui/trading-terminal/order-form/AccountSummary";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderFormPanel } from "@/ui/trading-terminal/SpotOrderFormPanel";
import { TerminalGrid } from "@/ui/trading-terminal/TerminalGrid";
import { usePublishTerminalHeader } from "@/ui/trading-terminal/TerminalHeaderSlot";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useLiveMarketBook } from "@/ui/trading-terminal/useLiveMarketBook";
import { useSignedHistoryTabs } from "@/ui/trading-terminal/useSignedHistoryTabs";

/** The venue's symbol for this market; markets-service resolves the stream subscription from it. */
const SPOT_MARKET_SYMBOL = "cNGN-USDC";

/**
 * The spot market's panels on the terminal's grid, under the shell's header, which it feeds its
 * figures and the deposit control through the header slot. Presentational: the wallet, signing
 * and the account live in `SpotMarketPanels`, so a fixture can render this with made-up figures.
 */
export function SpotTradingTerminal({
  candles,
  candleInterval = "1d",
  spotMarket,
  accountCngn = null,
  accountUsdc = null,
  walletAddress = null,
  depositControl,
  legacy = null,
  legacyControl = null,
  onDepositRequest,
  onWithdrawRequest,
  onFormEdit,
  onSubmitOrder,
  onCancelOrder,
  onSignOrderHistory,
  hasWallet = false,
  isSignedIn = false,
  isPreparingAccount = false,
  isSubmitting = false,
  lastAction = null,
}: {
  candles: Candle[];
  /** The interval `candles` are bucketed at, which streamed fills are folded in at. The page serves daily. */
  candleInterval?: CandleInterval;
  spotMarket: SpotMarket;
  /** Subaccount balances as numbers — the ticket sizes a percentage of what the account can spend. */
  accountCngn?: number | null;
  accountUsdc?: number | null;
  /** Connected wallet, used to pick this trader's own orders out of the public book. */
  walletAddress?: string | null;
  /** The deposit dialog trigger, published to the shell's header bar. */
  depositControl?: ReactNode;
  /** The wallet's account on the retired spot stack, shown withdraw-only on the Assets tab. */
  legacy?: { accountId: string; cngnLabel: string | null; usdcLabel: string | null } | null;
  /** The withdraw trigger for that account, rendered on its rows. */
  legacyControl?: ReactNode;
  /**
   * Opens the deposit dialog; the ticket CTA calls it while there is no funded account, or when the
   * order on screen is short of one leg. The currency is the asset that is short, so the dialog
   * opens on the one the trader was asked to deposit rather than always on USDC.
   */
  onDepositRequest?: (currency?: DepositCurrency) => void;
  /** Opens the deposit dialog on Withdraw, for the asset the Account row names. */
  onWithdrawRequest?: (currency: DepositCurrency) => void;
  /** Any edit to the order ticket; the host clears the order status line on it. */
  onFormEdit?: () => void;
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
  /**
   * personal_sign with the connected wallet, for the Order History login. The parent holds the
   * wallet, so it owns this; absent when there is none to sign with.
   */
  onSignOrderHistory?: (message: string) => Promise<string>;
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
  const [bottomTab, setBottomTab] = useState<string>("open-orders");
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
  const ticketColumnRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const signedHistory = useSignedHistoryTabs({
    bottomTab,
    isSignedIn,
    market: SPOT_MARKET_SYMBOL,
    signMessage: onSignOrderHistory,
    walletAddress,
  });

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
  const {
    asks: bookAsks,
    bestAsk,
    bestBid,
    bids: bookBids,
    candles: liveCandles,
    lastPrice,
    stats24h: liveStats,
    trades: bookTrades,
  } = useLiveMarketBook({
    candleInterval,
    candles,
    snapshot: spotMarket,
    symbol: SPOT_MARKET_SYMBOL,
    type: "spot",
  });
  const anchorPrice = getAnchorPrice(bestAsk, bestBid, lastPrice);

  function handleSubmitOrder(args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market";
  }) {
    onSubmitOrder({ ...args, book: { bestAsk, bestBid } });
  }
  // Measured to the price the header actually shows, so the arrow describes the figure beside it.
  const { changePercent, high, low, volumeLabel } = get24hStats(liveStats, anchorPrice);
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
   * orders already claim. Showing the raw balance let an account with 1,300 cNGN and 1,382 cNGN
   * already working read as fully available.
   */
  const committed = getCommittedBalances(workingOrders, walletAddress);
  const spendableCngn = accountCngn === null ? null : Math.max(0, accountCngn - committed.cngn);
  const spendableUsdc = accountUsdc === null ? null : Math.max(0, accountUsdc - committed.usdc);

  function buildActivityView() {
    if (bottomTab === "open-orders") {
      return buildOpenOrdersActivityView(workingOrders, walletAddress);
    }
    return (
      signedHistory.view ??
      ACTIVITY_VIEWS[bottomTab as keyof typeof ACTIVITY_VIEWS] ?? { columns: [], rows: [] }
    );
  }

  const activityView = buildActivityView();

  /**
   * The wallet menu's Portfolio item. There is no separate portfolio route — the account's holdings
   * live in the Account panel under the ticket, so this brings that column into view, which
   * matters on the short viewports most of this app's traffic uses.
   */
  function showPortfolio() {
    ticketColumnRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  usePublishTerminalHeader({
    changePercent24h: changePercent,
    depositControl,
    high24h: high,
    low24h: low,
    market: "spot",
    onPortfolioSelect: showPortfolio,
    price: anchorPrice,
    volume24hLabel: volumeLabel,
  });

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
    <TerminalGrid
      activity={
        <>
          <TradingActivityPanel
            activityView={activityView}
            emptyState={signedHistory.emptyState}
            footerLinks={FOOTER_LINKS}
            isSignedIn={isSignedIn}
            onTabSelect={setBottomTab}
            rowAction={buildSpotRowAction({
              bottomTab,
              cancellingNonce,
              handleCancelOrder,
              ownedOpenOrders,
              tradeHistoryRowAction: signedHistory.rowAction,
            })}
            selectedTab={bottomTab}
            tabs={SPOT_BOTTOM_TABS}
          />
          {cancelError === null ? null : (
            <p className="px-4 pt-1 text-[11px] text-sell">{cancelError}</p>
          )}
        </>
      }
      book={
        <SpotOrderBookPanel
          asks={bookAsks}
          bids={bookBids}
          lastPrice={lastPrice}
          onTabChange={setBookTab}
          tab={bookTab}
          trades={bookTrades}
        />
      }
      chart={
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
      }
      ticketColumn={
        /*
         * The ticket shares the column with the balance summary beneath it. The ticket only ever
         * reports the leg the selected side spends, so the summary is where both legs of the
         * account are readable at once while an order is being written.
         */
        <>
          <SpotOrderFormPanel
            anchorPrice={anchorPrice}
            asks={bookAsks}
            availableCngn={spendableCngn}
            availableUsdc={spendableUsdc}
            bestAsk={bestAsk}
            bestBid={bestBid}
            bids={bookBids}
            hasWallet={hasWallet}
            isPreparingAccount={isPreparingAccount}
            isSubmitting={isSubmitting}
            lastAction={lastAction}
            onDepositRequest={onDepositRequest}
            onEdit={onFormEdit}
            onSubmitOrder={handleSubmitOrder}
            ownOpenOrders={ownedOpenOrders}
            takerFeeBps={spotMarket.takerFeeBps}
          />
          {/* Both legs of the account, in the order the ticket spends them, then any retired account's. */}
          <AccountSummary
            rows={buildAccountRows({
              accountCngn,
              accountUsdc,
              hasWallet,
              legacy,
              legacyControl,
              onDepositRequest,
              onWithdrawRequest,
            })}
          />
        </>
      }
      ticketColumnRef={ticketColumnRef}
    />
  );
}

/**
 * The Account panel's rows: both legs of the live account, with deposit and (once a wallet is
 * connected) withdraw, then the retired spot account's holdings, which can only be withdrawn and
 * share one withdraw dialog hung on the first of them.
 */
function buildAccountRows(inputs: {
  accountCngn: number | null;
  accountUsdc: number | null;
  hasWallet: boolean;
  legacy: { accountId: string; cngnLabel: string | null; usdcLabel: string | null } | null;
  legacyControl: ReactNode;
  onDepositRequest?: (currency?: DepositCurrency) => void;
  onWithdrawRequest?: (currency: DepositCurrency) => void;
}): AccountSummaryRow[] {
  const live = (symbol: DepositCurrency, balance: number | null): AccountSummaryRow => ({
    balance: formatBalance(balance, symbol),
    onWithdraw: inputs.hasWallet ? () => inputs.onWithdrawRequest?.(symbol) : undefined,
    onDeposit: () => inputs.onDepositRequest?.(symbol),
    symbol,
  });
  const rows = [live("USDC", inputs.accountUsdc), live("cNGN", inputs.accountCngn)];
  if (inputs.legacy === null) {
    return rows;
  }
  const note = `Old spot account #${inputs.legacy.accountId} · withdraw only`;
  const legacyRows = (
    [
      ["USDC", inputs.legacy.usdcLabel],
      ["cNGN", inputs.legacy.cngnLabel],
    ] as const
  )
    .filter((entry): entry is readonly [DepositCurrency, string] => entry[1] !== null)
    .map(([symbol, balance], index) => ({
      // One dialog withdraws from both escrows, so the trigger sits on the first row only.
      action: index === 0 ? inputs.legacyControl : <span />,
      balance,
      id: `legacy-${symbol}`,
      note,
      symbol,
    }));
  return [...rows, ...legacyRows];
}

/**
 * The control at the end of a row: Cancel on an open order, the trade-history action otherwise.
 */
function buildSpotRowAction(inputs: {
  bottomTab: string;
  cancellingNonce: string | null;
  handleCancelOrder: (nonce: string, ownerAddress: string) => void;
  ownedOpenOrders: { nonce: string; ownerAddress: string }[];
  tradeHistoryRowAction: ((rowIndex: number) => ReactNode) | undefined;
}) {
  if (inputs.bottomTab === "open-orders") {
    return (rowIndex: number) => {
      const order = inputs.ownedOpenOrders[rowIndex];
      if (!order) {
        return null;
      }
      const busy = inputs.cancellingNonce === order.nonce;
      return (
        <button
          className="cursor-pointer rounded-sm bg-input-bg px-2 py-1 font-medium text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active disabled:cursor-wait disabled:opacity-60"
          disabled={busy}
          onClick={() => inputs.handleCancelOrder(order.nonce, order.ownerAddress)}
          type="button"
        >
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      );
    };
  }
  return inputs.tradeHistoryRowAction;
}
