import { cn } from "@/lib/cn";

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
 * Shown while a terminal route renders, so a market switch responds on the click rather than
 * leaving the previous terminal on screen until the venue's data arrives. It holds no figures —
 * only the panel frames, on the terminals' own grid, so the page does not shift when it resolves.
 */
export function TerminalSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading market"
      className="flex min-h-screen flex-col bg-terminal-bg text-foreground md:h-dvh md:overflow-hidden"
    >
      <div className="flex min-h-16 shrink-0 items-center gap-3 border-panel-border border-b px-4 py-3">
        <div className="h-7 w-24 animate-pulse rounded-sm bg-input-bg" />
        <div className="w-px self-stretch bg-panel-border" />
        <div className="h-9 w-40 animate-pulse rounded-full bg-input-bg" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:min-h-0 md:overflow-hidden md:px-4">
        <div className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,3fr)] md:overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_270px_320px] lg:grid-rows-[minmax(0,7fr)_minmax(0,3fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
          <SkeletonPanel className="md:col-start-1 md:row-start-1 lg:row-start-1" />
          <SkeletonPanel className="md:col-start-1 md:row-start-2 lg:col-start-2 lg:row-start-1" />
          <SkeletonPanel className="order-first min-h-[420px] md:order-0 md:col-start-2 md:row-span-3 md:row-start-1 lg:col-start-3 lg:row-span-2 lg:row-start-1" />
          <SkeletonPanel className="md:col-start-1 md:row-start-3 lg:col-span-2 lg:col-start-1 lg:row-start-2" />
        </div>
      </div>
    </main>
  );
}
