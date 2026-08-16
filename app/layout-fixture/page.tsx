import { notFound } from "next/navigation";
import { LayoutFixtureTerminal } from "./LayoutFixtureTerminal";

/**
 * A connected, funded terminal for `scripts/check-layout.mjs`.
 *
 * The signed-out page the check already drives cannot show the header's balance pair or the
 * ticket's shortfall CTA — both need an account — so the invariants that matter most to a funded
 * trader on a phone had no coverage at all. This route supplies that state without a wallet.
 *
 * Not a preview of the market: every figure on it is a fixture, which is exactly why it must never
 * be reachable in production. It 404s there.
 */
export default function LayoutFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <LayoutFixtureTerminal />;
}
