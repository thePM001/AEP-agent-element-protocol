# Custom sub-lattices inside the AEP hyperlattice

AEP does not ship domain products. Base Node is the kernel. The wrap is one hyperlattice per governed system: scene plus action paths plus written policy plus dock channels.

A custom sub-protocol is an attach on that wrap. It is not a second kernel. Bundled UI, commerce, workflow, REST, events, IaC or MCP crates are not the library.

## What you declare

You own the domain files. Structure is a scene graph of what exists. Behaviour is the registry of operations, types, fields and constraints. Skin is look only. Action paths name each allowed agent move as a node on the hyperlattice. GAP policy says who may do what. Dock channels take sealed capsules only.

## Kernel sequence

Seal, freeze, wait, collect-all Admit then Apply. live-entry is the worked scene. A domain check may reject a proposed payload before seal. It may not skip Admit. Execution happens only after Base Node allows the output. TypeScript processEvent is not product Admit.

## Pattern

REGISTRY defines valid operations. VALIDATOR checks every agent-proposed action against that registry. REJECTION returns specific errors so the agent can self-correct. EXECUTION applies only Admit-allowed actions. Registries are stateless and the caller passes execution state in.

## Do not

Do not add a parallel runtime that opens unsealed work. Do not count extra domain folders as extra library layers. The library count is the kernel, protocol, execution companion and clients table.
