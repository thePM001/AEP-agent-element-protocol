# AEP 2.8.6 Policy Lattice - Quick Setup

## 1. The one authoring form for the Admit layer

GAP is the one authoring form that feeds the Admit layer. A GAP file is a
declarative record with an address, a pattern block and an action block. The
reference form lives in `AEP-Policy-System/reference/`.

```json
{
  "address": { "domain": "aep.reference.writing", "id": "conventions.v1" },
  "pattern": {
    "guard": "true",
    "invariants": [
      { "expr": "no_em_dashes", "lang": "gapdsl", "severity": "hard" }
    ]
  },
  "action": { "type": "template", "content": "Apply AEP 2.8.6 writing conventions." }
}
```

## 2. Add your policies

Create GAP files in your policy directory:

```bash
aep policy-init ./my-policies
```

Every policy file you add is one GAP record. The Admit layer loads GAP and
compiles each invariant into an Admit wall on the one collect-all pass.

## 3. Validate your lattice

```bash
aep verify ./my-policies/
aep lint-policy ./my-policies/reference/writing.gap
```

## 4. Test against inputs

```bash
aep red-team
```

## Lattice structure

```
my-policies/
 |-- lattice.yaml
 |-- reference/
 | |-- security.gap
 | |-- deployment.gap
 | |-- writing.gap
 | |-- governance.gap
 |-- custom/
 |-- my-policy.gap
```

## The host layer keeps its own rules

The host engine reads its own inputs. Two classes stay in the host layer and they
are not Admit layer authoring forms. See `AUTHORING-FORM.md` for the table.

| Class | Path | Read by |
|------|------|------|
| Host lattice policy | `AEP-Policy-System/*.policy.yaml` | The host lattice engine only |
| Host compiled lattice policy | `AEP-Policy-System/*.rego` | The host lattice engine only |

The Admit layer reads GAP. A YAML policy file and a Rego rule file never decide
an Admit wall on their own.

## Composition

GAP files load as live Admit walls on the kernel collect-all pass. Policies
compose by conjunction, so every invariant must pass for an action to be
allowed. The lattice structure guarantees that composed policies have
well-defined results.
