---
name: verify
description: How to build, run, and drive this Next.js trading app to verify UI changes end-to-end.
---

# Verify trading-app changes

## Launch

```bash
na next dev --port 3111        # run in background; ready when /trade/cngn-usdc returns 200
```

`.env.local` points `MARKETS_SERVICE_URL` at the live venue, so every figure on screen is real;
there is no mock or preview data in the render path. Without the venue the panels render their
empty states, which is enough to check layout but not behaviour.

For redirect and status-code checks use a production build, since `next dev` differs on streaming:

```bash
bun run build && MARKETS_SERVICE_URL=https://api.numofx.com na next start --port 3111
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3111/perp
```

## Routes

Both markets render at `/trade/<slug>` under one shell (header, wallet, trading account, market
selector) that stays mounted across a switch; only the market's panels are replaced.

- `/trade/cngn-usdc` — spot. `/` redirects here (307).
- `/trade/cngn-perp` — the perp. `/perp` redirects here (307).
- Another casing of a slug is redirected to lowercase by `proxy.ts`; an unknown slug is a 404.
- `/layout-fixture` and `/layout-fixture/perp` — dev-only fixtures with made-up figures (404 in
  production), used by `scripts/check-layout.mjs`.

## Drive

Use `agent-browser` (already installed; the next-devtools MCP `browser_eval` tool just points you
at it):

```bash
agent-browser open http://localhost:3111/trade/cngn-usdc
agent-browser snapshot -i -c        # refs: the market pill, Deposit/Withdraw, the ticket inputs
agent-browser click @e1             # the market pill (first button); then re-snapshot
agent-browser eval "..."            # DOM reads; --stdin for multi-line scripts
agent-browser screenshot out.png
```

Switching markets: click the pill by its ref, then in the dialog click the `Spot` or `Perp` tab
(`[role=tab]`) and the row link (`[role=dialog] a[href="/trade/cngn-perp"]`); DOM `.click()` works
for both of those. Ticket inputs: `#spot-amount` on spot, `#perp-size` on the perp.

To check a switch keeps the shell: set a property on `document.querySelector("header")` before
the switch and read it back after. The node persisting means the `/trade` layout, and the session
provider above the header, never remounted. The header shows skeleton metrics (`[aria-busy]`
inside `header`) and no Deposit/Withdraw until the new market's panels publish their figures.

## Gotchas

- Base UI dialog and menu triggers: `agent-browser click @ref` opens them; a DOM `.click()` on
  the trigger does not, and dispatching a pointerdown/up sequence toggles an open one closed.
- The Next dev overlay reports one pre-existing hydration mismatch (Base UI generated ids) on the
  spot page — present on clean main, not a regression signal.
- Kill the server with `pkill -f "next (dev|start) --port 3111"` when done.
