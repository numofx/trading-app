import { WalletMenuFixture } from "./WalletMenuFixture";

/**
 * The connected wallet menu, open, for a made-up wallet: the app only reaches this state with a
 * real Privy session. Every value is a fixture; the route group's layout 404s it in production.
 */
export default function WalletMenuFixturePage() {
  return <WalletMenuFixture />;
}
