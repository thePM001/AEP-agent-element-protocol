/** Canvas sector minimap (from Agent Composer CP-00038, Composer Lite API). */

const NODE_COLORS = {
  agent: "#3de8ff",
  lattice: "#d4c84a",
  dock_validation: "#4af2c8",
  dock_inference: "#7aa7ff",
  data_input: "#22d3ee",
  data_output: "#f472b6",
  connector: "#38bdf8",

};

export class CanvasMinimap {
  constructor(host, api, options = {}) {
    this.host = host;
    this.api = api;
    this.width = options.width || 190;
    this.height = options.height || 118;
    this.padding = options.padding || 14;
    this._raf = null;
    this._dragging = false;
    this._dragPointerId = null;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "canvas-minimap-canvas";
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d");

    this.labelEl = document.createElement("div");
    this.labelEl.className = "canvas-minimap-label";
    this.labelEl.textContent = options.workspaceName || "Canvas";

    this.host.appendChild(this.labelEl);
    this.host.appendChild(this.canvas);
    this.host.classList.add("canvas-minimap-ready");

    this._bindEvents();
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.draw();
    });
  }

  _mapTransform(bounds) {
    const innerW = this.width - this.padding * 2;
    const innerH = this.height - this.padding * 2;
    const scale = Math.min(innerW / Math.max(bounds.width, 1), innerH / Math.max(bounds.height, 1));
    const offsetX = this.padding + (innerW - bounds.width * scale) / 2;
    const offsetY = this.padding + (innerH - bounds.height * scale) / 2;
    return {
      scale,
      offsetX,
      offsetY,
      worldToMap(wx, wy) {
        return {
          x: offsetX + (wx - bounds.minX) * scale,
          y: offsetY + (wy - bounds.minY) * scale,
        };
      },
      mapToWorld(mx, my) {
        return {
          x: bounds.minX + (mx - offsetX) / scale,
          y: bounds.minY + (my - offsetY) / scale,
        };
      },
    };
  }

  _panFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * this.width;
    const my = ((e.clientY - rect.top) / rect.height) * this.height;
    const bounds = this.api.getWorldBounds();
    const map = this._mapTransform(bounds);
    const world = map.mapToWorld(mx, my);
    this.api.centerOnWorld(world.x, world.y);
    this.scheduleDraw();
  }

  _bindEvents() {
    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this._dragging = true;
      this._dragPointerId = e.pointerId;
      this.host.classList.add("canvas-minimap-dragging");
      this.canvas.setPointerCapture?.(e.pointerId);
      this._panFromEvent(e);
    };
    const onPointerMove = (e) => {
      if (!this._dragging || e.pointerId !== this._dragPointerId) return;
      e.preventDefault();
      this._panFromEvent(e);
    };
    const endDrag = (e) => {
      if (!this._dragging) return;
      if (e?.pointerId != null && e.pointerId !== this._dragPointerId) return;
      this._dragging = false;
      this._dragPointerId = null;
      this.host.classList.remove("canvas-minimap-dragging");
    };

    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  draw() {
    const ctx = this.ctx;
    const { getWorldBounds, getViewportWorldBounds, getGraph, getSelectedId, nodeLayout, nodeColor } =
      this.api;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width, this.height);
    const bounds = getWorldBounds();
    const map = this._mapTransform(bounds);
    const innerX = this.padding;
    const innerY = this.padding;
    const innerW = this.width - this.padding * 2;
    const innerH = this.height - this.padding * 2;
    const graph = getGraph();
    const selectedId = getSelectedId();

    ctx.fillStyle = "rgba(5, 13, 26, 0.82)";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(61, 232, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(innerX + 0.5, innerY + 0.5, innerW - 1, innerH - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, innerY, innerW, innerH);
    ctx.clip();

    const gridStep = 40 * map.scale;
    if (gridStep >= 6) {
      ctx.strokeStyle = "rgba(61, 232, 255, 0.06)";
      for (let x = innerX; x <= innerX + innerW; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, innerY);
        ctx.lineTo(x, innerY + innerH);
        ctx.stroke();
      }
      for (let y = innerY; y <= innerY + innerH; y += gridStep) {
        ctx.beginPath();
        ctx.moveTo(innerX, y);
        ctx.lineTo(innerX + innerW, y);
        ctx.stroke();
      }
    }

    for (const node of graph.nodes) {
      const layout = nodeLayout(node);
      const color = nodeColor(node.type) || NODE_COLORS[node.type] || "#3de8ff";
      const cx = node.x + layout.width / 2;
      const cy = node.y + layout.height / 2;
      const p = map.worldToMap(cx, cy);
      const rw = Math.max(3, layout.width * map.scale * 0.38);
      const rh = Math.max(2, layout.height * map.scale * 0.38);
      const isSelected = node.id === selectedId;

      ctx.beginPath();
      if (layout.shape === "funnel") {
        ctx.moveTo(p.x - rw, p.y - rh);
        ctx.lineTo(p.x + rw, p.y - rh);
        ctx.lineTo(p.x + rw * 0.35, p.y + rh);
        ctx.lineTo(p.x - rw * 0.35, p.y + rh);
        ctx.closePath();
      } else {
        ctx.rect(p.x - rw / 2, p.y - rh / 2, rw, rh);
      }
      ctx.fillStyle = isSelected ? `${color}cc` : `${color}88`;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "rgba(61, 232, 255, 0.7)" : "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = isSelected ? 1.4 : 1;
      ctx.stroke();
    }

    const view = getViewportWorldBounds();
    if (view) {
      const tl = map.worldToMap(view.minX, view.minY);
      const br = map.worldToMap(view.maxX, view.maxY);
      const vw = br.x - tl.x;
      const vh = br.y - tl.y;
      ctx.fillStyle = "rgba(61, 232, 255, 0.1)";
      ctx.fillRect(tl.x, tl.y, vw, vh);
      ctx.strokeStyle = "rgba(61, 232, 255, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, Math.max(0, vw - 1), Math.max(0, vh - 1));
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}

export function initMinimap(host, api, options = {}) {
  return new CanvasMinimap(host, api, options);
}