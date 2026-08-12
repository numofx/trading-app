"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { PrivyWalletButton } from "@/ui/PrivyWalletButton";
import { SmartImage } from "@/ui/SmartImage";

export function TradingMarketHeader({ depositControl }: { depositControl?: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const isLight = document.documentElement.classList.contains("light");
    setTheme(isLight ? "light" : "dark");
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    if (nextTheme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    }
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  };

  return (
    <header className="rounded-[26px] bg-panel-bg px-4 py-3 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SmartImage<string>
          alt="Numo"
          className="h-7 w-24 shrink-0 sm:h-8 sm:w-32"
          imgClassName="object-left"
          priority
          src={theme === "light" ? "/numo_logo_black.png" : "/numo_logo_white.png"}
        />

        <div className="flex items-center gap-3">
          {depositControl}
          <button
            aria-label="Toggle theme"
            className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-panel-border bg-input-bg text-panel-text-active transition-all duration-300 hover:bg-input-hover"
            onClick={toggleTheme}
            type="button"
          >
            {theme === "light" ? <Moon className="size-5" /> : <Sun className="size-5" />}
          </button>
          <PrivyWalletButton />
        </div>
      </div>
    </header>
  );
}
