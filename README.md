# Trading App

**An orderbook exchange for futures on stablecoin FX.**

Renders physically delivered FX futures on USDC/cNGN through an orderbook UI, with off/on ramping via Busha and Coinbase APIs for instant USD/USDC and NGN/cNGN conversions. Integrated with `markets-service` for live market discovery, books, and trades.

## Runtime config

The app discovers live markets from `markets-service` and renders them through the orderbook UI. When `markets-service` is unreachable or returns no markets, the app falls back to preview (mock) markets and disables live order submission.

Set:

- `MARKETS_SERVICE_URL`

Local development:

```bash
MARKETS_SERVICE_URL=http://127.0.0.1:8080
```

Production must override that local default. For the current Railway backend deployment:

```bash
MARKETS_SERVICE_URL=https://markets-service-production.up.railway.app
```

Do not deploy the frontend with `MARKETS_SERVICE_URL=http://127.0.0.1:8080`.
In production, `MARKETS_SERVICE_URL` must point at the live `markets-service` deployment. The frontend throws at request time if `NODE_ENV=production` and the URL is missing or points at localhost.

If the frontend is deployed on Railway, encode `MARKETS_SERVICE_URL` in that deploy environment and treat it as required production configuration rather than tribal knowledge.

## Strails spot liquidity (read-only)

The spot order book panel can display live CNGN-USDC liquidity from the [strails FX orderbook](https://docs.strails.co/). This is display-only: strails' LP quotes are mapped into book levels, while order submission, the price chart, recent trades, and 24h stats remain on preview/simulation data.

Set on the frontend deployment:

- `STRAILS_API_URL` — strails API base URL: `https://beta.stablesrail.io/v1` (the live beta environment — currently the **only** environment)
- `STRAILS_API_KEY` — fintech API key, sent as `x-api-key` (provisioned via strails onboarding)

> Per strails (confirmed 2026-07-10): `beta.stablesrail.io/v1` is **not a sandbox** — it is the live environment with real liquidity, full stop. There is no separate production activation; `api.strails.io/v1` becomes relevant only when strails migrates beta → prod in the future, at which point they will issue new keys. Do not treat the beta API as safe-to-break test data.

Both are server-only (no `NEXT_PUBLIC_` prefix): the browser polls `/api/strails/orderbook`, and the key never reaches the client.

**Go-live blockers** (tracked in the "Strails spot liquidity go-live" GitHub issue):

1. **Verify against strails' live beta API first.** The integration has only been exercised against a local stub built from docs.strails.co, and the docs contain internal inconsistencies (crossed example books, 10^6-scaled values in some responses). With a beta API key, confirm `/api/strails/orderbook` returns `status: "ok"` with plausible cNGN-per-USDC prices before enabling for users. Remember the beta API is live — read-only calls like `GET /fx/orderbook` are safe, but this is real liquidity, not test data.
2. **IP allowlisting.** Strails rejects requests from non-allowlisted IPs (HTTP 400 `IP_NOT_ALLOWED`), so the deployment's egress IP must be registered (self-service via strails' `/manageipallowlist` endpoint, 30 rpm limit; `{"action":"list"}` shows current entries). If it isn't, the panel silently falls back to preview data with `status: "upstream_error"` — there is no user-visible error. **Runbook:** `GET /api/strails/egress` reports the deployment's current egress IP; Vercel serverless egress is not guaranteed static, so if the book degrades with `IP_NOT_ALLOWED`, hit that route and add the new IP via `/manageipallowlist` (Vercel egress `54.196.174.165` was added 2026-07-10).

When the vars are unset, strails is unreachable, either book side is empty, prices fail the cNGN-per-USDC plausibility check, or the LP board is crossed (best bid ≥ best ask — possible because strails is a quote board, not a matched CLOB), the panel falls back to the preview book for that poll. A "Live liquidity" badge marks when real strails depth is shown; sizes are USDC-equivalents derived from each quote's `availableLiquidity`, which is denominated in the asset the LP receives: USDC on buy orders, cNGN on sell orders. (Verified empirically against the live beta API on 2026-07-10 via boundary quotes — strails' docs claim the opposite denomination; the docs are wrong.)

Monitoring: because the fallback is silent in the UI, alert on the backend instead. `GET /api/strails/orderbook` returns a `status` field (`ok` | `empty` | `crossed` | `implausible` | `unconfigured` | `upstream_error`) suitable for an uptime monitor, and the server logs every status transition plus a reminder every 10 minutes while degraded under the greppable `strails-orderbook` prefix.

## How markets are populated

`markets-service` has **no seeding script, admin endpoint, or on-chain auto-discovery**. Its market list is a static registry in Go (`internal/instruments/registry.go`) defining three USDC/cNGN deliverable futures. Each market is served from `GET /v1/markets` only when its env-var pair is set on the `markets-service` deployment:

| Market | Env vars on markets-service |
| --- | --- |
| JUN 30 2026 | `CNGN_JUN30_2026_FUTURE_ASSET_ADDRESS` + `CNGN_JUN30_2026_FUTURE_SUB_ID` |
| NOV 30 2026 | `CNGN_NOV30_2026_FUTURE_ASSET_ADDRESS` + `CNGN_NOV30_2026_FUTURE_SUB_ID` |
| MAY 31 2027 | `CNGN_MAY31_2027_FUTURE_ASSET_ADDRESS` + `CNGN_MAY31_2027_FUTURE_SUB_ID` |

The address/sub-id pairs identify the instrument in the on-chain `Matching` contract. If `/v1/markets` returns `[]`, none of those pairs are configured on the backend deployment.

The frontend consumes markets matching:

- `contract_type=deliverable_fx_future`
- `settlement_type=physical_delivery`
- `base_asset_symbol=USDC`
- `quote_asset_symbol=cNGN`

## Spot market status

Spot support was **removed from `markets-service`** (commit `e75d513`, May 2026). The spot USDC/cNGN market shown in the UI is preview data only, and live spot execution cannot activate against the current backend. The spot order translation contract below is retained for when spot returns.

Legacy override envs: `NEXT_PUBLIC_USDCCNGN_APR_FUTURE_ASSET_ADDRESS` / `NEXT_PUBLIC_USDCCNGN_APR_FUTURE_SUB_ID` patch metadata only for a market with `expiry_timestamp=1777507200` (APR 30 2026, now expired). They are no-ops against the current registry and can be left unset.

## Base Sepolia execution

For Base Sepolia frontend execution, the matching stack env should point to deployed contracts:

- `NEXT_PUBLIC_MATCHING_ADDRESS=0x1599636347FD5bA1fBE21D58AfE0b8B9cbe283FF`
- `NEXT_PUBLIC_TRADE_MODULE_ADDRESS=0x0AAE65AaA66Fe7f54486cDbD007956d3De611990`
- `NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS=0x1917960763BF3a0DfA10a05f0a112E828C1A934f`
- `NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS=0xdC3f31B61a2128B3D1ECB8b6f6d0DE82eBd6c7Ae`
- `NEXT_PUBLIC_USDC_TOKEN_ADDRESS=0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110`

Deposit flow address semantics (naming follows the risk-core deployment artifacts and is easy to invert):

- `NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS` is the `WLWrappedERC20Asset` contract (`base` in
  `risk-core/deployments/*/WRAPPED_USDC_DELIVERABLE.json`). It receives deposits and is the ERC-20 spender for
  deposits to an existing subaccount.
- `NEXT_PUBLIC_USDC_TOKEN_ADDRESS` is the underlying USDC ERC-20 pulled from the wallet (`wrappedAsset` in the same
  artifact). The legacy `NEXT_PUBLIC_USDC_DELIVERABLE_BASE_ASSET_ADDRESS` env is honored as a fallback alias for the
  token address.
- Deposits may be whitelist-gated on-chain (`WLWrappedERC20Asset.wlEnabled`). The app probes for the whitelist at
  preflight: plain `WrappedERC20Asset` deployments (including the current Base Sepolia one) have no gate and deposits
  are open; on WL deployments only operator-whitelisted subaccounts can deposit, and the create-and-deposit path
  cannot activate.

## Spot Order Contract

For spot `USDC/cNGN`, the trader-facing API contract is intentionally different from the raw engine order.

- UI price: `cNGN per USDC`
- UI size: `USDC notional`
- UI `BUY`: acquire USDC
- UI `SELL`: dispose of USDC

The engine still trades `WRAPPED_CNGN` against internal USDC cash, so the app must translate:

```text
engine_price = 1 / ui_price
engine_amount = ui_size * ui_price
UI BUY  -> engine SELL
UI SELL -> engine BUY
```

Fill deltas should reconcile as:

```text
UI BUY  -> dUSDC = +ui_size, d cNGN = -(ui_size * ui_price)
UI SELL -> dUSDC = -ui_size, d cNGN = +(ui_size * ui_price)
```
