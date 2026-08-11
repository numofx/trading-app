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

Production must override that local default:

```bash
MARKETS_SERVICE_URL=https://api.numofx.com
```

`api.numofx.com` is the stable public hostname for `markets-service`; it is a CNAME onto the Railway
deployment, which also still answers on `markets-service-production.up.railway.app`. Prefer the
`api.numofx.com` name everywhere — the Railway hostname is a fallback and should not be handed to
external consumers.

Do not deploy the frontend with `MARKETS_SERVICE_URL=http://127.0.0.1:8080`.
In production, `MARKETS_SERVICE_URL` must point at the live `markets-service` deployment. The frontend throws at request time if `NODE_ENV=production` and the URL is missing or points at localhost.

The frontend is deployed on Vercel; `MARKETS_SERVICE_URL` is encoded in that project's production
environment and should be treated as required production configuration rather than tribal knowledge.

## Live order book stream

The spot and futures order-book panels stream live depth and trades from `markets-service` over its WebSocket API (`GET /v1/ws`). The browser connects **directly** to the socket (no Next.js proxy), so the URL must be client-reachable:

- `NEXT_PUBLIC_MARKETS_WS_URL` — e.g. `wss://api.numofx.com/v1/ws` in production, `ws://127.0.0.1:8080/v1/ws` locally.

The client subscribes to the public `book` and `trades` channels for the selected market (spot uses the `USDCcNGN-SPOT` symbol; futures use the market symbol such as `USDCcNGN-SEP16-2026`), seeds from the `snapshot` frame, and applies `update` deltas. Both channels are unauthenticated; the only server-side gate is `WS_ALLOWED_ORIGINS` on the `markets-service` deployment, which **must include the frontend origin** or the browser handshake is rejected. When the socket is unreachable, still connecting, or the book is one-sided/crossed, the panel falls back to the server-rendered snapshot (futures) or preview book (spot). That fallback is silent — there is no on-screen indicator of which source is rendering, so a stream that never goes live looks identical to a healthy one. (A "Live liquidity" badge used to signal this and was removed in `bf5688e`; its absence is what let the spot stream sit permanently in fallback, fixed in `c7c2f2e`.)

`GET /api/strails/egress` remains as an ops diagnostic that reports the deployment's current egress IP (used when registering an IP allowlist upstream).

## How markets are populated

`markets-service` has **no seeding script, admin endpoint, or on-chain auto-discovery**. Its market
list is a static registry in Go — `services/markets/internal/instruments/registry.go` in the
`numofx/exchange` monorepo — defining spot plus three USDC/cNGN deliverable futures. Each market is
served from `GET /v1/markets` only when its env var(s) are set on the `markets-service` deployment:

| Market | Expiry (UTC) | Env vars on markets-service | Live today |
| --- | --- | --- | --- |
| `USDCcNGN-SPOT` | — | `CNGN_SPOT_ASSET_ADDRESS` | yes |
| `USDCcNGN-SEP16-2026` | 2026-09-16 14:00 | `CNGN_SEP16_2026_FUTURE_ASSET_ADDRESS` + `CNGN_SEP16_2026_FUTURE_SUB_ID` | yes |
| `USDCcNGN-NOV30-2026` | 2026-11-30 00:00 | `CNGN_NOV30_2026_FUTURE_ASSET_ADDRESS` + `CNGN_NOV30_2026_FUTURE_SUB_ID` | no |
| `USDCcNGN-MAY31-2027` | 2027-05-31 00:00 | `CNGN_MAY31_2027_FUTURE_ASSET_ADDRESS` + `CNGN_MAY31_2027_FUTURE_SUB_ID` | no |

The address/sub-id pairs identify the instrument in the on-chain `Matching` contract. A market whose
pair is unset is simply absent from `/v1/markets` — that is the only reason a registry entry does
not appear, so an empty `[]` means none of the pairs are configured on the backend deployment.

> Verify the "live today" column against `GET https://api.numofx.com/v1/markets` before relying on
> it. Until 2026-08-08 this table described a `CNGN_JUN30_2026_*` pair that no longer exists in the
> registry — it dated from the standalone `markets-service` repo and was never updated when the
> service moved into `numofx/exchange`, so it sent readers looking for env vars matching nothing.

The frontend picks markets out of that list with two separate filters (`lib/markets-service.ts`):

| | Futures (`getLiveDeliverableFXFutures`) | Spot (`getLiveSpotMarket`) |
| --- | --- | --- |
| `contract_type` | `deliverable_fx_future` | `spot` |
| `settlement_type` | `physical_delivery` | not checked |
| `base_asset_symbol` | `USDC` | `USDC` |
| `quote_asset_symbol` | `cNGN` | `cNGN` |

Futures are sorted by `expiry_timestamp` ascending; spot takes the first match.

## Spot market status

Spot is **live again**. `markets-service` serves `USDCcNGN-SPOT` (`contract_type=spot`,
`order_entry_spec=usdc_cngn_spot_v1`) from `GET /v1/markets`, gated on `CNGN_SPOT_ASSET_ADDRESS`
being set on that deployment. Depth, trades and candles are real, and the spot order translation
contract below is what the engine actually expects.

> An earlier revision of this section said spot had been removed in `e75d513` (May 2026). That was
> true at the time and is no longer — verify against `GET /v1/markets` before trusting it again.

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
- The cNGN pair (`NEXT_PUBLIC_CNGN_ASSET_ADDRESS` + `NEXT_PUBLIC_CNGN_TOKEN_ADDRESS`) mirrors
  `risk-core/deployments/<chainId>/WRAPPED_CNGN.json`, whose `base` is the escrow and `wrappedAsset` the token.
  The asset is the cNGN counterpart to `NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS` — what a cNGN deposit approves
  and pays into, and the id labeling the cNGN leg of a subaccount balance. The token is the ERC-20 pulled from
  the wallet, which the spot terminal's Assets tab reads. Defaults per chain:

  | Chain | Asset (escrow) | Token (ERC-20) | Token decimals |
  | --- | --- | --- | --- |
  | Base mainnet (8453) | `0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493` | `0x46C85152bFe9f96829aA94755D9f915F9B10EF5F` | 6 |
  | Base Sepolia (84532) | `0x1c08f30c204EE18EbBDc161c0f0864AFb826934b` | `0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6` | 18 |

  Both escrows are verified on-chain: `wrappedAsset()` returns the paired token, `deposit(uint256,uint256)` is
  present, and neither has a `wlEnabled()` gate. The mainnet escrow is also the spot market's `asset_address`
  from `GET /v1/markets`, so cNGN deposits and cNGN orders settle against one contract.

  > **Override the two together or not at all.** An escrow only accepts the exact ERC-20 it wraps. Base Sepolia
  > also hosts `0xe2387F04d3858e7Cb64Ef5Ed6617f9B2fcEEAfa2` — likewise named `cNGN`, but 6 decimals and not
  > wrapped by this venue's escrow. The app pointed at it until 2026-08-11; approving it produces a deposit that
  > cannot settle. Note the decimals differ by chain, so never hardcode 6: the deposit flow reads them from the
  > token contract.
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
