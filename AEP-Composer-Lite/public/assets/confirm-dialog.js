/** NLA-style confirm dialog (no browser confirm()). */

let instance = null;

class LiteConfirm {
  constructor() {
    this.root = document.getElementById("nla-confirm-dialog");
    this.titleEl = document.getElementById("nla-confirm-title");
    this.bodyEl = document.getElementById("nla-confirm-body");
    this.okBtn = document.getElementById("nla-confirm-ok");
    this.cancelBtn = document.getElementById("nla-confirm-cancel");
    this._resolve = null;
    this._onKey = (e) => {
      if (e.key === "Escape") this._finish(false);
    };
    this.okBtn?.addEventListener("click", () => this._finish(true));
    this.cancelBtn?.addEventListener("click", () => this._finish(false));
    this.root?.addEventListener("click", (e) => {
      if (e.target === this.root) this._finish(false);
    });
  }

  show(options = {}) {
    if (!this.root) return Promise.resolve(false);
    if (this._resolve) this._finish(false);
    const {
      title = "CONFIRM",
      body = "",
      confirmText = "CONFIRM",
      cancelText = "CANCEL",
    } = options;
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.bodyEl) this.bodyEl.textContent = body;
    if (this.okBtn) this.okBtn.textContent = confirmText;
    if (this.cancelBtn) this.cancelBtn.textContent = cancelText;
    this.root.hidden = false;
    this.root.removeAttribute("hidden");
    document.addEventListener("keydown", this._onKey);
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  _finish(ok) {
    if (!this.root) return;
    this.root.hidden = true;
    this.root.setAttribute("hidden", "");
    document.removeEventListener("keydown", this._onKey);
    const resolve = this._resolve;
    this._resolve = null;
    if (resolve) resolve(ok);
  }
}

export function confirmDialog(options) {
  if (!instance) instance = new LiteConfirm();
  return instance.show(options);
}

export function isConfirmOpen() {
  return !!(instance?.root && !instance.root.hidden && instance._resolve);
}