/**
 * Composer Lite right sidebar - renders developer-registered blocks per node type.
 */

import {
  getBlocksForSelection,
  loadBlocksFromUrls,
  listBlocks,
} from "./sidebar-blocks/registry.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toElement(content) {
  if (!content) return null;
  if (content instanceof HTMLElement) return content;
  const wrap = document.createElement("div");
  wrap.innerHTML = String(content);
  return wrap.firstElementChild || wrap;
}

export function initLiteInspector({
  rootId = "lite-inspector",
  getGraph,
  getSelectedId,
  getSelectedEdgeId,
  getNodeById,
  getPalette,
  updateNodeById,
  selectNode,
  blockUrls = [],
} = {}) {
  const root = document.getElementById(rootId);
  if (!root) return null;

  const cleanups = new Map();
  let lastKey = "";

  function buildContext() {
    const graph = getGraph?.() || { nodes: [], edges: [] };
    const nodeId = getSelectedId?.();
    const edgeId = getSelectedEdgeId?.();
    const node = nodeId ? getNodeById?.(nodeId) : null;
    const edge = edgeId ? graph.edges?.find((e) => e.id === edgeId) : null;
    return {
      node,
      edge,
      graph,
      palette: getPalette?.() || [],
      api: {
        updateNode: (id, patch) => updateNodeById?.(id, patch),
        selectNode: (id) => selectNode?.(id),
      },
    };
  }

  function clearBlocks() {
    for (const fn of cleanups.values()) {
      try {
        fn?.();
      } catch {
        /* ignore */
      }
    }
    cleanups.clear();
    root.innerHTML = "";
    root.classList.remove("lite-inspector-active");
    root.removeAttribute("data-selection");
  }

  function renderEmptyChrome() {
    clearBlocks();
    root.innerHTML = `
      <div class="lite-inspector-empty" aria-hidden="true">
        <span class="lite-inspector-empty-glyph">◈</span>
        <p class="lite-inspector-empty-title">Inspector</p>
        <p class="lite-inspector-empty-hint">Register sidebar blocks for node types. See docs/SIDEBAR-BLOCKS.md.</p>
      </div>`;
  }

  function renderBlocks(ctx) {
    const blocks = getBlocksForSelection(ctx);
    if (!blocks.length) {
      renderEmptyChrome();
      return;
    }

    const key = `${ctx.node?.id || ""}:${blocks.map((b) => b.id).join(",")}`;
    if (key === lastKey && root.querySelector(".lite-inspector-block")) {
      for (const block of blocks) {
        const section = root.querySelector(`[data-block-id="${block.id}"]`);
        if (section && block.update) {
          try {
            block.update(section.querySelector(".lite-inspector-block-body"), ctx);
          } catch (err) {
            console.warn(`[lite-inspector] update ${block.id}:`, err);
          }
        }
      }
      return;
    }
    lastKey = key;

    for (const fn of cleanups.values()) {
      try {
        fn?.();
      } catch {
        /* ignore */
      }
    }
    cleanups.clear();
    root.innerHTML = "";
    root.classList.add("lite-inspector-active");
    root.dataset.selection = ctx.node?.type || "";

    const header = document.createElement("header");
    header.className = "lite-inspector-head";
    header.innerHTML = `
      <span class="lite-inspector-kicker">Node</span>
      <h2 class="lite-inspector-title">${esc(ctx.node?.label || ctx.node?.type || "Selection")}</h2>
      <span class="lite-inspector-type">${esc(ctx.node?.type)}</span>`;
    root.appendChild(header);

    const stack = document.createElement("div");
    stack.className = "lite-inspector-stack";
    root.appendChild(stack);

    for (const block of blocks) {
      const section = document.createElement("section");
      section.className = "lite-inspector-block";
      section.dataset.blockId = block.id;
      section.innerHTML = `<h3 class="lite-inspector-block-title">${esc(block.title)}</h3>`;

      const body = document.createElement("div");
      body.className = "lite-inspector-block-body";
      section.appendChild(body);
      stack.appendChild(section);

      try {
        const el = toElement(block.render(ctx));
        if (el) body.appendChild(el);
        if (block.mount) {
          const cleanup = block.mount(body, ctx);
          if (typeof cleanup === "function") cleanups.set(block.id, cleanup);
        }
      } catch (err) {
        body.innerHTML = `<p class="lite-inspector-error">Block ${esc(block.id)} failed: ${esc(err.message)}</p>`;
      }
    }
  }

  function refresh() {
    const ctx = buildContext();
    if (ctx.node) renderBlocks(ctx);
    else renderEmptyChrome();
  }

  window.addEventListener("wasm-composer:select", refresh);
  window.addEventListener("wasm-composer:graph-change", refresh);

  const boot = async () => {
    if (blockUrls.length) await loadBlocksFromUrls(blockUrls);
    if (!listBlocks().length) renderEmptyChrome();
    else refresh();
  };
  boot();

  return { refresh, loadBlocks: loadBlocksFromUrls };
}