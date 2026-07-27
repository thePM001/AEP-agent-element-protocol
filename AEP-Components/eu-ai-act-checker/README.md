# eu-ai-act-checker

EU AI Act compliance checking pack for AEP. Not a legal certification.

## One definition file

`EU-AI-ACT-PACK.json` - controls, roles, risk classes, Annex assist, evidence schemas, fixtures.

## One gate

```bash
./gates/gate-eu-ai-act.sh
```

## Build (once)

```bash
cd crate && cargo test && cargo build --release
```
