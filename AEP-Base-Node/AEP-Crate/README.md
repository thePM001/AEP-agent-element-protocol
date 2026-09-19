# AEP-Crate

Kernel daemon crate for Base Node. The workspace package is aep-base-node. The binaries are aep-base-node and aep-lattice-log.

This folder is one of the six kernel children under AEP-Base-Node/. The six children are AEP-Crate, AEP-Docks, AEP-Potomitan, AEP-Multi-Base-Node, AEP-Registry and AEP-Agent-Control-Hub.

After admit, CAW at AEP-CAW/ runs the admitted action.

Nested rust leaf crate/ under a product stays.

## Build

```bash
cargo build --release -p aep-base-node
```

The default build is the single Base Node kernel.
