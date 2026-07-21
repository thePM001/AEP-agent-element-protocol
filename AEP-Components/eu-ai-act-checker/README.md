# eu-ai-act-checker

Fail-closed EU AI Act LRP **compliance checking pack** for AEP.

This is a technical control pack. It is **not** a legal certification of Regulation (EU) 2024/1689 conformity.

## Build

```bash
cd crate
cargo test
cargo build --release
```

## Run conformance

```bash
eu-ai-act-checker --pack-root ../wizard/lrp/modules/eu-ai-act conformance
```

## Gate

```bash
./gates/gate-eu-ai-act-lrp.sh
```

## Config

When LRP `eu-ai-act` is enabled, require at least `role` and `risk_class`. For `high_risk` also require retention, logging, incident reporting and risk management evidence.
