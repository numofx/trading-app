/**
 * Build check: the stack this bundle is configured for must be the stack the venue serves spot on.
 *
 * The ticket signs spot orders for the asset and module `/v1/markets` reports, but deposits, the
 * legacy rows and the perp fall back to `NEXT_PUBLIC_*`; a deployment whose env still names the old
 * stack after a venue cutover would deposit into one escrow and trade another. markets-service
 * refuses the order (`asset_address must match a configured instrument`), so the trader sees a 422
 * instead of a fill; this check fails the build first.
 *
 * Skipped with a notice when MARKETS_SERVICE_URL is unset (a local UI build) or the venue cannot be
 * reached (unreachable is not a mismatch, and a build should not hinge on a transient). A mismatch,
 * or an env var missing on a Vercel production build, exits non-zero.
 */
const url = process.env.MARKETS_SERVICE_URL?.trim();
const production = process.env.VERCEL_ENV === "production";
const CHECKS = [
  ["asset_address", "NEXT_PUBLIC_SPOT_ASSET_ADDRESS", "spot asset (the cNGN escrow)"],
  ["trade_module_address", "NEXT_PUBLIC_TRADE_MODULE_ADDRESS", "TradeModule"],
  ["quote_asset_address", "NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS", "quote asset (cash)"],
  ["margin_manager_address", "NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS", "margin manager (SRM)"],
];

function note(message) {
  console.log(`check-market-stack: ${message}`);
}

if (!url) {
  note("MARKETS_SERVICE_URL is unset; nothing to compare against (local build)");
  process.exit(0);
}

let markets;
try {
  const response = await fetch(`${url}/v1/markets`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`GET /v1/markets returned ${response.status}`);
  }
  markets = await response.json();
} catch (error) {
  note(`could not read ${url}/v1/markets (${error.message}); the stack was not verified`);
  process.exit(0);
}

const spot = (Array.isArray(markets) ? markets : []).find(
  (market) =>
    market.contract_type === "spot" &&
    market.base_asset_symbol === "USDC" &&
    market.quote_asset_symbol === "cNGN"
);
if (!spot) {
  note(`${url} serves no USDC/cNGN spot market; nothing to compare against`);
  process.exit(0);
}

const failures = [];
for (const [field, envName, label] of CHECKS) {
  const served = spot[field]?.toLowerCase();
  const configured = process.env[envName]?.trim().toLowerCase();
  if (!served) {
    note(`venue does not report ${field}; ${label} not compared`);
    continue;
  }
  if (!configured) {
    if (production) {
      failures.push(`${envName} is unset on a production build; the venue serves ${label} ${served}`);
    } else {
      note(`${envName} is unset; the venue serves ${label} ${served} (code default applies)`);
    }
    continue;
  }
  if (configured !== served) {
    failures.push(`${envName}=${configured} but the venue serves ${label} ${served}`);
  } else {
    note(`${label} ${served} matches ${envName}`);
  }
}

if (failures.length > 0) {
  console.error("check-market-stack: this bundle is configured for a stack the venue does not serve spot on:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("  Fix the env vars (they move with the venue's stack as one) and rebuild.");
  process.exit(1);
}
note("ok: the configured stack is the one the venue serves");
