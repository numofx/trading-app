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

- `/trade/cngn-perp` — the perp, the default market. `/` and `/perp` redirect here (307).
- `/trade/cngn-usdc` — spot.
- Another casing of a slug is redirected to lowercase by `proxy.ts`; an unknown slug is a 404.
- `/layout-fixture` and `/layout-fixture/perp` — dev-only fixtures with made-up figures (404 in
  production), used by `scripts/check-layout.mjs`.

## Layout probe

```bash
node scripts/check-layout.mjs      # against the dev server on :3111; `just check-layout`
```

Drives agent-browser through the signed-out spot and perp routes at phone and desktop sizes and
the funded fixture, asserting the submit button clears the fold, nothing covers it, no grid cell
overflows, the page does not scroll sideways and, from `md` up, the ticket column has at least
24px to spare under the Account panel (`MIN_COLUMN_MARGIN`). Needs `next dev`: the fixture 404s
in production. `/layout-fixture/perp` carries seven-figure balances and a seven-figure position
under water, for eyeballing the perp ticket's wrapped account line and summary at 375px.

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

## The switch check

What a market switch must hold, and how to see it:

- **The shell stays mounted.** Set a property on `document.querySelector("header")` before the
  switch and read it back after. The node persisting means the `/trade` layout, and the session
  provider above the header, never remounted, so the wallet, trading-account and balance hooks
  never re-ran.
- **The header never mixes markets.** The selector pill flips with the URL. From that instant the
  header shows only the target market's figures: first the seed from the selector's last
  `/api/markets-overview` read (same price and change the clicked row showed; the perp's Mark and
  Index read `—` until live), then the panels' live publication. With no recent read it shows
  skeleton metrics (`[aria-busy]` inside `header`). Deposit/Withdraw come only from the mounted
  panel, so they are absent until the panels publish.
- **The ticket resets.** Type into `#spot-amount` (or `#perp-size`) before the switch; after the
  round trip the field is back at its default and the other market's input is gone.

Sample it rather than eyeballing it: from an open selector, `.click()` the target row in an
`eval --stdin` script and read the header every 10 ms for a few seconds, keeping each sample that
differs from the last (pill text, `[aria-busy]`, which metric labels are present, whether a
Withdraw button exists, `main > [aria-busy]` for the grid skeleton). A mismatch is any sample
where the pill names one market and the metric labels belong to the other. Report the gap from
the pill flip to the first sample with figures (seeded: ~0 ms) and to the first with
Deposit/Withdraw (live: the page's own load, 0.3–1.6 s against the live venue).

## Gotchas

- Base UI dialog and menu triggers: `agent-browser click @ref` opens them; a DOM `.click()` on
  the trigger does not, and dispatching a pointerdown/up sequence toggles an open one closed.
- The Next dev overlay reports one pre-existing hydration mismatch (Base UI generated ids) on the
  spot page — present on clean main, not a regression signal.
- Kill the server with `pkill -f "next (dev|start) --port 3111"` when done.
