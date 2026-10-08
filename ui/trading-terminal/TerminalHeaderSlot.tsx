"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import type { TerminalMarketId } from "@/lib/market-overview.types";
import type { HeaderMetricItem } from "@/ui/trading-terminal/TerminalHeaderBar";

/**
 * What a market's panels put in the shared header: the figures beside the selector and the
 * Deposit and Withdraw controls, which differ per market. Keyed by the market, so the header can
 * refuse figures that belong to a market other than the one its selector shows.
 */
export type TerminalHeaderPublication = {
  market: TerminalMarketId;
  changePercent24h: number | null;
  /** Extremes over the same window as the volume; null when nothing traded in it. */
  high24h: number | null;
  low24h: number | null;
  /**
   * What the market is worth here now: the book's mid, else its one resting side, else the last
   * trade. In USDC per cNGN. See `TerminalHeaderBar`.
   */
  price: number | null;
  volume24hLabel: string;
  /** Figures to show instead of the spot set: the perp's mark, index, funding and the rest. */
  metrics?: HeaderMetricItem[];
  /** The market's Deposit and Withdraw controls; rendered inside the header's action cluster. */
  depositControl?: ReactNode;
  /**
   * Figures the shell seeded from the selector's last read rather than the panels' own: shown
   * dimmed, with placeholder controls, until the live publication replaces them.
   */
  seeded?: boolean;
};

type Publish = {
  publish: (publication: TerminalHeaderPublication) => void;
  /** Drops the publication if it is still `market`'s: a panel unmounting clears only its own. */
  clear: (market: TerminalMarketId) => void;
};

/*
 * Two contexts on purpose. A panel publishes through the first, whose value never changes, so its
 * own publication cannot re-render it; only the header reads the second. One context would loop:
 * publish, re-render the publisher, publish again.
 */
const PublishContext = createContext<Publish | null>(null);
const PublicationContext = createContext<TerminalHeaderPublication | null>(null);

export function TerminalHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [publication, setPublication] = useState<TerminalHeaderPublication | null>(null);
  const [publish] = useState<Publish>(() => ({
    publish: setPublication,
    clear: (market) => setPublication((prev) => (prev?.market === market ? null : prev)),
  }));

  return (
    <PublishContext.Provider value={publish}>
      <PublicationContext.Provider value={publication}>{children}</PublicationContext.Provider>
    </PublishContext.Provider>
  );
}

/**
 * Puts a market's figures and controls in the shell's header for as long as the caller is mounted,
 * and takes them down when it unmounts, so the header is never left showing a market that is no
 * longer on screen. A layout effect, so the header never paints a frame behind the panels.
 * Outside the shell (a fixture rendered on its own) it does nothing.
 */
export function usePublishTerminalHeader(publication: TerminalHeaderPublication) {
  const slot = useContext(PublishContext);
  const { market } = publication;

  useLayoutEffect(() => {
    slot?.publish(publication);
  }, [slot, publication]);

  useLayoutEffect(() => {
    return () => slot?.clear(market);
  }, [slot, market]);
}

/** The current publication, for the header alone. */
export function useTerminalHeaderPublication() {
  return useContext(PublicationContext);
}
