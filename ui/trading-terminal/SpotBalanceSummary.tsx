"use client";

import { SmartImage } from "@/ui/SmartImage";

function BalanceRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="flex items-center gap-2 text-panel-text-muted">
        <SmartImage<string> alt={label} className="size-4.5 animate-none rounded-full" src={icon} />
        {label}
      </span>
      <span className="font-medium text-panel-text">{value}</span>
    </div>
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
    <section className="shrink-0 rounded-[20px] bg-panel-bg-muted p-3 ring-1 ring-panel-ring transition-colors duration-300">
      <div className="font-medium text-[11px] text-panel-text-active">Balance summary</div>

      <div className="mt-3 space-y-2.5">
        <BalanceRow icon="/tokens/usdc.svg" label="USDC" value={usdcBalanceLabel} />
        <BalanceRow icon="/tokens/cngn.svg" label="cNGN" value={cngnBalanceLabel} />
      </div>

      <div className="mt-3 border-panel-border border-t pt-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-panel-text-muted">Margin ratio</span>
          <span className="font-medium text-panel-text">{clampedRatio.toFixed(1)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-input-bg">
          <div className="h-full rounded-full bg-spread-percent" style={{ width: `${clampedRatio}%` }} />
        </div>
        <p className="mt-2 text-[10px] text-panel-text-muted">
          {clampedRatio === 0 ? "No margin in use — spot balances are fully available." : "Margin used by open derivatives positions."}
        </p>
      </div>
    </section>
  );
}
