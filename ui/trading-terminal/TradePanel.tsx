import { ChevronDown, Info } from "lucide-react";
import { CONTRACT_DETAILS, POSITION_OVERVIEW } from "@/lib/mock-trading-data";
import { cn } from "@/lib/cn";

function SegmentedRow({
  items,
  selected,
}: {
  items: string[];
  selected: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-sm bg-[#151B23] p-1">
      {items.map((item) => (
        <button
          className={cn(
            "rounded-sm p-2 font-medium text-[#6B7280] text-xs transition-colors",
            item === selected && "bg-[#11161D] text-[#D1D5DB]",
          )}
          key={item}
          type="button"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function LabelValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[#6B7280]">{label}</span>
      <span className={cn("font-medium text-[#D1D5DB]", value.startsWith("+$") && "text-[#16A34A]")}>{value}</span>
    </div>
  );
}

export function TradePanel() {
  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-md border border-[#1B2430] bg-[#11161D] xl:min-h-0">
      <div className="space-y-2.5 overflow-y-auto p-3">
        <SegmentedRow items={["Outright", "Physical", "CLOB"]} selected="Outright" />

        <div className="grid grid-cols-3 gap-1 rounded-sm bg-[#151B23] p-1">
          {["Market", "Limit", "Stop"].map((tab) => (
            <button
              className={cn(
                "rounded-sm p-2 font-medium text-xs transition-colors",
                tab === "Market" ? "bg-[#11161D] text-[#D1D5DB]" : "text-[#6B7280]",
              )}
              key={tab}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-sm bg-[#151B23] p-1">
          <button className="rounded-sm bg-[#14532d] p-2.5 text-left text-sm" type="button">
            <span className="block font-semibold text-[#DCFCE7]">Buy USD</span>
            <span className="mt-1 block text-[#86EFAC] text-xs">Long USD / Short NGN</span>
          </button>
          <button className="rounded-sm bg-[#7F1D1D] p-2.5 text-left text-sm" type="button">
            <span className="block font-semibold text-[#FEE2E2]">Sell USD</span>
            <span className="mt-1 block text-[#FCA5A5] text-xs">Short USD / Long NGN</span>
          </button>
        </div>

        <div className="space-y-1.5 rounded-sm border border-[#1B2430] bg-[#151B23] p-2.5">
          <LabelValueRow label="Available to Deliver" value="250,000 USDC" />
          <LabelValueRow label="Settlement Wallet" value="USDC / cNGN" />
        </div>

        <div className="space-y-2">
          <label className="text-[#6B7280] text-[11px] uppercase tracking-[0.14em]" htmlFor="trade-size">
            Size
          </label>
          <div className="flex items-center overflow-hidden rounded-sm border border-[#1B2430] bg-[#151B23]">
            <input
              className="h-11 flex-1 bg-transparent px-3 text-[#D1D5DB] text-sm outline-none placeholder:text-[#6B7280]"
              id="trade-size"
              placeholder="50,000"
              readOnly
              value=""
            />
            <button
              className="flex h-11 items-center gap-1 border-[#1B2430] border-l px-3 text-[#D1D5DB] text-sm"
              type="button"
            >
              USD
              <ChevronDown className="size-4 text-[#6B7280]" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative h-1.5 flex-1 rounded-full bg-[#1F2937]">
              <div className="absolute top-0 left-0 h-1.5 w-[20%] rounded-full bg-[#3B82F6]" />
              <div className="-translate-1/2 absolute top-1/2 left-[20%] size-3 rounded-full border border-[#60A5FA] bg-[#11161D]" />
            </div>
            <div className="rounded-sm border border-[#1B2430] bg-[#151B23] px-2 py-1 text-[#D1D5DB] text-xs">
              20 %
            </div>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          {["Post Only", "At Expiry Deliver"].map((option) => (
            <div className="flex items-center justify-between gap-3" key={option}>
              <span className="text-[#D1D5DB]">{option}</span>
              <button
                aria-label={option}
                className="flex size-4 items-center justify-center rounded-sm border border-[#1B2430] bg-[#151B23]"
                type="button"
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5 rounded-sm border border-[#1B2430] bg-[#151B23] p-2.5">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Position Summary</div>
          {POSITION_OVERVIEW.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>

        <div className="space-y-1.5 rounded-sm border border-[#1B2430] bg-[#151B23] p-2.5">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Order Economics</div>
          <LabelValueRow label="Order Value" value="$80,262,500 NGN" />
          <LabelValueRow label="Initial Margin" value="$4,012" />
          <LabelValueRow label="Fees" value="0.0200% / 0.0100%" />
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1 text-[#6B7280]">
              Slippage
              <Info className="size-3" />
            </span>
            <span className="font-medium text-[#D1D5DB]">Est: 0.01% / Max: 0.25%</span>
          </div>
        </div>

        <div className="space-y-1.5 rounded-sm border border-[#1B2430] bg-[#151B23] p-2.5">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Delivery Terms</div>
          {CONTRACT_DETAILS.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>

        <button
          className="flex h-10 w-full items-center justify-center rounded-sm border border-[#14532D] bg-[#14532D]/20 font-medium text-[#86EFAC] text-sm transition-colors hover:bg-[#14532D]/30"
          type="button"
        >
          Buy USD
        </button>

        <button
          className="flex h-10 w-full items-center justify-center rounded-sm border border-[#7F1D1D] bg-[#7F1D1D]/20 font-medium text-[#FCA5A5] text-sm transition-colors hover:bg-[#7F1D1D]/30"
          type="button"
        >
          Sell USD
        </button>
        <button
          className="flex h-10 w-full items-center justify-center rounded-sm border border-[#1B2430] bg-[#151B23] font-medium text-[#D1D5DB] text-sm transition-colors hover:border-[#374151] hover:bg-[#1A212C]"
          type="button"
        >
          Deposit Settlement Assets
        </button>
      </div>
    </section>
  );
}
