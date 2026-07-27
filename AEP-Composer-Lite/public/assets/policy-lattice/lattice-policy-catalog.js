/* Policy catalog per lattice stage (WARN / SOFT / HARD) */
(function (global) {
  const STAGE_KEYS = global.LatticeVisualTokens?.LATTICE_STAGE_KEYS || ["warn", "soft", "hard"];

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultCategory() {
    return { id: uid("cat"), name: "General", policies: [] };
  }

  function normalizePolicyCatalog(meta = {}) {
    const raw = meta.policyCatalog && typeof meta.policyCatalog === "object" ? meta.policyCatalog : {};
    const catalog = {};
    for (const key of STAGE_KEYS) {
      const stage = raw[key] && typeof raw[key] === "object" ? raw[key] : {};
      const categories = Array.isArray(stage.categories) ? stage.categories.map((c) => ({
        id: c.id || uid("cat"),
        name: String(c.name || "General"),
        policies: Array.isArray(c.policies)
          ? c.policies.map((p) => ({
            id: p.id || uid("pol"),
            name: String(p.name || "Untitled policy"),
            source: p.source || "user",
            body: p.body && typeof p.body === "object" ? p.body : {},
            assigned: !!p.assigned,
            createdAt: p.createdAt || new Date().toISOString(),
            ingestFile: p.ingestFile || null,
          }))
          : [],
      })) : [];
      catalog[key] = {
        categories: categories.length ? categories : [defaultCategory()],
      };
    }
    return catalog;
  }

  function writePolicyCatalog(meta = {}, catalog) {
    return { ...meta, policyCatalog: clone(catalog) };
  }

  function getStageCatalog(meta, stageKey) {
    const catalog = normalizePolicyCatalog(meta);
    return catalog[stageKey] || { categories: [defaultCategory()] };
  }

  function addCategory(meta, stageKey, name) {
    const catalog = normalizePolicyCatalog(meta);
    const stage = catalog[stageKey] || { categories: [defaultCategory()] };
    stage.categories.push({ id: uid("cat"), name: String(name || "New category").trim() || "New category", policies: [] });
    catalog[stageKey] = stage;
    return writePolicyCatalog(meta, catalog);
  }

  function addPolicy(meta, stageKey, categoryId, policy) {
    const catalog = normalizePolicyCatalog(meta);
    const stage = catalog[stageKey];
    const cat = stage?.categories?.find((c) => c.id === categoryId);
    if (!cat) return meta;
    cat.policies.push({
      id: uid("pol"),
      name: String(policy?.name || "Untitled policy"),
      source: policy?.source || "user",
      body: policy?.body || {},
      assigned: false,
      createdAt: new Date().toISOString(),
      ingestFile: policy?.ingestFile || null,
    });
    return writePolicyCatalog(meta, catalog);
  }

  function removePolicy(meta, stageKey, categoryId, policyId) {
    const catalog = normalizePolicyCatalog(meta);
    const cat = catalog[stageKey]?.categories?.find((c) => c.id === categoryId);
    if (!cat) return meta;
    cat.policies = cat.policies.filter((p) => p.id !== policyId);
    return writePolicyCatalog(meta, catalog);
  }

  function updatePolicyAssignment(meta, stageKey, categoryId, policyId, assigned) {
    const catalog = normalizePolicyCatalog(meta);
    const cat = catalog[stageKey]?.categories?.find((c) => c.id === categoryId);
    const pol = cat?.policies?.find((p) => p.id === policyId);
    if (!pol) return meta;
    pol.assigned = !!assigned;
    return writePolicyCatalog(meta, catalog);
  }

  function importPolicyJson(meta, stageKey, categoryId, json) {
    let parsed = json;
    if (typeof json === "string") {
      try { parsed = JSON.parse(json); } catch { return { meta, error: "Invalid JSON" }; }
    }
    const name = parsed?.name || parsed?.title || parsed?.policy_id || "Imported policy";
    const next = addPolicy(meta, stageKey, categoryId, {
      name: String(name),
      source: "import",
      body: parsed,
    });
    return { meta: next, error: null };
  }

  function resolveLatticeStorageLinks(latticeId, nodes, edges) {
    const input = [];
    const output = [];
    for (const edge of edges || []) {
      const from = nodes.find((n) => n.id === edge.from);
      const to = nodes.find((n) => n.id === edge.to);
      if (!from || !to) continue;
      if (to.id === latticeId && from.type === "data_input") input.push(from);
      if (from.id === latticeId && to.type === "data_output") output.push(to);
      if (from.id === latticeId && to.type === "data_input") input.push(to);
      if (to.id === latticeId && from.type === "data_output") output.push(from);
    }
    return { input: input[0] || null, output: output[0] || null, inputs: input, outputs: output };
  }

  global.LatticePolicyCatalog = {
    STAGE_KEYS,
    normalizePolicyCatalog,
    writePolicyCatalog,
    getStageCatalog,
    addCategory,
    addPolicy,
    removePolicy,
    updatePolicyAssignment,
    importPolicyJson,
    resolveLatticeStorageLinks,
    uid,
  };
})(window);