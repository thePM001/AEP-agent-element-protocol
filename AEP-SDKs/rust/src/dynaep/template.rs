//! Template-instance fast exit. CN- prefix or registered template ids.
//! @PAD: aep-sdk-dynaep-template
//! @GCDE: gaplune.code.v1

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct FastExitResult {
    pub is_template_instance: bool,
    pub template_id: Option<String>,
    pub stamped_at: i64,
}

pub struct TemplateInstanceResolver {
    templates: HashSet<String>,
    cache: HashMap<String, bool>,
    max: usize,
}

impl TemplateInstanceResolver {
    pub fn new(templates: HashSet<String>) -> Self {
        Self { templates, cache: HashMap::new(), max: 10_000 }
    }
    pub fn resolve(&mut self, target_id: &str) -> bool {
        if let Some(v) = self.cache.get(target_id) { return *v; }
        let hit = target_id.starts_with("CN-") || self.templates.contains(target_id);
        if self.cache.len() >= self.max {
            if let Some(k) = self.cache.keys().next().cloned() { self.cache.remove(&k); }
        }
        self.cache.insert(target_id.to_string(), hit);
        hit
    }
    pub fn try_fast_exit(&mut self, target_id: &str, now_ms: i64) -> FastExitResult {
        if self.resolve(target_id) {
            FastExitResult { is_template_instance: true, template_id: Some(target_id.into()), stamped_at: now_ms }
        } else {
            FastExitResult { is_template_instance: false, template_id: None, stamped_at: now_ms }
        }
    }
}
