# Trading App

**An orderbook exchange for stablecoin FX.**

Renders the cNGN-USDC spot market through an orderbook UI, with off/on ramping via Busha and Coinbase APIs for instant USD/USDC and NGN/cNGN conversions. Integrated with `markets-service` for live books and trades.

The app renders **cNGN-USDC** spot at `/` and **cNGN-PERP** at `/perp`, switched from the market
selector in the header. Both are shown exactly as the engine trades them: cNGN is the base and USDC the
quote, prices are USDC per cNGN (about 0.00073, to seven decimals, with ₦ per USDC as a secondary
line in the header and under the ticket's price field), sizes are cNGN, a buy or long is a buy of
cNGN. The venue's internal symbols stay `USDCcNGN-SPOT` and `USDCcNGN-PERP`; only the display names
changed. The display names live in `lib/market-labels.ts` and nowhere else. The perp is a USDC-settled perpetual on its own stack (numofx/exchange
`deploy-cngn-perp-stack.s.sol`): its own CashAsset, SRM and TradeModule. The app reads everything
about it from `markets-service`, with no env of its own:

- `/v1/markets` lists `USDCcNGN-PERP` (`contract_type: perpetual`) with a `perp` object: mark, index,
  funding, margin rates, max leverage, and the module, cash and SRM a trader signs and deposits for.
  Until it does, `/perp` renders its not-live state: empty panels and a ticket that cannot submit.
- Orders are signed exactly as entered (USDC per cNGN, cNGN contracts, a long is the on-chain long)
  for the perp's module and asset. A trader's perp margin is a separate account under the perp
  SRM, opened by the first "Deposit margin"; it is not the spot account. "Withdraw" on the Balances
  tab signs a WithdrawalModule action for the perp's CashAsset, like a spot withdrawal, and the
  venue pays USDC to the wallet; cash backing an open position is refused by the venue's
  simulation. "Close" on a position row sends a market order on the opposite side sized in the
  engine's own cNGN contracts (`engineAmountWhole`), so the account lands on exactly zero; the venue
  has no reduce-only flag, the exact size is what keeps a close from becoming a flip.
- `/v1/positions` (proxied at `/api/positions`) serves positions and margin, polled every 15s.
- **cNGN as margin.** When the perp block lists `collateral_assets` (the perp stack's own cNGN
  escrow, whitelisted on the perp SRM as a base asset), "Deposit margin" offers cNGN beside USDC,
  depositing into that escrow through the same deposit machine; the Balances tab shows one row per
  asset (cash, then each collateral asset at its index value and the share the SRM credits —
  50% for cNGN), and each row's Withdraw signs a WithdrawalModule action for that row's escrow.
  Without `collateral_assets` the terminal is cash-only, exactly as before. The haircut is what
  liquidates a leveraged short when the naira strengthens, so the dialog tells a cNGN depositor to
  post about as much cNGN as they short. cNGN and USDC both count as margin under the SRM's own
  check (cNGN at its factor), in either direction and at the normal maximum leverage: the venue no
  longer limits a cNGN-holding account to long USD or to the cNGN posted. A short (long naira) on
  such an account carries a warning that it doubles the naira exposure. Margin is shown by source:
  the ticket's "Available to trade" lists the cash, each collateral asset with its value and margin
  credit, and what positions already use (tooltip: cross-margin, P&L in USDC); the Balances tab has a
  row per asset with balance, value and margin credit, listing an accepted asset at zero with a
  Deposit action until it is held; and the Size field takes cNGN as well as USDC, converted at the
  ticket's own price.

The earlier dated-futures terminal was removed; the perp is a new market, not a restoration of it.

## Runtime config

The app reads the live spot market from `markets-service` and renders it through the orderbook UI.

**There is no mock, preview or sample data anywhere in the render path.** Every price, level, trade,
candle and balance on screen is the venue's own or the connected wallet's. When `markets-service` is
unreachable or serves no spot market, the panels render empty states ("No resting bids", "No chart
data", a `—` price) rather than invented depth — a trader cannot tell fabricated depth from real
depth, and the prices would be ones nothing can fill at. `lib/spot-market.test.mjs` pins that
contract.

Set:

- `MARKETS_SERVICE_URL`

Local development against the live venue (what `.env.local` ships with):

```bash
MARKETS_SERVICE_URL=https://api.numofx.com
```

Against a local `markets-service`:

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

The spot order-book panel streams live depth and trades from `markets-service` over its WebSocket API (`GET /v1/ws`). The browser connects **directly** to the socket (no Next.js proxy), so the URL must be client-reachable:

- `NEXT_PUBLIC_MARKETS_WS_URL` — e.g. `wss://api.numofx.com/v1/ws` in production, `ws://127.0.0.1:8080/v1/ws` locally.

The client subscribes to the public `book` and `trades` channels for the `USDCcNGN-SPOT` symbol, seeds from the `snapshot` frame, and applies `update` deltas. Both channels are unauthenticated; the only server-side gate is `WS_ALLOWED_ORIGINS` on the `markets-service` deployment, which **must include the frontend origin** or the browser handshake is rejected. When the socket is unreachable, still connecting, empty or crossed, the panel falls back to the server-rendered REST snapshot — also real venue data, just fetched at page render. A genuinely one-sided live book is shown as it rests rather than being replaced by the older snapshot. When neither source has depth, the ladder says so. That fallback is silent — there is no on-screen indicator of which source is rendering, so a stream that never goes live looks identical to a healthy one. (A "Live liquidity" badge used to signal this and was removed in `bf5688e`; its absence is what let the spot stream sit permanently in fallback, fixed in `c7c2f2e`.)

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

The frontend picks its one market out of that list with `getLiveSpotMarket` (`lib/markets-service.ts`),
taking the first entry whose `contract_type` is `spot`, `base_asset_symbol` is `USDC` and
`quote_asset_symbol` is `cNGN`. The futures rows are ignored — the futures filter
(`getLiveDeliverableFXFutures`) was deleted along with the futures UI.

## Spot market status

Spot is **live again**. `markets-service` serves `USDCcNGN-SPOT` (`contract_type=spot`,
`order_entry_spec=usdc_cngn_spot_v1`) from `GET /v1/markets`, gated on `CNGN_SPOT_ASSET_ADDRESS`
being set on that deployment. Depth, trades and candles are real, and the spot order translation
contract below is what the engine actually expects.

> An earlier revision of this section said spot had been removed in `e75d513` (May 2026). That was
> true at the time and is no longer — verify against `GET /v1/markets` before trusting it again.

Legacy override envs: `NEXT_PUBLIC_USDCCNGN_APR_FUTURE_ASSET_ADDRESS` / `NEXT_PUBLIC_USDCCNGN_APR_FUTURE_SUB_ID` are no longer read at all — the code that applied them went with the futures UI. Leave them unset.

## Chain and execution

The app runs on **Base mainnet (8453)** — the chain the live venue settles on. `getAppChain`
returns mainnet unless `NEXT_PUBLIC_MATCHING_CHAIN_ID=84532` asks for Sepolia by name; an unset or
malformed value lands on mainnet rather than quietly on a testnet whose contracts do not exist here.

### RPC

`NEXT_PUBLIC_BASE_RPC_URL` must be set to the venue's keyed Alchemy endpoint on every deployment.
The code falls back to the public `https://mainnet.base.org` only so a missing env does not hard-fail
locally — that endpoint is shared and aggressively throttled, and a rate limit there is what made
wallet balance reads silently come back empty. Because the var is `NEXT_PUBLIC_`, the key ships in
the browser bundle: keep the Alchemy key domain-restricted, and rotate it there rather than in code.

### Matching stack (Base mainnet)

Since the **unified-account cutover on 2026-10-04**, spot and the perp trade on one stack: the
perp's TradeModule, under the perp's StandardManager (SRM), quoted in the perp's CashAsset, with
the perp's cNGN escrow as the spot asset. A wallet has one trading account for both markets, so a
spot fill settles into the same cash and collateral the perp margins against.

`GET /v1/markets` is the source of truth for the stack: the ticket signs spot orders for the
`asset_address` and `trade_module_address` the venue reports, and the perp reads its whole stack
from the `perp` block. Deposits, withdrawals, the legacy rows and account resolution use the
`NEXT_PUBLIC_*` envs below, which fall back to the code defaults in
`lib/matching-stack-defaults.json`; both name the live stack. `scripts/check-market-stack.mjs`
runs before every build and compares the resolved stack (env if set, else default) against the
venue, failing any build that disagrees, since a half-flipped deployment would deposit into one
escrow and trade another. A production build also fails when the venue cannot be reached.

| Env | Mainnet address (live, and the code default) | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_MATCHING_ADDRESS` | `0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191` | Matching — EIP-712 domain, `DepositedSubAccount` source |
| `NEXT_PUBLIC_TRADE_MODULE_ADDRESS` | `0xDea968188598BA0E3F58A56C0fdfF338C74F699f` | the perp TradeModule — the one module both markets' trades go through; it trades any base asset the order names |
| `NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS` | `0x0a10AE2f5D2482cE1e43bC309D430B8861C2b5aB` | WithdrawalModule — signed withdrawals from accounts Matching holds, submitted by the venue's executor |
| `NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS` | `0x568890A8D63Ba8a03b6eCbEedA1bD9f6ea014D5D` | periphery for `createAndDepositSubAccount` |
| `NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS` | `0xDE0423D0a1E15536265C9513d2e0c10DAb5835D4` | the perp SRM — the manager every trading account is resolved and created under |
| `NEXT_PUBLIC_SUBACCOUNTS_ADDRESS` | `0x7019244E25FA416e6Ca2ed2F3cA25277aef72843` | SubAccounts ERC-721 ledger |
| `NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS` | `0xA74E49b4Ed7cb176bc02ef4D8a1A3240C9aD4272` | the perp CashAsset — the USDC deposit escrow and the module's `quoteAsset()`, holding real USDC |
| `NEXT_PUBLIC_SPOT_ASSET_ADDRESS` / `NEXT_PUBLIC_CNGN_ASSET_ADDRESS` | `0x37c976bb5d4887a714ef19AF6B83e34fe2f37c98` | the perp cNGN escrow — the spot asset, the cNGN deposit escrow, and the collateral the SRM credits at its factor |
| `NEXT_PUBLIC_USDC_TOKEN_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | canonical Base USDC, 6 decimals |

The perp's own asset (`0xC74EfC8B4808803dBCF439E76Fde076d56625b8E`) is read from the `perp`
block only; no env names it.

> **Legacy balances.** Accounts under the two retired stacks can withdraw but never trade again:
> Matching has disallowed their modules, and SubAccounts cannot change an account's manager. With
> `NEXT_PUBLIC_LEGACY_SPOT_MANAGER_ADDRESS`, `NEXT_PUBLIC_LEGACY_SPOT_USDC_ESCROW_ADDRESS` and
> `NEXT_PUBLIC_LEGACY_SPOT_CNGN_ESCROW_ADDRESS` set (production: the 2026-09-10 stack above), the
> spot Assets tab lists a wallet's account on that stack withdraw-only. The original CashAsset
> `0x6B232A21…6fc6` and DeliverableFXManager `0xcE01f3D7…4d49` from before 2026-09-10 are offered
> nowhere, withdrawals included: that ledger's claims exceed the USDC it holds, so it cannot pay out.

> **The stack moves as one.** None of the Sepolia addresses have code on mainnet, so a half-flipped
> config is not a degraded app — it builds transactions against contracts that do not exist.
> `lib/subaccount-deposit-config.test.mjs` pins both stacks and the mainnet default.

### Base Sepolia (opt-in)

Reachable only with `NEXT_PUBLIC_MATCHING_CHAIN_ID=84532`:

- `NEXT_PUBLIC_MATCHING_ADDRESS=0x1599636347FD5bA1fBE21D58AfE0b8B9cbe283FF`
- `NEXT_PUBLIC_TRADE_MODULE_ADDRESS=0x0AAE65AaA66Fe7f54486cDbD007956d3De611990`
- `NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS=0xfdDb0D00Df6d1569E46e72D35e7B6CEE4Bb7F9FB`
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
  | Base mainnet (8453) | `0x37c976bb5d4887a714ef19AF6B83e34fe2f37c98` (the perp cNGN escrow) | `0x46C85152bFe9f96829aA94755D9f915F9B10EF5F` | 6 |
  | Base Sepolia (84532) | `0x1c08f30c204EE18EbBDc161c0f0864AFb826934b` | `0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6` | 18 |

  Each escrow is verified on-chain: `wrappedAsset()` returns the paired token, `deposit(uint256,uint256)` is
  present, and none has a `wlEnabled()` gate. The live mainnet escrow is also the spot market's `asset_address`
  from `GET /v1/markets` and the perp's collateral escrow, so cNGN deposits, cNGN orders and cNGN margin all
  settle against one contract; the build check enforces that the resolved address matches it. The escrow of
  the 2026-09-10 stack (`0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493`) is reachable withdraw-only through the
  legacy envs.

  > **Override the two together or not at all.** An escrow only accepts the exact ERC-20 it wraps. Base Sepolia
  > also hosts `0xe2387F04d3858e7Cb64Ef5Ed6617f9B2fcEEAfa2` — likewise named `cNGN`, but 6 decimals and not
  > wrapped by this venue's escrow. The app pointed at it until 2026-08-11; approving it produces a deposit that
  > cannot settle. Note the decimals differ by chain, so never hardcode 6: the deposit flow reads them from the
  > token contract.
- Deposits may be whitelist-gated on-chain (`WLWrappedERC20Asset.wlEnabled`). The app probes for the whitelist at
  preflight: plain `WrappedERC20Asset` deployments (including the current Base Sepolia one) have no gate and deposits
  are open; on WL deployments only operator-whitelisted subaccounts can deposit, and the create-and-deposit path
  cannot activate.

## Order Contract

The trader-facing contract is the engine's own, on both markets, under the identity order-entry
specs `cngn_usdc_spot_v1` and `cngn_usdc_perp_v1` (`lib/order-entry-spec.ts`):

- UI price: `USDC per cNGN` (shown to seven decimals; the engine's tick is 1e-18)
- UI size: `cNGN` (the engine rests whole cNGN, so the signer floors the size)
- UI `BUY` / perp `Long`: acquire cNGN, pay USDC
- UI `SELL` / perp `Short`: deliver cNGN, receive USDC

```text
engine_side   = ui_side
engine_price  = ui_price
engine_amount = floor(ui_size)
```

Fill deltas reconcile as:

```text
BUY  -> d cNGN = +size, dUSDC = -(size * price)
SELL -> d cNGN = -size, dUSDC = +(size * price)
```

Until 2026-10-07 the app showed the pair the other way up (cNGN per USDC, sized in USDC, side
flipped against the engine) under `usdc_cngn_*_v1`; that translation is gone from both the app and
markets-service.
