# Platform core

Shared helpers and the regulation catalog of the public tree.

- `lib/paths.mjs` resolves the data folder, the socket base and the binaries of a Base Node.
- `lib/lrp.mjs` reads the regulation catalog and the platform contracts.
- `lrp/catalog.json` lists the regulation modules. `lrp/modules/` holds one manifest per module.

The coding governance, intent ledger, lattice channels, hyperlattice and registry components import these files.
