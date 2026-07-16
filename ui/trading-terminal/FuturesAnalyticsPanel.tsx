import type { DeliveryTerm } from "@/lib/trading.types";

function AnalyticsRow({ label, value }: DeliveryTerm) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-panel-text-muted">{label}</span>
      <span className="text-right font-medium text-panel-text">{value}</span>
    </div>
  );
}

export function FuturesAnalyticsPanel({
  contractDetails,
  marketStats,
  positionOverview,
}: {
  contractDetails: DeliveryTerm[];
  marketStats: DeliveryTerm[];
  positionOverview: DeliveryTerm[];
}) {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-[28px] bg-panel-bg/72 p-4 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="space-y-2.5">
        <div className="text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">Market Analytics</div>
        <div className="space-y-2 rounded-[18px] bg-input-bg p-3">
          {marketStats.map((item) => (
            <AnalyticsRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </div>

      <div className="space-y-2.5 border-panel-border border-t pt-3.5">
        <div className="text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">Position Overview</div>
        <div className="space-y-2 rounded-[18px] bg-input-bg p-3">
          {positionOverview.map((item) => (
            <AnalyticsRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </div>

      <div className="space-y-2.5 border-panel-border border-t pt-3.5">
        <div className="text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">Contract Details</div>
        <div className="space-y-2">
          {contractDetails.map((item) => (
            <AnalyticsRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </div>
    </section>
  );
}
