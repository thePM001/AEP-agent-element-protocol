/** Custom hover tooltips (no native browser title dialogs). */

let instance = null;

class LiteTooltip {
  constructor() {
    this.node = document.createElement("div");
    this.node.className = "lite-tooltip";
    this.node.setAttribute("role", "tooltip");
    this.node.hidden = true;
    document.body.appendChild(this.node);
    this._timer = null;
    this._anchor = null;
    this._onScroll = () => this._hide();
    this._onResize = () => this._hide();
    window.addEventListener("scroll", this._onScroll, true);
    window.addEventListener("resize", this._onResize);
  }

  bind(root = document) {
    root.querySelectorAll("[data-lite-tip]").forEach((anchor) => {
      if (anchor.dataset.liteTipBound === "1") return;
      anchor.dataset.liteTipBound = "1";
      anchor.removeAttribute("title");
      anchor.addEventListener("mouseenter", () => this._schedule(anchor));
      anchor.addEventListener("mouseleave", () => this._hide());
      anchor.addEventListener("focus", () => this._schedule(anchor));
      anchor.addEventListener("blur", () => this._hide());
    });
  }

  _schedule(anchor) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._show(anchor), 280);
  }

  _show(anchor) {
    const text = anchor.dataset.liteTip;
    if (!text) return;
    this._anchor = anchor;
    this.node.textContent = text;
    this.node.hidden = false;
    this._position();
  }

  _hide() {
    clearTimeout(this._timer);
    this.node.hidden = true;
    this._anchor = null;
  }

  _position() {
    if (!this._anchor) return;
    const r = this._anchor.getBoundingClientRect();
    this.node.style.visibility = "hidden";
    this.node.hidden = false;
    const tip = this.node.getBoundingClientRect();
    let top = r.bottom + 8;
    let left = r.left + (r.width - tip.width) / 2;
    if (left < 8) left = 8;
    if (left + tip.width > window.innerWidth - 8) left = window.innerWidth - tip.width - 8;
    if (top + tip.height > window.innerHeight - 8) top = r.top - tip.height - 8;
    this.node.style.top = `${Math.round(top)}px`;
    this.node.style.left = `${Math.round(left)}px`;
    this.node.style.visibility = "visible";
  }
}

export function bindTooltips(root = document) {
  if (!instance) instance = new LiteTooltip();
  instance.bind(root);
}