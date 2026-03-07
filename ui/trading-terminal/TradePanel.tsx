import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { CONTRACT_DETAILS, POSITION_OVERVIEW } from "@/lib/mock-trading-data";

function LabelValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[#6B7280]">{label}</span>
      <span
        className={cn(
          "font-medium text-[#D1D5DB]",
          value.startsWith("+$") && "text-[#8CC9A3]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function TradePanel() {
  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-md border border-[#1B2430] bg-[#0F1720] xl:min-h-0">
      <div className="space-y-2 overflow-hidden p-2.5 text-[11px]">
        <div className="grid grid-cols-3 gap-1 rounded-sm bg-[#11161D] p-1">
          {["Market", "Limit", "Stop"].map((tab) => (
            <button
              className={cn(
                "rounded-sm px-2 py-1.5 font-medium text-[11px] transition-colors",
                tab === "Market" ? "bg-[#151B23] text-[#D1D5DB]" : "text-[#6B7280]",
              )}
              key={tab}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button className="rounded-sm bg-[#123524] px-3 py-2 text-left" type="button">
            <span className="block font-semibold text-[#D1FAE5] text-sm">Buy USD</span>
            <span className="mt-0.5 block text-[#8CC9A3] text-[11px]">Long USD / Short NGN</span>
          </button>
          <button className="rounded-sm bg-[#4D1717] px-3 py-2 text-left" type="button">
            <span className="block font-semibold text-[#FDE2E2] text-sm">Sell USD</span>
            <span className="mt-0.5 block text-[#D59C9C] text-[11px]">Short USD / Long NGN</span>
          </button>
        </div>

        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <LabelValueRow label="Available to Deliver" value="250,000 USDC" />
          <LabelValueRow label="Settlement Wallet" value="USDC / cNGN" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]" htmlFor="trade-size">
            Size
          </label>
          <div className="flex items-center overflow-hidden rounded-sm border border-[#1B2430] bg-[#11161D]">
            <input
              className="h-10 flex-1 bg-transparent px-3 text-[#D1D5DB] text-sm outline-none placeholder:text-[#6B7280]"
              id="trade-size"
              placeholder="50,000"
              readOnly
              value=""
            />
            <button
              className="flex h-10 items-center gap-1 border-[#1B2430] border-l px-3 text-[#D1D5DB] text-sm"
              type="button"
            >
              USD
              <ChevronDown className="size-4 text-[#6B7280]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative h-1.5 flex-1 rounded-full bg-[#1F2937]">
              <div className="absolute top-0 left-0 h-1.5 w-[20%] rounded-full bg-[#3B82F6]" />
              <div className="-translate-1/2 absolute top-1/2 left-[20%] size-3 rounded-full border border-[#60A5FA] bg-[#0F1720]" />
            </div>
            <div className="rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 text-[#D1D5DB] text-[11px]">
              20 %
            </div>
          </div>
        </div>

        <div className="space-y-1.5 text-[11px]">
          {["Post Only", "At Expiry Deliver"].map((option) => (
            <div className="flex items-center justify-between gap-3" key={option}>
              <span className="text-[#D1D5DB]">{option}</span>
              <button
                aria-label={option}
                className="flex size-4 items-center justify-center rounded-sm border border-[#1B2430] bg-[#11161D]"
                type="button"
              />
            </div>
          ))}
        </div>

        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Position Summary</div>
          {POSITION_OVERVIEW.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>

        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Order Economics</div>
          <LabelValueRow label="Order Value" value="$80,262,500 NGN" />
          <LabelValueRow label="Initial Margin" value="$4,012" />
          <LabelValueRow label="Fees" value="0.0200% / 0.0100%" />
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 text-[#6B7280]">
              Slippage
              <Info className="size-3" />
            </span>
            <span className="font-medium text-[#D1D5DB]">Est: 0.01% / Max: 0.25%</span>
          </div>
        </div>

        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Delivery Terms</div>
          {CONTRACT_DETAILS.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </div>
    </section>
  );
}
