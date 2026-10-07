"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import {
  buildOrderHistoryActivityView,
  buildTradeHistoryActivityView,
  getFillTransactionUrl,
} from "@/lib/account-activity-views";
import { getAppChain } from "@/lib/base-public-client";
import type { AccountFill, OrderHistoryOrder, SignedHistoryState } from "@/lib/order-history.types";
import type { ActivityView } from "@/lib/trading.types";
import { useOrderHistory, useTradeHistory } from "@/ui/trading-terminal/useAccountHistory";

/** The empty-state copy that differs between the two signed history tabs. */
const SIGNED_HISTORY_COPY = {
  "order-history": {
    emptyBody: "Orders you place will appear here.",
    emptyTitle: "No orders yet",
    loadingBody: "Fetching your orders.",
    noun: "order history",
  },
  "trade-history": {
    emptyBody: "Each fill on your orders will appear here.",
    emptyTitle: "No trades yet",
    loadingBody: "Fetching your trades.",
    noun: "trade history",
  },
} as const;

type SignedHistoryTab = keyof typeof SIGNED_HISTORY_COPY;

function isSignedHistoryTab(tab: string): tab is SignedHistoryTab {
  return Object.hasOwn(SIGNED_HISTORY_COPY, tab);
}

/**
 * What a signed history tab says while it has no rows, and which control it offers. Lives outside
 * the component so the state-by-state branching stays off its complexity budget.
 */
function getSignedHistoryEmptyState(
  tab: SignedHistoryTab,
  state: SignedHistoryState<unknown>
): { action: "retry" | "sign" | null; body: string; title: string } | null {
  const copy = SIGNED_HISTORY_COPY[tab];
  switch (state.status) {
    case "needs-signature":
      return {
        action: "sign",
        body: "Your order and trade history are private. Sign a message with your wallet to view them — it costs no gas and lasts 12 hours.",
        title: `Sign to view ${copy.noun}`,
      };
    case "signing":
      return {
        action: null,
        body: "Approve the signature request in your wallet.",
        title: "Waiting for your wallet",
      };
    case "loading":
      return { action: null, body: copy.loadingBody, title: `Loading ${copy.noun}` };
    case "error":
      return { action: "retry", body: state.error, title: `Couldn't load ${copy.noun}` };
    case "ready":
      return { action: null, body: copy.emptyBody, title: copy.emptyTitle };
    default:
      return null;
  }
}

/** What the terminal needs from a signed history hook to prompt for, retry and render it. */
type SignedHistoryHandle = {
  authorize: () => Promise<void>;
  reload: () => void;
  state: SignedHistoryState<unknown>;
};

/**
 * The open signed history tab's empty state, with the hook its sign and retry controls act on; null
 * on any other tab, or once that tab has nothing to say.
 */
function getSignedHistoryPrompt(
  tab: string,
  histories: Record<SignedHistoryTab, SignedHistoryHandle>
) {
  if (!isSignedHistoryTab(tab)) {
    return null;
  }
  const history = histories[tab];
  const emptyState = getSignedHistoryEmptyState(tab, history.state);
  return emptyState === null ? null : { ...emptyState, history };
}

/**
 * The rows a signed history tab shows once its history has loaded; null for any other tab or state,
 * which fall through to the panel's headers and empty state. Outside the component for the same
 * complexity budget as the empty state above.
 */
function getSignedHistoryView(
  tab: string,
  orderHistory: SignedHistoryState<OrderHistoryOrder>,
  tradeHistory: SignedHistoryState<AccountFill>,
  orderHistoryView: (orders: OrderHistoryOrder[]) => ActivityView,
  tradeHistoryView: (fills: AccountFill[]) => ActivityView
): ActivityView | null {
  if (tab === "order-history" && orderHistory.status === "ready") {
    return orderHistoryView(orderHistory.rows);
  }
  if (tab === "trade-history" && tradeHistory.status === "ready") {
    return tradeHistoryView(tradeHistory.rows);
  }
  return null;
}

/**
 * The Trade History row control: a link to the fill's settling transaction on Basescan, when the venue
 * recorded one. Undefined on any other tab, so no trailing cell is added there. Outside the component
 * for the same complexity budget as the helpers above.
 */
function getTradeHistoryRowAction(
  tab: string,
  tradeHistory: SignedHistoryState<AccountFill>
): ((rowIndex: number) => ReactNode) | undefined {
  if (tab !== "trade-history" || tradeHistory.status !== "ready") {
    return undefined;
  }
  const explorerUrl = getAppChain().blockExplorers?.default.url;
  const fills = tradeHistory.rows;

  return function renderTransactionLink(rowIndex: number) {
    const fill = fills[rowIndex];
    const href = fill === undefined ? null : getFillTransactionUrl(fill, explorerUrl);
    if (href === null) {
      return null;
    }
    return (
      <a
        aria-label="View transaction on Basescan"
        className="inline-flex text-panel-text-muted transition-colors hover:text-panel-text-active"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
        title="View on Basescan"
      >
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
    );
  };
}

/** Rows the venue labelled with another market, or with none (an older service), stay out of this terminal's tabs. */
function ofMarket<Row extends { market?: string }>(rows: Row[], market: string): Row[] {
  return rows.filter((row) => row.market === undefined || row.market === market);
}

function filterState<Row extends { market?: string }>(
  state: SignedHistoryState<Row>,
  market: string
): SignedHistoryState<Row> {
  return state.status === "ready" ? { ...state, rows: ofMarket(state.rows, market) } : state;
}

/**
 * The Order History and Trade History tabs, shared by the spot and perp terminals: one signed
 * login serves both tabs and both markets, and each terminal shows the rows the venue labelled
 * with its own market. Returns what the activity panel needs for the open tab, or nulls on any
 * other tab.
 */
export function useSignedHistoryTabs({
  bottomTab,
  isSignedIn,
  market,
  orderHistoryView = (orders) => buildOrderHistoryActivityView(orders),
  signMessage,
  tradeHistoryView = (fills) => buildTradeHistoryActivityView(fills),
  walletAddress,
}: {
  bottomTab: string;
  isSignedIn: boolean;
  /** The venue's symbol for this terminal's market, as history rows carry it. */
  market: string;
  /** Builds the Order History rows from the loaded orders; spot's columns unless the terminal says otherwise. */
  orderHistoryView?: (orders: OrderHistoryOrder[]) => ActivityView;
  /** Builds the Trade History rows from the loaded fills; spot's columns unless the terminal says otherwise. */
  tradeHistoryView?: (fills: AccountFill[]) => ActivityView;
  /** personal_sign with the connected wallet; absent when there is no wallet to sign with. */
  signMessage?: (message: string) => Promise<string>;
  walletAddress: string | null;
}) {
  const orderHistory = useOrderHistory({
    enabled: isSignedIn && bottomTab === "order-history",
    signMessage,
    walletAddress,
  });
  const tradeHistory = useTradeHistory({
    enabled: isSignedIn && bottomTab === "trade-history",
    signMessage,
    walletAddress,
  });
  const orderState = filterState(orderHistory.state, market);
  const tradeState = filterState(tradeHistory.state, market);

  // Both signed tabs share one login, so a signature from either prompt unlocks the other.
  const prompt = getSignedHistoryPrompt(bottomTab, {
    "order-history": { ...orderHistory, state: orderState },
    "trade-history": { ...tradeHistory, state: tradeState },
  });

  return {
    emptyState:
      prompt === null
        ? undefined
        : {
            action:
              prompt.action === null ? undefined : (
                <button
                  className="cursor-pointer rounded-sm bg-input-bg px-3 py-1.5 font-medium text-[11px] text-panel-text-active ring-1 ring-panel-border transition-colors hover:bg-input-hover disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={prompt.action === "sign" && signMessage === undefined}
                  onClick={
                    prompt.action === "sign" ? prompt.history.authorize : prompt.history.reload
                  }
                  type="button"
                >
                  {prompt.action === "sign" ? "Sign to view" : "Retry"}
                </button>
              ),
            body: prompt.body,
            title: prompt.title,
          },
    /** The Trade History row control, undefined on every other tab. */
    rowAction: getTradeHistoryRowAction(bottomTab, tradeState),
    /** The open tab's rows once loaded; null on any other tab or state. */
    view: getSignedHistoryView(
      bottomTab,
      orderState,
      tradeState,
      orderHistoryView,
      tradeHistoryView
    ),
  };
}
