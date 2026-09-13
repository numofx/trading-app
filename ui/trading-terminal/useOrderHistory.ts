"use client";

import { useEffect, useState } from "react";
import type {
  OrderHistoryAuthFrame,
  OrderHistoryResponse,
  OrderHistoryState,
} from "@/lib/order-history.types";
import {
  buildOrderHistoryAuthMessage,
  createOrderHistoryAuthDraft,
  encodeOrderHistoryAuthHeader,
  getMarketsAuthDomain,
  isOrderHistoryAuthUsable,
  parseOrderHistoryAuthFrame,
} from "@/lib/order-history-auth";

const STORAGE_PREFIX = "numo.order-history-auth.v1";

/** The newest orders shown; older pages are not loaded yet. */
const ORDER_HISTORY_PAGE_SIZE = 100;

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

type FetchResult =
  | { kind: "ok"; response: OrderHistoryResponse }
  | { kind: "unauthorized" }
  | { error: string; kind: "error" };

async function fetchOrderHistory(frame: OrderHistoryAuthFrame): Promise<FetchResult> {
  const response = await fetch(`/api/orders?limit=${ORDER_HISTORY_PAGE_SIZE}`, {
    cache: "no-store",
    headers: { "x-numo-auth": encodeOrderHistoryAuthHeader(frame) },
  });

  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  const body = (await response.json().catch(() => null)) as
    | (OrderHistoryResponse & { error?: string })
    | null;
  if (!response.ok || body === null) {
    return { error: body?.error ?? `Order history failed (${response.status})`, kind: "error" };
  }
  return { kind: "ok", response: body };
}

/**
 * The connected wallet's order history, loaded while the tab is open.
 *
 * The history is private, so markets-service wants a signed login. Signing is never started on its
 * own: without a usable cached login the state is `needs-signature` and the tab offers the prompt.
 * Every visit to the tab re-reads the list, so orders placed since show up without a reload.
 */
export function useOrderHistory({
  enabled,
  signMessage,
  walletAddress,
}: {
  /** Load only while true — the tab is open and a wallet session is active. */
  enabled: boolean;
  /** personal_sign with the connected wallet; absent when there is no wallet to sign with. */
  signMessage?: (message: string) => Promise<string>;
  walletAddress: string | null;
}) {
  const [state, setState] = useState<OrderHistoryState>({ status: "idle" });
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

    fetchOrderHistory(frame)
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
            ? { orders: result.response.orders, status: "ready" }
            : { error: result.error, status: "error" }
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : "Order history failed",
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, walletAddress, reloadCount]);

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
