# Commerce Subprotocol

Validates agentic commerce actions: cart updates, checkout, payment negotiation, returns. Spend tracking persists to `.aep/commerce/spend.jsonl`.

## Rust crate

- **Crate:** `aep-subprotocol-commerce`
- **Modules:** `validator`, `spend`, `policy`, `types`

## Actions

| Action | Validated |
|--------|-----------|
| `discover` | Always allowed |
| `add_to_cart` / `update_cart` | Merchant allow/block lists, category blocks, currency, price > 0, metadata injection scan |
| `checkout_start` / `checkout_complete` | Max transaction, daily spend cap, human gate threshold, payment method, currency |
| `payment_negotiate` / `payment_authorize` | Handler allowlist, amount, currency, max transaction |
| `return_initiate` / `refund_request` | Order ID required, reason injection scan |
| `fulfillment_query` / `order_status` | Always allowed |

## Reference data

| File | Purpose |
|------|---------|
| `model-mapping.yaml` | Canonical model name to provider-specific IDs |
| `price-catalog.yaml` | Per-million-token pricing for economics routing |

Used by harness economics (`harness/*/harness/aep-economics.js`).

## CLI

```bash
aep-subprotocol commerce \
  --action add_to_cart \
  --payload '{"item":{"productId":"p1","quantity":1,"price":10,"currency":"USD"},"cart":{"id":"c1","items":[],"total":10,"currency":"USD","merchantId":"shop"}}' \
  --policy '{"blocked_merchants":["bad_shop"],"max_daily_spend":2000}'
```

## LRP

Enable via component registry: `commerce-subprotocol` (`AEP-Base-Node/registry/components/commerce-subprotocol.json`).