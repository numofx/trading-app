"use client";

import { Menu } from "@base-ui/react/menu";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useLogin, useLogout, usePrivy } from "@privy-io/react-auth";
import { Duration } from "effect";
import { Check, Copy, LogOut, MessagesSquare, Wallet } from "lucide-react";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { formatAddressShort } from "@/lib/address-display";
import { getAppChain } from "@/lib/base-public-client";
import { cn } from "@/lib/cn";
import { getExplorerAddressUrl } from "@/lib/explorer-links";
import { SmartImage } from "@/ui/SmartImage";
import { usePrimaryWallet } from "@/ui/usePrimaryWallet";

/**
 * The community invite the menu's Join Discord item opens. Unset, the item is left out rather than
 * linking nowhere.
 */
const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL?.trim() || null;

/** How long the copy control shows its tick after the address is copied. */
const COPIED_FOR_MS = Duration.toMillis("1500 millis");

/** A row of the menu: icon, then label. */
const MENU_ITEM_CLASSNAME =
  "flex cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-[14px] text-panel-text-active outline-none transition-colors data-highlighted:bg-input-bg";

/** A square icon control in the menu's address row. */
const ICON_ITEM_CLASSNAME =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-panel-text-muted outline-none transition-colors data-highlighted:bg-input-bg data-highlighted:text-panel-text-active";

/** The shared pill shape, so the connected menu trigger and the connect button stay identical. */
const WALLET_PILL_CLASSNAME =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm bg-[#9BDBF8] px-4 font-medium text-[#111111] text-[14px] outline-none ring-1 ring-black/10 transition-colors hover:bg-[#9BDBF8]/90";

export function PrivyWalletButton() {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  if (!privyAppId) {
    return (
      <button
        aria-disabled="true"
        className="inline-flex h-10 items-center gap-2 rounded-sm bg-white px-4 font-medium text-[#111111] text-[14px] ring-1 ring-black/10"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable wallet login"
        type="button"
      >
        <Wallet className="size-3.5" />
        <span>Wallet Unconfigured</span>
      </button>
    );
  }

  return <PrivyWalletButtonInner />;
}

/** The connected wallet's own logo, if it supplies one inline; null to use the wallet glyph. */
function inlineWalletIcon(wallet: ConnectedWallet | null): string | null {
  const icon = wallet?.meta?.icon;
  // Only an inline image: a remote URL would reach out to wherever the wallet points, from the
  // trading page. Injected wallets (Phantom, MetaMask) announce theirs as a data URI.
  return icon?.startsWith("data:image/") ? icon : null;
}

/**
 * The connected wallet's own logo, else the wallet glyph. `tile` sets it on the menu's square
 * tile; bare, it sits in the pill beside the address.
 */
function WalletMark({ tile = false, wallet }: { tile?: boolean; wallet: ConnectedWallet | null }) {
  const icon = inlineWalletIcon(wallet);
  const mark =
    icon === null ? (
      <Wallet aria-hidden className="size-4 shrink-0" />
    ) : (
      <SmartImage<string>
        alt={wallet?.meta?.name ?? "Wallet"}
        className={cn("shrink-0 animate-none rounded-sm", tile ? "size-5" : "size-4")}
        src={icon}
      />
    );
  if (!tile) {
    return mark;
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-input-bg text-panel-text-active">
      {mark}
    </span>
  );
}

function PrivyWalletButtonInner() {
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin({
    onComplete: ({ user, loginAccount }) => {
      const walletAddress =
        loginAccount && "address" in loginAccount ? (loginAccount.address as string) : null;
      const distinctId = walletAddress ?? user.id;
      posthog.identify(distinctId);
      posthog.capture("wallet_connected", {
        is_new_user: false,
        login_method: loginAccount?.type ?? null,
        privy_user_id: user.id,
        wallet_address_truncated: walletAddress
          ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
          : null,
      });
    },
    onError: (error) => {
      if (error === "exited_auth_flow") {
        return;
      }

      console.error("Privy login error", error);
    },
  });
  const { logout } = useLogout({
    onSuccess: () => {
      posthog.capture("wallet_disconnected");
      posthog.reset();
    },
  });
  // The same wallet the terminal acts as — not `wallets[0]`, whose order is not stable, and which let
  // the header show one address while orders and balances belonged to another.
  const { primaryWallet, walletsReady } = usePrimaryWallet();
  const isReady = ready && walletsReady;
  // Connected: the pill becomes the menu trigger. Disconnecting moved in here, so a stray click on
  // the address no longer drops the session — it opens the menu and asks which action was meant.
  if (isReady && authenticated) {
    return <WalletMenu onSignOut={() => void logout()} wallet={primaryWallet} />;
  }

  return (
    <button
      className={cn(WALLET_PILL_CLASSNAME, !isReady && "cursor-wait opacity-80")}
      onClick={() => {
        if (!isReady) {
          return;
        }

        login();
      }}
      type="button"
    >
      <Wallet className="size-4" />
      <span>{isReady ? "Connect Wallet" : "Loading Wallet"}</span>
    </button>
  );
}

/**
 * The connected wallet's menu, opened from the address pill: the wallet's mark, its address (to
 * the explorer) with copy and a one-tap sign out, then Sign Out, then Join Discord when an invite
 * is configured. Takes the wallet as a prop so a fixture can render it without a Privy session.
 */
export function WalletMenu({
  defaultOpen = false,
  onSignOut,
  wallet: primaryWallet,
}: {
  /** Open on first render; the fixture uses it to show the menu without a click. */
  defaultOpen?: boolean;
  onSignOut: () => void;
  wallet: ConnectedWallet | null;
}) {
  const walletAddress = primaryWallet?.address ? formatAddressShort(primaryWallet.address) : null;
  const explorerUrl = getExplorerAddressUrl(
    primaryWallet?.address,
    getAppChain().blockExplorers?.default.url
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /** Copies the full address, not the shortened one on screen. */
  async function copyAddress() {
    if (!primaryWallet?.address) {
      return;
    }
    try {
      await navigator.clipboard.writeText(primaryWallet.address);
      setCopied(true);
    } catch {
      // A browser that refuses clipboard access leaves the icon as it was; nothing to undo.
    }
  }

  return (
    <Menu.Root defaultOpen={defaultOpen}>
      <Menu.Trigger className={WALLET_PILL_CLASSNAME}>
        <WalletMark wallet={primaryWallet} />
        <span>{walletAddress ?? "Wallet Connected"}</span>
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8}>
          <Menu.Popup className="z-50 w-72 overflow-hidden rounded-sm border border-panel-border bg-panel-bg-darker p-1.5 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
            {/*
             * The wallet the app acts as: its mark, its address (to the explorer), copy, and a
             * one-tap sign out at the end of the row.
             */}
            <div className="flex items-center gap-2 px-1 pb-1.5">
              <WalletMark tile wallet={primaryWallet} />
              {explorerUrl === null ? (
                <span className="min-w-0 flex-1 truncate font-medium text-[14px] text-panel-text-active">
                  {walletAddress}
                </span>
              ) : (
                <Menu.Item
                  className="min-w-0 flex-1 cursor-pointer truncate rounded-sm p-1 font-medium text-[14px] text-panel-text-active underline underline-offset-4 outline-none data-highlighted:bg-input-bg"
                  render={
                    // biome-ignore lint/a11y/useAnchorContent: the item renders the address as the link's text.
                    <a href={explorerUrl} rel="noopener noreferrer" target="_blank" />
                  }
                  title="View on Basescan"
                >
                  {walletAddress}
                </Menu.Item>
              )}
              <Menu.Item
                aria-label={copied ? "Address copied" : "Copy address"}
                className={ICON_ITEM_CLASSNAME}
                closeOnClick={false}
                onClick={() => void copyAddress()}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Menu.Item>
              <Menu.Item aria-label="Sign out" className={ICON_ITEM_CLASSNAME} onClick={onSignOut}>
                <LogOut className="size-4" />
              </Menu.Item>
            </div>

            <Menu.Separator className="-mx-1.5 my-1 h-px bg-panel-border" />

            <Menu.Item className={MENU_ITEM_CLASSNAME} onClick={onSignOut}>
              <LogOut className="size-4" />
              <span>Sign Out</span>
            </Menu.Item>

            {DISCORD_URL === null ? null : (
              <>
                <Menu.Separator className="-mx-1.5 my-1 h-px bg-panel-border" />
                <Menu.Item
                  className={MENU_ITEM_CLASSNAME}
                  render={
                    // biome-ignore lint/a11y/useAnchorContent: the item renders the label as the link's text.
                    <a href={DISCORD_URL} rel="noopener noreferrer" target="_blank" />
                  }
                >
                  <MessagesSquare className="size-4" />
                  <span>Join Discord</span>
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
