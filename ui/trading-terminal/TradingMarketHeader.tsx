"use client";

import { PrivyWalletButton } from "@/ui/PrivyWalletButton";
import { SmartImage } from "@/ui/SmartImage";

export function TradingMarketHeader() {
  return (
    <header className="rounded-[26px] bg-black px-4 py-3 shadow-[0_24px_80px_rgba(0,0,0,0.32)] ring-1 ring-white/8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SmartImage<string>
          alt="Numo"
          className="h-7 w-24 shrink-0 sm:h-8 sm:w-32"
          imgClassName="object-left"
          priority
          src="/numo_logo_white.png"
        />

        <PrivyWalletButton />
      </div>
    </header>
  );
}
