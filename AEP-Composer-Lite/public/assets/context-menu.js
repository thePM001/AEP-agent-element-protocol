/** Right-click context menu for Composer Lite canvas targets. */

export class LatticeContextMenu {
  constructor(options = {}) {
    this.onAction = options.onAction || (() => {});
    this.root = document.createElement("div");
    this.root.className = "lattice-context-menu";
    this.root.setAttribute("role", "menu");
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this._items = [];
    this._activeIndex = -1;
    this._onDocClick = (e) => {
      if (this.root.hidden) return;
      if (e.type === "contextmenu") return;
      if (e.type === "pointerdown" && e.button === 2) return;
      if (!this.root.contains(e.target)) this.hide();
    };
    this._onKey = (e) => {
      if (this.root.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this._moveFocus(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this._moveFocus(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this._activateFocused();
      }
    };
    document.addEventListener("click", this._onDocClick);
    document.addEventListener("pointerdown", this._onDocClick);
    document.addEventListener("keydown", this._onKey);
    this.root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-menu-action]");
      if (!btn || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.menuAction;
      const payload = btn.dataset.menuPayload || "";
      this.hide();
      this.onAction(action, payload ? JSON.parse(payload) : {});
    });
  }

  show(clientX, clientY, items, meta = {}) {
    this._items = items.filter((item) => item !== "sep" && item?.id);
    this.root.innerHTML = "";
    for (const item of items) {
      if (item === "sep") {
        const sep = document.createElement("div");
        sep.className = "lattice-context-sep";
        sep.setAttribute("role", "separator");
        this.root.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lattice-context-item";
      btn.dataset.menuAction = item.id;
      if (item.payload) btn.dataset.menuPayload = JSON.stringify(item.payload);
      btn.setAttribute("role", "menuitem");
      btn.disabled = !!item.disabled;
      if (item.danger) btn.classList.add("danger");
      const label = document.createElement("span");
      label.className = "lattice-context-label";
      label.textContent = item.label;
      btn.appendChild(label);
      if (item.shortcut) {
        const shortcut = document.createElement("span");
        shortcut.className = "lattice-context-shortcut";
        shortcut.textContent = item.shortcut;
        btn.appendChild(shortcut);
      }
      this.root.appendChild(btn);
    }
    this.root.hidden = false;
    this.root.removeAttribute("hidden");
    this.root.dataset.target = meta.target || "canvas";
    this._position(clientX, clientY);
    this._activeIndex = this._firstFocusableIndex();
    this._applyFocus();
  }

  hide() {
    this.root.hidden = true;
    this.root.setAttribute("hidden", "");
    this._activeIndex = -1;
  }

  isOpen() {
    return !this.root.hidden;
  }

  _position(clientX, clientY) {
    this.root.style.visibility = "hidden";
    this.root.hidden = false;
    const rect = this.root.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    const pad = 8;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.visibility = "visible";
  }

  _focusableButtons() {
    return [...this.root.querySelectorAll(".lattice-context-item:not(:disabled)")];
  }

  _firstFocusableIndex() {
    const buttons = this._focusableButtons();
    return buttons.length ? 0 : -1;
  }

  _moveFocus(delta) {
    const buttons = this._focusableButtons();
    if (!buttons.length) return;
    if (this._activeIndex < 0) this._activeIndex = 0;
    else this._activeIndex = (this._activeIndex + delta + buttons.length) % buttons.length;
    this._applyFocus();
  }

  _applyFocus() {
    const buttons = this._focusableButtons();
    buttons.forEach((btn, i) => btn.classList.toggle("focused", i === this._activeIndex));
    if (this._activeIndex >= 0 && buttons[this._activeIndex]) buttons[this._activeIndex].focus();
  }

  _activateFocused() {
    const buttons = this._focusableButtons();
    if (this._activeIndex < 0 || !buttons[this._activeIndex]) return;
    buttons[this._activeIndex].click();
  }
}