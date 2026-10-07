/**
 * Build check: the stack this bundle resolves must be the stack the venue serves spot on.
 *
 * The ticket signs spot orders for the asset and module `/v1/markets` reports, but deposits,
 * account resolution, the legacy rows and the perp fall back to `NEXT_PUBLIC_*`, and those fall
 * back to the code defaults in `lib/matching-stack-defaults.json`. A bundle whose resolved stack
 * (env if set, else default) names the old stack after a venue cutover would deposit into one
 * escrow and trade another. markets-service refuses the order (`asset_address must match a
 * configured instrument`), so the trader sees a 422 instead of a fill; this check fails the build
 * first. Every build compares the resolved value, so a default left behind fails locally too.
 *
 * Outside production, an unset MARKETS_SERVICE_URL (a local UI build) or an unreachable venue is a
 * notice and the build goes on. On a Vercel production build both fail it: an unverified stack is
 * not one to ship.
 */
import { readFileSync } from "node:fs";

const url = process.env.MARKETS_SERVICE_URL?.trim();
const production = process.env.VERCEL_ENV === "production";
const chain = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID?.trim() === "84532" ? "sepolia" : "mainnet";
const defaults = JSON.parse(
  readFileSync(new URL("../lib/matching-stack-defaults.json", import.meta.url), "utf8")
)[chain];

/** [venue field, env, default, label] */
const CHECKS = [
  [
    "asset_address",
    "NEXT_PUBLIC_SPOT_ASSET_ADDRESS",
    defaults.cngnAsset,
    "spot asset (the cNGN escrow)",
  ],
  ["asset_address", "NEXT_PUBLIC_CNGN_ASSET_ADDRESS", defaults.cngnAsset, "cNGN deposit escrow"],
  ["trade_module_address", "NEXT_PUBLIC_TRADE_MODULE_ADDRESS", defaults.tradeModule, "TradeModule"],
  [
    "quote_asset_address",
    "NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS",
    defaults.wrappedUsdcAsset,
    "quote asset (cash)",
  ],
  [
    "margin_manager_address",
    "NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS",
    defaults.manager,
    "margin manager (SRM)",
  ],
];

function note(message) {
  console.log(`check-market-stack: ${message}`);
}

function fail(lines) {
  console.error(
    "check-market-stack: this bundle resolves a stack the venue does not serve spot on:"
  );
  for (const line of lines) {
    console.error(`  - ${line}`);
  }
  console.error(
    "  Fix the env vars or the defaults (they move with the venue's stack as one) and rebuild."
  );
  process.exit(1);
}

if (!url) {
  if (production) {
    fail(["MARKETS_SERVICE_URL is unset on a production build; the stack cannot be verified"]);
  }
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
  if (production) {
    fail([`could not read ${url}/v1/markets (${error.message}); the stack cannot be verified`]);
  }
  note(`could not read ${url}/v1/markets (${error.message}); the stack was not verified`);
  process.exit(0);
}

const spot = (Array.isArray(markets) ? markets : []).find(
  (market) =>
    market.contract_type === "spot" &&
    market.base_asset_symbol === "cNGN" &&
    market.quote_asset_symbol === "USDC"
);
if (!spot) {
  note(`${url} serves no USDC/cNGN spot market; nothing to compare against`);
  process.exit(0);
}

const failures = [];
for (const [field, envName, fallback, label] of CHECKS) {
  const served = spot[field]?.toLowerCase();
  if (!served) {
    note(`venue does not report ${field}; ${label} not compared`);
    continue;
  }
  const fromEnv = process.env[envName]?.trim();
  const resolved = (fromEnv || fallback).toLowerCase();
  const source = fromEnv ? envName : `the ${chain} default (${envName} unset)`;
  if (resolved !== served) {
    failures.push(`${source} resolves ${label} ${resolved} but the venue serves ${served}`);
  } else {
    note(`${label} ${served} matches ${source}`);
  }
}

if (failures.length > 0) {
  fail(failures);
}
note("ok: the resolved stack is the one the venue serves");
