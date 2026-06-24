/** Nine quick slots for node placement (Composer Lite). */

const SLOT_COUNT = 9;
const STORAGE_KEY = "composer-lite-quick-slots";
const MIME = "application/x-wasm-node";

const DEFAULT_SLOTS = [
  "lattice",
  "agent",
  "dock_validation",
  "dock_inference",
  "data_input",
  "data_output",
  null,
  null,
  null,
];

function loadSlots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_SLOTS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== SLOT_COUNT) return [...DEFAULT_SLOTS];
    return parsed;
  } catch {
    return [...DEFAULT_SLOTS];
  }
}

function saveSlots(slots) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    /* storage blocked */
  }
}

function shortLabel(item) {
  if (item.short) return item.short;
  const words = String(item.label || item.type || "").trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(item.label || item.type || "?").slice(0, 2).toUpperCase();
}

export function initQuickSlots(grid, palette, options = {}) {
  const onPlace = options.onPlace || (() => {});
  const onArm = options.onArm || (() => {});
  const onDisarm = options.onDisarm || (() => {});

  const slots = loadSlots();
  let armedIndex = null;

  function paletteItem(type) {
    return palette.find((p) => p.type === type) ?? null;
  }

  function disarm() {
    if (armedIndex === null) return;
    armedIndex = null;
    grid.querySelectorAll(".quickslot").forEach((el) => el.classList.remove("armed"));
    onDisarm();
  }

  function arm(index) {
    const type = slots[index];
    if (!type) return;
    armedIndex = index;
    grid.querySelectorAll(".quickslot").forEach((el, i) => {
      el.classList.toggle("armed", i === index);
    });
    onArm(paletteItem(type));
  }

  function render() {
    grid.replaceChildren();
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const type = slots[i];
      const item = type ? paletteItem(type) : null;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `quickslot${item ? "" : " empty"}`;
      btn.dataset.slotIndex = String(i);
      btn.setAttribute("aria-label", item ? `Quick slot ${i + 1}: ${item.label}` : `Quick slot ${i + 1}: empty`);

      if (item) {
        btn.draggable = true;
        btn.innerHTML = `
          <span class="quickslot-disc">
            <span class="quickslot-core" style="--slot-color:${item.color}"></span>
            <span class="quickslot-glyph">${shortLabel(item)}</span>
            <span class="quickslot-key">${i + 1}</span>
          </span>
          <span class="quickslot-label">${item.label}</span>
        `;
        btn.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData(MIME, JSON.stringify(item));
          disarm();
        });
        btn.addEventListener("click", () => {
          if (armedIndex === i) {
            disarm();
            onPlace(item);
          } else {
            arm(i);
          }
        });
      } else {
        btn.innerHTML = `
          <span class="quickslot-disc"></span>
          <span class="quickslot-label">Empty</span>
        `;
        btn.addEventListener("click", () => disarm());
      }

      grid.appendChild(btn);
    }
  }

  function assignSlot(index, type) {
    if (index < 0 || index >= SLOT_COUNT) return;
    slots[index] = type;
    saveSlots(slots);
    render();
  }

  function setPalette(nextPalette) {
    palette.length = 0;
    palette.push(...nextPalette);
    render();
  }

  render();

  window.addEventListener("keydown", (e) => {
    if (e.target?.matches?.("input, textarea, select, [contenteditable]")) return;
    const num = Number(e.key);
    if (num >= 1 && num <= 9) {
      const index = num - 1;
      const type = slots[index];
      if (!type) return;
      const item = paletteItem(type);
      if (!item) return;
      if (armedIndex === index) {
        disarm();
        onPlace(item);
      } else {
        arm(index);
      }
    }
    if (e.key === "Escape") disarm();
  });

  return {
    render,
    setPalette,
    assignSlot,
    disarm,
    getArmedType: () => (armedIndex !== null ? slots[armedIndex] : null),
  };
}