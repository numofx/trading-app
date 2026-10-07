"use client";

import type { ReactNode } from "react";
import { PanelTitle } from "@/ui/trading-terminal/PanelTabs";

/**
 * The ticket's frame, shared by spot and the perp: a panel label that only shows beside sibling
 * panels, the fields, and a footer pinned to the bottom of the column so the submit button never
 * leaves the viewport.
 *
 * `min-h-fit` is what keeps the fields on screen: the ticket shares its column with a summary
 * beneath it, and as a plain flex child it gave up whatever height the summary took. On a 700px
 * window that left the fields a ~20px sliver behind an inner scrollbar. Refusing to shrink below
 * its own content makes the *column* scroll instead. It does not grow either: stretched to the
 * column, the slack opened up as a blank band between the last field and the summary.
 */
export function OrderFormShell({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <section className="flex flex-col overflow-clip bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 md:min-h-fit">
      {/*
       * The panel label only earns its space next to sibling panels. In the stacked sub-md layout
       * this is the only form on screen, so the row is dropped there to keep the submit button
       * within the first screenful.
       */}
      <PanelTitle className="hidden md:block">Order form</PanelTitle>

      {/* No scroller of its own: the column is the one scroll region, so a squeezed ticket scrolls
          the whole column rather than hiding fields inside an unmarked box. */}
      <div className="space-y-1.5 px-3 py-1.5">{children}</div>

      {/*
       * Summary and the submit CTA stay pinned so the primary action is never scrolled out of
       * reach: sticky to the column's scrollport, so on a viewport too short for the whole ticket
       * the CTA rides at the bottom of the column instead of sitting below the fold.
       */}
      <div className="shrink-0 space-y-2 border-panel-border border-t bg-panel-bg-muted px-3 pt-1.5 pb-2 md:sticky md:bottom-0 md:z-10">
        {footer}
      </div>
    </section>
  );
}
