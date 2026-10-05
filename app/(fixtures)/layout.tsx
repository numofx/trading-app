import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Every route in this group is a fixture: a terminal rendered from made-up figures for
 * `scripts/check-layout.mjs` and for eyeballing states the app only reaches with a real wallet.
 * None of it may be reachable in production, so the gate lives here rather than in each page.
 *
 * Rendered per request, not prerendered: a prerendered fixture ran `notFound()` at build time and
 * then served the 404 page's body with HTTP 200. Dynamic rendering makes the status a real 404.
 *
 * This group deliberately has no `loading.tsx`. The terminal routes' loading boundary streams the
 * page in a hidden segment that a swap script moves into place; a fixture has no server data to
 * wait on, so React resolved the boundary from the RSC payload first and the swap left a second,
 * unhydrated copy of the page in the body with every id duplicated.
 */
export const dynamic = "force-dynamic";

export default function FixturesLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return children;
}
