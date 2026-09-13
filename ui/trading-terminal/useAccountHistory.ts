"use client";

import { useEffect, useState } from "react";
import type {
  AccountFill,
  OrderHistoryAuthFrame,
  OrderHistoryOrder,
  SignedHistoryState,
} from "@/lib/order-history.types";
import {
  buildOrderHistoryAuthMessage,
  createOrderHistoryAuthDraft,
  encodeOrderHistoryAuthHeader,
  getMarketsAuthDomain,
  isOrderHistoryAuthUsable,
  parseOrderHistoryAuthFrame,
} from "@/lib/order-history-auth";

/** Unchanged from when only Order History used the login, so logins signed before still load. */
const STORAGE_PREFIX = "numo.order-history-auth.v1";

/** The newest rows shown; older pages are not loaded yet. */
const HISTORY_PAGE_SIZE = 100;

/** One signed history endpoint, as the Next.js route proxies it. */
type HistoryEndpoint = {
  /** Names the history in an error, e.g. "Order history failed (500)". */
  label: string;
  path: string;
  /** The response field holding the rows. */
  rowsKey: string;
};

const ORDER_HISTORY_ENDPOINT = {
  label: "Order history",
  path: "/api/orders",
  rowsKey: "orders",
} satisfies HistoryEndpoint;

const TRADE_HISTORY_ENDPOINT = {
  label: "Trade history",
  path: "/api/fills",
  rowsKey: "fills",
} satisfies HistoryEndpoint;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function storageKey(walletAddress: string) {
  return `${STORAGE_PREFIX}.${walletAddress.toLowerCase()}`;
}

/*
 * The login is kept in localStorage so one signature lasts its full lifetime across reloads. Storage
 * can be unavailable (private mode, blocked site data); losing it only costs another signature, so it
 * must never break the tab.
 */
function readStoredFrame(walletAddress: string) {
  try {
    return parseOrderHistoryAuthFrame(window.localStorage.getItem(storageKey(walletAddress)));
  } catch {
    return null;
  }
}

function writeStoredFrame(walletAddress: string, frame: OrderHistoryAuthFrame) {
  try {
    window.localStorage.setItem(storageKey(walletAddress), JSON.stringify(frame));
  } catch {
    // See readStoredFrame.
  }
}

function clearStoredFrame(walletAddress: string) {
  try {
    window.localStorage.removeItem(storageKey(walletAddress));
  } catch {
    // See readStoredFrame.
  }
}

type FetchResult<Row> =
  | { kind: "ok"; rows: Row[] }
  | { kind: "unauthorized" }
  | { error: string; kind: "error" };

async function fetchHistory<Row>(
  endpoint: HistoryEndpoint,
  frame: OrderHistoryAuthFrame
): Promise<FetchResult<Row>> {
  const response = await fetch(`${endpoint.path}?limit=${HISTORY_PAGE_SIZE}`, {
    cache: "no-store",
    headers: { "x-numo-auth": encodeOrderHistoryAuthHeader(frame) },
  });

  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const rows = body?.[endpoint.rowsKey];
  if (!(response.ok && Array.isArray(rows))) {
    const error = typeof body?.error === "string" ? body.error : null;
    return { error: error ?? `${endpoint.label} failed (${response.status})`, kind: "error" };
  }
  return { kind: "ok", rows: rows as Row[] };
}

type HistoryOptions = {
  /** Load only while true — the tab is open and a wallet session is active. */
  enabled: boolean;
  /** personal_sign with the connected wallet; absent when there is no wallet to sign with. */
  signMessage?: (message: string) => Promise<string>;
  walletAddress: string | null;
};

/**
 * One of the connected wallet's private histories, loaded while its tab is open.
 *
 * markets-service wants a signed login. Signing is never started on its own: without a usable cached
 * login the state is `needs-signature` and the tab offers the prompt. The login is the same for every
 * history, so signing on one tab unlocks the others. Every visit to the tab re-reads the list, so
 * activity since shows up without a reload.
 */
function useSignedHistory<Row>(
  endpoint: HistoryEndpoint,
  { enabled, signMessage, walletAddress }: HistoryOptions
) {
  const [state, setState] = useState<SignedHistoryState<Row>>({ status: "idle" });
  const [reloadCount, setReloadCount] = useState(0);

  // `reloadCount` is only a trigger: bumping it re-reads after a signature or a retry.
  useEffect(() => {
    if (!enabled || walletAddress === null) {
      setState({ status: "idle" });
      return;
    }

    const frame = readStoredFrame(walletAddress);
    if (frame === null || !isOrderHistoryAuthUsable(frame, walletAddress, nowSeconds())) {
      setState({ status: "needs-signature" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    fetchHistory<Row>(endpoint, frame)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.kind === "unauthorized") {
          // Expired early, signed for another domain, or the server limit changed: sign again.
          clearStoredFrame(walletAddress);
          setState({ status: "needs-signature" });
          return;
        }
        setState(
          result.kind === "ok"
            ? { rows: result.rows, status: "ready" }
            : { error: result.error, status: "error" }
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : `${endpoint.label} failed`,
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, endpoint, walletAddress, reloadCount]);

  /** Asks the wallet to sign the login, then loads the history with it. */
  async function authorize() {
    if (walletAddress === null || signMessage === undefined) {
      return;
    }

    setState({ status: "signing" });
    try {
      const draft = createOrderHistoryAuthDraft({
        address: walletAddress,
        nonce: crypto.randomUUID(),
        nowSeconds: nowSeconds(),
      });
      const signature = await signMessage(
        buildOrderHistoryAuthMessage({
          address: draft.address,
          domain: getMarketsAuthDomain(),
          expiry: draft.expiry,
          issuedAt: draft.issued_at,
          nonce: draft.nonce,
        })
      );
      writeStoredFrame(walletAddress, { ...draft, signature });
      setReloadCount((count) => count + 1);
    } catch (error) {
      setState({
        error: error instanceof Error ? error.message : "The signature was not completed",
        status: "error",
      });
    }
  }

  /** Re-reads the history, or returns to the signature prompt if the login is gone. */
  function reload() {
    setReloadCount((count) => count + 1);
  }

  return { authorize, reload, state };
}

/** The connected wallet's orders in every status (`GET /v1/orders`). */
export function useOrderHistory(options: HistoryOptions) {
  return useSignedHistory<OrderHistoryOrder>(ORDER_HISTORY_ENDPOINT, options);
}

/** The fills on the connected wallet's orders (`GET /v1/fills`), on the same login as order history. */
export function useTradeHistory(options: HistoryOptions) {
  return useSignedHistory<AccountFill>(TRADE_HISTORY_ENDPOINT, options);
}
