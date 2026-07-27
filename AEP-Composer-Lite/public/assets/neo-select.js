/** Custom styled select - avoids native OS dropdown chrome. */

export function initNeoSelect(root) {
  const trigger = root.querySelector(".neo-select-trigger");
  const menu = root.querySelector(".neo-select-menu");
  const valueEl = root.querySelector(".neo-select-value");
  const hidden = root.querySelector('input[type="hidden"]');
  const options = [...menu.querySelectorAll('[role="option"]')];

  function labelFor(val) {
    const opt = options.find((o) => o.dataset.value === val);
    return opt?.textContent?.trim() ?? val;
  }

  function setValue(val) {
    if (!val) return;
    hidden.value = val;
    valueEl.textContent = labelFor(val);
    for (const opt of options) {
      const selected = opt.dataset.value === val;
      opt.classList.toggle("selected", selected);
      opt.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function close() {
    root.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
  }

  function open() {
    for (const el of document.querySelectorAll(".neo-select.open")) {
      if (el !== root) el.classList.remove("open");
    }
    root.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    const selected = menu.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
  }

  function moveFocus(delta) {
    const idx = options.findIndex((o) => o.getAttribute("aria-selected") === "true");
    const next = Math.max(0, Math.min(options.length - 1, idx + delta));
    setValue(options[next].dataset.value);
  }

  trigger.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (root.classList.contains("open")) close();
    else open();
  });

  for (const opt of options) {
    opt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setValue(opt.dataset.value);
      close();
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  document.addEventListener("click", (ev) => {
    if (!root.contains(ev.target)) close();
  });

  trigger.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      close();
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (root.classList.contains("open")) close();
      else open();
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (!root.classList.contains("open")) open();
      else moveFocus(1);
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!root.classList.contains("open")) open();
      else moveFocus(-1);
    }
  });

  setValue(hidden.value || options[0]?.dataset.value);

  return { setValue, getValue: () => hidden.value };
}