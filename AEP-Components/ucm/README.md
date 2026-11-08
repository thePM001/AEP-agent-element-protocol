# Universal Computation Module (UCM)

Status: normative. Stability: the program form, the receipt form and the error codes are stable for ucm-rules-1.

UCM is the calculation engine of AEP. Agents call it instead of producing numbers in token space. Every result is exact unless a program asks for binary64, every evaluation runs under a budget and touches no file, network or process. Every result comes with a receipt signed with ML-DSA-65 that anyone can check and replay. Admit can require such a receipt for any field a task manifest declares as computed.

A System-1 lookup finds the right UCM function, unit, constant or formula for a task. It only finds the tool. The agent writes the program and UCM computes the result.

The normative text is [spec/UCM-SPEC.md](spec/UCM-SPEC.md). The threat model is [THREAT-MODEL.md](THREAT-MODEL.md).

## Quick start

```bash
cargo build --release -p aep-ucm
export UCM_DATA=$PWD/ucm-data
B=rust/target/release/aep-ucm

$B lookup monthly payment on a loan
printf 'input p: money[EUR];\ninput n: int;\nround(p * n * 1.081, 2, "half_even")\n' > total.ucm
$B eval total.ucm --inputs '{"p": "19.90 EUR", "n": "3"}' > out.json
python3 -c 'import json; d = json.load(open("out.json")); print(d["result"]); json.dump(d["receipt"], open("receipt.json", "w"))'
$B verify receipt.json --replay
$B serve
```

The last command serves the HTTP API on loopback port 8414.

## Programs

```
input principal: money[CHF];
input rate: rational;
input years: int;
let monthly = rate / 12;
let n = years * 12;
round(principal * monthly / (1 - (1 + monthly) ^ (-n)), 2, "half_even")
```

- Numbers are exact: 1/3 is a rational, 12.50 is a decimal of scale 2.
- Every rounding names its mode: half_even, half_up, half_down, up, down, floor or ceiling.
- Money carries its currency and never mixes currencies. convert(m, "EUR", rate) takes a rate you supply.
- Quantities carry units: q(90, "km/h"), to(q(1, "mi"), "km"). The checker refuses adding metres to seconds.
- Dates and time zones: date("2026-11-07"), add_months(d, 1), instant("2026-11-07T09:30", "Europe/Zurich").
- Statistics, exact linear algebra, number theory, intervals and cited constants and formulas: see `aep-ucm catalog`.
- Binary64 only inside float { }: float { sqrt(2) }. The receipt then says float_used true.

## Inputs

Inputs are JSON strings: "12.50 EUR" for money, "9.81 m/s^2" for a quantity, "1/3" for a rational, "2026-11-07" for a date and arrays for vectors.

## HTTP API

| Endpoint | Purpose |
|----------|---------|
| GET /health | Liveness |
| GET /ucm/v1/capabilities | Engine build, node id, public key, library digest, budgets |
| GET /ucm/v1/catalog | Every function, unit, constant and formula |
| POST /ucm/v1/lookup | System-1 lookup: {"query": "...", "k": "5"} |
| POST /ucm/v1/eval | {"program": "...", "inputs": {...}} gives the result and a signed receipt |
| POST /ucm/v1/verify | {"receipt": {...} or "ucmr_...", "mode": "signature" or "replay"} |
| POST /ucm/v1/explain | Typecheck only |
| GET /ucm/v1/receipts/{id} | A stored receipt |
| POST /ucm/v1/mcp | MCP over JSON-RPC |

With UCM_API_KEY set, every POST needs Authorization: Bearer KEY or X-UCM-API-Key: KEY.

## MCP

`aep-ucm mcp` serves MCP on stdio with the tools ucm_lookup, ucm_eval, ucm_verify and ucm_explain. See [examples/README.md](examples/README.md) for Claude Code, LangGraph and a native AEP component.

## Receipts and Admit

A receipt is JSON that validates against AEP-Base-Node/AEP-Registry/schemas/ucm-receipt-v1.json. To make Admit check computed numbers:

1. Declare the fields in the task manifest: "computed_fields": ["/total"].
2. Put the receipt for each field into the action payload under ucm.receipts, keyed by the same pointer.
3. Trust the node key: write the hex public key from `aep-ucm key` into the file AEP_UCM_TRUSTED_KEYS names.
4. Set AEP_UCM_RECEIPT_PROFILE to warn, then strict.

Under strict, a missing receipt, an invalid or untrusted receipt and a field that differs from its signed result close the walls of policy ucm-computed-claims. Admit decides as before for every action without computed fields.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| UCM_HOST, UCM_PORT | 127.0.0.1, 8414 | Listen address |
| UCM_DATA | AEP_DATA/ucm | Node key, receipts and the receipt log |
| UCM_API_KEY | none | Key for POST endpoints |
| UCM_TRUSTED_KEYS | none | Extra trusted public keys for verify, one per line |
| UCM_BUDGET_CEILING_STEPS, _BITS, _LEN, _MILLIS | spec section 8 | Operator ceiling |
| UCM_LOOKUP_RANKER_URL, UCM_LOOKUP_RANKER_MODEL, UCM_LOOKUP_RANKER_KEY_FILE | none | Optional System-1 tier two ranker, any OpenAI compatible chat endpoint such as model-gateway or Ollama |
| UCM_LATTICE_RECORD, AEP_LATTICE_LOG_BIN, AEP_LATTICE_DB | off | Record each receipt digest in the Base Node lattice log |
| UCM_MAX_CONCURRENT | 4 | Evaluations at a time |

## Layout

| Path | Content |
|------|---------|
| spec/ | Normative specification |
| crates/ucm-core | Parser, checker, exact evaluator, units, time, library |
| crates/ucm-receipt | Signed receipts and the node key |
| crates/ucm-lookup | System-1 lookup |
| crates/ucm-service | aep-ucm binary: CLI, HTTP, MCP, receipt store |
| clients/ts | TypeScript client |
| library | Cited constants and formulas |
| vectors | Conformance vectors with Python computed expectations |
| scripts | Vector generator, language neutral runner and differential test |
| fuzz | cargo-fuzz targets |

## Testing

```bash
cargo test -p aep-ucm-core -p aep-ucm-receipt -p aep-ucm-lookup -p aep-ucm
cargo test -p aep-policy-system-admit --test ucm_redteam
python3 -I AEP-Components/ucm/scripts/run_vectors.py emit cases.jsonl
rust/target/release/aep-ucm batch < cases.jsonl > got.jsonl
python3 -I AEP-Components/ucm/scripts/run_vectors.py check got.jsonl
python3 -I AEP-Components/ucm/scripts/differential.py generate 1000000 diff.jsonl expect.jsonl
rust/target/release/aep-ucm batch < diff.jsonl > diff-got.jsonl
python3 -I AEP-Components/ucm/scripts/differential.py compare expect.jsonl diff-got.jsonl
```
