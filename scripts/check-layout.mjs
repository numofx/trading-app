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
 * currently accepted (see PR #17: the header needs two rows below ~390px wide, so the CTA
 * cannot clear a 667px fold). If a change makes it true, tighten the expectation.
 */
const VIEWPORTS = [
  {
    ctaVisible: false,
    height: 667,
    note: "iPhone SE — known gap, header needs 2 rows",
    width: 375,
  },
  { ctaVisible: true, height: 711, width: 410 },
  { ctaVisible: true, height: 959, width: 545 },
  { ctaVisible: true, height: 700, width: 1440 },
  { ctaVisible: true, height: 900, width: 1440 },
];

const PROBE = `(() => {
  const cta = [...document.querySelectorAll("button")].find((b) => /^(Buy USDC|Buy now)$/.test(b.textContent.trim()));
  if (!cta) return JSON.stringify({ error: "no submit CTA found" });
  const rect = cta.getBoundingClientRect();

  const navs = [...document.querySelectorAll("nav")].filter((n) => getComputedStyle(n).display !== "none");
  const doc = document.documentElement;

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
    ctaVisible: rect.top >= 0 && rect.bottom <= innerHeight,
    ctaVisibleAfterScroll,
    ctaBottom: Math.round(rect.bottom + scrollY),
    visibleNavCount: navs.length,
    pageHorizontalScroll: doc.scrollWidth > doc.clientWidth,
    overflowingCells,
    blockedBy: [...new Set(blocked)],
  });
})()`;

function browser(...args) {
  return execFileSync("agent-browser", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function probe(width, height) {
  browser("set", "viewport", String(width), String(height));
  browser("open", `${BASE_URL}/?market=USDCcNGN`);
  browser("wait", "3500");
  // `--json` wraps the result in an envelope; `data.result` is itself a JSON string,
  // since the probe returns JSON.stringify(...).
  const envelope = JSON.parse(browser("eval", "--json", PROBE));
  if (!envelope.success) {
    throw new Error(envelope.error ?? "eval reported failure");
  }
  return JSON.parse(envelope.data.result);
}

const failures = [];

for (const viewport of VIEWPORTS) {
  const { width, height, ctaVisible: expectCta, note } = viewport;
  const label = `${width}x${height}`;
  let result;

  try {
    result = probe(width, height);
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
    [result.visibleNavCount === 1, `expected exactly 1 visible nav, got ${result.visibleNavCount}`],
    [result.pageHorizontalScroll === false, "page scrolls horizontally"],
    [
      result.overflowingCells.length === 0,
      `grid cells overflow their track: ${result.overflowingCells.join(", ")}`,
    ],
    [result.blockedBy.length === 0, `submit button covered by: ${result.blockedBy.join(", ")}`],
  ];

  const failed = checks.filter(([ok]) => !ok).map(([, message]) => message);
  for (const message of failed) {
    failures.push(`${label}: ${message}`);
  }

  const status = failed.length === 0 ? "ok  " : "FAIL";
  console.log(
    `${status} ${label.padEnd(9)} cta=${String(result.ctaVisible).padEnd(5)} bottom=${String(result.ctaBottom).padEnd(5)}${note ? `  (${note})` : ""}`
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
