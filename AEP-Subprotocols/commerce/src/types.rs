use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommerceAction {
    Discover,
    AddToCart,
    RemoveFromCart,
    UpdateCart,
    CheckoutStart,
    CheckoutComplete,
    PaymentNegotiate,
    PaymentAuthorize,
    FulfillmentQuery,
    OrderStatus,
    ReturnInitiate,
    RefundRequest,
}

impl CommerceAction {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "discover" => Some(Self::Discover),
            "add_to_cart" => Some(Self::AddToCart),
            "remove_from_cart" => Some(Self::RemoveFromCart),
            "update_cart" => Some(Self::UpdateCart),
            "checkout_start" | "checkout_complete" => Some(Self::CheckoutStart),
            "payment_negotiate" | "payment_authorize" => Some(Self::PaymentNegotiate),
            "fulfillment_query" | "order_status" => Some(Self::FulfillmentQuery),
            "return_initiate" | "refund_request" => Some(Self::ReturnInitiate),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartItem {
    #[serde(alias = "productId")]
    pub product_id: String,
    pub quantity: i64,
    pub price: f64,
    pub currency: String,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cart {
    pub id: String,
    pub items: Vec<CartItem>,
    pub total: f64,
    pub currency: String,
    #[serde(alias = "merchantId")]
    pub merchant_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutSession {
    pub id: String,
    #[serde(alias = "cartId")]
    pub cart_id: String,
    #[serde(default, alias = "paymentMethod")]
    pub payment_method: Option<String>,
    pub status: String,
    #[serde(default)]
    pub total: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentNegotiation {
    #[serde(default, alias = "availableHandlers")]
    pub available_handlers: Vec<String>,
    #[serde(default, alias = "selectedHandler")]
    pub selected_handler: Option<String>,
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommerceValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    #[serde(default)]
    pub gate_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

impl CommerceValidationResult {
    pub fn ok() -> Self {
        Self {
            valid: true,
            errors: vec![],
            gate_required: false,
            detail: None,
        }
    }

    pub fn fail(errors: Vec<String>) -> Self {
        Self {
            valid: false,
            errors,
            gate_required: false,
            detail: None,
        }
    }
}

pub fn parse_cart_item(v: &Value) -> Result<CartItem, String> {
    serde_json::from_value(v.clone()).map_err(|e| e.to_string())
}

pub fn parse_cart(v: &Value) -> Result<Cart, String> {
    let mut c: Cart = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
    if c.merchant_id.is_empty() {
        if let Some(m) = v.get("merchantId").and_then(|x| x.as_str()) {
            c.merchant_id = m.into();
        }
    }
    Ok(c)
}

pub fn metadata_category(metadata: &Value) -> Option<String> {
    metadata
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

pub fn injection_scan(text: &str) -> Vec<String> {
    let patterns = ["<script", "javascript:", "DROP TABLE", "rm -rf"];
    patterns
        .iter()
        .filter(|p| text.to_lowercase().contains(&p.to_lowercase()))
        .map(|p| format!("prohibited pattern: {p}"))
        .collect()
}