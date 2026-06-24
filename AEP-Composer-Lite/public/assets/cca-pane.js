/** CCA bottom pane: Composer chat + xterm terminal (from NLA Agent Composer). */

import { authFetch } from "./setup-auth.js";

const STORAGE_KEY = "composer-lite-cca-pane";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_WIDTH = 1040;
const MIN_WIDTH = 480;
const MAX_WIDTH = 1680;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveState(patch) {
  try {
    const cur = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* storage blocked */
  }
}

function apiBase() {
  const base = document.querySelector("base")?.href;
  if (base) return new URL(".", base).href.replace(/\/$/, "");
  return `${location.origin}${location.pathname.replace(/\/[^/]*$/, "")}`.replace(/\/$/, "");
}

function terminalWsUrl() {
  const explicit = document.documentElement.dataset.terminalWs || "";
  if (explicit) return explicit.replace(/\/$/, "");
  const cwd = encodeURIComponent(
    document.documentElement.dataset.terminalCwd || "/opt/aep",
  );
  const base = apiBase().replace(/^http/, "ws");
  return `${base}/api/terminal/ws?cwd=${cwd}&cmd=bash`;
}

export class ComposerCcaPane {
  constructor({ onSend, onApplySuggestion, getContext }) {
    this.onSend = onSend;
    this.onApplySuggestion = onApplySuggestion;
    this.getContext = getContext;
    this.root = null;
    this.viewportEl = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.fileInput = null;
    this.attachments = [];
    this.messages = [];
    this.history = [];
    this.pendingSuggestion = null;
    this.expanded = true;
    this.activeTab = "agent";
    this.term = null;
    this.fitAddon = null;
    this.termWs = null;
    this.termReady = false;
    this._resizeObs = null;
    this._width = DEFAULT_WIDTH;
  }

  init() {
    this.root = document.getElementById("composer-cca-pane");
    if (!this.root) return;

    const saved = loadState();
    this.expanded = saved.expanded !== false;
    this.activeTab = saved.tab === "terminal" ? "terminal" : "agent";
    if (Array.isArray(saved.messages)) this.messages = saved.messages.slice(-80);

    this.viewportEl = document.getElementById("cca-chat-viewport");
    this.messagesEl = document.getElementById("cca-chat-messages");
    this.inputEl = document.getElementById("cca-chat-input");
    this.fileInput = document.getElementById("cca-file-input");

    document.getElementById("cca-pane-toggle")?.addEventListener("click", () => this.toggleExpanded());
    document.getElementById("cca-tab-agent")?.addEventListener("click", () => this.setTab("agent"));
    document.getElementById("cca-tab-terminal")?.addEventListener("click", () => this.setTab("terminal"));
    document.getElementById("cca-send-btn")?.addEventListener("click", () => this.sendMessage());
    document.getElementById("cca-upload-btn")?.addEventListener("click", () => this.fileInput?.click());
    this.fileInput?.addEventListener("change", (e) => this.onFilesSelected(e));

    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.syncPaneWidth();
    window.addEventListener("resize", () => this.syncPaneWidth());
    this.syncChrome();
    this.renderMessages();
    if (this.expanded && this.activeTab === "terminal") {
      requestAnimationFrame(() => this.ensureTerminal());
    }
  }

  inspectorInset() {
    const inspector = document.querySelector(".lite-inspector");
    if (inspector) {
      const rect = inspector.getBoundingClientRect();
      if (rect.width > 40 && rect.right > window.innerWidth * 0.55) {
        return Math.max(52, window.innerWidth - rect.left + 12);
      }
    }
    return 320;
  }

  maxWidth() {
    const gutter =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-gutter")) || 12;
    return Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH + 120, window.innerWidth - gutter * 2 - this.inspectorInset()),
    );
  }

  syncPaneWidth() {
    const cap = this.maxWidth();
    const next = Math.round(Math.max(MIN_WIDTH, Math.min(cap, DEFAULT_WIDTH)));
    this._width = next;
    document.documentElement.style.setProperty("--cca-pane-width", `${next}px`);
    document.documentElement.style.setProperty("--cca-pane-max-width", `${cap}px`);
    if (this.termReady) this.resizeTerminal();
  }

  toggleExpanded(force) {
    if (typeof force === "boolean") this.expanded = force;
    else this.expanded = !this.expanded;
    saveState({ expanded: this.expanded });
    this.syncChrome();
    if (this.expanded && this.activeTab === "terminal") this.ensureTerminal();
  }

  setTab(tab) {
    this.activeTab = tab;
    saveState({ tab });
    this.syncChrome();
    if (tab === "terminal") {
      this.ensureTerminal();
      requestAnimationFrame(() => this.resizeTerminal());
    }
  }

  focusComposer(prompt = "") {
    this.setTab("agent");
    this.toggleExpanded(true);
    requestAnimationFrame(() => {
      const input = document.getElementById("cca-chat-input");
      if (!input) return;
      if (prompt) input.value = prompt;
      input.focus();
    });
  }

  syncChrome() {
    if (!this.root) return;
    const composerActive = this.activeTab === "agent";
    const terminalActive = this.activeTab === "terminal";
    this.root.classList.toggle("cca-pane-collapsed", !this.expanded);
    this.root.classList.toggle("cca-pane-expanded", this.expanded);
    this.root.classList.toggle("cca-tab-composer-active", composerActive);
    this.root.classList.toggle("cca-tab-terminal-active", terminalActive);

    document.getElementById("cca-tab-agent")?.classList.toggle("active", composerActive);
    document.getElementById("cca-tab-terminal")?.classList.toggle("active", terminalActive);

    const agentPanel = document.getElementById("cca-panel-agent");
    const terminalPanel = document.getElementById("cca-panel-terminal");
    if (agentPanel) {
      agentPanel.hidden = !composerActive;
      agentPanel.setAttribute("aria-hidden", composerActive ? "false" : "true");
    }
    if (terminalPanel) {
      terminalPanel.hidden = !terminalActive;
      terminalPanel.setAttribute("aria-hidden", terminalActive ? "false" : "true");
    }

    const toggle = document.getElementById("cca-pane-toggle");
    if (toggle) {
      toggle.textContent = this.expanded ? "−" : "+";
      toggle.setAttribute("aria-expanded", this.expanded ? "true" : "false");
    }
  }

  scrollToBottom() {
    const scrollEl = this.viewportEl || this.messagesEl;
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  logPrefix(role) {
    if (role === "user") return "you ›";
    if (role === "system") return "sys ›";
    return "cca ›";
  }

  formatLogTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    if (Number.isNaN(d.getTime())) return "[--:-- --]";
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `[${String(h).padStart(2, "0")}:${m} ${ampm}]`;
  }

  renderMessages() {
    if (!this.messagesEl) return;
    this.messagesEl.innerHTML = this.messages
      .map((m) => {
        const role = m.role === "user" ? "user" : m.role === "system" ? "system" : "agent";
        const attach = m.attachments?.length
          ? ` <span class="cca-log-attach">[${m.attachments.map((a) => esc(a.name)).join(", ")}]</span>`
          : "";
        const meta = m.meta ? ` <span class="cca-log-meta">${esc(m.meta)}</span>` : "";
        const time = `<span class="cca-log-time">${esc(this.formatLogTime(m.ts))}</span>`;
        return `<div class="cca-log-line cca-log-${role}">${time}<span class="cca-log-prefix">${this.logPrefix(role)}</span><span class="cca-log-text">${esc(m.text)}</span>${attach}${meta}</div>`;
      })
      .join("");
    this.scrollToBottom();
  }

  pushMessage(role, text, extras = {}) {
    this.messages.push({
      role,
      text,
      ts: new Date().toISOString(),
      ...extras,
    });
    if (this.messages.length > 80) this.messages = this.messages.slice(-80);
    saveState({ messages: this.messages });
    this.renderMessages();
  }

  async onFilesSelected(e) {
    const files = Array.from(e.target?.files || []);
    e.target.value = "";
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        this.pushMessage("system", `File too large: ${file.name} (max 4MB)`);
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await authFetch("api/cca/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        this.attachments.push({
          id: data.file_id,
          name: data.name,
          size: data.size,
          mime: data.mime,
        });
        this.pushMessage("system", `Attached ${file.name}`);
      } catch (err) {
        this.pushMessage("system", `Upload failed: ${file.name} (${err.message})`);
      }
    }
    this.renderAttachmentBar();
  }

  renderAttachmentBar() {
    const bar = document.getElementById("cca-attach-bar");
    if (!bar) return;
    if (!this.attachments.length) {
      bar.innerHTML = "";
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML = this.attachments
      .map(
        (a, i) =>
          `<span class="cca-attach-chip">${esc(a.name)}<button type="button" data-idx="${i}" aria-label="Remove">×</button></span>`,
      )
      .join("");
    bar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        this.attachments.splice(idx, 1);
        this.renderAttachmentBar();
      });
    });
  }

  renderSuggestionPreview() {
    const bar = document.getElementById("cca-suggestion-bar");
    if (!bar) return;
    const s = this.pendingSuggestion;
    if (!s?.suggestion) {
      bar.innerHTML = "";
      bar.hidden = true;
      return;
    }
    const nodes = s.suggestion.nodes?.length || 0;
    const edges = s.suggestion.edges?.length || 0;
    const valid = s.validation?.valid !== false;
    bar.hidden = false;
    bar.innerHTML = `
      <div class="cca-suggestion-copy">
        <strong>CCA plan ready</strong>
        <span>${nodes} node${nodes === 1 ? "" : "s"}, ${edges} edge${edges === 1 ? "" : "s"}${valid ? "" : " (validation warnings)"}</span>
      </div>
      <div class="cca-suggestion-actions">
        <button type="button" class="cca-suggestion-btn ghost" id="cca-suggestion-dismiss">DISMISS</button>
        <button type="button" class="cca-suggestion-btn accent" id="cca-suggestion-apply">APPLY TO CANVAS</button>
      </div>`;
    bar.querySelector("#cca-suggestion-dismiss")?.addEventListener("click", () => {
      this.pendingSuggestion = null;
      this.renderSuggestionPreview();
    });
    bar.querySelector("#cca-suggestion-apply")?.addEventListener("click", async () => {
      const payload = this.pendingSuggestion;
      this.pendingSuggestion = null;
      this.renderSuggestionPreview();
      try {
        await this.onApplySuggestion?.(payload);
        this.pushMessage(
          "system",
          "Applied CCA plan to canvas. Ctrl+Z or Action Log → Undo to revert.",
        );
      } catch (err) {
        this.pushMessage("system", `Apply failed: ${err.message}`);
      }
    });
  }

  buildMessagePayload(text) {
    return text;
  }

  replyPassedHyperlatticeGate(result) {
    if (!result || result.ok === false) return false;
    if (!result.reply?.trim()) return false;
    if (result.writing_validation?.ok !== true) return false;
    const hl = result.hyperlattice_validation;
    if (hl?.ok !== true) return false;
    if (hl?.dock_audit_ok === false) return false;
    return true;
  }

  hyperlatticeReleaseMeta(result) {
    const provider = result?.provider;
    const model = result?.model;
    if (!provider || provider === "none") return "";
    const shortModel = model ? String(model).split("/").pop() : "";
    return shortModel ? `via ${provider}/${shortModel}` : `via ${provider}`;
  }

  async sendMessage() {
    const text = this.inputEl?.value?.trim();
    if (!text && !this.attachments.length) return;
    const payload = this.buildMessagePayload(text || "(file attachment)");
    const sentAttachments = this.attachments.slice();
    this.pushMessage("user", text || "(file attachment)", {
      attachments: sentAttachments,
    });
    if (this.inputEl) this.inputEl.value = "";
    this.inputEl?.focus();
    this.attachments = [];
    this.renderAttachmentBar();

    try {
      const context = this.getContext?.() || {};
      const result = await this.onSend(payload, this.history, {
        context,
        attachments: sentAttachments,
      });
      this.history.push({ role: "user", content: payload });
      if (result?.ok === false) {
        const hl = result.hyperlattice_validation?.error
          ? ` Hyperlattice: ${result.hyperlattice_validation.error}`
          : "";
        const viol = result.writing_validation?.violations?.[0];
        let msg = result.error || "CCA reply blocked by hyperlattice writing.gap validation.";
        if (viol?.rule === "spaced_sign_word_space" || viol?.rule === "punctuation_word_space") {
          msg =
            "CCA blocked a reply with bad spacing after ? or ! (writing.gap). Retrying usually fixes this. Send again or shorten the message.";
        } else if (viol?.rule === "hyperlattice_dock_audit") {
          msg =
            "CCA blocked release: Base Node validation_engine dock audit failed (fail-closed). Check task manifest for agent_id=cca and lattice sockets.";
        }
        this.pushMessage("system", msg + hl);
        return;
      }
      if (this.replyPassedHyperlatticeGate(result)) {
        this.messages = this.messages.filter(
          (m) =>
            !(
              m.role === "system"
              && /blocked|writing\.gap|Hyperlattice:|CCA error/i.test(String(m.text ?? ""))
            ),
        );
        this.history.push({ role: "assistant", content: result.reply });
        this.pushMessage("agent", result.reply);
        saveState({ messages: this.messages });
      } else if (result?.reply) {
        this.pushMessage(
          "system",
          "CCA reply withheld: text did not pass EPSCOM writing.gap and hyperlattice release gate (fail-closed).",
        );
      }
      const planMode = result?.mode === "plan";
      if (
        planMode &&
        result?.suggestion &&
        (result.suggestion.nodes?.length || result.suggestion.edges?.length)
      ) {
        this.pendingSuggestion = result;
        this.renderSuggestionPreview();
        this.pushMessage("system", "Review the plan above, then Apply or Dismiss.");
      }
    } catch (err) {
      this.pushMessage("system", `CCA error: ${err.message}`);
    }
  }

  ensureTerminal() {
    if (this.termReady || typeof globalThis.Terminal === "undefined") return;
    const host = document.getElementById("cca-terminal-host");
    if (!host) return;

    this.term = new globalThis.Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      scrollback: 5000,
      theme: {
        background: "#050d1a",
        foreground: "#d8ecff",
        cursor: "#3de8ff",
        selectionBackground: "rgba(61, 232, 255, 0.25)",
        black: "#050d1a",
        red: "#ff6b8a",
        green: "#4af2c8",
        yellow: "#d4c84a",
        blue: "#3de8ff",
        magenta: "#9eb8ff",
        cyan: "#6b9fff",
        white: "#d8ecff",
      },
    });

    const FitCtor = globalThis.FitAddon?.FitAddon || globalThis.FitAddon;
    if (FitCtor) {
      this.fitAddon = new FitCtor();
      this.term.loadAddon(this.fitAddon);
    }

    this.term.open(host);
    try {
      this.fitAddon?.fit();
    } catch {
      /* initial fit */
    }

    this.term.onData((data) => {
      if (this.termWs?.readyState === WebSocket.OPEN) {
        this.termWs.send(data);
      }
    });

    this.connectTerminalWs();
    this.termReady = true;

    if (typeof ResizeObserver !== "undefined") {
      this._resizeObs = new ResizeObserver(() => this.resizeTerminal());
      this._resizeObs.observe(host);
    }
  }

  resizeTerminal() {
    if (!this.term || !this.fitAddon) return;
    try {
      this.fitAddon.fit();
      const d = this.fitAddon.proposeDimensions?.() || { cols: 80, rows: 24 };
      if (this.termWs?.readyState === WebSocket.OPEN) {
        this.termWs.send(JSON.stringify({ type: "resize", cols: d.cols, rows: d.rows }));
      }
    } catch {
      /* ignore */
    }
  }

  connectTerminalWs() {
    const url = terminalWsUrl();
    this.term?.writeln(`\x1b[38;2;61;232;255mconnecting\x1b[0m ${url}`);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.termWs = ws;

    ws.onopen = () => {
      this.term?.writeln("\x1b[32mconnected\x1b[0m");
      this.resizeTerminal();
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("export PS1='\\[\\e[38;2;61;232;255m\\]⬡ \\W\\[\\e[0m\\] \\$ ' && clear\n");
        }
      }, 400);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.term?.write(ev.data);
      else if (ev.data instanceof ArrayBuffer) this.term?.write(new Uint8Array(ev.data));
    };

    ws.onclose = () => {
      this.term?.writeln("\r\n\x1b[31mterminal disconnected\x1b[0m");
    };

    ws.onerror = () => {
      this.term?.writeln("\r\n\x1b[31mterminal connection error\x1b[0m");
    };
  }
}

export function initCcaPane(handlers) {
  const pane = new ComposerCcaPane(handlers);
  pane.init();
  return pane;
}