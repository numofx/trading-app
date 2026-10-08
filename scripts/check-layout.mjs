/**
 * Layout invariant check for the trading terminal.
 *
 * Not a unit test — layout only exists in a real browser, so this drives `agent-browser`
 * (the same tool `.claude/skills/verify` documents) and asserts the invariants established
 * while making the submit button reachable across viewports.
 *
 * Usage:
 *   bunx next dev --port 3111       # in another shell
 *   just check-layout               # or: node scripts/check-layout.mjs [--url http://...]
 *
 * Exits non-zero if any expectation is unmet.
 */

import { execFileSync } from "node:child_process";

/**
 * What the ticket column must have left over at its fixed height, from `md` up: the ticket, the
 * Account panel and the gap between them, and this much besides. At 0 the next row added to
 * either panel cuts the balance summary off; 24px is a row's worth of warning.
 */
const MIN_COLUMN_MARGIN = 24;

const urlArgIndex = process.argv.indexOf("--url");
const BASE_URL = urlArgIndex === -1 ? "http://localhost:3111" : process.argv[urlArgIndex + 1];

/**
 * Known-good matrix. `ctaVisible: false` is not a passing grade — it records a gap that is
 * currently accepted. If a change makes it true, tighten the expectation.
 *
 * iPhone SE was such a gap (PR #17: the header needs two rows below ~390px wide, so the CTA could
 * not clear a 667px fold). Removing the decorative "Pay with" dropdown reclaimed the row it cost
 * and the CTA now clears the fold — by nothing to spare, which is why the expectation is tightened
 * rather than left permissive: the next row added to the ticket pushes it back under.
 *
 * `connected` rows run against `/layout-fixture`, a dev-only route rendering the terminal for a
 * funded account with orders resting. Everything this file measured before was the signed-out page,
 * where the header carries no balances and the ticket's CTA can only say "Deposit" — so the phone
 * layout of the state an actual trader is in went unchecked, which is how the header came to depend
 * on a third wrapped row without anything noticing. The three phone widths are the common ones:
 * iPhone SE, iPhone 12/13/14, and the Plus/Max sizes.
 */
const VIEWPORTS = [
  {
    ctaVisible: true,
    height: 667,
    note: "iPhone SE — clears the fold with no margin",
    width: 375,
  },
  { ctaVisible: true, height: 711, width: 410 },
  { ctaVisible: true, height: 959, width: 545 },
  { ctaVisible: true, height: 700, width: 1440 },
  { ctaVisible: true, height: 900, width: 1440 },
  // The perp, signed out, on the same grid: its ticket has its own submit button. Its leverage
  // row, side-by-side switches and merged account line are what keep it under a phone's fold.
  ...[
    [375, 667],
    [410, 711],
    [545, 959],
    [1440, 700],
    [1440, 900],
  ].map(([width, height]) => ({
    cta: "perp-submit-cta",
    ctaVisible: true,
    height,
    path: "/trade/cngn-perp",
    width,
  })),
  {
    connected: true,
    ctaVisible: true,
    height: 667,
    note: "iPhone SE, funded — balances live under the ticket",
    path: "/layout-fixture",
    width: 375,
  },
  { connected: true, ctaVisible: true, height: 844, path: "/layout-fixture", width: 390 },
  { connected: true, ctaVisible: true, height: 896, path: "/layout-fixture", width: 414 },
];

/**
 * The rendered element with an id. React can leave a streamed Suspense segment behind as a
 * \`<div hidden id="S:0">\` holding a second, unrendered copy of the page, and \`getElementById\`
 * returned that copy on \`/layout-fixture\`: zero-sized, "covered by the header", and never updated
 * by the deposit the connected probe clicks.
 */
const VISIBLE_BY_ID = `const visibleById = (id) =>
    [...document.querySelectorAll("#" + CSS.escape(id))].find((el) => el.getClientRects().length > 0) ?? null;`;

/** The page probe, for the ticket whose submit button carries `ctaId`. */
const probeScript = (ctaId) => `(() => {
  ${VISIBLE_BY_ID}
  // Matched by id, not label: the CTA reads "Deposit" signed out, "Loading account…" while the
  // subaccount resolves and "Buy cNGN" once funded. Matching on text silently found nothing from
  // 25b40bf (which relabelled the signed-out CTA) until the id landed.
  const cta = visibleById(${JSON.stringify(ctaId)});
  if (!cta) return JSON.stringify({ error: "no submit CTA found" });
  const rect = cta.getBoundingClientRect();

  // The ticket column holds the order form and the balance summary beneath it. From the md
  // breakpoint up it is a fixed-height scroller, and everything in it is meant to fit: a trader
  // should not have to scroll a column to read their own balance. It overflowed by 74px when the
  // summary landed, which is how the cNGN row came to sit under the fold.
  const ticketColumn = cta.closest("div.order-first");
  const columnOverflow = ticketColumn
    ? Math.max(0, ticketColumn.scrollHeight - ticketColumn.clientHeight)
    : 0;
  const grid = ticketColumn ? ticketColumn.parentElement : null;
  const gridTop = grid ? Math.round(grid.getBoundingClientRect().top + scrollY) : null;
  const headerHeight = Math.round(document.querySelector("header").getBoundingClientRect().height);
  // The header's figures, from \`lg\` where they show: each label's and each value's top, to the
  // pixel. One y per row is what reads as a common baseline (all labels share one type size, all
  // values another). Empty below \`lg\`, where the figures are hidden.
  const headerRow = (selector) =>
    [...document.querySelectorAll("header " + selector)]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => Math.round(el.getBoundingClientRect().top));
  const labelTops = headerRow("[data-metric-label]");
  const valueTops = headerRow("[data-metric-value]");

  // What the column has left at its fixed height: its height less its content's, measured from
  // its top to its last child's bottom (scrollHeight never reads below clientHeight, so it cannot
  // say how much room a column that fits has left). Negative is the overflow above.
  const columnMargin = ticketColumn
    ? Math.round(
        ticketColumn.clientHeight -
          (ticketColumn.lastElementChild.getBoundingClientRect().bottom -
            ticketColumn.getBoundingClientRect().top +
            ticketColumn.scrollTop)
      )
    : null;

  const navs = [...document.querySelectorAll("nav")].filter((n) => getComputedStyle(n).display !== "none");
  const doc = document.documentElement;
  const rootStyle = getComputedStyle(doc);

  // Every grid track that holds text must fit its content — this is what regressed when the
  // activity table compressed six columns into ~52px each.
  const grids = [...document.querySelectorAll("div")].filter((d) => getComputedStyle(d).display === "grid");
  const overflowingCells = grids.flatMap((g) =>
    [...g.children].filter((c) => c.textContent.trim() && c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim().slice(0, 24))
  );

  // The submit button must not be covered by anything (floating widgets, overlays).
  // Dev-only tooling is excluded: the Next.js dev indicator and the react-grab inspector
  // both render fixed, max-z overlays that a production build does not ship.
  const DEV_ONLY_OVERLAY = /NEXTJS-PORTAL|ph-no-capture|react-grab/i;
  const blocked = [];
  for (let i = 0; i <= 10; i++) {
    const x = rect.left + (rect.width * i) / 10 + (i === 0 ? 2 : i === 10 ? -2 : 0);
    const el = document.elementFromPoint(x, rect.top + rect.height / 2);
    if (!el || el === cta || cta.contains(el)) continue;
    const id = el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : "");
    if (!DEV_ONLY_OVERLAY.test(id)) blocked.push(id);
  }

  // The original defect only appeared after scrolling: a footer stuck to its own section
  // scrolls away with it. Unproven — the ticket no longer overflows its column, so the
  // condition cannot currently be reproduced. Kept as a guard for if the ticket grows again.
  const scrollers = [...document.querySelectorAll("div")].filter(
    (d) => d.scrollHeight > d.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(d).overflowY)
  );
  for (const s of scrollers) s.scrollTop = s.scrollHeight;
  const scrolled = cta.getBoundingClientRect();
  const ctaVisibleAfterScroll = scrolled.top >= 0 && scrolled.bottom <= innerHeight;
  for (const s of scrollers) s.scrollTop = 0;

  return JSON.stringify({
    ctaLabel: cta.textContent.trim(),
    // The page must sit still at its borders rather than rubber-banding away from them.
    overscrollPinned: rootStyle.overscrollBehaviorY === "none" && rootStyle.overscrollBehaviorX === "none",
    columnOverflow,
    columnMargin,
    gridTop,
    headerHeight,
    labelTops,
    valueTops,
    ctaVisible: rect.top >= 0 && rect.bottom <= innerHeight,
    ctaVisibleAfterScroll,
    ctaBottom: Math.round(rect.bottom + scrollY),
    visibleNavCount: navs.length,
    pageHorizontalScroll: doc.scrollWidth > doc.clientWidth,
    overflowingCells,
    blockedBy: [...new Set(blocked)],
  });
})()`;

/**
 * The funded-account invariants, which only hold on `/layout-fixture`.
 *
 * Three things, in the order a trader meets them:
 *
 *  1. Both balances are on screen, in the balance summary under the ticket. That panel is now the
 *     only place either one is reported — the header pair beside the deposit control is gone — so
 *     a width that drops it leaves a funded trader with no account balance anywhere.
 *  2. A deposit clears a shortfall without costing the trader their order. The ticket's CTA becomes
 *     "Deposit …" rather than going dead, and the deposit that follows must leave the typed amount
 *     alone — the ticket is never unmounted, so re-entry would mean something reset state that had
 *     no business resetting.
 *
 * Interactive, so it runs after PROBE and leaves the page dirty. The fixture's Deposit button
 * stands in for `handleDeposited`, which likewise only refreshes the balances the terminal renders.
 */
const CONNECTED_PROBE = `(async () => {
  ${VISIBLE_BY_ID}
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cta = () => visibleById("spot-submit-cta");
  const amountField = () => visibleById("spot-amount");
  const setValue = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const header = document.querySelector("header");
  if (!(header && cta() && amountField())) return JSON.stringify({ error: "fixture terminal did not render" });

  // The balance summary under the ticket, found by the pair of deposit buttons only it has — the
  // ticket's own "Available" row carries one of the two, never both. Its panel label is hidden at
  // these widths, so the rows themselves are what identifies it.
  const summaryPanel = [...document.querySelectorAll("section")].find(
    (s) =>
      s.querySelector('button[aria-label="Deposit USDC"]') &&
      s.querySelector('button[aria-label="Deposit cNGN"]')
  );
  const summaryText = summaryPanel ? summaryPanel.textContent : "";
  const summaryShowsBothLegs =
    /[\\d,.]+ USDC/.test(summaryText) && /[\\d,.]+ cNGN/.test(summaryText);

  // 50,000 cNGN at the fixture's ~0.000714 mid costs ~35.7 USDC against ~22 spendable.
  setValue(amountField(), "50000");
  await sleep(400);
  const shortRect = cta().getBoundingClientRect();
  const shortfallLabel = cta().textContent.trim();
  const shortfallNoted = [...document.querySelectorAll('p[data-note="shortfall"]')].some((el) => el.getClientRects().length > 0);
  const ctaVisibleWithShortfall = shortRect.top >= 0 && shortRect.bottom <= innerHeight;

  visibleById("fixture-deposit").click();
  await sleep(600);

  return JSON.stringify({
    summaryShowsBothLegs,
    ctaVisibleWithShortfall,
    shortfallLabel,
    shortfallNoted,
    // After the deposit: the order survives untouched and the CTA is an order button again.
    amountAfterDeposit: amountField().value,
    ctaAfterDeposit: cta().textContent.trim(),
    ctaDisabledAfterDeposit: cta().disabled,
    shortfallNotedAfterDeposit: [...document.querySelectorAll('p[data-note="shortfall"]')].some((el) => el.getClientRects().length > 0),
  });
})()`;

function browser(...args) {
  return execFileSync("agent-browser", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function evaluate(script) {
  // `--json` wraps the result in an envelope; `data.result` is itself a JSON string,
  // since each probe returns JSON.stringify(...).
  const envelope = JSON.parse(browser("eval", "--json", script));
  if (!envelope.success) {
    throw new Error(envelope.error ?? "eval reported failure");
  }
  return JSON.parse(envelope.data.result);
}

function probe(width, height, path, ctaId) {
  browser("set", "viewport", String(width), String(height));
  browser("open", `${BASE_URL}${path}`);
  browser("wait", "3500");
  return evaluate(probeScript(ctaId));
}

const failures = [];

/**
 * Where the panel grid starts, per viewport and route. Spot and the perp share one shell, so at a
 * given size their panels must start at the same height: a switch that moves the grid reads as
 * the whole terminal jumping. Compared once both markets have been probed at a size.
 */
const gridTops = new Map();

for (const viewport of VIEWPORTS) {
  const {
    width,
    height,
    connected = false,
    cta = "spot-submit-cta",
    ctaVisible: expectCta,
    note,
    path = "/trade/cngn-usdc",
  } = viewport;
  const label = `${width}x${height} ${path}${connected ? " funded" : ""}`;
  let result;

  try {
    result = probe(width, height, path, cta);
  } catch (error) {
    failures.push(`${label}: probe failed — ${error.message}`);
    continue;
  }

  if (result.error) {
    failures.push(`${label}: ${result.error}`);
    continue;
  }

  const checks = [
    [
      result.ctaVisible === expectCta,
      `CTA visible expected ${expectCta}, got ${result.ctaVisible} (bottom ${result.ctaBottom})`,
    ],
    [
      result.ctaVisibleAfterScroll === expectCta,
      `CTA scrolled out of view: expected ${expectCta} after scrolling the ticket, got ${result.ctaVisibleAfterScroll}`,
    ],
    // The app is a single spot terminal, so there is no primary nav to render: the Spot/Futures
    // rail and its phone-sized switcher went with the futures section.
    [result.visibleNavCount === 0, `expected no visible nav, got ${result.visibleNavCount}`],
    // Below `md` the ticket column is not a scroller — the page itself scrolls — so the invariant
    // only holds where the column has a fixed height of its own.
    [
      width < 768 || result.columnOverflow === 0,
      `ticket column overflows its height by ${result.columnOverflow}px — the balance summary is cut off`,
    ],
    [
      width < 768 || result.columnMargin >= MIN_COLUMN_MARGIN,
      `ticket column has ${result.columnMargin}px to spare, under the ${MIN_COLUMN_MARGIN}px minimum`,
    ],
    [
      result.overscrollPinned,
      "page can overscroll — expected overscroll-behavior: none on the root",
    ],
    [result.pageHorizontalScroll === false, "page scrolls horizontally"],
    [
      result.overflowingCells.length === 0,
      `grid cells overflow their track: ${result.overflowingCells.join(", ")}`,
    ],
    [result.blockedBy.length === 0, `submit button covered by: ${result.blockedBy.join(", ")}`],
  ];

  if (connected) {
    let funded;
    try {
      funded = evaluate(CONNECTED_PROBE);
    } catch (error) {
      failures.push(`${label}: funded probe failed — ${error.message}`);
      funded = null;
    }

    if (funded?.error) {
      failures.push(`${label}: ${funded.error}`);
      funded = null;
    }

    if (funded) {
      checks.push(
        [
          funded.summaryShowsBothLegs,
          "the balance summary under the ticket does not report both account legs",
        ],
        [
          /^Deposit /.test(funded.shortfallLabel),
          `an unaffordable order left the CTA reading "${funded.shortfallLabel}" instead of offering a deposit`,
        ],
        [funded.shortfallNoted, "an unaffordable order printed no shortfall explanation"],
        [
          funded.ctaVisibleWithShortfall,
          "the shortfall note pushed the CTA below the fold — the explanation cost the trader the button it explains",
        ],
        [
          funded.amountAfterDeposit === "50000",
          `the deposit reset the typed amount to "${funded.amountAfterDeposit}" — the order has to be re-entered`,
        ],
        [
          funded.ctaAfterDeposit === "Buy cNGN" && funded.ctaDisabledAfterDeposit === false,
          `after the deposit the CTA reads "${funded.ctaAfterDeposit}" (disabled=${funded.ctaDisabledAfterDeposit}) instead of an enabled order button`,
        ],
        [
          funded.shortfallNotedAfterDeposit === false,
          "the shortfall note survived the deposit that cleared it",
        ]
      );
    }
  }

  // Every label at one y and every value at another, within this header.
  const spread = (tops) => (tops.length === 0 ? 0 : Math.max(...tops) - Math.min(...tops));
  checks.push(
    [
      spread(result.labelTops) === 0,
      `header labels sit at different heights: ${[...new Set(result.labelTops)].join(", ")}px`,
    ],
    [
      spread(result.valueTops) === 0,
      `header values sit at different heights: ${[...new Set(result.valueTops)].join(", ")}px`,
    ]
  );

  if (path.startsWith("/trade/")) {
    const size = `${width}x${height}`;
    const here = {
      gridTop: result.gridTop,
      headerHeight: result.headerHeight,
      labelTop: result.labelTops[0] ?? null,
      path,
      valueTop: result.valueTops[0] ?? null,
    };
    const seen = gridTops.get(size);
    if (seen === undefined) {
      gridTops.set(size, here);
    } else {
      checks.push(
        [
          seen.gridTop === here.gridTop && seen.headerHeight === here.headerHeight,
          `panels start at ${here.gridTop}px under a ${here.headerHeight}px header here but at ${seen.gridTop}px under a ${seen.headerHeight}px header on ${seen.path}: switching markets moves the terminal`,
        ],
        [
          seen.labelTop === here.labelTop && seen.valueTop === here.valueTop,
          `header labels/values sit at ${here.labelTop}/${here.valueTop}px here but ${seen.labelTop}/${seen.valueTop}px on ${seen.path}: the figures jump on a switch`,
        ]
      );
    }
  }

  const failed = checks.filter(([ok]) => !ok).map(([, message]) => message);
  for (const message of failed) {
    failures.push(`${label}: ${message}`);
  }

  const status = failed.length === 0 ? "ok  " : "FAIL";
  console.log(
    `${status} ${label.padEnd(26)} cta=${String(result.ctaVisible).padEnd(5)} bottom=${String(result.ctaBottom).padEnd(5)} margin=${String(width < 768 ? "n/a" : result.columnMargin).padEnd(5)} header=${String(result.headerHeight).padEnd(4)} label/value y=${String(result.labelTops[0] ?? "-")}/${String(result.valueTops[0] ?? "-")} label=${String(result.ctaLabel).padEnd(14)}${note ? `  (${note})` : ""}`
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("\nAll layout invariants hold.");
