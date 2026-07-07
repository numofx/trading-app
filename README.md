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
- `NEXT_PUBLIC_USDC_DELIVERABLE_BASE_ASSET_ADDRESS=0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110`

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
