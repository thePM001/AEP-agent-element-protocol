/** Policy catalog per lattice stage (WARN / SOFT / HARD). */

export const STAGE_KEYS = ["warn", "soft", "hard"];
export const STAGE_LABELS = ["WARN", "SOFT", "HARD"];
export const STAGE_COLORS = ["#8edcff", "#3de8ff", "#1a8fff"];

export function clearLatticeStage(data = {}, stageIndex) {
  const idx = Number(stageIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= STAGE_KEYS.length) return data;
  const stages = normalizeLatticeStages(data);
  const slot = stages[idx];
  const key = STAGE_KEYS[idx];
  let next = { ...data, stages: stages.slice() };
  next.stages[idx] = null;
  if (slot?.catalogPolicyId && slot?.categoryId) {
    next = updatePolicyAssignment(next, key, slot.categoryId, slot.catalogPolicyId, false);
  }
  return next;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultCategory() {
  return { id: uid("cat"), name: "General", policies: [] };
}

export function normalizePolicyCatalog(data = {}) {
  const raw = data.policyCatalog && typeof data.policyCatalog === "object" ? data.policyCatalog : {};
  const catalog = {};
  for (const key of STAGE_KEYS) {
    const stage = raw[key] && typeof raw[key] === "object" ? raw[key] : {};
    const categories = Array.isArray(stage.categories)
      ? stage.categories.map((c) => ({
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
                gapRef: p.gapRef || null,
              }))
            : [],
        }))
      : [];
    catalog[key] = { categories: categories.length ? categories : [defaultCategory()] };
  }
  return catalog;
}

export function writePolicyCatalog(data = {}, catalog) {
  return { ...data, policyCatalog: clone(catalog) };
}

export function getStageCatalog(data, stageKey) {
  const catalog = normalizePolicyCatalog(data);
  return catalog[stageKey] || { categories: [defaultCategory()] };
}

export function addCategory(data, stageKey, name) {
  const catalog = normalizePolicyCatalog(data);
  const stage = catalog[stageKey] || { categories: [defaultCategory()] };
  stage.categories.push({
    id: uid("cat"),
    name: String(name || "New category").trim() || "New category",
    policies: [],
  });
  catalog[stageKey] = stage;
  return writePolicyCatalog(data, catalog);
}

export function addPolicy(data, stageKey, categoryId, policy) {
  const catalog = normalizePolicyCatalog(data);
  const stage = catalog[stageKey];
  const cat = stage?.categories?.find((c) => c.id === categoryId);
  if (!cat) return data;
  cat.policies.push({
    id: uid("pol"),
    name: String(policy?.name || "Untitled policy"),
    source: policy?.source || "user",
    body: policy?.body || {},
    assigned: false,
    createdAt: new Date().toISOString(),
    ingestFile: policy?.ingestFile || null,
    gapRef: policy?.gapRef || null,
  });
  return writePolicyCatalog(data, catalog);
}

export function removePolicy(data, stageKey, categoryId, policyId) {
  const catalog = normalizePolicyCatalog(data);
  const cat = catalog[stageKey]?.categories?.find((c) => c.id === categoryId);
  if (!cat) return data;
  cat.policies = cat.policies.filter((p) => p.id !== policyId);
  return writePolicyCatalog(data, catalog);
}

export function updatePolicyAssignment(data, stageKey, categoryId, policyId, assigned) {
  const catalog = normalizePolicyCatalog(data);
  const cat = catalog[stageKey]?.categories?.find((c) => c.id === categoryId);
  const pol = cat?.policies?.find((p) => p.id === policyId);
  if (!pol) return data;
  pol.assigned = !!assigned;
  return writePolicyCatalog(data, catalog);
}

export function importPolicyJson(data, stageKey, categoryId, json) {
  let parsed = json;
  if (typeof json === "string") {
    try {
      parsed = JSON.parse(json);
    } catch {
      return { data, error: "Invalid JSON" };
    }
  }
  const name = parsed?.name || parsed?.title || parsed?.policy_id || "Imported policy";
  const next = addPolicy(data, stageKey, categoryId, {
    name: String(name),
    source: "import",
    body: parsed,
  });
  return { data: next, error: null };
}

export function normalizeLatticeStages(data = {}) {
  const stages = Array.isArray(data.stages) ? data.stages.slice() : [];
  while (stages.length < STAGE_KEYS.length) stages.push(null);
  return stages.slice(0, STAGE_KEYS.length);
}

export function resolveLatticeStorageLinks(latticeId, nodes, edges) {
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