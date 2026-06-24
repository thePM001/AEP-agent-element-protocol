# AEP YAML Policy Importer

Imports external policy formats and maps them to AEP covenants.

## Supported Formats

- YAML policy conditions (tool-call format)
- JSON policy documents
- OPA Rego policies (via transpiler)
- Cedar policies (via transpiler)

## Usage

```bash
aep import-policy external-policy.yaml --output policies/imported.gap
```

## Mapping

External policies are mapped to AEP covenants:
- Tool conditions -> covenant constraints
- Allow/deny rules -> action pipeline steps
- Rate limits -> execution parameters
- Approval requirements -> human-in-the-loop gates
