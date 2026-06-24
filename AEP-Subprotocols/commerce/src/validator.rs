use crate::policy::CommercePolicy;
use crate::spend::SpendTracker;
use crate::types::{
    injection_scan, metadata_category, parse_cart, parse_cart_item, CommerceAction,
    CommerceValidationResult, PaymentNegotiation,
};
use serde_json::Value;
use std::path::Path;

pub struct CommerceValidator {
    policy: CommercePolicy,
    spend: SpendTracker,
}

impl CommerceValidator {
    pub fn new(policy: CommercePolicy, spend_base: impl AsRef<Path>) -> Self {
        let max_daily = policy.max_daily_spend.unwrap_or(0.0);
        let currency = policy
            .allowed_currencies
            .first()
            .cloned()
            .unwrap_or_else(|| "USD".into());
        Self {
            spend: SpendTracker::new(max_daily, currency, spend_base),
            policy,
        }
    }

    pub fn validate_action(&mut self, action: &str, payload: &Value) -> CommerceValidationResult {
        let Some(act) = CommerceAction::parse(action) else {
            return CommerceValidationResult::fail(vec![format!(
                "Unknown commerce action: {action}"
            )]);
        };
        match act {
            CommerceAction::Discover
            | CommerceAction::RemoveFromCart
            | CommerceAction::FulfillmentQuery
            | CommerceAction::OrderStatus => CommerceValidationResult::ok(),
            CommerceAction::AddToCart | CommerceAction::UpdateCart => {
                self.validate_add_to_cart(payload)
            }
            CommerceAction::CheckoutStart | CommerceAction::CheckoutComplete => {
                self.validate_checkout(payload)
            }
            CommerceAction::PaymentNegotiate | CommerceAction::PaymentAuthorize => {
                self.validate_payment(payload)
            }
            CommerceAction::ReturnInitiate | CommerceAction::RefundRequest => {
                self.validate_return(payload)
            }
        }
    }

    fn validate_add_to_cart(&self, payload: &Value) -> CommerceValidationResult {
        let item_v = match payload.get("item") {
            Some(v) => v,
            None => return CommerceValidationResult::fail(vec!["Cart item is required.".into()]),
        };
        let cart_v = match payload.get("cart") {
            Some(v) => v,
            None => return CommerceValidationResult::fail(vec!["Cart is required.".into()]),
        };
        let item = match parse_cart_item(item_v) {
            Ok(i) => i,
            Err(e) => return CommerceValidationResult::fail(vec![e]),
        };
        let cart = match parse_cart(cart_v) {
            Ok(c) => c,
            Err(e) => return CommerceValidationResult::fail(vec![e]),
        };

        if !self.policy.blocked_merchants.is_empty()
            && self.policy.blocked_merchants.iter().any(|m| m == &cart.merchant_id)
        {
            return CommerceValidationResult::fail(vec![format!(
                "Merchant \"{}\" is blocked by commerce policy.",
                cart.merchant_id
            )]);
        }
        if !self.policy.allowed_merchants.is_empty()
            && !self
                .policy
                .allowed_merchants
                .iter()
                .any(|m| m == &cart.merchant_id)
        {
            return CommerceValidationResult::fail(vec![format!(
                "Merchant \"{}\" is not in the allowed merchants list.",
                cart.merchant_id
            )]);
        }
        if let Some(meta) = &item.metadata {
            if let Some(cat) = metadata_category(meta) {
                if self
                    .policy
                    .blocked_product_categories
                    .iter()
                    .any(|c| c == &cat)
                {
                    return CommerceValidationResult::fail(vec![format!(
                        "Product category \"{cat}\" is blocked by commerce policy."
                    )]);
                }
            }
            let findings = injection_scan(&meta.to_string());
            if !findings.is_empty() {
                return CommerceValidationResult::fail(findings);
            }
        }
        if item.price <= 0.0 {
            return CommerceValidationResult::fail(vec!["Item price must be positive.".into()]);
        }
        if !self.policy.allowed_currencies.is_empty()
            && !self
                .policy
                .allowed_currencies
                .iter()
                .any(|c| c == &item.currency)
        {
            return CommerceValidationResult::fail(vec![format!(
                "Currency \"{}\" is not allowed.",
                item.currency
            )]);
        }
        CommerceValidationResult::ok()
    }

    fn validate_checkout(&mut self, payload: &Value) -> CommerceValidationResult {
        let session = match payload.get("session") {
            Some(v) => v,
            None => {
                return CommerceValidationResult::fail(vec![
                    "Checkout session is required.".into(),
                ])
            }
        };
        let total = session
            .get("total")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let currency = session
            .get("currency")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let payment_method = session
            .get("paymentMethod")
            .or_else(|| session.get("payment_method"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if let Some(max) = self.policy.max_transaction_amount {
            if total > max {
                return CommerceValidationResult::fail(vec![format!(
                    "Transaction amount {total} exceeds maximum allowed {max}."
                )]);
            }
        }
        if let Some(max_daily) = self.policy.max_daily_spend {
            if max_daily > 0.0 && !self.spend.can_spend(total) {
                return CommerceValidationResult::fail(vec![format!(
                    "Daily spend limit would be exceeded. Current: {}, requested: {total}, limit: {max_daily}",
                    self.spend.today_total()
                )]);
            }
        }
        if let Some(gate) = self.policy.require_human_gate_above {
            if total > gate {
                return CommerceValidationResult {
                    valid: true,
                    errors: vec![],
                    gate_required: true,
                    detail: None,
                };
            }
        }
        if !self.policy.allowed_payment_methods.is_empty() {
            if let Some(pm) = &payment_method {
                if !self.policy.allowed_payment_methods.iter().any(|m| m == pm) {
                    return CommerceValidationResult::fail(vec![format!(
                        "Payment method \"{pm}\" is not allowed."
                    )]);
                }
            }
        }
        if !self.policy.allowed_currencies.is_empty() && !currency.is_empty() {
            if !self.policy.allowed_currencies.iter().any(|c| c == &currency) {
                return CommerceValidationResult::fail(vec![format!(
                    "Currency \"{currency}\" is not allowed for checkout."
                )]);
            }
        }
        if total > 0.0 {
            self.spend.record(total);
        }
        CommerceValidationResult::ok()
    }

    fn validate_payment(&self, payload: &Value) -> CommerceValidationResult {
        let neg_v = match payload.get("negotiation") {
            Some(v) => v,
            None => {
                return CommerceValidationResult::fail(vec![
                    "Payment negotiation data is required.".into(),
                ])
            }
        };
        let neg: PaymentNegotiation = match serde_json::from_value(neg_v.clone()) {
            Ok(n) => n,
            Err(e) => return CommerceValidationResult::fail(vec![e.to_string()]),
        };
        if !self.policy.allowed_payment_methods.is_empty() {
            if let Some(handler) = &neg.selected_handler {
                if !self.policy.allowed_payment_methods.iter().any(|m| m == handler) {
                    return CommerceValidationResult::fail(vec![format!(
                        "Payment handler \"{handler}\" is not allowed."
                    )]);
                }
            }
        }
        if neg.amount < 0.0 {
            return CommerceValidationResult::fail(vec![
                "Payment amount must be non-negative.".into(),
            ]);
        }
        if !self.policy.allowed_currencies.is_empty()
            && !self
                .policy
                .allowed_currencies
                .iter()
                .any(|c| c == &neg.currency)
        {
            return CommerceValidationResult::fail(vec![format!(
                "Currency \"{}\" is not allowed.",
                neg.currency
            )]);
        }
        if let Some(max) = self.policy.max_transaction_amount {
            if neg.amount > max {
                return CommerceValidationResult::fail(vec![format!(
                    "Payment amount {} exceeds maximum allowed {max}.",
                    neg.amount
                )]);
            }
        }
        CommerceValidationResult::ok()
    }

    fn validate_return(&self, payload: &Value) -> CommerceValidationResult {
        let order_id = payload
            .get("orderId")
            .or_else(|| payload.get("order_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if order_id.is_empty() {
            return CommerceValidationResult::fail(vec![
                "Order ID is required for return/refund.".into(),
            ]);
        }
        if let Some(reason) = payload.get("reason").and_then(|v| v.as_str()) {
            let findings = injection_scan(reason);
            if !findings.is_empty() {
                return CommerceValidationResult::fail(findings);
            }
        }
        CommerceValidationResult::ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::CommercePolicy;
    use serde_json::json;

    #[test]
    fn blocks_banned_merchant() {
        let mut v = CommerceValidator::new(
            CommercePolicy {
                blocked_merchants: vec!["banned_store".into()],
                ..Default::default()
            },
            ".aep/commerce-test",
        );
        let r = v.validate_action(
            "add_to_cart",
            &json!({
                "item": { "productId": "p1", "quantity": 1, "price": 10.0, "currency": "USD" },
                "cart": { "id": "c1", "items": [], "total": 10.0, "currency": "USD", "merchantId": "banned_store" }
            }),
        );
        assert!(!r.valid);
    }
}