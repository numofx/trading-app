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
  {
    connected: true,
    ctaVisible: true,
    height: 667,
    note: "iPhone SE, funded — header carries both balances",
    path: "/layout-fixture",
    width: 375,
  },
  { connected: true, ctaVisible: true, height: 844, path: "/layout-fixture", width: 390 },
  { connected: true, ctaVisible: true, height: 896, path: "/layout-fixture", width: 414 },
];

const PROBE = `(() => {
  // Matched by id, not label: the CTA reads "Deposit" signed out, "Loading account…" while the
  // subaccount resolves and "Buy USDC" once funded. Matching on text silently found nothing from
  // 25b40bf (which relabelled the signed-out CTA) until the id landed.
  const cta = document.getElementById("spot-submit-cta");
  if (!cta) return JSON.stringify({ error: "no submit CTA found" });
  const rect = cta.getBoundingClientRect();

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
 *  1. Both balances are on screen. Below `xl` this header is the only place either one is reported
 *     — the strip that used to carry them under the ticket is gone — so a phone that drops them
 *     leaves a funded trader with no account balance anywhere.
 *  2. The claim breakdown opens on a tap. The inline "🔒 12,224 cNGN" note only fits from `xl`, and
 *     below that the explanation used to live in a `title` tooltip, which a touch device cannot
 *     reach at all. It is a real control with a real tap target now, and this asserts both.
 *  3. A deposit clears a shortfall without costing the trader their order. The ticket's CTA becomes
 *     "Deposit …" rather than going dead, and the deposit that follows must leave the typed amount
 *     alone — the ticket is never unmounted, so re-entry would mean something reset state that had
 *     no business resetting.
 *
 * Interactive, so it runs after PROBE and leaves the page dirty. The fixture's Deposit button
 * stands in for `handleDeposited`, which likewise only refreshes the balances the terminal renders.
 */
const CONNECTED_PROBE = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cta = () => document.getElementById("spot-submit-cta");
  const amountField = () => document.getElementById("spot-amount");
  const setValue = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const header = document.querySelector("header");
  if (!(header && cta() && amountField())) return JSON.stringify({ error: "fixture terminal did not render" });

  const headerText = header.textContent;
  const balancesShown = /[\\d,.]+ USDC/.test(headerText) && /[\\d,.]+ cNGN/.test(headerText);

  // The disclosure is found the way an assistive technology would find it, not by class.
  const triggers = [...header.querySelectorAll("button")].filter(
    (b) => /balance breakdown/i.test(b.getAttribute("aria-label") || "")
  );
  const tapTargets = triggers.map((b) => Math.round(b.getBoundingClientRect().height));
  const claimVisibleBeforeTap = document.body.textContent.includes("Claimed by resting orders");
  triggers[0]?.click();
  await sleep(400);
  const claimVisibleAfterTap = document.body.textContent.includes("Claimed by resting orders");
  triggers[0]?.click();
  await sleep(300);

  // 25 USDC at the fixture's ~1,400 mid costs ~35,000 cNGN against ~29,000 spendable.
  setValue(amountField(), "25");
  await sleep(400);
  const shortRect = cta().getBoundingClientRect();
  const shortfallLabel = cta().textContent.trim();
  const shortfallNoted = document.querySelector("p.text-sell") !== null;
  const ctaVisibleWithShortfall = shortRect.top >= 0 && shortRect.bottom <= innerHeight;

  document.getElementById("fixture-deposit").click();
  await sleep(600);

  return JSON.stringify({
    balancesShown,
    claimTapOpensBreakdown: claimVisibleBeforeTap === false && claimVisibleAfterTap === true,
    ctaVisibleWithShortfall,
    disclosureCount: triggers.length,
    minTapTarget: tapTargets.length === 0 ? 0 : Math.min(...tapTargets),
    shortfallLabel,
    shortfallNoted,
    // After the deposit: the order survives untouched and the CTA is an order button again.
    amountAfterDeposit: amountField().value,
    ctaAfterDeposit: cta().textContent.trim(),
    ctaDisabledAfterDeposit: cta().disabled,
    shortfallNotedAfterDeposit: document.querySelector("p.text-sell") !== null,
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

function probe(width, height, path) {
  browser("set", "viewport", String(width), String(height));
  browser("open", `${BASE_URL}${path}`);
  browser("wait", "3500");
  return evaluate(PROBE);
}

const failures = [];

for (const viewport of VIEWPORTS) {
  const { width, height, connected = false, ctaVisible: expectCta, note, path = "/" } = viewport;
  const label = `${width}x${height}${connected ? " funded" : ""}`;
  let result;

  try {
    result = probe(width, height, path);
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
    [result.overscrollPinned, "page can overscroll — expected overscroll-behavior: none on the root"],
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
        [funded.balancesShown, "header does not show both account balances in ticker form"],
        [
          funded.disclosureCount === 2,
          `expected a claim disclosure on each balance, found ${funded.disclosureCount}`,
        ],
        [
          funded.claimTapOpensBreakdown,
          "tapping a balance does not open its claim breakdown — the note is hover-only again",
        ],
        // 24px is the floor a fingertip can reliably hit; the trigger buys it with padding that a
        // negative margin bleeds back out, so it costs the header row nothing.
        [
          funded.minTapTarget >= 24,
          `claim disclosure tap target is ${funded.minTapTarget}px tall, under the 24px floor`,
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
          funded.amountAfterDeposit === "25",
          `the deposit reset the typed amount to "${funded.amountAfterDeposit}" — the order has to be re-entered`,
        ],
        [
          funded.ctaAfterDeposit === "Buy USDC" && funded.ctaDisabledAfterDeposit === false,
          `after the deposit the CTA reads "${funded.ctaAfterDeposit}" (disabled=${funded.ctaDisabledAfterDeposit}) instead of an enabled order button`,
        ],
        [
          funded.shortfallNotedAfterDeposit === false,
          "the shortfall note survived the deposit that cleared it",
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
    `${status} ${label.padEnd(16)} cta=${String(result.ctaVisible).padEnd(5)} bottom=${String(result.ctaBottom).padEnd(5)} label=${String(result.ctaLabel).padEnd(14)}${note ? `  (${note})` : ""}`
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
