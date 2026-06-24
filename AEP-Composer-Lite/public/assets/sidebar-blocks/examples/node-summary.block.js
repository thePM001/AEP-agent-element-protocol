/**
 * Example sidebar block - copy and adapt for your node types.
 * Load from index.html or app.js:
 *   loadBlocksFromUrls(["assets/sidebar-blocks/examples/node-summary.block.js"])
 */

export function register({ register }) {
  register({
    id: "example.node-summary",
    title: "Node Summary",
    nodeTypes: "*",
    order: 10,
    render(ctx) {
      const node = ctx.node;
      if (!node) return "";
      const dataKeys = Object.keys(node.data || {});
      return `
        <dl class="lite-block-kv">
          <div><dt>ID</dt><dd>${node.id}</dd></div>
          <div><dt>Type</dt><dd>${node.type}</dd></div>
          <div><dt>Position</dt><dd>${Math.round(node.x)}, ${Math.round(node.y)}</dd></div>
          ${dataKeys.length ? `<div><dt>Data keys</dt><dd>${dataKeys.join(", ")}</dd></div>` : ""}
        </dl>`;
    },
  });
}

export default register;