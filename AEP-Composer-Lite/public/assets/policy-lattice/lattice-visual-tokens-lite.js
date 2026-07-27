/* Minimal LatticeVisualTokens for stage policy panel (Composer Lite blue theme). */
(function (global) {
  const LATTICE_STAGE_KEYS = ["warn", "soft", "hard"];
  const LATTICE_STAGE_LABELS = ["WARN", "SOFT", "HARD"];
  const LATTICE_STAGE_COLORS = ["#8edcff", "#3de8ff", "#1a8fff"];
  const LATTICE_LEGACY_STAGE_MAP = { 0: 0, 2: 1, 4: 2 };

  function normalizeLatticeStages(meta) {
    const raw = meta?.stages;
    const stages = Array.from({ length: LATTICE_STAGE_KEYS.length }, () => null);
    if (!Array.isArray(raw)) return stages;
    if (raw.length >= 5) {
      for (const [from, to] of Object.entries(LATTICE_LEGACY_STAGE_MAP)) {
        const slot = raw[Number(from)];
        if (slot && typeof slot === "object") stages[Number(to)] = { ...slot };
      }
      return stages;
    }
    for (let i = 0; i < stages.length; i++) {
      const slot = raw[i];
      if (slot && typeof slot === "object") stages[i] = { ...slot };
    }
    return stages;
  }

  global.LatticeVisualTokens = {
    LATTICE_STAGE_KEYS,
    LATTICE_STAGE_LABELS,
    LATTICE_STAGE_COLORS,
    normalizeLatticeStages,
  };
})(window);