"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { Duration } from "effect";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createWalletClient, custom, isAddressEqual } from "viem";
import {
  buildFutureOpenOrdersActivityView,
  buildFutureOrderHistoryActivityView,
  buildFutureTradeHistoryActivityView,
  getOwnedOpenOrders,
} from "@/lib/account-activity-views";
import { formatBalance } from "@/lib/account-balance-display";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import type { ChartInterval } from "@/lib/chart-interval";
import { CHART_INTERVALS } from "@/lib/chart-interval";
import {
  buildFutureBalancesView,
  buildFutureHeaderMetrics,
  buildFuturePositionsView,
  describeFutureRejection,
  FUTURE_PRICE_DECIMALS,
  FUTURE_PRICE_GROUPS,
  futureCloseOrder,
  futureMarkSource,
  futureOrderUiSide,
  futureWorstFeeUnits,
  isOutsideFillBand,
} from "@/lib/future-market";
import type { FutureAccount, FutureMarket } from "@/lib/future-market.types";
import { FUTURE_ACTIVITY_VIEWS, FUTURE_BOTTOM_TABS } from "@/lib/future-terminal-config";
import type { OrderOutcome } from "@/lib/order-settlement";
import { isOrderFillKnown, pollOrderOutcome } from "@/lib/order-settlement";
import { PERP_DEFAULT_MAX_SLIPPAGE } from "@/lib/perp-market";
import { getAnchorPrice, getMarketableLimitPrice } from "@/lib/spot-market";
import { buildCancelEnvelope, buildSpotOrderEnvelope } from "@/lib/spot-order-submission";
import { FOOTER_LINKS } from "@/lib/spot-terminal-config";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { getUsdcCngnManagerAddress } from "@/lib/subaccount-deposit-config";
import { get24hStats } from "@/lib/ticker-stats";
import type { ActivityTab, ActivityView, TradePrint } from "@/lib/trading.types";
import type { FutureOrderRequest } from "@/ui/trading-terminal/FutureOrderFormPanel";
import { FutureOrderFormPanel } from "@/ui/trading-terminal/FutureOrderFormPanel";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import type { AccountSummaryRow } from "@/ui/trading-terminal/order-form/AccountSummary";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import type { ChartUnits, SpotChartTab } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { BookUnits, SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { TerminalGrid } from "@/ui/trading-terminal/TerminalGrid";
import { usePublishTerminalHeader } from "@/ui/trading-terminal/TerminalHeaderSlot";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useAccountTransfer } from "@/ui/trading-terminal/useAccountTransfer";
import { useChartInterval } from "@/ui/trading-terminal/useChartInterval";
import { useFutureAccount } from "@/ui/trading-terminal/useFutureAccount";
import { useFutureOpenInterest } from "@/ui/trading-terminal/useFutureOpenInterest";
import { useLiveMarketBook } from "@/ui/trading-terminal/useLiveMarketBook";
import { useOrderStatus } from "@/ui/trading-terminal/useOrderStatus";
import { useSignedHistoryTabs } from "@/ui/trading-terminal/useSignedHistoryTabs";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";

type FutureBottomTab = keyof typeof FUTURE_ACTIVITY_VIEWS;

/** What the venue's amounts count: USDC of notional, or whole contracts on a venue that sizes in them. */
function sizeUnitLabel(market: FutureMarket | null) {
  return market !== null && market.state.unitUsdc === market.state.contractSizeUsdc
    ? "Contracts"
    : "USDC";
}

/** USDC of notional restates in cNGN at each level's price; whole contracts have no such restatement. */
function bookUnits(market: FutureMarket | null): BookUnits {
  const base = sizeUnitLabel(market);
  return {
    base,
    price: "cNGN",
    priceDecimals: FUTURE_PRICE_DECIMALS,
    priceGroups: FUTURE_PRICE_GROUPS,
    quote: base === "USDC" ? "cNGN" : null,
  };
}

function chartUnits(symbol: string, market: FutureMarket | null): ChartUnits {
  return {
    axisDecimals: FUTURE_PRICE_DECIMALS,
    pair: symbol,
    priceDecimals: FUTURE_PRICE_DECIMALS,
    priceLabel: "Last traded",
    volumeUnit: sizeUnitLabel(market).toLowerCase(),
  };
}

/** A fill's volume in the chart's unit: its size, already USDC of notional (or contracts). */
function fillSize(trade: TradePrint) {
  return trade.size;
}

/** Each side's resting notional in USDC: the venue's sizes count `unitUsdc` each. */
function bookDepthUsdc(
  book: { asks: { size: number }[]; bids: { size: number }[] },
  unitUsdc: number
) {
  const total = (levels: { size: number }[]) =>
    levels.reduce((sum, level) => sum + level.size, 0) * unitUsdc;
  return { asks: total(book.asks), bids: total(book.bids) };
}

/** How the next mark is set, from the live book; null without the market. */
function markSourceOf(
  market: FutureMarket | null,
  book: { asks: { size: number }[]; bids: { size: number }[] }
) {
  return market === null ? null : futureMarkSource(bookDepthUsdc(book, market.state.unitUsdc));
}

/** How often the countdown to the last trade time re-renders. */
const CLOCK_TICK_MS = Duration.toMillis("30 seconds");

const ROW_BUTTON_CLASSES =
  "cursor-pointer rounded-sm bg-input-bg px-2 py-1 font-medium text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active disabled:cursor-wait disabled:opacity-60";

/** The wall clock, re-read every half minute: what the countdown and the trading gate are measured against. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** The signed limit as a decimal string; two places beyond the display, never exponent notation. */
function toPriceString(price: number) {
  return price.toFixed(FUTURE_PRICE_DECIMALS + 2);
}

/**
 * The limit a market order is signed at: through the touch by the ticket's slippage, then held
 * inside the fill band, since the venue refuses a limit beyond it and the chain a fill beyond it.
 */
function resolveFutureOrderPrice(
  request: FutureOrderRequest,
  market: FutureMarket,
  touch: { bestAsk: number | null; bestBid: number | null }
): { price: string } | { error: string } {
  const band = market.state.fillBand;
  if (band === null) {
    return { error: "The venue cannot read the fill band right now; try again shortly." };
  }
  if (request.orderType === "Limit") {
    const limit = Number(request.limitPrice.replaceAll(",", ""));
    if (!Number.isFinite(limit) || limit <= 0) {
      return { error: "Enter a limit price in cNGN per USDC." };
    }
    if (isOutsideFillBand(limit, band)) {
      return { error: "Limit price outside the fill band shown under the field." };
    }
    return { price: request.limitPrice.replaceAll(",", "") };
  }
  const uiSide = futureOrderUiSide(request.side);
  const marketable = getMarketableLimitPrice(
    uiSide,
    touch.bestAsk,
    touch.bestBid,
    request.maxSlippage
  );
  if (marketable === null) {
    return { error: "No resting liquidity on that side. Use a limit order." };
  }
  const banded = Math.min(band.high, Math.max(band.low, marketable));
  return { price: toPriceString(banded) };
}

/**
 * How long a Close is signed for. The venue stops matching an order at its expiry and the chain
 * refuses to settle one past it, so what the book cannot fill lapses instead of resting. It covers
 * the wallet prompt, since the expiry is fixed before signing, and the settlement of every rung,
 * each waiting on its receipt.
 */
const CLOSE_ORDER_LIFETIME_SECONDS = Duration.toSeconds("2 minutes");

/**
 * Signs a future order for the series' asset and sub id on its TradeModule, with the fee ceiling
 * per contract, then posts it. `price` is cNGN per USDC; `units` the venue's whole units, each
 * signed as the market's `amountScale`. A limit order is signed to the series' last trade time, so
 * it rests until filled or cancelled; a market order keeps the day-long default unless
 * `lifetimeSeconds` shortens it.
 */
async function signAndPostFutureOrder({
  lifetimeSeconds,
  market,
  onAwaitingSignature,
  orderType,
  price,
  reduceOnly,
  side,
  subaccountId,
  units,
  wallet,
}: {
  lifetimeSeconds?: number;
  market: FutureMarket;
  onAwaitingSignature: () => void;
  orderType: FutureOrderRequest["orderType"];
  /** Ask the venue to hold the order to the account's position in the series. */
  reduceOnly: boolean;
  price: string;
  side: "buy" | "sell";
  subaccountId: string;
  units: number;
  wallet: ConnectedWallet;
}) {
  const appChain = getAppChain();
  await wallet.switchChain(appChain.id);
  const provider = await wallet.getEthereumProvider();
  const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });
  const envelope = buildSpotOrderEnvelope({
    expiry: resolveFutureOrderExpiry(orderType, market, lifetimeSeconds),
    market: {
      amountScale: market.state.amountScale,
      assetAddress: market.stack.assetAddress,
      orderIdPrefix: "future",
      subId: market.stack.subId,
      tradeModuleAddress: market.stack.tradeModuleAddress,
      worstFeeUnits: futureWorstFeeUnits(market.state.contractSizeUsdc),
    },
    reduceOnly,
    side,
    subaccountId,
    uiPrice: price,
    uiSize: String(units),
    walletAddress: wallet.address,
  });
  onAwaitingSignature();
  const signature = await walletClient.signTypedData({
    account: wallet.address as `0x${string}`,
    ...envelope.typedData,
  });
  const response = await fetch("/api/orders", {
    body: JSON.stringify({ ...envelope.payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return { body, ok: response.ok, orderId: envelope.payload.order_id, status: response.status };
}

function resolveFutureOrderExpiry(
  orderType: FutureOrderRequest["orderType"],
  market: FutureMarket,
  lifetimeSeconds: number | undefined
) {
  if (lifetimeSeconds !== undefined) {
    return Math.floor(Date.now() / 1000) + lifetimeSeconds;
  }
  return orderType === "Limit" ? Math.floor(market.state.lastTradeAtMs / 1000) : undefined;
}

const FILL_POLL_INTERVAL_MS = Duration.toMillis("1 second");
const FILL_POLL_TIMEOUT_MS = Duration.toMillis("15 seconds");

/** The order as `/api/orders/{id}` reports it; null before the matcher records it. */
async function readFutureOrder(orderId: string): Promise<OrderOutcome | null> {
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as OrderOutcome) : null;
  } catch {
    return null;
  }
}

/**
 * The first block that can hold a fill the venue has just recorded. The venue marks an order
 * filled once the settlement is sent, so the account is read from the block after the latest,
 * not from the 15-second poll, which left a filled position off screen for up to its interval.
 */
async function blockAfterLatest() {
  try {
    return (await createBasePublicClient().getBlockNumber()) + 1n;
  } catch {
    return null;
  }
}

/** Signs a cancel for one of the wallet's resting orders and posts it; true when the venue took it. */
async function signAndPostCancel(wallet: ConnectedWallet, nonce: string, ownerAddress: string) {
  const appChain = getAppChain();
  await wallet.switchChain(appChain.id);
  const provider = await wallet.getEthereumProvider();
  const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });
  const envelope = buildCancelEnvelope({ nonce, ownerAddress, signerAddress: wallet.address });
  const signature = await walletClient.signTypedData({
    account: wallet.address as `0x${string}`,
    ...envelope.typedData,
  });
  const response = await fetch("/api/orders/cancel", {
    body: JSON.stringify({ ...envelope.payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response;
}

/** Signs the order-history login with personal_sign, or nothing without a wallet. */
function buildHistorySigner(wallet: ConnectedWallet | null, walletsReady: boolean) {
  if (wallet === null) {
    return undefined;
  }
  return async (message: string) => {
    if (!walletsReady) {
      throw new Error("Connect a wallet to view your order history");
    }
    const provider = await wallet.getEthereumProvider();
    const walletClient = createWalletClient({ chain: getAppChain(), transport: custom(provider) });
    return walletClient.signMessage({ account: wallet.address as `0x${string}`, message });
  };
}

function buildActivityView(inputs: {
  account: FutureAccount | null;
  bottomTab: FutureBottomTab;
  market: FutureMarket | null;
  signedHistoryView: ActivityView | null;
  symbol: string;
  walletAddress: string | null;
}): ActivityView {
  const { bottomTab, market } = inputs;
  if (market === null) {
    return FUTURE_ACTIVITY_VIEWS[bottomTab];
  }
  switch (bottomTab) {
    case "positions":
      return buildFuturePositionsView(inputs.account, market.state, inputs.symbol);
    case "balances":
      return buildFutureBalancesView(inputs.account, market.state);
    case "open-orders":
      return buildFutureOpenOrdersActivityView(
        market.openOrders,
        inputs.walletAddress,
        market.state.unitUsdc
      );
    default:
      return inputs.signedHistoryView ?? FUTURE_ACTIVITY_VIEWS[bottomTab];
  }
}

/**
 * Deposit and Withdraw on each Balances row, USDC then cNGN as `buildFutureBalancesView` lays
 * them out; Withdraw only where something is held.
 */
function buildBalanceRowAction(
  account: FutureAccount | null,
  onDeposit: (currency: DepositCurrency) => void,
  onWithdraw: (currency: DepositCurrency) => void
) {
  const rows: { currency: DepositCurrency; held: bigint }[] = [
    { currency: "USDC", held: account?.cashUnits ?? 0n },
    { currency: "cNGN", held: account?.cngnUnits ?? 0n },
  ];
  return (rowIndex: number) => {
    const row = rows[rowIndex];
    if (row === undefined) {
      return null;
    }
    return (
      <span className="inline-flex gap-1.5">
        <button
          className={ROW_BUTTON_CLASSES}
          onClick={() => onDeposit(row.currency)}
          type="button"
        >
          Deposit
        </button>
        {row.held > 0n ? (
          <button
            className={ROW_BUTTON_CLASSES}
            onClick={() => onWithdraw(row.currency)}
            type="button"
          >
            Withdraw
          </button>
        ) : null}
      </span>
    );
  };
}

function buildRowAction(inputs: {
  account: FutureAccount | null;
  bottomTab: FutureBottomTab;
  cancellingNonce: string | null;
  hasWallet: boolean;
  isLive: boolean;
  isSubmitting: boolean;
  onCancel: (nonce: string, ownerAddress: string) => void;
  onClose: () => void;
  onDeposit: (currency: DepositCurrency) => void;
  onWithdraw: (currency: DepositCurrency) => void;
  ownedOpenOrders: { nonce: string; ownerAddress: string }[];
  tradeHistoryRowAction: ((rowIndex: number) => ReactNode) | undefined;
}) {
  if (!(inputs.isLive && inputs.hasWallet)) {
    return undefined;
  }
  if (inputs.bottomTab === "trade-history") {
    return inputs.tradeHistoryRowAction;
  }
  if (inputs.bottomTab === "balances") {
    return buildBalanceRowAction(inputs.account, inputs.onDeposit, inputs.onWithdraw);
  }
  if (inputs.bottomTab === "positions") {
    // One series, so at most one row.
    return (rowIndex: number) =>
      rowIndex === 0 && (inputs.account?.positionUnits ?? 0n) !== 0n ? (
        <button
          className={ROW_BUTTON_CLASSES}
          disabled={inputs.isSubmitting}
          onClick={inputs.onClose}
          type="button"
        >
          {inputs.isSubmitting ? "Closing…" : "Close"}
        </button>
      ) : null;
  }
  if (inputs.bottomTab !== "open-orders") {
    return undefined;
  }
  return (rowIndex: number) => {
    const order = inputs.ownedOpenOrders[rowIndex];
    if (!order) {
      return null;
    }
    const busy = inputs.cancellingNonce === order.nonce;
    return (
      <button
        className={ROW_BUTTON_CLASSES}
        disabled={busy}
        onClick={() => inputs.onCancel(order.nonce, order.ownerAddress)}
        type="button"
      >
        {busy ? "Cancelling…" : "Cancel"}
      </button>
    );
  };
}

/** What a fill changes on the account: its position in the series. */
function positionSignature(account: FutureAccount | null) {
  return account === null ? "" : account.positionUnits.toString();
}

function withCounts(
  tabs: typeof FUTURE_BOTTOM_TABS,
  hasWallet: boolean,
  counts: Partial<Record<FutureBottomTab, number>>
): ActivityTab[] {
  if (!hasWallet) {
    return [...tabs];
  }
  return tabs.map((tab) => {
    const count = counts[tab.id as FutureBottomTab];
    return count === undefined ? tab : { ...tab, label: `${tab.label} (${count})` };
  });
}

function buildEmptyState(
  market: FutureMarket | null,
  subaccountId: string | null,
  bottomTab: FutureBottomTab,
  signedHistoryEmptyState: { action?: ReactNode; body: string; title: string } | undefined
) {
  if (signedHistoryEmptyState !== undefined) {
    return signedHistoryEmptyState;
  }
  if (market === null) {
    return { body: "The future isn't listed on the venue right now.", title: "Nothing yet" };
  }
  if (bottomTab === "order-history" || bottomTab === "trade-history") {
    return undefined;
  }
  if (subaccountId === null) {
    return {
      body: "Spot and the future trade from one account. Deposit USDC to open it.",
      title: "No trading account",
    };
  }
  if (bottomTab === "positions") {
    return {
      body: "Positions you open will appear here, with their variation margin at the hourly mark.",
      title: "No positions",
    };
  }
  return undefined;
}

/** The trading account's two holdings under the ticket, each with its Deposit and Withdraw. */
function buildAccountRows(
  account: FutureAccount | null,
  onDeposit: (currency: DepositCurrency) => void,
  onWithdraw: (currency: DepositCurrency) => void
): AccountSummaryRow[] {
  return [
    {
      balance: formatBalance(account?.cash ?? null, "USDC"),
      onWithdraw: account === null ? undefined : () => onWithdraw("USDC"),
      symbol: "USDC",
      onDeposit: () => onDeposit("USDC"),
    },
    {
      balance: formatBalance(account?.cngn ?? null, "cNGN"),
      onWithdraw: (account?.cngnUnits ?? 0n) > 0n ? () => onWithdraw("cNGN") : undefined,
      symbol: "cNGN",
      onDeposit: () => onDeposit("cNGN"),
    },
  ];
}

/**
 * The future's book, trades and candles from the shared live-book hook, its headline price (the
 * touch, else the venue's mark) and its 24h volume as USDC of notional.
 */
function useFutureBook(market: FutureMarket | null, symbol: string, candleInterval: ChartInterval) {
  const book = useLiveMarketBook({
    candleInterval,
    candles: market?.candles ?? [],
    enabled: market !== null,
    fillVolume: fillSize,
    symbol,
    type: "future",
    snapshot: {
      mark: market?.mark ?? null,
      orderBookAsks: market?.orderBookAsks ?? [],
      orderBookBids: market?.orderBookBids ?? [],
      stats24h: market?.stats24h ?? null,
      trades: market?.trades ?? [],
    },
  });
  const anchor = getAnchorPrice(book.bestAsk, book.bestBid, book.lastPrice);
  const units = market?.volumeUnits24h ?? null;
  return {
    book,
    price: market === null ? null : (anchor ?? market.state.markPrice),
    stats: get24hStats(book.stats24h, book.lastPrice),
    volumeUsd: market === null || units === null ? null : units * market.state.unitUsdc,
  };
}

/**
 * Placing and cancelling future orders: each signs with the wallet, posts to the venue and reports
 * the outcome on the ticket's status line. Without a trading account, placing opens the deposit
 * that creates one instead.
 */
function useFutureOrderActions({
  market,
  onAccountChanged,
  onNeedsAccount,
  orderStatus,
  subaccountId,
  touch,
  wallet,
}: {
  market: FutureMarket | null;
  onAccountChanged: (minBlock: bigint | null) => void;
  onNeedsAccount: () => void;
  orderStatus: ReturnType<typeof useOrderStatus>;
  subaccountId: string | null;
  touch: { bestAsk: number | null; bestBid: number | null };
  wallet: ConnectedWallet | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingNonce, setCancellingNonce] = useState<string | null>(null);

  /**
   * Watches an accepted order until its fill is known, then re-reads the account at the block
   * after the fill so the position shows at once. An order the venue ends without a fill says so.
   */
  async function followFill(orderId: string) {
    const outcome = await pollOrderOutcome(() => readFutureOrder(orderId), {
      intervalMs: FILL_POLL_INTERVAL_MS,
      timeoutMs: FILL_POLL_TIMEOUT_MS,
      until: isOrderFillKnown,
    });
    if (Number.parseFloat(outcome?.filled_amount ?? "0") > 0) {
      onAccountChanged(await blockAfterLatest());
    } else if (outcome?.status === "cancelled" || outcome?.status === "expired") {
      const reason = outcome.cancel_reason
        ? ` (${outcome.cancel_reason.replaceAll("_", " ")})`
        : "";
      orderStatus.settle(`Order ${outcome.status} without a fill${reason}.`);
    }
  }

  /**
   * `options.awaitingSignature` replaces the line shown while the wallet signs,
   * `options.eventOrderType` the order type the analytics events carry (a Close is a market order)
   * and `options.lifetimeSeconds` how long the order is signed for, when not the default.
   */
  async function submit(
    request: FutureOrderRequest,
    options: { awaitingSignature?: string; eventOrderType?: string; lifetimeSeconds?: number } = {}
  ) {
    if (market === null || wallet === null) {
      return;
    }
    if (subaccountId === null) {
      onNeedsAccount();
      return;
    }
    const resolved = resolveFutureOrderPrice(request, market, touch);
    if ("error" in resolved) {
      orderStatus.announce(resolved.error);
      return;
    }
    const event = {
      market_id: "usdc-cngn-future",
      notional_usdc: request.units * market.state.unitUsdc,
      order_side: request.side,
      order_type: options.eventOrderType ?? request.orderType,
    };
    setIsSubmitting(true);
    try {
      const { body, ok, orderId, status } = await signAndPostFutureOrder({
        lifetimeSeconds: options.lifetimeSeconds,
        market,
        orderType: request.orderType,
        price: resolved.price,
        reduceOnly: request.reduceOnly,
        side: futureOrderUiSide(request.side),
        onAwaitingSignature: () =>
          orderStatus.announce(
            options.awaitingSignature ?? `Awaiting wallet signature for account #${subaccountId}`
          ),
        subaccountId,
        units: request.units,
        wallet,
      });
      if (!ok) {
        posthog.capture("order_rejected", {
          ...event,
          error_message: body?.error ?? null,
          http_status: status,
        });
        orderStatus.settle(describeFutureRejection(body?.error, "Futures order submission failed"));
        return;
      }
      posthog.capture("order_submitted", event);
      orderStatus.announce(null, { awaitFill: true });
      router.refresh();
      await followFill(orderId);
      router.refresh();
    } catch (error) {
      posthog.captureException(error, {
        properties: { market_id: "usdc-cngn-future", order_side: request.side },
      });
      orderStatus.settle(
        error instanceof Error ? error.message : "Futures order submission failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancel(nonce: string, ownerAddress: string) {
    if (wallet === null) {
      return;
    }
    setCancellingNonce(nonce);
    try {
      const response = await signAndPostCancel(wallet, nonce, ownerAddress);
      orderStatus.settle(response.ok ? "Order cancelled." : `Cancel failed (${response.status})`);
      router.refresh();
    } catch (error) {
      orderStatus.settle(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setCancellingNonce(null);
    }
  }

  return { cancel, cancellingNonce, isSubmitting, submit };
}

/**
 * The wallet's one trading account, which spot shares, when the venue margins the future under
 * the manager this bundle resolves it under (the build check holds that for spot). A venue that
 * names another manager gets its own lookup there instead, so an order is never signed from an
 * account that cannot hold the future.
 */
function useFutureTradingAccount(
  stack: FutureMarket["stack"] | null,
  walletAddress: string | null,
  sessionAccount: ReturnType<typeof useTradingSubaccount>
) {
  const shared =
    stack === null || isAddressEqual(stack.managerAddress, getUsdcCngnManagerAddress());
  const ownLookup = useTradingSubaccount(
    shared ? null : walletAddress,
    stack === null ? undefined : { depositAsset: stack.cashAddress, manager: stack.managerAddress }
  );
  return { account: shared ? sessionAccount : ownLookup, shared };
}

/**
 * One cash-settled future series under the shell, on the same grid as spot.
 *
 * The future trades from the wallet's one trading account, which spot shares: since 2026-10-13
 * that account lives under the MarginEngine, the only manager whose accounts may hold the future,
 * so spot fills, futures positions and their margin are one balance. The first deposit opens it.
 * Its position, margin and unsettled variation margin are read from chain, since markets-service
 * serves none of them for the future. Orders are signed for the future's asset and series on the perp's TradeModule,
 * with the fee ceiling per contract.
 *
 * `market` is null while markets-service does not list the series with its state and stack; the
 * panels then render their empty states and a ticket that cannot submit.
 */
export function FutureMarketPanels({
  candleInterval,
  market,
  symbol,
}: {
  /** The interval the page read the candles at, from `?interval=`. */
  candleInterval: ChartInterval;
  market: FutureMarket | null;
  /** The series' venue symbol, from the route: the stream, history and display name. */
  symbol: string;
}) {
  const session = useTerminalSession();
  const { isSignedIn, login, walletsReady } = session;
  const primaryWallet = market === null ? null : session.primaryWallet;
  const nowMs = useNow();

  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useChartInterval(candleInterval);
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<FutureBottomTab>("positions");

  const stack = market?.stack ?? null;
  const { account, shared } = useFutureTradingAccount(
    stack,
    primaryWallet?.address ?? null,
    session.account
  );
  const subaccountId = market === null ? null : account.subaccountId;
  const futureAccount = useFutureAccount(subaccountId, stack);
  const orderStatus = useOrderStatus(positionSignature(futureAccount.account));
  const transfer = useAccountTransfer({
    account,
    accountRows: futureAccount.rows,
    depositManager: shared ? undefined : stack?.managerAddress,
    depositNotes: {
      cNGN: "cNGN counts as margin at half its index value. Variation margin is paid from cNGN first, then USDC.",
    },
    onTransferred: (blockNumber) => futureAccount.refresh(blockNumber),
  });

  const signedHistory = useSignedHistoryTabs({
    bottomTab,
    isSignedIn,
    market: symbol,
    signMessage: buildHistorySigner(primaryWallet, walletsReady),
    walletAddress: primaryWallet?.address ?? null,
    orderHistoryView: (orders) =>
      buildFutureOrderHistoryActivityView(orders, symbol, market?.state.unitUsdc ?? 1),
    tradeHistoryView: (fills) =>
      buildFutureTradeHistoryActivityView(fills, symbol, market?.state.unitUsdc ?? 1),
  });

  const { book, price, stats } = useFutureBook(market, symbol, candleInterval);
  const ownedOpenOrders = getOwnedOpenOrders(
    market?.openOrders ?? [],
    primaryWallet?.address ?? null
  );
  const actions = useFutureOrderActions({
    market,
    onAccountChanged: (minBlock) => futureAccount.refresh(minBlock),
    onNeedsAccount: () => transfer.openDeposit("USDC"),
    orderStatus,
    subaccountId,
    touch: { bestAsk: book.bestAsk, bestBid: book.bestBid },
    wallet: primaryWallet,
  });

  const openInterestUsd = useFutureOpenInterest(market);

  /**
   * Closes the position with a reduce-only market order on the opposite side, sized to what the
   * book fills inside the default slippage. A position larger than that closes in parts: the venue
   * holds a reduce-only order to the position, so a stale size can shrink it but never flip it.
   * The order is signed for minutes, not a day, so a book that moved before it landed leaves no
   * remainder resting (2026-10-28: 240 USDC of a Close sized to a stale rung did).
   */
  function handleClose() {
    if (market === null) {
      return;
    }
    const close = futureCloseOrder({
      account: futureAccount.account,
      asks: book.asks,
      bids: book.bids,
      maxSlippage: PERP_DEFAULT_MAX_SLIPPAGE,
      state: market.state,
    });
    if ("error" in close) {
      orderStatus.announce(close.error);
      return;
    }
    const usdc = (units: number) => (units * market.state.unitUsdc).toLocaleString("en-US");
    const part =
      close.units < close.held
        ? `${usdc(close.units)} of ${usdc(close.held)} USDC (all the book fills now; Close again for the rest)`
        : `${usdc(close.units)} USDC`;
    void actions.submit(
      {
        limitPrice: "",
        maxSlippage: PERP_DEFAULT_MAX_SLIPPAGE,
        orderType: "Market",
        reduceOnly: true,
        side: close.side,
        units: close.units,
      },
      {
        awaitingSignature: `Awaiting wallet signature to close ${part}`,
        eventOrderType: "Close",
        lifetimeSeconds: CLOSE_ORDER_LIFETIME_SECONDS,
      }
    );
  }

  usePublishTerminalHeader({
    changePercent24h: stats.changePercent,
    depositControl: market === null ? undefined : transfer.headerControl,
    high24h: stats.high,
    low24h: stats.low,
    market: "future",
    metrics: buildFutureHeaderMetrics({
      markSource: markSourceOf(market, book),
      nowMs,
      openInterestUsd,
      state: market?.state ?? null,
    }),
    price,
    volume24hLabel: stats.volumeLabel,
  });

  return (
    <>
      <MarketDocumentTitle digits={FUTURE_PRICE_DECIMALS} pair={symbol} price={price} />

      <TerminalGrid
        activity={
          <TradingActivityPanel
            activityView={buildActivityView({
              account: futureAccount.account,
              bottomTab,
              market,
              signedHistoryView: signedHistory.view,
              symbol,
              walletAddress: primaryWallet?.address ?? null,
            })}
            emptyState={buildEmptyState(market, subaccountId, bottomTab, signedHistory.emptyState)}
            footerLinks={FOOTER_LINKS}
            isSignedIn={isSignedIn}
            onTabSelect={(tab) => setBottomTab(tab as FutureBottomTab)}
            rowAction={buildRowAction({
              account: futureAccount.account,
              bottomTab,
              cancellingNonce: actions.cancellingNonce,
              hasWallet: primaryWallet !== null,
              isLive: market !== null,
              isSubmitting: actions.isSubmitting,
              onClose: handleClose,
              onDeposit: transfer.openDeposit,
              onWithdraw: transfer.openWithdraw,
              onCancel: (nonce, ownerAddress) => void actions.cancel(nonce, ownerAddress),
              ownedOpenOrders,
              tradeHistoryRowAction: signedHistory.rowAction,
            })}
            selectedTab={bottomTab}
            tabs={withCounts(FUTURE_BOTTOM_TABS, primaryWallet !== null, {
              "open-orders": ownedOpenOrders.length,
              positions: (futureAccount.account?.positionUnits ?? 0n) === 0n ? 0 : 1,
            })}
          />
        }
        book={
          <SpotOrderBookPanel
            asks={book.asks}
            bids={book.bids}
            lastPrice={book.lastPrice}
            onTabChange={setBookTab}
            tab={bookTab}
            trades={book.trades}
            units={bookUnits(market)}
          />
        }
        chart={
          <SpotChartPanel
            asks={book.asks}
            bids={book.bids}
            candles={book.candles}
            chartTab={chartTab}
            indicatorsEnabled={indicatorsEnabled}
            onChartTabChange={setChartTab}
            onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
            onTimeframeChange={setTimeframe}
            onToolSelect={setSelectedTool}
            selectedTimeframe={timeframe}
            selectedTool={selectedTool}
            timeframes={CHART_INTERVALS}
            units={chartUnits(symbol, market)}
          />
        }
        ticketColumn={
          <>
            <FutureOrderFormPanel
              account={futureAccount.account}
              asks={book.asks}
              bestAsk={book.bestAsk}
              bestBid={book.bestBid}
              bids={book.bids}
              hasAccount={subaccountId !== null}
              hasWallet={primaryWallet !== null}
              isAccepted={orderStatus.isAccepted}
              isFilled={orderStatus.isFilled}
              isPreparingAccount={account.isLoading || (isSignedIn && !walletsReady)}
              isSubmitting={actions.isSubmitting}
              lastAction={orderStatus.isFilled ? null : orderStatus.status}
              nowMs={nowMs}
              onConnect={login}
              onDepositRequest={() => transfer.openDeposit("USDC")}
              onEdit={orderStatus.clear}
              onSubmit={market === null ? undefined : actions.submit}
              referencePrice={price}
              state={market?.state ?? null}
              takerFeeBps={market?.takerFeeBps ?? null}
            />
            {/* The trading account's holdings under the ticket. */}
            <AccountSummary
              rows={buildAccountRows(
                futureAccount.account,
                transfer.openDeposit,
                transfer.openWithdraw
              )}
            />
          </>
        }
      />
    </>
  );
}
