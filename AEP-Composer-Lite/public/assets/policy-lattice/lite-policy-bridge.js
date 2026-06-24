/** Wire internal LatticeStagePolicyPanel to Composer Lite graph (data ↔ meta). */
(function (global) {
  let latticeShim = null;
  let panel = null;

  function wrapNode(node) {
    if (!node) return null;
    if (!node.data) node.data = {};
    node.meta = node.data;
    return node;
  }

  global.initLitePolicyPanel = function initLitePolicyPanel(deps) {
    const { getGraph, updateNodeById, onFocusCca, onOpen, onClose } = deps;
    latticeShim = {
      get nodes() {
        return getGraph().nodes.map((n) => wrapNode(n));
      },
      get edges() {
        return getGraph().edges;
      },
      updateNode(id, patch = {}) {
        const node = getGraph().nodes.find((n) => n.id === id);
        if (!node) return;
        const next = {
          label: patch.label !== undefined ? patch.label : node.label,
          data: patch.meta !== undefined ? patch.meta : node.data,
        };
        updateNodeById(id, next);
      },
      _scheduleDraw() {},
    };

    if (!global.composerCcaPane) {
      global.composerCcaPane = {
        focusComposer(prompt) {
          onFocusCca?.(prompt);
        },
        setTab() {},
        toggleExpanded() {},
      };
    }

    const root = document.getElementById("lattice-stage-policy-panel");
    if (!root || typeof global.LatticeStagePolicyPanel !== "function") return null;

    panel = new global.LatticeStagePolicyPanel(root, {
      lattice: latticeShim,
      onChange: () => {},
    });

    const nativeOpen = panel.open.bind(panel);
    const nativeClose = panel.close.bind(panel);
    panel.open = function openLite(nodeOrId, stageIndex) {
      const id = typeof nodeOrId === "object" ? nodeOrId?.id : nodeOrId;
      const raw = getGraph().nodes.find((n) => n.id === id);
      if (!raw) return;
      const live = getGraph().nodes.find((n) => n.id === raw.id) || raw;
      wrapNode(live);
      onOpen?.();
      nativeOpen(live, stageIndex);
    };
    panel.close = function closeLite() {
      nativeClose();
      onClose?.();
    };

    return panel;
  };
})(window);