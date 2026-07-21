"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import {
  applyBookDelta,
  applyBookSnapshot,
  buildBookSide,
  presentStreamTrade,
} from "@/lib/market-stream";
import type { BookState } from "@/lib/market-stream";
import type {
  BookSnapshotData,
  BookUpdateData,
  MarketStreamFrame,
  MarketStreamPresenter,
  MarketStreamRequest,
  MarketStreamStatus,
  StreamTrade,
} from "@/lib/market-stream.types";
import type { MarketType, OrderBookLevel, TradePrint } from "@/lib/trading.types";

const MARKETS_WS_URL = process.env.NEXT_PUBLIC_MARKETS_WS_URL;

const RECONNECT_MIN_MS = Duration.toMillis("1 second");
const RECONNECT_MAX_MS = Duration.toMillis("30 seconds");
const MAX_TRADES = 50;

type MarketOrderBookView = {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  trades: TradePrint[];
  status: MarketStreamStatus;
};

const EMPTY_VIEW: MarketOrderBookView = { asks: [], bids: [], status: "connecting", trades: [] };

/**
 * Streams a live order book and recent trades for one market over the markets-service WebSocket
 * (`GET /v1/ws`). Seeds from the `snapshot` frame, then applies `book`/`trades` `update` deltas,
 * and reconnects with backoff. Callers keep their preview book unless `isLive` is true — a book is
 * only "live" once both sides have depth, so a crossed or one-sided book falls back gracefully.
 *
 * The `market` identifier is a canonical symbol (e.g. `USDCcNGN-SEP16-2026`, `USDCcNGN-SPOT`) or
 * the `"<asset_address>:<sub_id>"` form; the server resolves either.
 */
export function useMarketOrderBook({
  market,
  type,
  contractMultiplier,
  enabled = true,
}: {
  market: string | null | undefined;
  type: MarketType;
  contractMultiplier?: string | null;
  enabled?: boolean;
}) {
  const [view, setView] = useState<MarketOrderBookView>(EMPTY_VIEW);

  // Deltas mutate a live map; a numeric dep keeps the effect from resubscribing on identity churn.
  const parsedMultiplier = Number((contractMultiplier ?? "10000").replaceAll(",", ""));
  const multiplier = Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 10_000;

  useEffect(() => {
    if (!(enabled && market)) {
      setView({ ...EMPTY_VIEW, status: "unconfigured" });
      return;
    }

    if (!MARKETS_WS_URL) {
      setView({ ...EMPTY_VIEW, status: "unconfigured" });
      return;
    }

    const marketSymbol: string = market;
    const presenter: MarketStreamPresenter = { contractMultiplier: multiplier, type };
    const bookState: BookState = new Map();
    let trades: TradePrint[] = [];
    let hasBookSnapshot = false;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = RECONNECT_MIN_MS;
    let disposed = false;

    function publish(status: MarketStreamStatus) {
      const asks = buildBookSide(bookState, "ask");
      const bids = buildBookSide(bookState, "bid");
      let resolvedStatus = status;

      if (status === "ok") {
        if (asks.length === 0 && bids.length === 0) {
          resolvedStatus = "empty";
        } else if (asks.length > 0 && bids.length > 0 && (asks[0]?.price ?? 0) <= (bids[0]?.price ?? 0)) {
          resolvedStatus = "crossed";
        }
      }

      setView({ asks, bids, status: resolvedStatus, trades: [...trades] });
    }

    function send(request: MarketStreamRequest) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(request));
      }
    }

    function handleBookFrame(frame: MarketStreamFrame) {
      if (frame.type === "snapshot") {
        const next = applyBookSnapshot((frame.data ?? {}) as BookSnapshotData, presenter);
        bookState.clear();
        for (const [id, order] of next) {
          bookState.set(id, order);
        }
        hasBookSnapshot = true;
      } else if (frame.type === "update" && hasBookSnapshot) {
        applyBookDelta(bookState, (frame.data ?? {}) as BookUpdateData, presenter);
      }
      publish("ok");
    }

    function handleTradesFrame(frame: MarketStreamFrame) {
      if (frame.type === "snapshot") {
        trades = ((frame.data ?? []) as StreamTrade[])
          .map((trade) => presentStreamTrade(trade, presenter))
          .filter((trade): trade is TradePrint => trade !== null)
          .slice(0, MAX_TRADES);
      } else if (frame.type === "update") {
        const trade = presentStreamTrade((frame.data ?? {}) as StreamTrade, presenter);
        if (trade) {
          trades = [trade, ...trades].slice(0, MAX_TRADES);
        }
      }
      publish(hasBookSnapshot ? "ok" : "connecting");
    }

    function handleFrame(frame: MarketStreamFrame) {
      if (frame.type === "error") {
        // The hub dropped us (slow consumer / retention); a fresh reconnect re-snapshots cleanly.
        if (frame.code === "stream_reset") {
          send({ channel: frame.channel, market: marketSymbol, op: "subscribe" });
        } else {
          publish("error");
        }
        return;
      }

      if (frame.channel === "book") {
        handleBookFrame(frame);
      } else if (frame.channel === "trades") {
        handleTradesFrame(frame);
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer !== null) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        connect();
      }, reconnectDelay);
    }

    function connect() {
      if (disposed) {
        return;
      }

      let nextSocket: WebSocket;
      try {
        nextSocket = new WebSocket(MARKETS_WS_URL as string);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = nextSocket;

      nextSocket.onopen = () => {
        reconnectDelay = RECONNECT_MIN_MS;
        hasBookSnapshot = false;
        bookState.clear();
        send({ channel: "book", market: marketSymbol, op: "subscribe" });
        send({ channel: "trades", market: marketSymbol, op: "subscribe" });
      };

      nextSocket.onmessage = (event) => {
        try {
          handleFrame(JSON.parse(event.data as string) as MarketStreamFrame);
        } catch {
          // Ignore malformed frames; the next valid frame recovers the view.
        }
      };

      nextSocket.onclose = () => {
        if (!disposed) {
          scheduleReconnect();
        }
      };

      nextSocket.onerror = () => {
        nextSocket.close();
      };
    }

    setView({ ...EMPTY_VIEW, status: "connecting" });
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [enabled, market, type, multiplier]);

  const isLive = view.status === "ok" && view.asks.length > 0 && view.bids.length > 0;

  return {
    asks: isLive ? view.asks : [],
    bids: isLive ? view.bids : [],
    isLive,
    status: view.status,
    trades: view.trades,
  };
}
