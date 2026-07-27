use serde::{Deserialize, Serialize};

fn default_enabled() -> bool {
    // HIGH fail-closed: commerce off until operator enables with explicit limits
    false
}

fn default_zero_limit() -> Option<f64> {
    Some(0.0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommercePolicy {
    /// When false, all commerce actions fail closed. Defaults to false (fail-closed).
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Required when enabled; default 0.0 denies all spend (no unlimited path).
    #[serde(default = "default_zero_limit")]
    pub max_transaction_amount: Option<f64>,
    #[serde(default)]
    pub allowed_currencies: Vec<String>,
    #[serde(default)]
    pub allowed_merchants: Vec<String>,
    #[serde(default)]
    pub blocked_merchants: Vec<String>,
    #[serde(default)]
    pub blocked_product_categories: Vec<String>,
    #[serde(default)]
    pub require_human_gate_above: Option<f64>,
    #[serde(default)]
    pub allowed_payment_methods: Vec<String>,
    /// Required when enabled; default 0.0 denies all daily spend.
    #[serde(default = "default_zero_limit")]
    pub max_daily_spend: Option<f64>,
}
impl Default for CommercePolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            max_transaction_amount: Some(0.0),
            allowed_currencies: Vec::new(),
            allowed_merchants: Vec::new(),
            blocked_merchants: Vec::new(),
            blocked_product_categories: Vec::new(),
            require_human_gate_above: None,
            allowed_payment_methods: Vec::new(),
            max_daily_spend: Some(0.0),
        }
    }
}
