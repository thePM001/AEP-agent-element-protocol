// @PAD: p0-v275-h46-h47-commerce-gate-spend-v1
// @GCDE: document_sha256=p0-v275-h46-h47-commerce
// @PAD: p0-v275-sec4-checkout-total-required-v1
// @GCDE: document_sha256=p0-v275-sec4-commerce-total
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
        if !self.policy.enabled {
            return CommerceValidationResult::fail(vec!["Commerce policy is disabled.".into()]);
        }
        // M-35: reject non-object payloads
        if !payload.is_object() {
            return CommerceValidationResult::fail(vec![
                "Commerce payload must be a JSON object.".into(),
            ]);
        }
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
            CommerceAction::CheckoutStart => self.validate_checkout(payload, true),
            // HIGH: complete validates session but does not re-record spend
            CommerceAction::CheckoutComplete => self.validate_checkout(payload, false),
            CommerceAction::PaymentNegotiate => self.validate_payment(payload, false),
            CommerceAction::PaymentAuthorize => self.validate_payment(payload, true),
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

    fn validate_checkout(&mut self, payload: &Value, record_spend: bool) -> CommerceValidationResult {
        let session = match payload.get("session") {
            Some(v) => v,
            None => {
                return CommerceValidationResult::fail(vec![
                    "Checkout session is required.".into(),
                ])
            }
        };
        // SEC-4: total is mandatory; missing/zero/NaN must not bypass spend limits or human gates
        let client_total = match session.get("total").and_then(|v| v.as_f64()) {
            None => {
                return CommerceValidationResult::fail(vec![
                    "Checkout total is required.".into(),
                ]);
            }
            Some(t) if !t.is_finite() => {
                return CommerceValidationResult::fail(vec![
                    "Checkout total must be a finite number.".into(),
                ]);
            }
            Some(t) if t <= 0.0 => {
                return CommerceValidationResult::fail(vec![
                    "Checkout total must be positive.".into(),
                ]);
            }
            Some(t) => t,
        };
        // HIGH: cart is mandatory for total authority (client-only total rejected)
        let cart_v = match payload.get("cart").or_else(|| session.get("cart")) {
            Some(v) => v,
            None => {
                return CommerceValidationResult::fail(vec![
                    "Checkout cart is required (client-only total is not authoritative).".into(),
                ]);
            }
        };
        let cart = match parse_cart(cart_v) {
            Ok(c) if !c.items.is_empty() => c,
            Ok(_) => {
                return CommerceValidationResult::fail(vec![
                    "Checkout cart must contain at least one item.".into(),
                ]);
            }
            Err(e) => {
                return CommerceValidationResult::fail(vec![format!("Checkout cart invalid: {e}")]);
            }
        };
        // CRITICAL: per-line positivity (no negative price/qty offsets that understate totals)
        for (idx, item) in cart.items.iter().enumerate() {
            if !item.price.is_finite() || item.price <= 0.0 {
                return CommerceValidationResult::fail(vec![format!(
                    "Checkout cart item[{idx}] price must be a finite positive number."
                )]);
            }
            if item.quantity <= 0 {
                return CommerceValidationResult::fail(vec![format!(
                    "Checkout cart item[{idx}] quantity must be a positive integer."
                )]);
            }
        }
        let server_total: f64 = cart
            .items
            .iter()
            .map(|i| i.price * i.quantity as f64)
            .sum();
        if !server_total.is_finite() || server_total <= 0.0 {
            return CommerceValidationResult::fail(vec![
                "Checkout cart total must be positive.".into(),
            ]);
        }
        if client_total + 1e-6 < server_total {
            return CommerceValidationResult::fail(vec![format!(
                "Checkout total {client_total} under-reports cart total {server_total}."
            )]);
        }
        // Use the higher of client/server so spend gates cannot be undercut
        let total = client_total.max(server_total);
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
        // BM-02: allowlists fail closed when required fields are omitted (always before gate).
        if !self.policy.allowed_payment_methods.is_empty() {
            match &payment_method {
                Some(pm)
                    if self
                        .policy
                        .allowed_payment_methods
                        .iter()
                        .any(|m| m == pm) => {}
                Some(pm) => {
                    return CommerceValidationResult::fail(vec![format!(
                        "Payment method \"{pm}\" is not allowed."
                    )]);
                }
                None => {
                    return CommerceValidationResult::fail(vec![
                        "Payment method is required when an allowlist is configured.".into(),
                    ]);
                }
            }
        }
        if !self.policy.allowed_currencies.is_empty() {
            if currency.is_empty() {
                return CommerceValidationResult::fail(vec![
                    "Currency is required when an allowlist is configured.".into(),
                ]);
            }
            if !self.policy.allowed_currencies.iter().any(|c| c == &currency) {
                return CommerceValidationResult::fail(vec![format!(
                    "Currency \"{currency}\" is not allowed for checkout."
                )]);
            }
        }
        if let Some(gate) = self.policy.require_human_gate_above {
            if total > gate {
                // HIGH: gate is hard-fail (valid:false). No spend record without approval path.
                if record_spend && total > 0.0 {
                    match self.spend.can_spend_checked(total) {
                        Ok(false) => {
                            return CommerceValidationResult::fail(vec![format!(
                                "Daily spend limit would be exceeded before human gate. Current: {}, requested: {total}",
                                self.spend.today_total()
                            )]);
                        }
                        Err(e) => return CommerceValidationResult::fail(vec![e]),
                        Ok(true) => {}
                    }
                }
                return CommerceValidationResult::gate_required_fail(vec![format!(
                    "Human approval gate required: total {total} exceeds require_human_gate_above {gate}."
                )]);
            }
        }
        // Even when not recording (checkout_complete), still fail closed on daily cap.
        if total > 0.0 {
            match self.spend.can_spend_checked(total) {
                Ok(false) => {
                    return CommerceValidationResult::fail(vec![format!(
                        "Daily spend limit would be exceeded. Current: {}, requested: {total}",
                        self.spend.today_total()
                    )]);
                }
                Err(e) => return CommerceValidationResult::fail(vec![e]),
                Ok(true) => {}
            }
        }
        if record_spend && total > 0.0 {
            if let Err(e) = self.spend.reserve_and_record(total) {
                return CommerceValidationResult::fail(vec![e]);
            }
        }
        CommerceValidationResult::ok()
    }

    fn validate_payment(&mut self, payload: &Value, record_spend: bool) -> CommerceValidationResult {
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
        // BM-02: payment method allowlist fail-closed on omit
        if !self.policy.allowed_payment_methods.is_empty() {
            match &neg.selected_handler {
                Some(handler)
                    if self
                        .policy
                        .allowed_payment_methods
                        .iter()
                        .any(|m| m == handler) => {}
                Some(handler) => {
                    return CommerceValidationResult::fail(vec![format!(
                        "Payment handler \"{handler}\" is not allowed."
                    )]);
                }
                None => {
                    return CommerceValidationResult::fail(vec![
                        "Payment handler is required when an allowlist is configured.".into(),
                    ]);
                }
            }
        }
        if neg.amount < 0.0 {
            return CommerceValidationResult::fail(vec![
                "Payment amount must be non-negative.".into(),
            ]);
        }
        // BM-02: currency allowlist fail-closed on empty currency
        if !self.policy.allowed_currencies.is_empty() {
            if neg.currency.is_empty() {
                return CommerceValidationResult::fail(vec![
                    "Currency is required when an allowlist is configured.".into(),
                ]);
            }
            if !self
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
        }
        if let Some(max) = self.policy.max_transaction_amount {
            if neg.amount > max {
                return CommerceValidationResult::fail(vec![format!(
                    "Payment amount {} exceeds maximum allowed {max}.",
                    neg.amount
                )]);
            }
        }
        // Human gate applies to payment_authorize as well as checkout (hard-fail + gate_required).
        if let Some(threshold) = self.policy.require_human_gate_above {
            if neg.amount > threshold {
                return CommerceValidationResult::gate_required_fail(vec![format!(
                    "Payment amount {} exceeds human gate threshold {threshold}; operator approval required.",
                    neg.amount
                )]);
            }
        }
        // BM-03: payment_authorize atomic reserve+record under one lock.
        if record_spend && neg.amount > 0.0 {
            if let Err(e) = self.spend.reserve_and_record(neg.amount) {
                return CommerceValidationResult::fail(vec![e]);
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
                enabled: true,
                max_daily_spend: Some(1000.0),
                max_transaction_amount: Some(1000.0),
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

    #[test]
    fn checkout_rejects_negative_price_line_offset() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = CommerceValidator::new(
            CommercePolicy {
                enabled: true,
                max_daily_spend: Some(10000.0),
                max_transaction_amount: Some(10000.0),
                allowed_payment_methods: vec!["card".into()],
                allowed_currencies: vec!["USD".into()],
                ..Default::default()
            },
            dir.path(),
        );
        // 1000 + (-900) = 100 understates a high-value cart if negatives were allowed
        let r = v.validate_action(
            "checkout_start",
            &json!({
                "session": {
                    "total": 100.0,
                    "currency": "USD",
                    "paymentMethod": "card"
                },
                "cart": {
                    "id": "c1",
                    "merchantId": "m1",
                    "currency": "USD",
                    "total": 100.0,
                    "items": [
                        { "productId": "expensive", "quantity": 1, "price": 1000.0, "currency": "USD" },
                        { "productId": "offset", "quantity": 1, "price": -900.0, "currency": "USD" }
                    ]
                }
            }),
        );
        assert!(!r.valid, "negative price line must fail closed: {:?}", r.errors);
        assert!(
            r.errors.iter().any(|e| e.contains("price") && e.contains("positive")),
            "errors={:?}",
            r.errors
        );
    }

    #[test]
    fn checkout_human_gate_is_hard_fail() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = CommerceValidator::new(
            CommercePolicy {
                enabled: true,
                max_daily_spend: Some(10000.0),
                max_transaction_amount: Some(10000.0),
                require_human_gate_above: Some(50.0),
                allowed_payment_methods: vec!["card".into()],
                allowed_currencies: vec!["USD".into()],
                ..Default::default()
            },
            dir.path(),
        );
        let r = v.validate_action(
            "checkout_start",
            &json!({
                "session": {
                    "total": 100.0,
                    "currency": "USD",
                    "paymentMethod": "card"
                },
                "cart": {
                    "id": "c1",
                    "merchantId": "m1",
                    "currency": "USD",
                    "total": 100.0,
                    "items": [
                        { "productId": "p1", "quantity": 1, "price": 100.0, "currency": "USD" }
                    ]
                }
            }),
        );
        assert!(!r.valid, "gate must be valid:false");
        assert!(r.gate_required);
        assert!(r.errors.iter().any(|e| e.contains("Human approval gate")));
    }

    #[test]
    fn checkout_rejects_non_positive_quantity() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = CommerceValidator::new(
            CommercePolicy {
                enabled: true,
                max_daily_spend: Some(10000.0),
                max_transaction_amount: Some(10000.0),
                allowed_payment_methods: vec!["card".into()],
                allowed_currencies: vec!["USD".into()],
                ..Default::default()
            },
            dir.path(),
        );
        let r = v.validate_action(
            "checkout_start",
            &json!({
                "session": {
                    "total": 10.0,
                    "currency": "USD",
                    "paymentMethod": "card"
                },
                "cart": {
                    "id": "c1",
                    "merchantId": "m1",
                    "currency": "USD",
                    "total": 10.0,
                    "items": [
                        { "productId": "p1", "quantity": 0, "price": 10.0, "currency": "USD" }
                    ]
                }
            }),
        );
        assert!(!r.valid, "zero quantity must fail closed: {:?}", r.errors);
        assert!(
            r.errors.iter().any(|e| e.contains("quantity")),
            "errors={:?}",
            r.errors
        );
    }

    #[test]
    fn bm02_checkout_requires_payment_method_when_allowlisted() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = CommerceValidator::new(
            CommercePolicy {
                enabled: true,
                max_daily_spend: Some(1000.0),
                max_transaction_amount: Some(1000.0),
                allowed_payment_methods: vec!["card".into()],
                allowed_currencies: vec!["USD".into()],
                ..Default::default()
            },
            dir.path(),
        );
        let r = v.validate_action(
            "checkout_start",
            &json!({
                "session": { "total": 10.0, "currency": "USD" },
                "cart": { "id": "c1", "merchantId": "m1", "currency": "USD", "total": 10.0,
                  "items": [{ "productId": "p1", "quantity": 1, "price": 10.0, "currency": "USD" }] }
            }),
        );
        assert!(!r.valid, "omitted payment method must fail closed");
        assert!(r.errors.iter().any(|e| e.contains("Payment method")));
    }

    #[test]
    fn bm02_checkout_requires_currency_when_allowlisted() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = CommerceValidator::new(
            CommercePolicy {
                enabled: true,
                max_daily_spend: Some(1000.0),
                max_transaction_amount: Some(1000.0),
                allowed_currencies: vec!["USD".into()],
                ..Default::default()
            },
            dir.path(),
        );
        let r = v.validate_action(
            "checkout_start",
            &json!({
                "session": { "total": 10.0 },
                "cart": { "id": "c1", "merchantId": "m1", "currency": "USD", "total": 10.0,
                  "items": [{ "productId": "p1", "quantity": 1, "price": 10.0, "currency": "USD" }] }
            }),
        );
        assert!(!r.valid, "omitted currency must fail closed");
        assert!(r.errors.iter().any(|e| e.contains("Currency")));
    }

    #[test]
    fn bm03_payment_authorize_enforces_daily_and_records() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = CommerceValidator::new(
            CommercePolicy {
                enabled: true,
                max_daily_spend: Some(25.0),
                max_transaction_amount: Some(1000.0),
                allowed_currencies: vec!["USD".into()],
                allowed_payment_methods: vec!["card".into()],
                ..Default::default()
            },
            dir.path(),
        );
        let ok = v.validate_action(
            "payment_authorize",
            &json!({
                "negotiation": {
                    "amount": 20.0,
                    "currency": "USD",
                    "selected_handler": "card"
                }
            }),
        );
        assert!(ok.valid, "{:?}", ok.errors);
        let over = v.validate_action(
            "payment_authorize",
            &json!({
                "negotiation": {
                    "amount": 10.0,
                    "currency": "USD",
                    "selected_handler": "card"
                }
            }),
        );
        assert!(!over.valid, "second authorize must hit daily cap");
    }
}