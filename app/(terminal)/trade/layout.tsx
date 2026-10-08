import type { ReactNode } from "react";
import { TerminalShell } from "@/ui/trading-terminal/TerminalShell";

/**
 * The shell every market renders under: header, wallet, trading account, market selector. A
 * layout, so Next keeps it mounted across `/trade/<slug>` navigations and only the page below it
 * (the market's panels) is replaced.
 */
export default function TradeLayout({ children }: { children: ReactNode }) {
  return <TerminalShell>{children}</TerminalShell>;
}
