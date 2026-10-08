"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { WalletMenu } from "@/ui/PrivyWalletButton";

/** A purple square, standing in for the logo an injected wallet announces as a data URI. */
const FIXTURE_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNiIgZmlsbD0iIzhiNWNmNiIvPjwvc3ZnPg==";

/**
 * Only what the menu reads from a connected wallet. Not a working wallet: nothing here signs.
 */
const FIXTURE_WALLET = {
  address: "0xeaBc4F2b9A8c3d1E0f7B6a5C4d3E2f1A0b9CbFcA",
  meta: { icon: FIXTURE_ICON, id: "fixture", name: "Fixture Wallet" },
} as unknown as ConnectedWallet;

export function WalletMenuFixture() {
  return (
    <main className="flex min-h-screen justify-end bg-terminal-bg p-6 text-foreground">
      <WalletMenu defaultOpen onSignOut={() => undefined} wallet={FIXTURE_WALLET} />
    </main>
  );
}
