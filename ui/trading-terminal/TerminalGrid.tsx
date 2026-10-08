import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

/*
 * One grid, two rows: the chart and order book take the top row, the activity panel spans the
 * bottom row beneath them, and the ticket column runs the full height alongside both. The ticket
 * used to be boxed into the top row's height, which cut its Amount field off mid-box on the
 * ~700-900px viewports most of this app's desktop traffic uses.
 *
 * Three layouts, because one breakpoint cannot serve a 700px window and a 1600px one:
 *
 *   <768px   one column, ticket first — a phone.
 *   768px+   two columns: chart over book on the left, ticket beside them. The page scrolls
 *            rather than being pinned to the viewport; at this width three panels stacked into a
 *            fixed height leaves each one a sliver.
 *   1024px+  the fixed-height terminal: chart | book | ticket, activity spanning beneath.
 *
 * Gated at `xl` alone, the whole terminal stacked on any window under 1280px — a browser window a
 * little under half a 27" screen got a single column with the ticket on top, while the venues it
 * is compared against still had their columns. The two fixed columns and gutters cost 646px, so
 * 1024px still leaves the chart ~378px; below that the second column has to give way, which is
 * what the 768px layout is for.
 *
 * The bottom row takes 3/10 rather than 2/10: at 2/10 the activity panel was a ~144px sliver whose
 * own empty state ran past its bottom edge, so it read as a strip of tab labels rather than a
 * panel holding anything.
 */
const FRAME_CLASS = "flex min-w-0 flex-1 flex-col gap-3 p-3 md:min-h-0 md:overflow-hidden md:px-4";
const GRID_CLASS =
  "grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,3fr)] md:overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_270px_320px] lg:grid-rows-[minmax(0,7fr)_minmax(0,3fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]";
const CHART_CELL = "md:col-start-1 md:row-start-1 md:min-h-0 md:overflow-hidden lg:row-start-1";
const BOOK_CELL =
  "md:col-start-1 md:row-start-2 md:min-h-0 md:overflow-hidden lg:col-start-2 lg:row-start-1";
/*
 * `order-first` below the grid breakpoint only: in the stacked single column the ticket would sit
 * below the chart and order book, putting the submit button ~2.5 screens down the document. The
 * lg grid places columns explicitly, so order resets there.
 */
const TICKET_CELL =
  "order-first flex min-h-[420px] flex-col gap-3 md:order-0 md:col-start-2 md:row-span-3 md:row-start-1 md:min-h-0 md:gap-2 md:overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1";
const ACTIVITY_CELL =
  "min-h-[200px] md:col-start-1 md:row-start-3 md:min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2";

/** The panels of one market on the terminal's grid, the same for spot and the perp. */
export function TerminalGrid({
  activity,
  book,
  chart,
  ticketColumn,
  ticketColumnRef,
}: {
  activity: ReactNode;
  book: ReactNode;
  chart: ReactNode;
  /** The ticket and, under it, the account summary; the column scrolls on its own below `lg`. */
  ticketColumn: ReactNode;
  ticketColumnRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className={FRAME_CLASS}>
      <div className={GRID_CLASS}>
        <div className={CHART_CELL}>{chart}</div>
        <div className={BOOK_CELL}>{book}</div>
        <div className={TICKET_CELL} ref={ticketColumnRef}>
          {ticketColumn}
        </div>
        <div className={ACTIVITY_CELL}>{activity}</div>
      </div>
    </div>
  );
}

/** A panel's frame with nothing in it; the pulse says the content is on its way, not missing. */
function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-full min-h-[200px] animate-pulse bg-panel-bg-muted ring-1 ring-panel-ring md:min-h-0",
        className
      )}
    />
  );
}

/**
 * Shown under the shell while a market's panels render, so a switch responds on the click rather
 * than leaving the previous market on screen until the venue's data arrives. It holds no figures —
 * only the panel frames, on the grid above, so the page does not shift when it resolves.
 */
export function TerminalGridSkeleton() {
  return (
    <div aria-busy="true" className={FRAME_CLASS}>
      <div className={GRID_CLASS}>
        <SkeletonPanel className={CHART_CELL} />
        <SkeletonPanel className={BOOK_CELL} />
        <SkeletonPanel className={cn(TICKET_CELL, "min-h-[420px]")} />
        <SkeletonPanel className={ACTIVITY_CELL} />
      </div>
    </div>
  );
}
