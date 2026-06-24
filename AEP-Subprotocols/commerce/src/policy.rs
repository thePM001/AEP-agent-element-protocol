use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommercePolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
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
    #[serde(default)]
    pub max_daily_spend: Option<f64>,
}