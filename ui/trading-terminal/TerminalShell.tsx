"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import type { TerminalMarketId } from "@/lib/market-overview.types";
import { marketIdForSlug } from "@/lib/market-routes";
import { TerminalHeaderBar } from "@/ui/trading-terminal/TerminalHeaderBar";
import {
  TerminalHeaderSlotProvider,
  useTerminalHeaderPublication,
} from "@/ui/trading-terminal/TerminalHeaderSlot";
import { TerminalSessionProvider } from "@/ui/trading-terminal/TerminalSession";

/**
 * The part of the terminal that outlives a market switch: the frame, the header (branding, the
 * market selector, the wallet button) and the session behind them. Rendered by the `/trade`
 * layout, above the `[market]` segment, so Next keeps it mounted while the market's panels under
 * it are swapped; a layout inside the segment would remount with the slug.
 *
 * `market` is read from the segment. A fixture rendered outside `/trade` names it instead.
 */
export function TerminalShell({
  children,
  market: marketOverride,
}: {
  children: ReactNode;
  market?: TerminalMarketId;
}) {
  const segment = useSelectedLayoutSegment();
  const market = marketOverride ?? marketIdForSlug(segment) ?? "spot";

  return (
    <TerminalHeaderSlotProvider>
      <TerminalSessionProvider>
        <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground transition-colors duration-300 md:h-dvh md:overflow-hidden">
          <ShellHeader market={market} />
          {children}
        </main>
      </TerminalSessionProvider>
    </TerminalHeaderSlotProvider>
  );
}

/**
 * Its own component so a publication re-renders the header alone. The figures shown are only
 * ever the selected market's: another market's publication (its panels still unmounting, or a
 * stale one) reads as "not published yet", and the header shows its skeleton instead.
 */
function ShellHeader({ market }: { market: TerminalMarketId }) {
  const publication = useTerminalHeaderPublication();
  return (
    <TerminalHeaderBar
      market={market}
      publication={publication?.market === market ? publication : null}
    />
  );
}
