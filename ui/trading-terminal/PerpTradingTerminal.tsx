"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { Duration } from "effect";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useState } from "react";
import { createWalletClient, custom } from "viem";
import { buildOpenOrdersActivityView, getOwnedOpenOrders } from "@/lib/account-activity-views";
import { formatBalance } from "@/lib/account-balance-display";
import { getAppChain } from "@/lib/base-public-client";
import {
  buildPerpPositionsView,
  describeOrderRejection,
  getPerpCollateralWithdrawableAsset,
  getPerpWithdrawableAsset,
} from "@/lib/perp-market";
import type {
  PerpAccountMargin,
  PerpCollateralAsset,
  PerpMarket,
  PerpPosition,
  PerpStack,
} from "@/lib/perp-market.types";
import {
  PERP_ACTIVITY_VIEWS,
  PERP_BOTTOM_TABS,
  PERP_MARKET_LABEL,
  PERP_MARKET_SYMBOL,
} from "@/lib/perp-terminal-config";
import {
  getAnchorPrice,
  getBestPrices,
  getMarketableLimitPrice,
  getMarketSizingPrice,
} from "@/lib/spot-market";
import type { OrderIdempotencyKey } from "@/lib/spot-order-submission";
import {
  buildCancelEnvelope,
  buildSpotOrderEnvelope,
  createOrderIdempotencyKey,
} from "@/lib/spot-order-submission";
import { FOOTER_LINKS, SPOT_TIMEFRAME_OPTIONS } from "@/lib/spot-terminal-config";
import { get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { ActivityView } from "@/lib/trading.types";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import type { AccountSummaryRow } from "@/ui/trading-terminal/order-form/AccountSummary";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import { PerpMarginDialog } from "@/ui/trading-terminal/PerpMarginDialog";
import type { PerpOrderRequest } from "@/ui/trading-terminal/PerpOrderFormPanel";
import { PerpOrderFormPanel } from "@/ui/trading-terminal/PerpOrderFormPanel";
import { PerpWithdrawDialog } from "@/ui/trading-terminal/PerpWithdrawDialog";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { TerminalHeaderBar } from "@/ui/trading-terminal/TerminalHeaderBar";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useMarketOrderBook } from "@/ui/trading-terminal/useMarketOrderBook";
import { usePerpLiveState } from "@/ui/trading-terminal/usePerpLiveState";
import { readPerpPositions, usePerpPositions } from "@/ui/trading-terminal/usePerpPositions";
import { useSignedHistoryTabs } from "@/ui/trading-terminal/useSignedHistoryTabs";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";
import { usePrimaryWallet } from "@/ui/usePrimaryWallet";

type PerpBottomTab = keyof typeof PERP_ACTIVITY_VIEWS;

function toPerpSideLabel(cell: string) {
  return cell === "Buy" ? "Long" : "Short";
}

/** Spot's open-orders rows, read in the perp's terms: a UI buy is a long of USD. */
function perpOpenOrdersView(view: ActivityView): ActivityView {
  return {
    ...view,
    rows: view.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, index) => (index === 0 ? toPerpSideLabel(cell) : cell)),
    })),
  };
}

/**
 * The signed limit (and, for a market order, the price its size is counted at) in cNGN per USDC.
 * A market order crosses the touch the trader is looking at, with the same slippage room as spot's.
 */
function resolvePerpOrderPrice(
  request: PerpOrderRequest,
  uiSide: "buy" | "sell",
  touch: { bestAsk: number | null; bestBid: number | null; price: number | null }
): { uiPrice: string; uiSizingPrice?: string } | { error: string } {
  if (request.orderType === "Limit") {
    return { uiPrice: request.limitPrice };
  }
  const marketable = getMarketableLimitPrice(uiSide, touch.bestAsk, touch.bestBid);
  if (marketable === null) {
    return { error: "No opposing perp liquidity to cross. Use a limit order." };
  }
  const sizing = getMarketSizingPrice(uiSide, touch.price, marketable);
  if (sizing === null) {
    return { error: "No price to size the market order at. Use a limit order." };
  }
  return { uiPrice: String(marketable), uiSizingPrice: String(sizing) };
}

type SigningWallet = NonNullable<ReturnType<typeof usePrimaryWallet>["primaryWallet"]>;

/**
 * Signs a perp order for the perp's own module and asset, then posts it. `engineAmountWhole` sizes
 * the order in cNGN contracts directly, for closing a position exactly; otherwise the size is the
 * USD notional counted at the sizing price. `reduceOnly` asks the venue to clamp the order to the
 * account's position. With an `idempotency` key the order is identified once by the caller, and a
 * POST that fails in transit is re-sent as the same order: the venue answers a duplicate with 409,
 * which here means the first attempt landed.
 */
async function signAndPostPerpOrder({
  engineAmountWhole,
  idempotency,
  market,
  onAwaitingSignature,
  price,
  reduceOnly = false,
  side,
  size,
  subaccountId,
  wallet,
}: {
  engineAmountWhole?: bigint;
  idempotency?: OrderIdempotencyKey;
  market: PerpMarket;
  onAwaitingSignature: () => void;
  price: { uiPrice: string; uiSizingPrice?: string };
  reduceOnly?: boolean;
  side: "buy" | "sell";
  size: string;
  subaccountId: string;
  wallet: SigningWallet;
}) {
  const appChain = getAppChain();
  await wallet.switchChain(appChain.id);
  const provider = await wallet.getEthereumProvider();
  const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });
  const envelope = buildSpotOrderEnvelope({
    engineAmountWhole,
    idempotency,
    market: {
      assetAddress: market.stack.assetAddress,
      orderIdPrefix: "perp",
      tradeModuleAddress: market.stack.tradeModuleAddress,
    },
    reduceOnly,
    side,
    subaccountId,
    uiPrice: price.uiPrice,
    uiSize: size,
    uiSizingPrice: price.uiSizingPrice,
    walletAddress: wallet.address,
  });
  onAwaitingSignature();
  const signature = await walletClient.signTypedData({
    account: wallet.address as `0x${string}`,
    ...envelope.typedData,
  });
  try {
    return await postSignedOrder(envelope.payload, signature);
  } catch (error) {
    if (idempotency === undefined) {
      throw error;
    }
    // The request may have reached the venue before the connection dropped. Re-sending the same
    // signed order is safe: the venue's unique (owner, nonce) index makes a duplicate a 409.
    const retried = await postSignedOrder(envelope.payload, signature);
    return retried.status === 409 ? { ...retried, ok: true } : retried;
  }
}

/** An order's outcome as `/api/orders/{id}` reports it; null when it was still open at the deadline. */
type OrderOutcome = { cancelReason: string; filledAmount: string; status: string } | null;

const CLOSE_CONFIRM_TIMEOUT_MS = Duration.toMillis("60 seconds");
const CLOSE_CONFIRM_POLL_MS = Duration.toMillis("1500 millis");

/**
 * Waits for the venue to settle an order's outcome: filled, cancelled or expired. A reduce-only
 * close is either filled or cancelled by the venue within a few matcher ticks; the deadline covers
 * a venue that is slow, not one that is wrong.
 */
async function awaitOrderOutcome(orderId: string): Promise<OrderOutcome> {
  const deadline = Date.now() + CLOSE_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        cancel_reason?: string;
        filled_amount?: string;
        status?: string;
      } | null;
      const status = body?.status ?? "";
      if (status !== "" && status !== "active" && status !== "matching") {
        return {
          cancelReason: body?.cancel_reason ?? "",
          filledAmount: body?.filled_amount ?? "0",
          status,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, CLOSE_CONFIRM_POLL_MS));
  }
  return null;
}

/** What to tell the trader once the venue has settled a Close. */
function describeCloseOutcome(outcome: OrderOutcome): string {
  if (outcome === null) {
    return "Close accepted but not yet confirmed by the venue; the position updates once it settles.";
  }
  switch (outcome.status) {
    case "filled":
      return `Closed: ${outcome.filledAmount} cNGN filled.`;
    case "cancelled":
      if (outcome.cancelReason === "reduce_only_done") {
        return `Closed: ${outcome.filledAmount} cNGN filled; the venue cancelled the rest because the position was already flat.`;
      }
      if (outcome.cancelReason === "reduce_only_no_position") {
        return "Nothing to close: the venue found the position already flat and cancelled the order.";
      }
      return outcome.filledAmount === "0"
        ? `Close cancelled${outcome.cancelReason ? ` (${outcome.cancelReason})` : ""}; the position is unchanged.`
        : `Close partly filled (${outcome.filledAmount} cNGN) and then cancelled${outcome.cancelReason ? ` (${outcome.cancelReason})` : ""}.`;
    case "expired":
      return "Close expired unfilled; the position is unchanged.";
    default:
      return `Close ${outcome.status}.`;
  }
}

/**
 * The position to close, read from the venue now rather than taken from the row: the row was drawn
 * from a poll up to 15 seconds old, and a fill since then (another close, a partial) is what turns
 * an exact close into a flip. A position that has gone, or changed side, is reported, not closed.
 */
async function readFreshPosition(
  subaccountId: string,
  shown: PerpPosition
): Promise<{ position: PerpPosition } | { error: string }> {
  let fresh: Awaited<ReturnType<typeof readPerpPositions>>;
  try {
    fresh = await readPerpPositions(subaccountId);
  } catch {
    return { error: "Could not re-read the position from the venue; nothing was sent. Try again." };
  }
  const position = fresh.positions[0] ?? null;
  if (position === null) {
    return { error: "Nothing to close: the venue reports the position already flat." };
  }
  if (position.uiSide !== shown.uiSide) {
    return {
      error: `The position changed side since this row was drawn (now ${position.uiSide}); refreshed. Close again if you still want to.`,
    };
  }
  if (position.engineSize === null) {
    return {
      error: "This position cannot be closed from here: the venue did not report its size.",
    };
  }
  return { position };
}

function listedCollateralOf(stack: PerpStack | null): PerpCollateralAsset[] {
  return stack === null ? [] : stack.collateralAssets;
}

type ActivityInputs = {
  account: PerpAccountMargin | null;
  bottomTab: PerpBottomTab;
  /** The open signed history tab's rows once loaded; null on any other tab or state. */
  signedHistoryView: ActivityView | null;
  market: PerpMarket | null;
  positions: PerpPosition[];
  walletAddress: string | null;
};

function buildActivityView(inputs: ActivityInputs): ActivityView {
  if (inputs.market === null) {
    return PERP_ACTIVITY_VIEWS[inputs.bottomTab];
  }
  if (inputs.bottomTab === "positions") {
    return buildPerpPositionsView(inputs.positions, PERP_MARKET_LABEL);
  }
  if (inputs.bottomTab === "order-history" || inputs.bottomTab === "trade-history") {
    return inputs.signedHistoryView ?? PERP_ACTIVITY_VIEWS[inputs.bottomTab];
  }
  return perpOpenOrdersView(
    buildOpenOrdersActivityView(inputs.market.openOrders, inputs.walletAddress)
  );
}

/**
 * Signs the order-history login with personal_sign, or nothing without a wallet. Unlike an order
 * or a cancel it authorizes nothing on chain, so there is no chain to switch to; the wallet shows
 * the plain-text message.
 */
function buildHistorySigner(primaryWallet: ConnectedWallet | null, walletsReady: boolean) {
  if (primaryWallet === null) {
    return undefined;
  }
  return async (message: string) => {
    if (!walletsReady) {
      throw new Error("Connect a wallet to view your order history");
    }
    const provider = await primaryWallet.getEthereumProvider();
    const walletClient = createWalletClient({ chain: getAppChain(), transport: custom(provider) });
    return walletClient.signMessage({
      account: primaryWallet.address as `0x${string}`,
      message,
    });
  };
}

/**
 * The Account panel's rows: cash, then cNGN when the SRM accepts it, at zero until it is held and
 * an em dash until the account is read. The plus opens the margin deposit, which chooses the asset.
 */
function buildAccountRows(
  account: PerpAccountMargin | null,
  stack: PerpStack | null,
  onDeposit: () => void,
  /** Opens the withdraw dialog on a row of the account's ledger: 0 is cash, then each collateral asset held. */
  onWithdraw: (rowIndex: number) => void
): AccountSummaryRow[] {
  const cngnListed = listedCollateralOf(stack).some((asset) => asset.symbol === "cNGN");
  const cngnIndex = account?.collateral.findIndex((row) => row.symbol === "cNGN") ?? -1;
  const cngnHeld = cngnIndex === -1 ? undefined : account?.collateral[cngnIndex]?.balance;
  const rows: AccountSummaryRow[] = [
    {
      balance: formatBalance(account?.cash ?? null, "USDC"),
      onDeposit,
      onWithdraw: account === null ? undefined : () => onWithdraw(0),
      symbol: "USDC",
    },
  ];
  if (cngnListed) {
    rows.push({
      balance: formatBalance(account === null ? null : (cngnHeld ?? 0), "cNGN"),
      onDeposit,
      onWithdraw: cngnIndex === -1 ? undefined : () => onWithdraw(cngnIndex + 1),
      symbol: "cNGN",
    });
  }
  return rows;
}

function buildEmptyState(
  market: PerpMarket | null,
  subaccountId: string | null,
  bottomTab: PerpBottomTab,
  /** The open signed history tab's prompt, which wins over the account-level copy. */
  signedHistoryEmptyState: { action?: ReactNode; body: string; title: string } | undefined
) {
  if (signedHistoryEmptyState !== undefined) {
    return signedHistoryEmptyState;
  }
  if (market === null) {
    return {
      body: "Perp trading isn't live yet.",
      title: bottomTab === "positions" ? "No positions" : "Nothing yet",
    };
  }
  // History is the wallet's, not the perp account's: its tabs prompt for the signed login instead.
  if (bottomTab === "order-history" || bottomTab === "trade-history") {
    return undefined;
  }
  if (subaccountId === null) {
    return { body: "Deposit margin to open your perp account.", title: "No perp account" };
  }
  if (bottomTab === "positions") {
    return { body: "Positions you open will appear here.", title: "No positions" };
  }
  return undefined;
}

/**
 * The market order that flattens a position: the opposite UI side, priced at the touch like any
 * market order, sized in the engine's contracts. The USD size is only reported, never signed.
 */
function buildCloseRequest(
  position: PerpPosition,
  touch: { bestAsk: number | null; bestBid: number | null; price: number | null }
):
  | {
      engineSize: bigint;
      price: { uiPrice: string; uiSizingPrice?: string };
      sizeUsd: string;
      uiSide: "buy" | "sell";
    }
  | { error: string } {
  if (position.engineSize === null) {
    return {
      error: "This position cannot be closed from here: the venue did not report its size.",
    };
  }
  const uiSide = position.uiSide === "long" ? "sell" : "buy";
  const resolved = resolvePerpOrderPrice(
    {
      limitPrice: "",
      orderType: "Market",
      reduceOnly: true,
      side: position.uiSide === "long" ? "short" : "long",
      size: "",
    },
    uiSide,
    touch
  );
  if ("error" in resolved) {
    return resolved;
  }
  const sizingPrice = Number(resolved.uiSizingPrice ?? resolved.uiPrice);
  return {
    engineSize: position.engineSize,
    price: resolved,
    sizeUsd: (Number(position.engineSize) / sizingPrice).toFixed(6),
    uiSide,
  };
}

const ROW_BUTTON_CLASSES =
  "cursor-pointer rounded-lg bg-input-bg px-2 py-1 font-medium text-[10px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active disabled:cursor-wait disabled:opacity-60";

/**
 * The button at the end of each row: Cancel on an open order, Close on a position, the fill's
 * transaction on a trade. Each is the one action the row is for.
 */
function buildRowAction(inputs: {
  bottomTab: PerpBottomTab;
  cancellingNonce: string | null;
  closingIndex: number | null;
  hasWallet: boolean;
  isSubmitting: boolean;
  market: PerpMarket | null;
  onCancel: (nonce: string, ownerAddress: string) => void;
  onClose: (position: PerpPosition, rowIndex: number) => void;
  ownedOpenOrders: { nonce: string; ownerAddress: string }[];
  positions: PerpPosition[];
  /** The Trade History row control (the fill's transaction), undefined on every other tab. */
  tradeHistoryRowAction: ((rowIndex: number) => ReactNode) | undefined;
}) {
  if (inputs.market === null || !inputs.hasWallet) {
    return undefined;
  }
  const { bottomTab } = inputs;
  if (bottomTab === "trade-history") {
    return inputs.tradeHistoryRowAction;
  }
  if (bottomTab === "open-orders") {
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
  if (bottomTab === "positions") {
    return (rowIndex: number) => {
      const position = inputs.positions[rowIndex];
      if (!position || position.engineSize === null) {
        return null;
      }
      const busy = inputs.closingIndex === rowIndex;
      return (
        <button
          className={ROW_BUTTON_CLASSES}
          // Disabled until the venue confirms the previous close: a second click before then is
          // what used to send a second full-size order.
          disabled={inputs.isSubmitting || inputs.closingIndex !== null}
          onClick={() => inputs.onClose(position, rowIndex)}
          title="Reduce-only market order for the position's exact size, on the opposite side; the venue clamps it so it can never flip the position"
          type="button"
        >
          {busy ? "Closing…" : "Close"}
        </button>
      );
    };
  }
  return undefined;
}

/**
 * What a Margin-tab row withdraws: row 0 the perp's cash as USDC, row n the n-th collateral asset
 * through its own escrow. Null for a collateral symbol the app cannot pay out (no known token).
 */
function withdrawTarget(
  stack: PerpStack | null,
  account: PerpAccountMargin | null,
  rowIndex: number | null
): { asset: WithdrawableAsset; balanceUnits: bigint | null } | null {
  if (stack === null || rowIndex === null) {
    return null;
  }
  if (rowIndex === 0) {
    return { asset: getPerpWithdrawableAsset(stack), balanceUnits: account?.cashUnits ?? null };
  }
  const held = account?.collateral[rowIndex - 1];
  if (held === undefined) {
    return null;
  }
  const listed = stack.collateralAssets.find((candidate) => candidate.escrow === held.escrow);
  const asset = listed === undefined ? null : getPerpCollateralWithdrawableAsset(listed);
  return asset === null ? null : { asset, balanceUnits: held.balanceUnits };
}

type SignedOrderResponse = { body: { error?: string } | null; ok: boolean; status: number };

async function postSignedOrder(payload: object, signature: string): Promise<SignedOrderResponse> {
  const response = await fetch("/api/orders", {
    body: JSON.stringify({ ...payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as SignedOrderResponse["body"];
  return { body, ok: response.ok, status: response.status };
}

/**
 * The perp's book, trades, candles and headline price. The stream when it is live, the
 * server-rendered snapshot otherwise; both the venue's own depth. The headline price is the book's
 * touch first, then the chain's mark, so an empty book still shows where the market is.
 */
function usePerpBook(market: PerpMarket | null) {
  const book = useMarketOrderBook({
    enabled: market !== null,
    market: market ? PERP_MARKET_SYMBOL : null,
    orderEntrySpec: market?.orderEntrySpec ?? null,
    type: "perp",
  });
  const bids = book.isLive ? book.bids : (market?.orderBookBids ?? []);
  const asks = book.isLive ? book.asks : (market?.orderBookAsks ?? []);
  const trades = book.isLive && book.trades.length > 0 ? book.trades : (market?.trades ?? []);
  const candles = market?.candles ?? [];
  const lastPrice = market ? getVenueLastPrice(trades, candles, market.mark) : null;
  const { bestAsk, bestBid } = getBestPrices(asks, bids);
  const price = market
    ? (getAnchorPrice(bestAsk, bestBid, lastPrice) ?? market.state.markPrice)
    : null;
  const stats = get24hStats(market?.stats24h ?? null, price);
  return { asks, bestAsk, bestBid, bids, candles, lastPrice, price, stats, trades };
}

/** The header's Deposit margin and Withdraw buttons, one look. */
function HeaderActionButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      className="flex h-10 cursor-pointer items-center whitespace-nowrap rounded-sm bg-input-bg px-4 font-semibold text-[14px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * The USDC-cNGN perpetual terminal, laid out on the spot terminal's grid so switching markets does
 * not move the panels.
 *
 * `market` is null until markets-service lists the perp with its chain state and stack; the
 * terminal then renders every panel's empty state and a ticket that cannot submit. With it, the book
 * streams, the account is the wallet's own under the perp SRM (separate from its spot account),
 * orders are signed for the perp's module and asset, and positions and margin are read from chain.
 */
export function PerpTradingTerminal({ market: renderedMarket }: { market: PerpMarket | null }) {
  // The chain state the page rendered with, kept current: the ticket opens and closes with the venue.
  const market = usePerpLiveState(renderedMarket);
  const router = useRouter();
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin();
  const { primaryWallet: pinnedWallet, walletsReady } = usePrimaryWallet();
  const isSignedIn = ready && authenticated;
  const primaryWallet = isSignedIn && market !== null ? pinnedWallet : null;

  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("D");
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<PerpBottomTab>("positions");
  const [depositOpen, setDepositOpen] = useState(false);
  /** The Margin-tab row being withdrawn from, or null while the dialog is closed. */
  const [withdrawRow, setWithdrawRow] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [cancellingNonce, setCancellingNonce] = useState<string | null>(null);
  const [closingIndex, setClosingIndex] = useState<number | null>(null);

  const stack = market?.stack ?? null;
  const signedHistory = useSignedHistoryTabs({
    bottomTab,
    isSignedIn,
    market: PERP_MARKET_SYMBOL,
    signMessage: buildHistorySigner(primaryWallet, walletsReady),
    walletAddress: primaryWallet?.address ?? null,
  });
  /** The header's deposit control and the account rows share one path: connect first, then deposit. */
  function openDeposit() {
    if (primaryWallet === null) {
      login();
      return;
    }
    setDepositOpen(true);
  }
  const account = useTradingSubaccount(
    primaryWallet?.address ?? null,
    stack ? { depositAsset: stack.cashAddress, manager: stack.srmAddress } : undefined
  );
  const perpAccount = usePerpPositions(account.subaccountId);
  const withdrawing = withdrawTarget(stack, perpAccount.account, withdrawRow);

  const { asks, bestAsk, bestBid, bids, candles, lastPrice, price, stats, trades } =
    usePerpBook(market);

  const ownedOpenOrders = getOwnedOpenOrders(
    market?.openOrders ?? [],
    primaryWallet?.address ?? null
  );

  async function handleSubmit(request: PerpOrderRequest) {
    if (market === null || primaryWallet === null) {
      return;
    }
    if (account.subaccountId === null) {
      setDepositOpen(true);
      return;
    }
    // A venue long buys USD, exactly as a spot buy does; the same translation signs both.
    const uiSide = request.side === "long" ? "buy" : "sell";
    const resolved = resolvePerpOrderPrice(request, uiSide, { bestAsk, bestBid, price });
    if ("error" in resolved) {
      setLastAction(resolved.error);
      return;
    }

    const event = {
      market_id: "cngn-usdc-perp",
      order_side: request.side,
      order_type: request.orderType,
      size_usdc_notional: request.size,
    };
    setIsSubmitting(true);
    try {
      const { body, ok, status } = await signAndPostPerpOrder({
        market,
        price: resolved,
        reduceOnly: request.reduceOnly,
        side: uiSide,
        size: request.size,
        subaccountId: account.subaccountId,
        wallet: primaryWallet,
        onAwaitingSignature: () =>
          setLastAction(`Awaiting wallet signature for perp account #${account.subaccountId}`),
      });
      if (!ok) {
        posthog.capture("order_rejected", {
          ...event,
          error_message: body?.error ?? null,
          http_status: status,
        });
        setLastAction(describeOrderRejection(body?.error, "Perp order submission failed"));
        return;
      }
      posthog.capture("order_submitted", event);
      setLastAction(
        request.reduceOnly
          ? "Reduce-only order accepted. The venue clamps it to your position; it fills or is cancelled once matched."
          : "Order accepted. Positions update once it fills."
      );
      perpAccount.refresh();
      router.refresh();
    } catch (error) {
      posthog.captureException(error, {
        properties: { market_id: "cngn-usdc-perp", order_side: request.side },
      });
      setLastAction(error instanceof Error ? error.message : "Perp order submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Closes a position with a reduce-only market order on the opposite side, sized in the engine's
   * own contracts from a fresh read of the venue (not the row, which a 15-second poll drew). The
   * venue clamps a reduce-only order to the position its own ledger holds after every fill and
   * cancels the remainder, so even a stale size can only shrink the position, never flip it. One
   * idempotency key per click: a retried POST re-sends the same order, never a second one. The row
   * stays busy until the venue reports the order's outcome, so two clicks cannot race.
   */
  async function handleClose(position: PerpPosition, rowIndex: number) {
    if (
      market === null ||
      primaryWallet === null ||
      account.subaccountId === null ||
      closingIndex !== null
    ) {
      return;
    }
    const subaccountId = account.subaccountId;
    setClosingIndex(rowIndex);
    setIsSubmitting(true);
    try {
      const fresh = await readFreshPosition(subaccountId, position);
      if ("error" in fresh) {
        setLastAction(fresh.error);
        perpAccount.refresh();
        return;
      }
      const close = buildCloseRequest(fresh.position, { bestAsk, bestBid, price });
      if ("error" in close) {
        setLastAction(close.error);
        return;
      }
      const idempotency = createOrderIdempotencyKey("perp");
      const event = {
        market_id: "cngn-usdc-perp",
        order_side: close.uiSide === "buy" ? "long" : "short",
        order_type: "Close",
        size_usdc_notional: close.sizeUsd,
      };
      const { body, ok, status } = await signAndPostPerpOrder({
        engineAmountWhole: close.engineSize,
        idempotency,
        market,
        price: close.price,
        reduceOnly: true,
        side: close.uiSide,
        size: close.sizeUsd,
        subaccountId,
        wallet: primaryWallet,
        onAwaitingSignature: () =>
          setLastAction(
            `Awaiting wallet signature to close ${fresh.position.uiSide} ${close.engineSize} cNGN (reduce-only)`
          ),
      });
      if (!ok) {
        posthog.capture("order_rejected", {
          ...event,
          error_message: body?.error ?? null,
          http_status: status,
        });
        setLastAction(describeOrderRejection(body?.error, "Close failed"));
        return;
      }
      posthog.capture("order_submitted", event);
      // The ticket is free again; the Close button stays disabled until the venue has an outcome.
      setIsSubmitting(false);
      setLastAction("Close accepted. Waiting for the venue to confirm the fill…");
      const outcome = await awaitOrderOutcome(idempotency.orderId);
      setLastAction(describeCloseOutcome(outcome));
      perpAccount.refresh();
      router.refresh();
    } catch (error) {
      posthog.captureException(error, {
        properties: { market_id: "cngn-usdc-perp", order_type: "Close" },
      });
      setLastAction(error instanceof Error ? error.message : "Close failed");
    } finally {
      setIsSubmitting(false);
      setClosingIndex(null);
    }
  }

  async function handleCancel(nonce: string, ownerAddress: string) {
    if (primaryWallet === null) {
      return;
    }
    setCancellingNonce(nonce);
    try {
      const appChain = getAppChain();
      await primaryWallet.switchChain(appChain.id);
      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });
      const envelope = buildCancelEnvelope({
        nonce,
        ownerAddress,
        signerAddress: primaryWallet.address,
      });
      const signature = await walletClient.signTypedData({
        account: primaryWallet.address as `0x${string}`,
        ...envelope.typedData,
      });
      const response = await fetch("/api/orders/cancel", {
        body: JSON.stringify({ ...envelope.payload, signature }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setLastAction(response.ok ? "Order cancelled." : `Cancel failed (${response.status})`);
      router.refresh();
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setCancellingNonce(null);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground transition-colors duration-300 md:h-dvh md:overflow-hidden">
      <MarketDocumentTitle pair={PERP_MARKET_LABEL} price={price} />

      <TerminalHeaderBar
        changePercent24h={stats.changePercent}
        depositControl={
          market === null ? undefined : (
            <div className="flex items-center gap-2">
              <HeaderActionButton
                onClick={() => (primaryWallet === null ? login() : setDepositOpen(true))}
              >
                Deposit margin
              </HeaderActionButton>
              {/* Withdraws cash; the Account rows withdraw each asset. Connects first without a wallet. */}
              <HeaderActionButton
                onClick={() => (primaryWallet === null ? login() : setWithdrawRow(0))}
              >
                Withdraw
              </HeaderActionButton>
            </div>
          )
        }
        high24h={stats.high}
        low24h={stats.low}
        market="perp"
        onPortfolioSelect={() => setBottomTab("positions")}
        price={price}
        volume24hLabel={stats.volumeLabel}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:min-h-0 md:overflow-hidden md:px-4">
        {/* The spot terminal's grid, unchanged; see SpotTradingTerminal for why it is shaped so. */}
        <div className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,3fr)] md:overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_270px_320px] lg:grid-rows-[minmax(0,7fr)_minmax(0,3fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
          <div className="md:col-start-1 md:row-start-1 md:min-h-0 md:overflow-hidden lg:row-start-1">
            <SpotChartPanel
              asks={asks}
              bids={bids}
              candles={candles}
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
              asks={asks}
              bids={bids}
              lastPrice={lastPrice}
              onTabChange={setBookTab}
              tab={bookTab}
              trades={trades}
            />
          </div>

          <div className="order-first flex min-h-[420px] flex-col gap-3 md:order-0 md:col-start-2 md:row-span-3 md:row-start-1 md:min-h-0 md:gap-2 md:overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
            <PerpOrderFormPanel
              account={perpAccount.account}
              availableMargin={perpAccount.account?.initialMarginSurplus ?? null}
              hasPosition={perpAccount.positions.length > 0}
              hasWallet={primaryWallet !== null}
              isPreparingAccount={account.isLoading || (isSignedIn && !walletsReady)}
              isSubmitting={isSubmitting}
              lastAction={lastAction}
              onConnect={login}
              onDepositRequest={() => setDepositOpen(true)}
              onSubmit={market === null ? undefined : handleSubmit}
              referencePrice={price}
              state={market?.state ?? null}
              takerFeeBps={market?.takerFeeBps ?? null}
            />
            {/* The perp account's holdings under the ticket, as spot's column ends. */}
            <AccountSummary
              rows={buildAccountRows(perpAccount.account, stack, openDeposit, setWithdrawRow)}
            />
          </div>

          <div className="min-h-[200px] md:col-start-1 md:row-start-3 md:min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <TradingActivityPanel
              activityView={buildActivityView({
                account: perpAccount.account,
                bottomTab,
                signedHistoryView: signedHistory.view,
                market,
                positions: perpAccount.positions,
                walletAddress: primaryWallet?.address ?? null,
              })}
              emptyState={buildEmptyState(
                market,
                account.subaccountId,
                bottomTab,
                signedHistory.emptyState
              )}
              footerLinks={FOOTER_LINKS}
              isSignedIn={isSignedIn}
              onTabSelect={(tab) => setBottomTab(tab as PerpBottomTab)}
              rowAction={buildRowAction({
                bottomTab,
                closingIndex,
                cancellingNonce,
                hasWallet: primaryWallet !== null,
                isSubmitting,
                market,
                onCancel: (nonce, ownerAddress) => void handleCancel(nonce, ownerAddress),
                onClose: (position, rowIndex) => void handleClose(position, rowIndex),
                ownedOpenOrders,
                positions: perpAccount.positions,
                tradeHistoryRowAction: signedHistory.rowAction,
              })}
              selectedTab={bottomTab}
              tabs={PERP_BOTTOM_TABS}
            />
          </div>
        </div>
      </div>

      {withdrawing === null ? null : (
        <PerpWithdrawDialog
          asset={withdrawing.asset}
          balanceUnits={withdrawing.balanceUnits}
          onOpenChange={(next) => setWithdrawRow(next ? withdrawRow : null)}
          onWithdrawn={() => perpAccount.refresh()}
          open={withdrawRow !== null}
          subaccountId={account.subaccountId}
          wallet={primaryWallet}
        />
      )}
      {stack === null ? null : (
        <PerpMarginDialog
          onDeposited={(subaccountId) => {
            account.adoptSubaccountId(subaccountId);
            perpAccount.refresh();
          }}
          onOpenChange={setDepositOpen}
          open={depositOpen}
          stack={stack}
          subaccountId={account.subaccountId}
          wallet={primaryWallet}
        />
      )}
    </main>
  );
}
