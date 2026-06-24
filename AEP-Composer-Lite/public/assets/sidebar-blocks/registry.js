/**
 * Sidebar block registry for Composer Lite right panel (#lite-inspector).
 * Developers register blocks per node type; the shell renders them on selection.
 */

const blocks = [];

function normalizeTypes(nodeTypes) {
  if (!nodeTypes || nodeTypes === "*") return ["*"];
  return Array.isArray(nodeTypes) ? nodeTypes.map(String) : [String(nodeTypes)];
}

function matchesNodeType(block, nodeType) {
  const types = block.nodeTypes || ["*"];
  return types.includes("*") || types.includes(nodeType);
}

/**
 * @param {object} spec
 * @param {string} spec.id - Unique block id
 * @param {string} [spec.title] - Panel heading
 * @param {string[]|string} [spec.nodeTypes] - Node types or "*" for all
 * @param {number} [spec.order] - Lower renders first
 * @param {function} spec.render - (ctx) => HTMLElement | string
 * @param {function} [spec.mount] - (el, ctx) => cleanup fn or void
 * @param {function} [spec.update] - (el, ctx) => void; skips re-render when provided
 */
export function registerBlock(spec) {
  if (!spec?.id || typeof spec.render !== "function") {
    throw new Error("Sidebar block requires id and render(ctx)");
  }
  const entry = {
    id: String(spec.id),
    title: spec.title || spec.id,
    nodeTypes: normalizeTypes(spec.nodeTypes),
    order: Number.isFinite(spec.order) ? spec.order : 100,
    render: spec.render,
    mount: spec.mount || null,
    update: spec.update || null,
  };
  const idx = blocks.findIndex((b) => b.id === entry.id);
  if (idx >= 0) blocks[idx] = entry;
  else blocks.push(entry);
  blocks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return entry;
}

export function unregisterBlock(id) {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx >= 0) blocks.splice(idx, 1);
}

export function listBlocks() {
  return blocks.slice();
}

export function getBlocksForSelection(ctx) {
  const nodeType = ctx?.node?.type;
  if (!nodeType) return [];
  return blocks.filter((b) => matchesNodeType(b, nodeType));
}

/**
 * Load block modules from URLs (ES modules must export register(sidebar) or default).
 * @param {string[]} urls
 */
export async function loadBlocksFromUrls(urls = []) {
  const loaded = [];
  for (const url of urls) {
    if (!url) continue;
    try {
      const mod = await import(url);
      const fn = mod.register || mod.default;
      if (typeof fn === "function") {
        fn({ register: registerBlock, unregister: unregisterBlock });
        loaded.push(url);
      }
    } catch (err) {
      console.warn(`[LiteSidebarBlocks] failed to load ${url}:`, err.message);
    }
  }
  return loaded;
}

export const LiteSidebarBlocks = {
  register: registerBlock,
  unregister: unregisterBlock,
  list: listBlocks,
  load: loadBlocksFromUrls,
};

if (typeof globalThis !== "undefined") {
  globalThis.LiteSidebarBlocks = LiteSidebarBlocks;
}