// BL-X2: TS CommerceValidator - real precheck validation (aligned with Rust semantics)
import type { CommercePolicy, CommerceValidationResult } from "./types.js";
import {
  CartItemSchema,
  CartSchema,
  PaymentNegotiationSchema,
  CommerceActionSchema,
} from "./types.js";
import { SpendTracker } from "./spend-tracker.js";
import { z } from "zod";

const PayloadObject = z.record(z.unknown());

export class CommerceValidator {
  private policy: NonNullable<CommercePolicy>;
  private spend: SpendTracker;

  constructor(policy: CommercePolicy | undefined, spendBaseDir: string) {
    // HIGH fail-closed: missing policy => commerce disabled with zero limits
    this.policy = (policy ?? {
      enabled: false,
      max_daily_spend: 0,
      max_transaction_amount: 0,
      allowed_currencies: [],
      allowed_merchants: [],
      blocked_merchants: [],
      blocked_product_categories: [],
      allowed_payment_methods: [],
    }) as NonNullable<CommercePolicy>;
    const maxDaily =
      this.policy?.max_daily_spend != null && this.policy.max_daily_spend > 0
        ? this.policy.max_daily_spend
        : 0;
    const currency =
      this.policy?.allowed_currencies?.[0] ?? "USD";
    this.spend = new SpendTracker(maxDaily, currency, spendBaseDir);
  }

  validateAction(action: string, payload: unknown): CommerceValidationResult {
    const parsedAction = CommerceActionSchema.safeParse(action);
    if (!parsedAction.success) {
      return fail([`Unknown commerce action: ${action}`]);
    }
    // HIGH: honor policy.enabled (fail closed when disabled)
    if (this.policy && (this.policy as { enabled?: boolean }).enabled === false) {
      return fail(["Commerce policy is disabled."]);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return fail(["Commerce payload must be a JSON object."]);
    }
    const p = payload as Record<string, unknown>;

    switch (parsedAction.data) {
      case "discover":
      case "remove_from_cart":
      case "fulfillment_query":
      case "order_status":
        return ok();
      case "add_to_cart":
      case "update_cart":
        return this.validateCart(p);
      case "checkout_start":
        return this.validateCheckout(p, true);
      case "checkout_complete":
        return this.validateCheckout(p, false);
      case "payment_negotiate":
      case "payment_authorize":
        return this.validatePayment(p, parsedAction.data === "payment_authorize");
      case "return_initiate":
      case "refund_request":
        return this.validateReturn(p);
      default:
        return fail([`Unhandled action: ${action}`]);
    }
  }

  private validateCart(p: Record<string, unknown>): CommerceValidationResult {
    const item = CartItemSchema.safeParse(p.item);
    if (!item.success) return fail(["Cart item is required or invalid."]);
    const cart = CartSchema.safeParse(p.cart);
    if (!cart.success) return fail(["Cart is required or invalid."]);
    const pol = this.policy;
    if (pol?.blocked_merchants?.includes(cart.data.merchantId)) {
      return fail([`Merchant blocked: ${cart.data.merchantId}`]);
    }
    if (
      pol?.allowed_merchants &&
      pol.allowed_merchants.length > 0 &&
      !pol.allowed_merchants.includes(cart.data.merchantId)
    ) {
      return fail([`Merchant not allowed: ${cart.data.merchantId}`]);
    }
    if (item.data.price <= 0) {
      return fail(["Item price must be positive."]);
    }
    if (
      pol?.allowed_currencies &&
      pol.allowed_currencies.length > 0 &&
      !pol.allowed_currencies.includes(item.data.currency)
    ) {
      return fail([`Currency not allowed: ${item.data.currency}`]);
    }
    // HIGH: category block + injection scan (parity with Rust)
    const meta = (item.data as { metadata?: Record<string, unknown> }).metadata;
    const category =
      (meta?.category as string | undefined) ??
      (meta?.product_category as string | undefined) ??
      "";
    if (
      category &&
      pol?.blocked_product_categories &&
      pol.blocked_product_categories.length > 0 &&
      pol.blocked_product_categories.includes(category)
    ) {
      return fail([`Product category blocked: ${category}`]);
    }
    const metaBlob = JSON.stringify(meta ?? {});
    if (commerceInjectionHit(metaBlob)) {
      return fail(["Cart item metadata failed injection scan."]);
    }
    return ok();
  }

  private validateCheckout(p: Record<string, unknown>, recordSpend: boolean): CommerceValidationResult {
    const session = p.session;
    if (!session || typeof session !== "object") {
      return fail(["Checkout session is required."]);
    }
    const s = session as Record<string, unknown>;
    let total = Number(s.total);
    if (!Number.isFinite(total)) return fail(["Checkout total is required."]);
    if (total <= 0) return fail(["Checkout total must be positive."]);
    // HIGH: cart mandatory; server recomputes total authority
    const cartRaw = (p.cart as Record<string, unknown> | undefined) ??
      (s.cart as Record<string, unknown> | undefined);
    if (!cartRaw || !Array.isArray(cartRaw.items) || cartRaw.items.length === 0) {
      return fail(["Checkout cart is required (client-only total is not authoritative)."]);
    }
    {
      let serverTotal = 0;
      const items = cartRaw.items as Array<Record<string, unknown>>;
      for (let idx = 0; idx < items.length; idx += 1) {
        const it = items[idx];
        const price = Number(it.price);
        const qty = Number(it.quantity);
        // CRITICAL: per-line positivity (no negative price/qty offsets that understate totals)
        if (!Number.isFinite(price) || price <= 0) {
          return fail([
            `Checkout cart item[${idx}] price must be a finite positive number.`,
          ]);
        }
        if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
          return fail([
            `Checkout cart item[${idx}] quantity must be a positive integer.`,
          ]);
        }
        serverTotal += price * qty;
      }
      if (!Number.isFinite(serverTotal) || serverTotal <= 0) {
        return fail(["Checkout cart total must be positive."]);
      }
      if (total + 1e-6 < serverTotal) {
        return fail([
          `Checkout total ${total} under-reports cart total ${serverTotal}.`,
        ]);
      }
      if (serverTotal > total) total = serverTotal;
    }
    const currency = String(s.currency ?? "");
    const paymentMethod =
      (s.paymentMethod as string | undefined) ??
      (s.payment_method as string | undefined);

    const pol = this.policy;
    if (pol?.max_transaction_amount != null && total > pol.max_transaction_amount) {
      return fail([`Transaction amount ${total} exceeds maximum ${pol.max_transaction_amount}.`]);
    }
    if (!recordSpend && pol?.max_daily_spend != null && pol.max_daily_spend > 0) {
      if (!this.spend.canSpend(total)) {
        return fail([
          `Daily spend limit would be exceeded. Current: ${this.spend.getTodayTotal()}, requested: ${total}, limit: ${pol.max_daily_spend}`,
        ]);
      }
    }
    if (pol?.allowed_payment_methods && pol.allowed_payment_methods.length > 0) {
      if (!paymentMethod) {
        return fail(["Payment method is required when an allowlist is configured."]);
      }
      if (!pol.allowed_payment_methods.includes(paymentMethod)) {
        return fail([`Payment method "${paymentMethod}" is not allowed.`]);
      }
    }
    if (pol?.allowed_currencies && pol.allowed_currencies.length > 0) {
      if (!currency) {
        return fail(["Currency is required when an allowlist is configured."]);
      }
      if (!pol.allowed_currencies.includes(currency)) {
        return fail([`Currency "${currency}" is not allowed for checkout.`]);
      }
    }
    if (pol?.require_human_gate_above != null && total > pol.require_human_gate_above) {
      // HIGH: hard-fail until operator approval proof exists (no soft valid:true).
      if (total > 0 && !this.spend.canSpend(total)) {
        return fail([
          `Daily spend limit would be exceeded before human gate. Current: ${this.spend.getTodayTotal()}, requested: ${total}`,
        ]);
      }
      return {
        valid: false,
        errors: [
          `Human approval gate required: total ${total} exceeds require_human_gate_above ${pol.require_human_gate_above}.`,
        ],
        gate_required: true,
      };
    }
    if (recordSpend && total > 0) {
      if (pol?.max_daily_spend == null || pol.max_daily_spend <= 0) {
        return fail([
          "Checkout denied: max_daily_spend must be a positive limit when commerce is enabled.",
        ]);
      }
      if (!this.spend.reserveAndRecord(total)) {
        return fail([
          `Daily spend limit would be exceeded. Current: ${this.spend.getTodayTotal()}, requested: ${total}, limit: ${pol.max_daily_spend}`,
        ]);
      }
    }
    return ok();
  }

  private validatePayment(
    p: Record<string, unknown>,
    authorize: boolean
  ): CommerceValidationResult {
    const neg = PaymentNegotiationSchema.safeParse(p.negotiation);
    if (!neg.success) {
      return fail(["Payment negotiation data is required or invalid."]);
    }
    const n = neg.data;
    const pol = this.policy;
    if (pol?.allowed_payment_methods && pol.allowed_payment_methods.length > 0) {
      if (!n.selectedHandler) {
        return fail(["Payment handler is required when an allowlist is configured."]);
      }
      if (!pol.allowed_payment_methods.includes(n.selectedHandler)) {
        return fail([`Payment handler "${n.selectedHandler}" is not allowed.`]);
      }
    }
    if (n.amount < 0) return fail(["Payment amount must be non-negative."]);
    if (pol?.allowed_currencies && pol.allowed_currencies.length > 0) {
      if (!n.currency) {
        return fail(["Currency is required when an allowlist is configured."]);
      }
      if (!pol.allowed_currencies.includes(n.currency)) {
        return fail([`Currency "${n.currency}" is not allowed.`]);
      }
    }
    if (pol?.max_transaction_amount != null && n.amount > pol.max_transaction_amount) {
      return fail([
        `Payment amount ${n.amount} exceeds maximum ${pol.max_transaction_amount}.`,
      ]);
    }
    // HIGH: human gate on payment_authorize (Rust parity)
    if (
      authorize &&
      pol?.require_human_gate_above != null &&
      n.amount > pol.require_human_gate_above
    ) {
      if (n.amount > 0 && !this.spend.canSpend(n.amount)) {
        return fail([
          `Daily spend limit would be exceeded before human gate. Current: ${this.spend.getTodayTotal()}, requested: ${n.amount}`,
        ]);
      }
      return {
        valid: false,
        errors: [
          `Payment amount ${n.amount} exceeds human gate threshold ${pol.require_human_gate_above}; operator approval required.`,
        ],
        gate_required: true,
      };
    }
    if (authorize) {
      if (n.amount > 0) {
        if (pol?.max_daily_spend == null || pol.max_daily_spend <= 0) {
          return fail([
            "Payment denied: max_daily_spend must be a positive limit when commerce is enabled.",
          ]);
        }
        if (!this.spend.reserveAndRecord(n.amount)) {
          return fail([
            `Daily spend limit would be exceeded. Current: ${this.spend.getTodayTotal()}, requested: ${n.amount}, limit: ${pol.max_daily_spend}`,
          ]);
        }
      }
    }
    return ok();
  }

  private validateReturn(p: Record<string, unknown>): CommerceValidationResult {
    const orderId =
      (p.orderId as string | undefined) ?? (p.order_id as string | undefined) ?? "";
    if (!orderId) return fail(["Order ID is required for return/refund."]);
    const reason =
      (p.reason as string | undefined) ?? (p.return_reason as string | undefined) ?? "";
    if (reason && commerceInjectionHit(reason)) {
      return fail(["Return reason failed injection scan."]);
    }
    return ok();
  }
}

function commerceInjectionHit(text: string): boolean {
  const t = String(text ?? "").toLowerCase();
  const patterns = [
    "<script",
    "</script",
    "javascript:",
    "vbscript:",
    "data:text/html",
    "onerror=",
    "onload=",
    "drop table",
    "drop database",
    "union select",
    "or 1=1",
    "rm -rf",
    "curl ",
    "wget ",
    "$(",
    "`",
    "{{",
    "}}",
  ];
  return patterns.some((p) => t.includes(p));
}

function ok(): CommerceValidationResult {
  return { valid: true, errors: [] };
}
function fail(errors: string[]): CommerceValidationResult {
  return { valid: false, errors };
}

// silence unused import in some bundlers
void PayloadObject;
