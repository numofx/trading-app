import { cn } from "@/lib/cn";
import type { MarketType } from "@/lib/trading.types";

const TYPE_BADGE_LABELS = {
  future: "FUT",
  option: "OPT",
  perp: "PERP",
  spot: "SPOT",
} satisfies Record<MarketType, string>;

const TYPE_BADGE_STYLES = {
  future: "bg-violet-950/70 text-violet-200 ring-1 ring-violet-800/70",
  option: "bg-orange-950/70 text-orange-200 ring-1 ring-orange-800/70",
  perp: "bg-blue-950/70 text-blue-200 ring-1 ring-blue-800/70",
  spot: "bg-neutral-800 text-neutral-300 ring-1 ring-neutral-700",
} satisfies Record<MarketType, string>;

export function TypeBadge({ type }: { type: MarketType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-[0.12em]",
        TYPE_BADGE_STYLES[type],
      )}
    >
      {TYPE_BADGE_LABELS[type]}
    </span>
  );
}
