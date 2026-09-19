# Universal Connect Dock (UCD)

UCB-regulated dock for **optional external modules** that need controlled internet egress. Use for plan-driven downloads (HCSE, future third-party binaries) instead of raw `fetch` or unscoped lattice requests.

## Architecture

```
HCSE install hook
        |
        v
+---------------------------+
| UCD client (ucd-client)   |
+-------------+-------------+
              |
              | manifest-scoped HTTP
              v
+---------------------------+
| UCB :8412 egress proxy    |
+-------------+-------------+
              |
              v
        upstream API (GitHub releases, etc.)
```

Native AEP components continue to use `lattice-channels` against Base Node Unix socket docks. UCD is **only** for external optional modules regulated by UCB.

## Module specs

| Module | Spec | Component |
|--------|------|-----------|
| HCSE | `modules/hcse.json` | `AEP-Components/hcse/` |

## Related

- Base Node socket docks: `AEP-Base-Node/AEP-Docks/specs/`
- UCB bridge: `AEP-Base-Node/AEP-Docks/ucb/`
- Protocol: [`../docs/DOCKING-PORTS.md`](../docs/DOCKING-PORTS.md)
Part of the AEP 2.8.6 release line.
