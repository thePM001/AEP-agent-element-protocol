# AEP 2.8.6 Reference Policy Lattice

This is the official AEP reference policy lattice. It provides baseline security, deployment, writing and governance policies that serve as a template for all AEP implementations.

## Lattice Structure

Writing and security stay always on for every action. Other walls bind to a wrap or an action-path prefix. Who may act is written as agent grants. Live documents do not set the old rank field.

## Live Admit GAP files

Loaded as live Admit walls on the kernel collect-all pass.

Leftover yaml and rego files sit beside this directory and are not live Admit skins. Collect-all loads only GAP reference docs under AEP-Policy-System/reference. Operators use the reference GAP files from GAP-285-P6. See AEP-Policy-System/leftover.gap.


## Usage

Copy any policy to your project policies directory and customize.

```bash
cp AEP-Policy-System/reference/security.gap my-project/policies/
```

All reference policies are pre-validated with zero structural errors. Validate your own policies with `aep lint-policy`.

## Customization

1. Add your allowed domains to the deployment file
2. Add your specific PII patterns to the security file
3. Set agent grants per your agent hierarchy
4. Loaded as live Admit walls on the kernel collect-all pass

## Platform mandatory policies (not LRPs)

LRPs are sovereign states, regional unions and international bodies and their regulations. Platform policies live under EPSCOM hyperlattice mandatory rules.

## Compliance reference policies (LRPs)

Regulation LRP modules ship starter GAP templates (enable via wizard or `base_node.lrps`).

See AEP-Components/wizard/README.md for LRP install and dock wiring.

## Validation

```bash
aep lint-policy AEP-Policy-System/reference/security.gap
aep lint-policy AEP-Policy-System/reference/writing.gap
aep lint-policy AEP-Policy-System/reference/governance.gap
```
