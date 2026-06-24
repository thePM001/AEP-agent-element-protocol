# Composer Lite Sidebar Blocks

The right panel (`#lite-inspector`) is **empty chrome by default**. Your team ships the **registration mechanism only**; each deployment can load custom blocks per node type.

## Quick start

1. Create a block module (ES module):

```javascript
// my-blocks/agent-health.block.js
export function register({ register }) {
  register({
    id: "acme.agent-health",
    title: "Agent Health",
    nodeTypes: ["agent"],
    order: 20,
    render(ctx) {
      const status = ctx.node.data?.health || "unknown";
      return `<p class="lite-block-line">Status: <strong>${status}</strong></p>`;
    },
    mount(el, ctx) {
      const btn = el.querySelector("[data-action=refresh]");
      btn?.addEventListener("click", () => {
        ctx.api.updateNode(ctx.node.id, {
          data: { health: "ok", checkedAt: new Date().toISOString() },
        });
      });
    },
  });
}
export default register;
```

2. Load it when the app boots (in `app.js` or a small bootstrap script):

```javascript
import { loadBlocksFromUrls } from "./sidebar-blocks/registry.js";

await loadBlocksFromUrls([
  "assets/sidebar-blocks/examples/node-summary.block.js", // optional example
  "assets/my-blocks/agent-health.block.js",
]);
```

3. Select a node on the canvas. Matching blocks render in the right sidebar.

## Block spec

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique string |
| `title` | no | Section heading (defaults to `id`) |
| `nodeTypes` | no | Array of node type strings, or `"*"` for all types |
| `order` | no | Sort key (lower = higher on panel) |
| `render(ctx)` | yes | Returns `HTMLElement` or HTML string |
| `mount(el, ctx)` | no | Called after render; return cleanup function on unmount |
| `update(el, ctx)` | no | In-place update on selection/graph change (skip full re-render) |

## Context object (`ctx`)

```typescript
{
  node: CanvasNode | null;      // selected node
  edge: CanvasEdge | null;      // selected edge (blocks still keyed by node type)
  graph: { nodes, edges };
  palette: PaletteEntry[];
  api: {
    updateNode(id, patch): void;
    selectNode(id): void;
  };
}
```

`node.data` holds per-node metadata (Lite uses `data`; internal composer uses `meta`).

## Global API

`window.LiteSidebarBlocks` is available after `registry.js` loads:

```javascript
LiteSidebarBlocks.register({ ... });
LiteSidebarBlocks.unregister("my.block.id");
LiteSidebarBlocks.list();
LiteSidebarBlocks.load(["assets/my-blocks/foo.block.js"]);
```

## Node types (AEP 2.8 catalog)

Common canvas types: `agent`, `lattice`, `dock_validation`, `dock_inference`, `connector`, `ucb`, `data_input`, `data_output`, `component`, `regulation`, plus registry extension types from `GET /api/palette`.

Use `nodeTypes: ["lattice", "agent"]` to target specific types. Use `nodeTypes: "*"` sparingly (global blocks).

## Styling

Blocks live inside `.lite-inspector-block-body`. Reuse existing tokens:

- `--accent`, `--accent-soft`, `--line`, `--text`
- Utility classes: `.lite-block-kv`, `.lite-block-line`, `.inspector-form` (in `styles.css`)

Keep blocks narrow (sidebar width is `--inspector-w`, typically ~280px).

## Example module

See `public/assets/sidebar-blocks/examples/node-summary.block.js`.

## What we do not ship

- No built-in per-node forms in Composer Lite core
- No opinionated block library in the default bundle
- Teams own block content, loading URLs, and lifecycle

## CCA integration

CCA receives the selected node in chat context (`POST /api/cca/chat` → `context.selectedNode`). Blocks can call `ctx.api.updateNode` and CCA suggestions can be applied from the Composer panel preview bar.