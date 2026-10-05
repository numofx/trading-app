import { PerpLayoutFixture } from "../PerpLayoutFixture";

/**
 * The perp ticket in a connected, funded state, with a position open, for eyeballing the ticket
 * column the way a trader sees it. The app itself only reaches this state with a real wallet and
 * a real perp account. Every figure is a fixture; the route group's layout 404s it in production.
 */
export default function PerpLayoutFixturePage() {
  return <PerpLayoutFixture />;
}
