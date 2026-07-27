# UI Subprotocol

Three-layer UI governance (AEP-FCR). Validation is Rust; declarations are JSON/YAML in this folder.

## Layers

| File | Layer | Contents |
|------|-------|----------|
| `aep-scene.json` | Structure | Element tree, z-order, layout, parent/child |
| `aep-registry.yaml` | Behaviour | Per-element function, states, events, constraints, `skin_binding` |
| `aep-theme.yaml` | Skin | Colors, typography, `component_styles` blocks |

Changing one layer must not require editing the others.

## Rust crate

- **Crate:** `aep-subprotocol-ui`
- **Entry:** `src/lib.rs` - `UiBundle::load()` + `UiBundle::validate()`

Checks:

- `aep_version` present in all three files
- Scene parent/child references resolve
- Every `skin_binding` in the registry exists in `theme.component_styles`

## CLI

```bash
aep-subprotocol ui \
  --scene AEP-Subprotocols/ui/aep-scene.json \
  --registry AEP-Subprotocols/ui/aep-registry.yaml \
  --theme AEP-Subprotocols/ui/aep-theme.yaml
```

## dynAEP

Default paths are wired in `dynAEP/dynaep-config.yaml` under `aep_sources`.