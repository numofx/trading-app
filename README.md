# Trading App

**An orderbook for spot and futures stablecoin FX.**

Enables spot trading and physically delivered FX futures on USDC/cNGN. Integrated with off/on ramping via Busha and Coinbase APIs for instant USD/USDC and NGN/cNGN conversions.

## Runtime config

The app discovers the live spot and deliverable futures markets from `markets-service` and renders both through the same orderbook UI.

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
In production, `MARKETS_SERVICE_URL` must point at the live `markets-service` deployment.

For the current Base staging deployment, `markets-service` should expose:

- `asset_address=<WRAPPED_CNGN>`
- `sub_id=0`
- `contract_type=spot`
- `settlement_type=spot`
- `asset_address=0x752803d72c1835cdcd300C7fDE6c7D7d2F12E679`
- `sub_id=1777507200`
- `contract_type=deliverable_fx_future`
- `settlement_type=physical_delivery`

If the frontend is deployed on Railway, encode `MARKETS_SERVICE_URL` in that deploy environment and treat it as required production configuration rather than tribal knowledge.

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
