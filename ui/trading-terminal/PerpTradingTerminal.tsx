"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
import { createWalletClient, custom } from "viem";
import { buildOpenOrdersActivityView, getOwnedOpenOrders } from "@/lib/account-activity-views";
import { getAppChain } from "@/lib/base-public-client";
import {
  buildPerpCngnExposure,
  buildPerpMarginView,
  buildPerpPositionsView,
  describeOrderRejection,
  getPerpCollateralWithdrawableAsset,
  getPerpWithdrawableAsset,
} from "@/lib/perp-market";
import type {
  PerpAccountMargin,
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
import { buildCancelEnvelope, buildSpotOrderEnvelope } from "@/lib/spot-order-submission";
import { FOOTER_LINKS, SPOT_TIMEFRAME_OPTIONS } from "@/lib/spot-terminal-config";
import { get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { ActivityView } from "@/lib/trading.types";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
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
import { usePerpPositions } from "@/ui/trading-terminal/usePerpPositions";
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
 * USD notional counted at the sizing price.
 */
async function signAndPostPerpOrder({
  engineAmountWhole,
  market,
  onAwaitingSignature,
  price,
  side,
  size,
  subaccountId,
  wallet,
}: {
  engineAmountWhole?: bigint;
  market: PerpMarket;
  onAwaitingSignature: () => void;
  price: { uiPrice: string; uiSizingPrice?: string };
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
    market: {
      assetAddress: market.stack.assetAddress,
      orderIdPrefix: "perp",
      tradeModuleAddress: market.stack.tradeModuleAddress,
    },
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
  return postSignedOrder(envelope.payload, signature);
}

type ActivityInputs = {
  account: PerpAccountMargin | null;
  bottomTab: PerpBottomTab;
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
  if (inputs.bottomTab === "margin") {
    return buildPerpMarginView(inputs.account);
  }
  return perpOpenOrdersView(
    buildOpenOrdersActivityView(inputs.market.openOrders, inputs.walletAddress)
  );
}

function buildEmptyState(
  market: PerpMarket | null,
  subaccountId: string | null,
  bottomTab: PerpBottomTab
) {
  if (market === null) {
    return {
      body: "Perp trading isn't live yet.",
      title: bottomTab === "positions" ? "No positions" : "Nothing yet",
    };
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
 * The button at the end of each row: Cancel on an open order, Close on a position, Withdraw on the
 * margin row. Each is the one action the row is for.
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
  /** The Margin tab's row index: 0 is cash, then each collateral asset in order. */
  onWithdraw: (rowIndex: number) => void;
  ownedOpenOrders: { nonce: string; ownerAddress: string }[];
  positions: PerpPosition[];
}) {
  if (inputs.market === null || !inputs.hasWallet) {
    return undefined;
  }
  const { bottomTab } = inputs;
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
          disabled={inputs.isSubmitting}
          onClick={() => inputs.onClose(position, rowIndex)}
          title="Market order for the exact position size, on the opposite side"
          type="button"
        >
          {busy ? "Closing…" : "Close"}
        </button>
      );
    };
  }
  return (rowIndex: number) => (
    <button
      className={ROW_BUTTON_CLASSES}
      onClick={() => inputs.onWithdraw(rowIndex)}
      type="button"
    >
      Withdraw
    </button>
  );
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

function PerpDepositButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="flex h-10 cursor-pointer items-center whitespace-nowrap rounded-sm bg-input-bg px-4 font-semibold text-[12px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active"
      onClick={onClick}
      type="button"
    >
      Deposit margin
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
      setLastAction("Order accepted. Positions update once it fills.");
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
   * Closes a position with a market order on the opposite side, sized in the engine's own contracts
   * so the account lands on exactly zero. The venue has no reduce-only flag; the exact size is what
   * keeps a close from becoming a flip, and a partial fill leaves a smaller position, never a new one.
   */
  async function handleClose(position: PerpPosition, rowIndex: number) {
    if (market === null || primaryWallet === null || account.subaccountId === null) {
      return;
    }
    const close = buildCloseRequest(position, { bestAsk, bestBid, price });
    if ("error" in close) {
      setLastAction(close.error);
      return;
    }
    const event = {
      market_id: "cngn-usdc-perp",
      order_side: close.uiSide === "buy" ? "long" : "short",
      order_type: "Close",
      size_usdc_notional: close.sizeUsd,
    };
    setClosingIndex(rowIndex);
    setIsSubmitting(true);
    try {
      const { body, ok, status } = await signAndPostPerpOrder({
        engineAmountWhole: close.engineSize,
        market,
        price: close.price,
        side: close.uiSide,
        size: close.sizeUsd,
        subaccountId: account.subaccountId,
        wallet: primaryWallet,
        onAwaitingSignature: () =>
          setLastAction(
            `Awaiting wallet signature to close ${position.uiSide} ${close.engineSize} cNGN`
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
      setLastAction("Close order accepted. The position updates once it fills.");
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
            <PerpDepositButton
              onClick={() => (primaryWallet === null ? login() : setDepositOpen(true))}
            />
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
              availableMargin={perpAccount.account?.initialMarginSurplus ?? null}
              cngn={buildPerpCngnExposure(
                perpAccount.account,
                perpAccount.positions,
                market?.state ?? null
              )}
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
          </div>

          <div className="min-h-[200px] md:col-start-1 md:row-start-3 md:min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <TradingActivityPanel
              activityView={buildActivityView({
                account: perpAccount.account,
                bottomTab,
                market,
                positions: perpAccount.positions,
                walletAddress: primaryWallet?.address ?? null,
              })}
              emptyState={buildEmptyState(market, account.subaccountId, bottomTab)}
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
                onWithdraw: (rowIndex) => setWithdrawRow(rowIndex),
                ownedOpenOrders,
                positions: perpAccount.positions,
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
