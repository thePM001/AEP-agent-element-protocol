// AEP 2.5 -- Commerce Validator
// Validates commerce operations that agents perform: product discovery,
// cart management, checkout, payment negotiation, fulfillment tracking
// and post-purchase actions.

import type { ScannerPipeline } from "../../scanners/pipeline.js";
import type { EvidenceLedger } from "../../ledger/ledger.js";
import type {
  CommerceAction,
  CommercePolicy,
  CartItem,
  Cart,
  CheckoutSession,
  PaymentNegotiation,
  CommerceValidationResult,
  CommerceLedgerEntryType,
} from "./types.js";
import type { LedgerEntryType } from "../../ledger/types.js";
import { SpendTracker } from "./spend-tracker.js";

export class CommerceValidator {
  private policy: CommercePolicy;
  private scannerPipeline: ScannerPipeline | null;
  private spendTracker: SpendTracker;
  private ledger: EvidenceLedger | null;

  constructor(
    policy: CommercePolicy,
    scannerPipeline?: ScannerPipeline | null,
    ledger?: EvidenceLedger | null,
    spendTrackerBaseDir?: string,
  ) {
    this.policy = policy ?? { enabled: false, allowed_currencies: [], allowed_merchants: [], blocked_merchants: [], blocked_product_categories: [], allowed_payment_methods: [] };
    this.scannerPipeline = scannerPipeline ?? null;
    this.ledger = ledger ?? null;

    const maxDaily = this.policy?.max_daily_spend ?? 0;
    const currency = this.policy?.allowed_currencies?.[0] ?? "USD";
    this.spendTracker = new SpendTracker(maxDaily, currency, spendTrackerBaseDir);
  }

  getSpendTracker(): SpendTracker {
    return this.spendTracker;
  }

  validateAction(action: CommerceAction, payload: unknown): CommerceValidationResult {
    const data = payload as Record<string, unknown>;

    switch (action) {
      case "discover":
        return this.logAndReturn("commerce:discover", { action, payload: data }, { valid: true, errors: [] });

      case "add_to_cart":
        return this.validateAddToCart(data.item as CartItem, data.cart as Cart);

      case "remove_from_cart":
        return this.logAndReturn("commerce:cart_update", { action: "remove_from_cart", payload: data }, { valid: true, errors: [] });

      case "update_cart":
        return this.validateAddToCart(data.item as CartItem, data.cart as Cart);

      case "checkout_start":
      case "checkout_complete":
        return this.validateCheckout(data.session as CheckoutSession);

      case "payment_negotiate":
        return this.validatePaymentNegotiation(data.negotiation as PaymentNegotiation);

      case "payment_authorize":
        return this.validatePaymentNegotiation(data.negotiation as PaymentNegotiation);

      case "fulfillment_query":
      case "order_status":
        return this.logAndReturn("commerce:fulfillment", { action, payload: data }, { valid: true, errors: [] });

      case "return_initiate":
        return this.validateReturn(data.orderId as string, data.reason as string);

      case "refund_request":
        return this.validateReturn(data.orderId as string, data.reason as string);

      default:
        return { valid: false, errors: [`Unknown commerce action: ${action as string}`] };
    }
  }

  validateAddToCart(item: CartItem, cart: Cart): CommerceValidationResult {
    const errors: string[] = [];

    if (!item) {
      return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", error: "missing item" }, { valid: false, errors: ["Cart item is required."] });
    }
    if (!cart) {
      return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", error: "missing cart" }, { valid: false, errors: ["Cart is required."] });
    }

    // Check merchant not in blocked list
    const blockedMerchants = this.policy?.blocked_merchants ?? [];
    if (blockedMerchants.length > 0 && blockedMerchants.includes(cart.merchantId)) {
      errors.push(`Merchant "${cart.merchantId}" is blocked by commerce policy.`);
      return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", merchantId: cart.merchantId, blocked: true }, { valid: false, errors });
    }

    // Check allowed merchants (if specified, only those are allowed)
    const allowedMerchants = this.policy?.allowed_merchants ?? [];
    if (allowedMerchants.length > 0 && !allowedMerchants.includes(cart.merchantId)) {
      errors.push(`Merchant "${cart.merchantId}" is not in the allowed merchants list.`);
      return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", merchantId: cart.merchantId, notAllowed: true }, { valid: false, errors });
    }

    // Check product category not in blocked list
    const blockedCategories = this.policy?.blocked_product_categories ?? [];
    if (blockedCategories.length > 0 && item.metadata) {
      const category = String(item.metadata.category ?? "");
      if (category && blockedCategories.includes(category)) {
        errors.push(`Product category "${category}" is blocked by commerce policy.`);
        return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", category, blocked: true }, { valid: false, errors });
      }
    }

    // Check item price is positive and reasonable
    if (item.price <= 0) {
      errors.push("Item price must be positive.");
    }

    // Check currency is allowed
    const allowedCurrencies = this.policy?.allowed_currencies ?? [];
    if (allowedCurrencies.length > 0 && !allowedCurrencies.includes(item.currency)) {
      errors.push(`Currency "${item.currency}" is not allowed. Allowed: ${allowedCurrencies.join(", ")}.`);
    }

    // Scan product metadata for PII/injection
    if (this.scannerPipeline && item.metadata) {
      const metadataStr = JSON.stringify(item.metadata);
      const scanResult = this.scannerPipeline.scan(metadataStr);
      if (!scanResult.passed) {
        const hardFindings = scanResult.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          errors.push(`Product metadata contains prohibited content: ${hardFindings.map(f => f.category).join(", ")}.`);
        }
      }
    }

    if (errors.length > 0) {
      return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", productId: item.productId, errors }, { valid: false, errors });
    }

    return this.logAndReturn("commerce:cart_update", { action: "add_to_cart", productId: item.productId, quantity: item.quantity, price: item.price }, { valid: true, errors: [] });
  }

  validateCheckout(session: CheckoutSession): CommerceValidationResult {
    const errors: string[] = [];

    if (!session) {
      return this.logAndReturn("commerce:checkout", { error: "missing session" }, { valid: false, errors: ["Checkout session is required."] });
    }

    // We need the cart total from the payload. For checkout validation, the
    // caller should provide the total on the session object or via input.
    // We pull the total from the input data passed to validateAction.
    const total = (session as unknown as Record<string, unknown>).total as number ?? 0;
    const currency = (session as unknown as Record<string, unknown>).currency as string ?? "";

    // Check total does not exceed max_transaction_amount
    const maxTransaction = this.policy?.max_transaction_amount;
    if (maxTransaction !== undefined && maxTransaction !== null && total > maxTransaction) {
      errors.push(`Transaction amount ${total} exceeds maximum allowed ${maxTransaction}.`);
      return this.logAndReturn("commerce:checkout", { sessionId: session.id, total, maxTransaction, exceeded: true }, { valid: false, errors });
    }

    // Check total against daily spend accumulator
    if (this.policy?.max_daily_spend && this.policy.max_daily_spend > 0) {
      if (!this.spendTracker.canSpend(total)) {
        errors.push(`Daily spend limit would be exceeded. Current: ${this.spendTracker.getToday()}, requested: ${total}, limit: ${this.policy.max_daily_spend}.`);
        return this.logAndReturn("commerce:checkout", { sessionId: session.id, total, dailyExceeded: true }, { valid: false, errors });
      }
    }

    // If total > require_human_gate_above: return gate_required
    const gateThreshold = this.policy?.require_human_gate_above;
    if (gateThreshold !== undefined && gateThreshold !== null && total > gateThreshold) {
      return this.logAndReturn("commerce:checkout", { sessionId: session.id, total, gateThreshold, gate_required: true }, {
        valid: true,
        errors: [],
        gate_required: true,
      });
    }

    // Check payment method is allowed
    const allowedPaymentMethods = this.policy?.allowed_payment_methods ?? [];
    if (allowedPaymentMethods.length > 0 && session.paymentMethod) {
      if (!allowedPaymentMethods.includes(session.paymentMethod)) {
        errors.push(`Payment method "${session.paymentMethod}" is not allowed. Allowed: ${allowedPaymentMethods.join(", ")}.`);
      }
    }

    // Check currency is allowed
    const allowedCurrencies = this.policy?.allowed_currencies ?? [];
    if (allowedCurrencies.length > 0 && currency) {
      if (!allowedCurrencies.includes(currency)) {
        errors.push(`Currency "${currency}" is not allowed for checkout. Allowed: ${allowedCurrencies.join(", ")}.`);
      }
    }

    // Scan shipping address for PII handling compliance
    if (this.scannerPipeline && session.shippingAddress) {
      const addrStr = JSON.stringify(session.shippingAddress);
      const scanResult = this.scannerPipeline.scan(addrStr);
      if (!scanResult.passed) {
        const hardFindings = scanResult.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          errors.push(`Shipping address contains prohibited content: ${hardFindings.map(f => f.category).join(", ")}.`);
        }
      }
    }

    if (errors.length > 0) {
      return this.logAndReturn("commerce:checkout", { sessionId: session.id, errors }, { valid: false, errors });
    }

    // Record spend on successful checkout
    if (total > 0) {
      this.spendTracker.record(total);
    }

    return this.logAndReturn("commerce:checkout", { sessionId: session.id, total, status: session.status }, { valid: true, errors: [] });
  }

  validatePaymentNegotiation(negotiation: PaymentNegotiation): CommerceValidationResult {
    const errors: string[] = [];

    if (!negotiation) {
      return this.logAndReturn("commerce:payment", { error: "missing negotiation" }, { valid: false, errors: ["Payment negotiation data is required."] });
    }

    // Check selected handler is in allowed list
    const allowedPaymentMethods = this.policy?.allowed_payment_methods ?? [];
    if (allowedPaymentMethods.length > 0 && negotiation.selectedHandler) {
      if (!allowedPaymentMethods.includes(negotiation.selectedHandler)) {
        errors.push(`Payment handler "${negotiation.selectedHandler}" is not allowed. Allowed: ${allowedPaymentMethods.join(", ")}.`);
      }
    }

    // Check amount is reasonable
    if (negotiation.amount < 0) {
      errors.push("Payment amount must be non-negative.");
    }

    // Check currency matches allowed currencies
    const allowedCurrencies = this.policy?.allowed_currencies ?? [];
    if (allowedCurrencies.length > 0 && !allowedCurrencies.includes(negotiation.currency)) {
      errors.push(`Currency "${negotiation.currency}" is not allowed. Allowed: ${allowedCurrencies.join(", ")}.`);
    }

    // Check max transaction amount
    const maxTransaction = this.policy?.max_transaction_amount;
    if (maxTransaction !== undefined && maxTransaction !== null && negotiation.amount > maxTransaction) {
      errors.push(`Payment amount ${negotiation.amount} exceeds maximum allowed ${maxTransaction}.`);
    }

    if (errors.length > 0) {
      return this.logAndReturn("commerce:payment", { amount: negotiation.amount, currency: negotiation.currency, errors }, { valid: false, errors });
    }

    return this.logAndReturn("commerce:payment", { amount: negotiation.amount, currency: negotiation.currency, handler: negotiation.selectedHandler }, { valid: true, errors: [] });
  }

  validateReturn(orderId: string, reason: string): CommerceValidationResult {
    const errors: string[] = [];

    if (!orderId) {
      errors.push("Order ID is required for return/refund.");
    }

    // Scan reason text for injection/jailbreak
    if (this.scannerPipeline && reason) {
      const scanResult = this.scannerPipeline.scan(reason);
      if (!scanResult.passed) {
        const hardFindings = scanResult.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          errors.push(`Return reason contains prohibited content: ${hardFindings.map(f => f.category).join(", ")}.`);
        }
      }
    }

    if (errors.length > 0) {
      return this.logAndReturn("commerce:return", { orderId, errors }, { valid: false, errors });
    }

    return this.logAndReturn("commerce:return", { orderId, reason: reason?.slice(0, 100) }, { valid: true, errors: [] });
  }

  private logAndReturn(
    ledgerType: CommerceLedgerEntryType,
    ledgerData: Record<string, unknown>,
    result: CommerceValidationResult,
  ): CommerceValidationResult {
    this.ledger?.append(ledgerType as LedgerEntryType, ledgerData);
    return { ...result, ledgerType, ledgerData };
  }
}
