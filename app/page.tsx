import { BottomTabs } from "@/ui/trading-terminal/BottomTabs";
import { ChartPanel } from "@/ui/trading-terminal/ChartPanel";
import { MarketHeader } from "@/ui/trading-terminal/MarketHeader";
import { OrderBook } from "@/ui/trading-terminal/OrderBook";
import { TradePanel } from "@/ui/trading-terminal/TradePanel";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0B0F14] text-[#D1D5DB] xl:h-screen xl:overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col p-2 xl:h-screen xl:overflow-hidden">
        <MarketHeader />

        <section className="mt-2 grid flex-1 grid-cols-1 gap-2 xl:min-h-0 xl:grid-cols-[minmax(0,64fr)_minmax(300px,20fr)_minmax(360px,20fr)] xl:overflow-hidden">
          <div className="min-h-[540px] xl:min-h-0 xl:overflow-hidden">
            <ChartPanel />
          </div>

          <div className="min-h-[420px] xl:min-h-0 xl:overflow-hidden">
            <OrderBook />
          </div>

          <div className="min-h-[420px] xl:min-h-0 xl:overflow-hidden">
            <TradePanel />
          </div>
        </section>

        <div className="mt-2 xl:shrink-0">
          <BottomTabs />
        </div>
      </div>
    </main>
  );
}
