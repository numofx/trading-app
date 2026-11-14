"use client";

import type { ReactNode } from "react";

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
export function OrderFormShell({
  children,
  footer,
  summary,
}: {
  children: ReactNode;
  /** The submit button and what belongs to it: pinned to the bottom of the column. */
  footer: ReactNode;
  /** The order's figures under the fields: they scroll with the fields. */
  summary: ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-clip bg-panel-bg-muted ring-2 ring-panel-ring transition-colors duration-300 md:min-h-fit">
      {/*
       * The panel label only earns its space next to sibling panels. In the stacked sub-md layout
       * this is the only form on screen, so the row is dropped there to keep the submit button
       * within the first screenful; on a short viewport (`short`, under 760px) it is dropped too,
       * since its 37px are what the column needs to hold the whole ticket with room to spare.
       */}
      {/* No scroller of its own: the column is the one scroll region, so a squeezed ticket scrolls
          the whole column rather than hiding fields inside an unmarked box. */}
      <div className="space-y-2 px-4 pt-2.5 pb-1.5">{children}</div>

      <div className="space-y-2 px-4 pt-1 pb-1.5">{summary}</div>

      {/*
       * Only the submit CTA is pinned, so the primary action is never scrolled out of reach: sticky
       * to the column's scrollport, it rides at the bottom of the column on a viewport too short
       * for the whole ticket. The summary used to be pinned with it, and on a short window its
       * rows covered the size slider and MAX rather than letting the column scroll to them.
       */}
      <div className="shrink-0 space-y-2 bg-panel-bg-muted px-4 pt-1.5 pb-3 md:sticky md:bottom-0 md:z-10">
        {footer}
      </div>
    </section>
  );
}
