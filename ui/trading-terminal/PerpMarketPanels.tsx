"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { Duration } from "effect";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useState } from "react";
import { createWalletClient, custom } from "viem";
import {
  buildOpenOrdersActivityView,
  buildPerpOrderHistoryActivityView,
  buildPerpTradeHistoryActivityView,
  getOwnedOpenOrders,
} from "@/lib/account-activity-views";
import { formatBalance } from "@/lib/account-balance-display";
import { getAppChain } from "@/lib/base-public-client";
import { marketPath } from "@/lib/market-routes";
import {
  buildPerpBalancesView,
  buildPerpHeaderMetrics,
  buildPerpPositionsView,
  describeOrderRejection,
  PERP_DEFAULT_MAX_SLIPPAGE,
  perpOrderUiSide,
  perpSideLabel,
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
  getMarketableLimitPrice,
  getMarketSizingPrice,
  toOrderSizeCngn,
} from "@/lib/spot-market";
import type { OrderIdempotencyKey } from "@/lib/spot-order-submission";
import {
  buildCancelEnvelope,
  buildSpotOrderEnvelope,
  createOrderIdempotencyKey,
} from "@/lib/spot-order-submission";
import { FOOTER_LINKS, SPOT_TIMEFRAME_OPTIONS } from "@/lib/spot-terminal-config";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { get24hStats } from "@/lib/ticker-stats";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";
import { SmartLink } from "@/ui/SmartLink";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import type { AccountSummaryRow } from "@/ui/trading-terminal/order-form/AccountSummary";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import type { PerpOrderRequest } from "@/ui/trading-terminal/PerpOrderFormPanel";
import { PerpOrderFormPanel } from "@/ui/trading-terminal/PerpOrderFormPanel";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { TerminalGrid } from "@/ui/trading-terminal/TerminalGrid";
import { usePublishTerminalHeader } from "@/ui/trading-terminal/TerminalHeaderSlot";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useAccountTransfer } from "@/ui/trading-terminal/useAccountTransfer";
import { useLiveMarketBook } from "@/ui/trading-terminal/useLiveMarketBook";
import { useOrderStatus } from "@/ui/trading-terminal/useOrderStatus";
import { usePerpLiveState } from "@/ui/trading-terminal/usePerpLiveState";
import { readPerpPositions, usePerpPositions } from "@/ui/trading-terminal/usePerpPositions";
import { useSignedHistoryTabs } from "@/ui/trading-terminal/useSignedHistoryTabs";
import { useSubaccountBalance } from "@/ui/trading-terminal/useSubaccountBalance";

type PerpBottomTab = keyof typeof PERP_ACTIVITY_VIEWS;

/** A venue side cell as the perp names it: a buy of cNGN is a Long, a sell a Short; anything else passes through. */
function toPerpSideLabel(cell: string) {
  if (cell === "Buy") {
    return perpSideLabel("long");
  }
  return cell === "Sell" ? perpSideLabel("short") : cell;
}

/**
 * Spot's activity rows read in the perp's terms: the side column (Open Orders' "Side", the history
 * tabs' "Direction") says Long or Short, so a trader sees one vocabulary across this terminal.
 */
function perpActivityView(view: ActivityView, column: "Side" | "Direction"): ActivityView {
  const index = view.columns.indexOf(column);
  if (index === -1) {
    return view;
  }
  return {
    ...view,
    rows: view.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, cellIndex) =>
        cellIndex === index ? toPerpSideLabel(cell) : cell
      ),
    })),
  };
}

/** The signed limit as a decimal string: never `String()`, which prints 0.00073 as "7.3e-4". */
function toPriceString(price: number) {
  return price.toFixed(10);
}

/**
 * The signed limit and, for a market order, the price a USDC-denominated size is converted at, in
 * USDC per cNGN. A market order crosses the touch the trader is looking at, with the slippage
 * room the ticket set (spot's 0.5% unless edited); a limit order is sized at its own limit.
 */
function resolvePerpOrderPrice(
  request: Pick<PerpOrderRequest, "limitPrice" | "maxSlippage" | "orderType">,
  uiSide: "buy" | "sell",
  touch: { bestAsk: number | null; bestBid: number | null; price: number | null }
): { uiPrice: string; sizingPrice: number } | { error: string } {
  if (request.orderType === "Limit") {
    const limit = Number(request.limitPrice.replaceAll(",", ""));
    if (!Number.isFinite(limit) || limit <= 0) {
      return { error: "Enter a limit price in USDC per cNGN." };
    }
    return { sizingPrice: limit, uiPrice: request.limitPrice };
  }
  const marketable = getMarketableLimitPrice(
    uiSide,
    touch.bestAsk,
    touch.bestBid,
    request.maxSlippage
  );
  if (marketable === null) {
    return { error: "No opposing perp liquidity to cross. Use a limit order." };
  }
  const sizing = getMarketSizingPrice(uiSide, touch.price, marketable);
  if (sizing === null) {
    return { error: "No price to size the market order at. Use a limit order." };
  }
  return { sizingPrice: sizing, uiPrice: toPriceString(marketable) };
}

/**
 * The ticket's size as whole cNGN contracts: what was typed when the unit is cNGN, else the USDC
 * figure converted at the sizing price. Null when it does not come to at least 1 cNGN, the venue's
 * minimum.
 */
function resolvePerpOrderSize(request: PerpOrderRequest, sizingPrice: number): string | null {
  const typed = Number(request.size.replaceAll(",", ""));
  const sizeCngn = Math.floor(toOrderSizeCngn(typed, request.sizeUnit, sizingPrice));
  return Number.isFinite(sizeCngn) && sizeCngn >= 1 ? sizeCngn.toFixed(0) : null;
}

type SigningWallet = ConnectedWallet;

/**
 * Signs a perp order for the perp's own module and asset, then posts it. `size` is cNGN contracts
 * and `price` the limit in USDC per cNGN, as the engine rests them; `engineAmountWhole` sizes the
 * order from the engine's own contract count instead, for closing a position exactly.
 * `reduceOnly` asks the venue to clamp the order to the account's position. With an `idempotency`
 * key the order is identified once by the caller, and a POST that fails in transit is re-sent as
 * the same order: the venue answers a duplicate with 409, which here means the first attempt
 * landed.
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
  price: string;
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
    uiPrice: price,
    uiSize: size,
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

/**
 * "Positions (1)": the tabs with the wallet's own counts. Plain labels without a wallet, since
 * the counts would be of an account that does not exist yet.
 */
function withCounts(
  tabs: typeof PERP_BOTTOM_TABS,
  hasWallet: boolean,
  counts: Partial<Record<PerpBottomTab, number>>
): ActivityTab[] {
  if (!hasWallet) {
    return [...tabs];
  }
  return tabs.map((tab) => {
    const count = counts[tab.id as PerpBottomTab];
    return count === undefined ? tab : { ...tab, label: `${tab.label} (${count})` };
  });
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
    return buildPerpPositionsView(inputs.positions, PERP_MARKET_LABEL, {
      account: inputs.account,
      state: inputs.market.state,
    });
  }
  if (inputs.bottomTab === "balances") {
    return buildPerpBalancesView(inputs.account, listedCollateralOf(inputs.market.stack), {
      indexPrice: inputs.market.state.indexPrice,
    });
  }
  if (inputs.bottomTab === "funding-history") {
    return PERP_ACTIVITY_VIEWS["funding-history"];
  }
  if (inputs.bottomTab === "order-history" || inputs.bottomTab === "trade-history") {
    return perpActivityView(
      inputs.signedHistoryView ?? PERP_ACTIVITY_VIEWS[inputs.bottomTab],
      "Direction"
    );
  }
  return perpActivityView(
    buildOpenOrdersActivityView(inputs.market.openOrders, inputs.walletAddress),
    "Side"
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
 * an em dash until the account is read. Each row's plus and minus open the account's one transfer
 * dialog on that row's asset; minus only where something is held to withdraw.
 */
function buildAccountRows(
  account: PerpAccountMargin | null,
  stack: PerpStack | null,
  onDeposit: (currency: DepositCurrency) => void,
  onWithdraw: (currency: DepositCurrency) => void
): AccountSummaryRow[] {
  const cngnListed = listedCollateralOf(stack).some((asset) => asset.symbol === "cNGN");
  const cngnHeld = account?.collateral.find((row) => row.symbol === "cNGN")?.balance;
  const rows: AccountSummaryRow[] = [
    {
      balance: formatBalance(account?.cash ?? null, "USDC"),
      onWithdraw: account === null ? undefined : () => onWithdraw("USDC"),
      symbol: "USDC",
      onDeposit: () => onDeposit("USDC"),
    },
  ];
  if (cngnListed) {
    rows.push({
      balance: formatBalance(account === null ? null : (cngnHeld ?? 0), "cNGN"),
      onWithdraw: cngnHeld === undefined ? undefined : () => onWithdraw("cNGN"),
      symbol: "cNGN",
      onDeposit: () => onDeposit("cNGN"),
    });
  }
  return rows;
}

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, style: "percent" });

/** The cNGN the perp credits as margin, if the venue lists it. */
function cngnCollateralOf(stack: PerpStack | null): PerpCollateralAsset | null {
  return listedCollateralOf(stack).find((asset) => asset.symbol === "cNGN") ?? null;
}

/**
 * Why cNGN cannot be deposited as perp margin right now, or nothing when it can: the venue lists
 * it and its escrow is taking deposits. Between the SRM crediting it and the escrow opening, a
 * deposit would revert, so the dialog does not offer it.
 */
function cngnMarginPause(stack: PerpStack | null): Partial<Record<DepositCurrency, string>> {
  const cngn = cngnCollateralOf(stack);
  if (cngn?.depositsOpen) {
    return {};
  }
  return { cNGN: "The venue is not taking cNGN margin deposits right now. USDC is open." };
}

/**
 * What a cNGN margin depositor must know before posting it: the haircut, and that the haircut is
 * what liquidates a leveraged short as the naira strengthens.
 */
function cngnMarginNote(stack: PerpStack | null): Partial<Record<DepositCurrency, string>> {
  const cngn = cngnCollateralOf(stack);
  if (cngn === null) {
    return {};
  }
  return {
    cNGN: `cNGN is valued at the index and ${PERCENT.format(cngn.marginFactor)} of that counts as margin. A short of cNGN loses as cNGN strengthens; the cNGN you post gains then, but only that share of the gain is credited, so the haircut is what gets a leveraged short liquidated: post about as much cNGN as you short.`,
  };
}

/** Each Balances row's asset, in the order `buildPerpBalancesView` lays the rows out. */
function balanceRowSymbolsOf(account: PerpAccountMargin | null, stack: PerpStack | null) {
  if (account === null) {
    return [];
  }
  const held = account.collateral;
  const unheld = listedCollateralOf(stack).filter(
    (asset) => !held.some((row) => row.escrow.toLowerCase() === asset.escrow.toLowerCase())
  );
  return ["USDC", ...held.map((row) => row.symbol), ...unheld.map((asset) => asset.symbol)];
}

/** A Balances row's asset as the transfer dialog names it, or null for one it cannot move. */
function toTransferCurrency(symbol: string | undefined): DepositCurrency | null {
  return symbol === "USDC" || symbol === "cNGN" ? symbol : null;
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
  if (bottomTab === "funding-history") {
    return {
      body: "Funding accrues continuously on chain at the rate in the header; there is no settlement to list. The venue does not yet publish funding payments per account.",
      title: "No funding history",
    };
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
 * The market order that flattens a position: the opposite side (a long of cNGN closes with a
 * sell), priced at the touch like any market order, sized in the engine's own contracts.
 */
function buildCloseRequest(
  position: PerpPosition,
  touch: { bestAsk: number | null; bestBid: number | null; price: number | null }
): { engineSize: bigint; price: string; uiSide: "buy" | "sell" } | { error: string } {
  if (position.engineSize === null) {
    return {
      error: "This position cannot be closed from here: the venue did not report its size.",
    };
  }
  const uiSide = position.uiSide === "long" ? "sell" : "buy";
  const resolved = resolvePerpOrderPrice(
    { limitPrice: "", maxSlippage: PERP_DEFAULT_MAX_SLIPPAGE, orderType: "Market" },
    uiSide,
    touch
  );
  if ("error" in resolved) {
    return resolved;
  }
  return { engineSize: position.engineSize, price: resolved.uiPrice, uiSide };
}

const ROW_BUTTON_CLASSES =
  "cursor-pointer rounded-sm bg-input-bg px-2 py-1 font-medium text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active disabled:cursor-wait disabled:opacity-60";

/**
 * The button at the end of each row: Cancel on an open order, Close on a position, the fill's
 * transaction on a trade. Each is the one action the row is for.
 */
/**
 * Deposit, Withdraw and Swap at the end of each Balances row, Deposit and Withdraw opening the
 * account's one transfer dialog on the row's asset. The rows run cash, each collateral asset held,
 * then each listed but not held, which can only be deposited. Swap opens the spot cNGN-USDC market,
 * the venue's one way to exchange the two. Since the unified-account cutover (2026-10-04) spot
 * trades on the perp stack from this same account, so a spot fill settles straight into these
 * balances: the USDC is the account's cash and the cNGN its collateral.
 */
function buildBalanceRowAction(
  account: PerpAccountMargin | null,
  rowSymbols: string[],
  onDeposit: (currency: DepositCurrency) => void,
  onWithdraw: (currency: DepositCurrency) => void
) {
  const heldRows = 1 + (account?.collateral.length ?? 0);
  return (rowIndex: number) => {
    const currency = toTransferCurrency(rowSymbols[rowIndex]);
    return (
      <span className="inline-flex gap-1.5">
        {currency === null ? null : (
          <button className={ROW_BUTTON_CLASSES} onClick={() => onDeposit(currency)} type="button">
            Deposit
          </button>
        )}
        {currency !== null && rowIndex < heldRows ? (
          <button className={ROW_BUTTON_CLASSES} onClick={() => onWithdraw(currency)} type="button">
            Withdraw
          </button>
        ) : null}
        <SmartLink
          className={ROW_BUTTON_CLASSES}
          href={marketPath("spot")}
          title="Trade cNGN for USDC, or back, on the spot market. Spot and the perp share this account, so the swap settles straight into these balances."
        >
          Swap
        </SmartLink>
      </span>
    );
  };
}

function buildRowAction(inputs: {
  account: PerpAccountMargin | null;
  bottomTab: PerpBottomTab;
  cancellingNonce: string | null;
  closingIndex: number | null;
  hasWallet: boolean;
  isSubmitting: boolean;
  market: PerpMarket | null;
  onCancel: (nonce: string, ownerAddress: string) => void;
  onClose: (position: PerpPosition, rowIndex: number) => void;
  onDeposit: (currency: DepositCurrency) => void;
  onWithdraw: (currency: DepositCurrency) => void;
  /** Each Balances row's asset, in the view's order. */
  balanceRowSymbols: string[];
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
  if (bottomTab === "balances") {
    return buildBalanceRowAction(
      inputs.account,
      inputs.balanceRowSymbols,
      inputs.onDeposit,
      inputs.onWithdraw
    );
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
 * The perp's book, trades, candles and headline price, from the shared live-book hook. The
 * headline price is the book's touch first, then the chain's mark, so an empty book still shows
 * where the market is.
 */
function usePerpBook(market: PerpMarket | null) {
  const book = useLiveMarketBook({
    candles: market?.candles ?? [],
    enabled: market !== null,
    symbol: PERP_MARKET_SYMBOL,
    type: "perp",
    snapshot: {
      mark: market?.mark ?? null,
      orderBookAsks: market?.orderBookAsks ?? [],
      orderBookBids: market?.orderBookBids ?? [],
      stats24h: market?.stats24h ?? null,
      trades: market?.trades ?? [],
    },
  });
  const price = market
    ? (getAnchorPrice(book.bestAsk, book.bestBid, book.lastPrice) ?? market.state.markPrice)
    : null;
  const stats = get24hStats(book.stats24h, book.lastPrice);
  return {
    asks: book.asks,
    bestAsk: book.bestAsk,
    bestBid: book.bestBid,
    bids: book.bids,
    candles: book.candles,
    lastPrice: book.lastPrice,
    price,
    stats,
    trades: book.trades,
    volumeUsd: book.stats24h?.quoteVolume ?? null,
  };
}

/** What a fill changes on the perp: the account's positions, by side and engine size. */
function positionsSignature(positions: PerpPosition[]) {
  return positions.map((p) => `${p.uiSide}:${p.engineSize ?? p.uiSize}`).join("|");
}

/** The header's figures for the perp on screen, or dashes while it is not live. */
function perpHeaderMetrics(
  market: PerpMarket | null,
  price: number | null,
  volumeUsd: number | null
) {
  return buildPerpHeaderMetrics({
    firstPrice: market?.stats24h?.firstPrice ?? null,
    price,
    state: market?.state ?? null,
    volumeUsd,
  });
}

/**
 * The cNGN-PERP market under the shell, on the same grid as spot so switching markets does not
 * move the panels. The session (wallet, trading account) is the shell's; since the unified-account
 * cutover the perp margins the same account spot settles into.
 *
 * `market` is null until markets-service lists the perp with its chain state and stack; the
 * panels then render every empty state and a ticket that cannot submit. With it, the book streams,
 * orders are signed for the perp's module and asset, and positions and margin are read from chain.
 */
export function PerpMarketPanels({ market: renderedMarket }: { market: PerpMarket | null }) {
  // The chain state the page rendered with, kept current: the ticket opens and closes with the venue.
  const market = usePerpLiveState(renderedMarket);
  const router = useRouter();
  const session = useTerminalSession();
  const { isSignedIn, login, walletsReady } = session;
  // No wallet while the perp is not live: nothing here can be signed for.
  const primaryWallet = market !== null ? session.primaryWallet : null;

  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("D");
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<PerpBottomTab>("positions");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingNonce, setCancellingNonce] = useState<string | null>(null);
  const [closingIndex, setClosingIndex] = useState<number | null>(null);

  const stack = market?.stack ?? null;
  const signedHistory = useSignedHistoryTabs({
    bottomTab,
    isSignedIn,
    market: PERP_MARKET_SYMBOL,
    signMessage: buildHistorySigner(primaryWallet, walletsReady),
    walletAddress: primaryWallet?.address ?? null,
    orderHistoryView: (orders) => buildPerpOrderHistoryActivityView(orders, PERP_MARKET_LABEL),
    tradeHistoryView: (fills) => buildPerpTradeHistoryActivityView(fills, PERP_MARKET_LABEL),
  });
  // The shell's account, resolved under the configured stack; the build check holds that equal to
  // the venue's perp stack. Unread while the perp is not live, as the wallet is.
  const account = {
    ...session.account,
    isLoading: market !== null && session.account.isLoading,
    subaccountId: market === null ? null : session.account.subaccountId,
  };
  const perpAccount = usePerpPositions(account.subaccountId);
  const orderStatus = useOrderStatus(positionsSignature(perpAccount.positions));
  // The account's ledger, as spot reads it: the transfer dialog's withdraw side draws its balances
  // and Max from these rows. Same account, same escrows, since the unified-account cutover.
  const ledger = useSubaccountBalance(account.subaccountId);
  // The account's one Deposit / Withdraw flow, the same dialog spot opens. The perp adds only what
  // a margin depositor must know: whether the venue is taking cNGN margin, and its haircut.
  const transfer = useAccountTransfer({
    accountRows: ledger.balance?.rows ?? null,
    depositNotes: cngnMarginNote(stack),
    depositPauseReasons: cngnMarginPause(stack),
    onTransferred: (blockNumber) => {
      ledger.refresh(blockNumber);
      perpAccount.refresh();
    },
  });
  const balanceRowSymbols = balanceRowSymbolsOf(perpAccount.account, stack);

  const { asks, bestAsk, bestBid, bids, candles, lastPrice, price, stats, trades, volumeUsd } =
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
      transfer.openDeposit("USDC");
      return;
    }
    const uiSide = perpOrderUiSide(request.side);
    const resolved = resolvePerpOrderPrice(request, uiSide, { bestAsk, bestBid, price });
    if ("error" in resolved) {
      orderStatus.announce(resolved.error);
      return;
    }
    const sizeCngn = resolvePerpOrderSize(request, resolved.sizingPrice);
    if (sizeCngn === null) {
      orderStatus.announce("Order too small: the size must come to at least 1 cNGN.");
      return;
    }

    const event = {
      market_id: "cngn-usdc-perp",
      order_side: request.side,
      order_type: request.orderType,
      size_cngn: sizeCngn,
    };
    setIsSubmitting(true);
    try {
      const { body, ok, status } = await signAndPostPerpOrder({
        market,
        price: resolved.uiPrice,
        reduceOnly: request.reduceOnly,
        side: uiSide,
        size: sizeCngn,
        subaccountId: account.subaccountId,
        wallet: primaryWallet,
        onAwaitingSignature: () =>
          orderStatus.announce(
            `Awaiting wallet signature for perp account #${account.subaccountId}`
          ),
      });
      if (!ok) {
        posthog.capture("order_rejected", {
          ...event,
          error_message: body?.error ?? null,
          http_status: status,
        });
        orderStatus.settle(describeOrderRejection(body?.error, "Perp order submission failed"));
        return;
      }
      posthog.capture("order_submitted", event);
      orderStatus.announce(
        request.reduceOnly
          ? "Reduce-only order accepted. The venue clamps it to your position; it fills or is cancelled once matched."
          : null,
        { awaitFill: true }
      );
      perpAccount.refresh();
      router.refresh();
    } catch (error) {
      posthog.captureException(error, {
        properties: { market_id: "cngn-usdc-perp", order_side: request.side },
      });
      orderStatus.settle(error instanceof Error ? error.message : "Perp order submission failed");
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
        orderStatus.announce(fresh.error);
        perpAccount.refresh();
        return;
      }
      const close = buildCloseRequest(fresh.position, { bestAsk, bestBid, price });
      if ("error" in close) {
        orderStatus.announce(close.error);
        return;
      }
      const idempotency = createOrderIdempotencyKey("perp");
      const event = {
        market_id: "cngn-usdc-perp",
        order_side: close.uiSide === "buy" ? "long" : "short",
        order_type: "Close",
        size_cngn: close.engineSize.toString(),
      };
      const { body, ok, status } = await signAndPostPerpOrder({
        engineAmountWhole: close.engineSize,
        idempotency,
        market,
        price: close.price,
        reduceOnly: true,
        side: close.uiSide,
        size: close.engineSize.toString(),
        subaccountId,
        wallet: primaryWallet,
        onAwaitingSignature: () =>
          orderStatus.announce(
            `Awaiting wallet signature to close ${fresh.position.uiSide} ${close.engineSize} cNGN (reduce-only)`
          ),
      });
      if (!ok) {
        posthog.capture("order_rejected", {
          ...event,
          error_message: body?.error ?? null,
          http_status: status,
        });
        orderStatus.settle(describeOrderRejection(body?.error, "Close failed"));
        return;
      }
      posthog.capture("order_submitted", event);
      // The ticket is free again; the Close button stays disabled until the venue has an outcome.
      setIsSubmitting(false);
      orderStatus.announce("Close accepted. Waiting for the venue to confirm the fill…");
      const outcome = await awaitOrderOutcome(idempotency.orderId);
      orderStatus.settle(describeCloseOutcome(outcome));
      perpAccount.refresh();
      router.refresh();
    } catch (error) {
      posthog.captureException(error, {
        properties: { market_id: "cngn-usdc-perp", order_type: "Close" },
      });
      orderStatus.settle(error instanceof Error ? error.message : "Close failed");
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
      orderStatus.settle(response.ok ? "Order cancelled." : `Cancel failed (${response.status})`);
      router.refresh();
    } catch (error) {
      orderStatus.settle(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setCancellingNonce(null);
    }
  }

  usePublishTerminalHeader({
    changePercent24h: stats.changePercent,
    depositControl: market === null ? undefined : transfer.headerControl,
    high24h: stats.high,
    low24h: stats.low,
    market: "perp",
    metrics: perpHeaderMetrics(market, price, volumeUsd),
    price,
    volume24hLabel: stats.volumeLabel,
  });

  return (
    <>
      <MarketDocumentTitle pair={PERP_MARKET_LABEL} price={price} />

      <TerminalGrid
        activity={
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
              account: perpAccount.account,
              bottomTab,
              closingIndex,
              cancellingNonce,
              hasWallet: primaryWallet !== null,
              isSubmitting,
              market,
              balanceRowSymbols,
              onDeposit: transfer.openDeposit,
              onWithdraw: transfer.openWithdraw,
              onCancel: (nonce, ownerAddress) => void handleCancel(nonce, ownerAddress),
              onClose: (position, rowIndex) => void handleClose(position, rowIndex),
              ownedOpenOrders,
              positions: perpAccount.positions,
              tradeHistoryRowAction: signedHistory.rowAction,
            })}
            selectedTab={bottomTab}
            tabs={withCounts(PERP_BOTTOM_TABS, primaryWallet !== null, {
              "open-orders": ownedOpenOrders.length,
              positions: perpAccount.positions.length,
            })}
          />
        }
        book={
          <SpotOrderBookPanel
            asks={asks}
            bids={bids}
            lastPrice={lastPrice}
            onTabChange={setBookTab}
            tab={bookTab}
            trades={trades}
          />
        }
        chart={
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
        }
        ticketColumn={
          <>
            <PerpOrderFormPanel
              account={perpAccount.account}
              asks={asks}
              availableMargin={perpAccount.account?.initialMarginSurplus ?? null}
              bids={bids}
              hasWallet={primaryWallet !== null}
              isAccepted={orderStatus.isAccepted}
              isFilled={orderStatus.isFilled}
              isPreparingAccount={account.isLoading || (isSignedIn && !walletsReady)}
              isSubmitting={isSubmitting}
              // The button reports acceptance and the fill; the line under it is for everything else.
              lastAction={orderStatus.isFilled ? null : orderStatus.status}
              onConnect={login}
              onDepositRequest={() => transfer.openDeposit("USDC")}
              onEdit={orderStatus.clear}
              onSubmit={market === null ? undefined : handleSubmit}
              position={perpAccount.positions[0] ?? null}
              referencePrice={price}
              state={market?.state ?? null}
              takerFeeBps={market?.takerFeeBps ?? null}
            />
            {/* The perp account's holdings under the ticket, as spot's column ends. */}
            <AccountSummary
              rows={buildAccountRows(
                perpAccount.account,
                stack,
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
