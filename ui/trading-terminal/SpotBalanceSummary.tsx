"use client";

import { SmartImage } from "@/ui/SmartImage";

function BalanceChip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <SmartImage<string>
        alt={label}
        className="size-4 shrink-0 animate-none rounded-full"
        src={icon}
      />
      <span className="truncate font-medium text-panel-text">{value}</span>
    </span>
  );
}

export function SpotBalanceSummary({
  cngnBalanceLabel,
  marginRatioPercent,
  usdcBalanceLabel,
}: {
  cngnBalanceLabel: string;
  marginRatioPercent: number;
  usdcBalanceLabel: string;
}) {
  const clampedRatio = Math.min(Math.max(marginRatioPercent, 0), 100);

  return (
    // A single strip rather than a stacked card: this sits directly under the
    // order ticket and every row it costs is a row the ticket cannot use.
    <section className="flex shrink-0 items-center justify-between gap-3 rounded-[20px] bg-panel-bg-muted px-3 py-2.5 ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex min-w-0 items-center gap-2">
        {/*
         * Named, because the order ticket above shows the *wallet* balance against the same two
         * tokens. Without a label the two strips read as one number disagreeing with itself —
         * a funded trading account can sit above a wallet showing 0 USDC, which is the normal
         * state once collateral has been deposited.
         */}
        <span className="shrink-0 text-[11px] text-panel-text-muted">Account</span>
        <div className="flex min-w-0 items-center gap-3">
          <BalanceChip icon="/tokens/usdc.svg" label="USDC" value={usdcBalanceLabel} />
          <BalanceChip icon="/tokens/cngn.svg" label="cNGN" value={cngnBalanceLabel} />
        </div>
      </div>

      <span className="shrink-0 text-[11px] text-panel-text-muted">
        Margin <span className="font-medium text-panel-text">{clampedRatio.toFixed(1)}%</span>
      </span>
    </section>
  );
}
