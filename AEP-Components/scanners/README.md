# 12 / Scanners

Status: normative. Stability: evolving. The scanners are pattern lists that the shared rule table still changes.

## What it is

The scanners read the content of a proposal or of a model answer and report findings: a leaked key, personal data, an injection attempt and more. Each finding has a severity. The scanner result is one wall of the validation pass, so a hard finding closes the action together with every other failed rule.

## Place among the 18

The Model Gateway (17) and the streaming checks call the pipeline on input and output. The result reaches the One Validation Envelope (03) as the wall `scanner.bundle` and the Admit Gate (04) judges it. The same rule table compiles into walls of the Admit Gate through the policy loader. UCB (02) uses its own perimeter profile for external content.

## What ships in 2.9

A pipeline of 13 scanners. A scanner error fails the pipeline and never counts as a clean result.

| Scanner | Finds |
|---------|-------|
| PII | Personal data such as e-mail addresses and numbers of identity documents |
| Secrets | API keys, tokens and private keys |
| Injection | SQL injection, cross site scripting, template injection and command injection |
| Prompt injection | Instructions aimed at overriding the system prompt |
| Jailbreak | Attempts to talk a model out of its rules |
| Supply chain | Risky package and install patterns |
| Toxicity | Slurs, hate speech patterns and threats |
| URLs | Links outside an allow list and obfuscated links |
| Data profile | Null rates, duplicates, outliers and schema drift in data. Off by default |
| Predictions | Forecast statements outside configured bounds |
| Brand | Content against brand guidelines |
| Regulatory | Missing required disclosures |
| Temporal | Time claims against configured constraints |

The page lists eleven threat vectors. This table maps them to the scanners of the tree.

| Name on the page | Scanner in this tree |
|------------------|----------------------|
| Secrets | Secrets |
| PII | PII |
| Evasion | Jailbreak and the obfuscated link patterns of URLs |
| Toxicity | Toxicity |
| Malware | Supply chain covers risky packages. A malware scanner is planned |
| Leaks | Secrets and PII |
| Exploits | Injection |
| Sensitive data | PII |
| Compliance | Regulatory and Brand |
| Prompt injection | Prompt injection |
| Anomalies | Data profile and Predictions. A general anomaly scanner is planned |

## Layout

| Path | Role |
|------|------|
| `lib/pipeline.ts` | The pipeline and its factory |
| `lib/*.ts` | One file per scanner |
| `lib/admit-rule-table.ts` | The generated form of the shared rule table |
| `rules/scan-rule-table.json` | The one scan rule table |
| `tools/generate-admit-rule-table.mjs` | Generates the TypeScript table from the JSON file |
| `tests/` | vitest suites for scanners, pipeline and rule table |

## Interfaces

- `ScannerPipeline` with `getScanners()` and the scan call, built by the factory in `lib/pipeline.ts` from a `ScannersConfig`.
- The `Scanner` interface in `lib/types.ts` for a scanner of your own.
- Rule table: `rules/scan-rule-table.json`, read by the scanners and by the crate in `AEP-Components/policy-system-admit/`.
- Component id `gap-runtime-scanners` with the manifest `AEP-Base-Node/AEP-Registry/components/gap-runtime-scanners.json`.

## Limits

- The scanners match patterns. They are no proof of safe content.
- A scanner finding is one wall. The verdict is the Admit Gate (04).
- The scanners run where a caller invokes them. The page describes all scanners inside one validation interval of the kernel. In this tree the kernel reads the scanner result as a wall and a scanner run inside the Base Node Pulse (10) is planned.

## Run and test

```bash
npx vitest run AEP-Components/scanners
node AEP-Components/scanners/tools/generate-admit-rule-table.mjs
```

## Related documents

- `AEP-Components/scanners/lib/README.md` for notes on the bundle
- `AEP-Components/mcp-security/README.md` for MCP traffic
- `AEP-Components/streaming/README.md` for checks on a stream
