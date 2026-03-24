# Trading App

**A futures exchange for stablecoin FX.**

Enables hedging with physically delivered FX futures on USDC/cNGN. Integrated with off/on ramping via Busha and Coinbase APIs for instant USD/USDC and NGN/cNGN conversions.

## Runtime config

The app discovers the live deliverable future from `markets-service` and renders that instrument as the canonical futures market.

Set:

- `MARKETS_SERVICE_URL`

Example:

```bash
MARKETS_SERVICE_URL=http://127.0.0.1:8080
```

For the current Base staging deployment, `markets-service` should expose:

- `asset_address=0x752803d72c1835cdcd300C7fDE6c7D7d2F12E679`
- `sub_id=1777507200`
- `contract_type=deliverable_fx_future`
- `settlement_type=physical_delivery`
