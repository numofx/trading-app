"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { TOKEN_ICONS } from "@/lib/token-icons";
import { SmartImage } from "@/ui/SmartImage";

export type TokenSymbol = "cNGN" | "USDC";

/** A token mark and ticker, set beside the input it denominates. */
export function TokenUnit({ symbol }: { symbol: TokenSymbol }) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-semibold text-[12px] text-panel-text-active">
      <SmartImage<string>
        alt={symbol}
        className="size-4 animate-none rounded-full"
        src={TOKEN_ICONS[symbol]}
      />
      {symbol}
    </span>
  );
}

/**
 * The unit an input is counted in, chosen from a menu. An option can be offered but disabled with
 * a reason, for a unit the ticket cannot convert to yet.
 */
export function TokenUnitSelect({
  disabledReason,
  label,
  onSelect,
  options,
  selected,
}: {
  /** Why an option is disabled, keyed by symbol; an option without an entry is enabled. */
  disabledReason?: Partial<Record<TokenSymbol, string>>;
  label: string;
  onSelect: (symbol: TokenSymbol) => void;
  options: readonly TokenSymbol[];
  selected: TokenSymbol;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="flex shrink-0 cursor-pointer items-center gap-1 border border-panel-border bg-input-bg py-0.5 pr-1 pl-1.5 font-semibold text-[12px] text-panel-text-active transition-colors hover:bg-input-hover"
      >
        <SmartImage<string>
          alt={selected}
          className="size-4 animate-none rounded-full"
          src={TOKEN_ICONS[selected]}
        />
        {selected}
        <ChevronDown aria-hidden className="size-3 shrink-0 text-panel-text-muted" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6}>
          <Menu.Popup className="z-50 min-w-(--anchor-width) overflow-hidden rounded-lg border border-panel-border bg-panel-bg-darker p-1 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
            {options.map((option) => {
              const reason = disabledReason?.[option];
              return (
                <Menu.Item
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 font-semibold text-[12px] outline-none transition-colors data-disabled:cursor-not-allowed data-highlighted:bg-input-hover data-disabled:opacity-50",
                    option === selected ? "text-panel-text-active" : "text-panel-text-muted"
                  )}
                  disabled={reason !== undefined}
                  key={option}
                  onClick={() => onSelect(option)}
                  title={reason}
                >
                  <SmartImage<string>
                    alt={option}
                    className="size-4 animate-none rounded-full"
                    src={TOKEN_ICONS[option]}
                  />
                  {option}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
