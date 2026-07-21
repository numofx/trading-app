---
name: verify
description: How to build, run, and drive this Next.js trading app to verify UI changes end-to-end.
---

# Verify trading-app changes

## Launch

```bash
na next dev --port 3111        # run in background; ready when / returns 200
```

No env vars needed for UI work: without `MARKETS_SERVICE_URL` the app falls
back to preview (mock) markets, which is enough to exercise the terminal UI.

## Drive

Use `agent-browser` (already installed; the next-devtools MCP `browser_eval`
tool just points you at it):

```bash
agent-browser open http://localhost:3111/
agent-browser snapshot -i -c        # sidebar: Markets/Spot/Futures/Portfolio/Orders buttons
agent-browser click @eN             # click "Futures" etc., then re-snapshot
agent-browser screenshot out.png
```

Sections are client state, not routes — always land on `/` and click the
sidebar. The selected market and futures layout persist in localStorage.

## Gotchas

- Base UI popover/menu triggers are flaky with agent-browser's synthetic
  pointer clicks (press-and-hold gesture can toggle them closed). If a
  trigger won't open, fall back to `agent-browser eval` with DOM `.click()`.
- The Next dev overlay reports one pre-existing hydration mismatch
  (Base UI generated ids) on the spot page — present on clean main,
  not a regression signal.
- Kill the server with `pkill -f "next dev --port 3111"` when done.
