# AEP clojure SDK

Compiled-AI lattice client scaffold. Calls Base Node via `aep-lattice-log` / Unix docking sockets.

## Produce

```bash
node AEP-User-Experience/scripts/produce-aep-sdks.mjs
```

## Transport

All outbound calls must use lattice-gated transport. See `AEP-Components/lattice-channels/`.

## Status

Scaffold produced by `produce-aep-sdks.mjs`. Implement language-native bindings against `lattice_client.*`.
