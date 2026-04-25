import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { CommerceValidator } from "../../../src/subprotocols/commerce/validator.js";
import { SpendTracker } from "../../../src/subprotocols/commerce/spend-tracker.js";
import { CommerceRegistry } from "../../../src/subprotocols/commerce/registry.js";
import { createDefaultPipeline } from "../../../src/scanners/pipeline.js";
import { EvidenceLedger } from "../../../src/ledger/ledger.js";
import { parseCovenant } from "../../../src/covenant/parser.js";
import { evaluateCovenant } from "../../../src/covenant/evaluator.js";
import type { CommercePolicy, CartItem, Cart, CheckoutSession, PaymentNegotiation } from "../../../src/subprotocols/commerce/types.js";

function makePolicy(overrides?: Partial<CommercePolicy>): CommercePolicy {
  return {
    enabled: true,
    max_transaction_amount: 1000,
    allowed_currencies: ["EUR", "USD"],
    allowed_merchants: [],
    blocked_merchants: ["banned_store"],
    blocked_product_categories: ["weapons", "drugs"],
    require_human_gate_above: 500,
    allowed_payment_methods: ["google_pay", "stripe", "bank_transfer"],
    max_daily_spend: 2000,
    ...overrides,
  };
}

function makeCart(merchantId: string = "shop_abc", total: number = 100): Cart {
  return {
    id: "cart-001",
    items: [],
    total,
    currency: "EUR",
    merchantId,
  };
}

function makeItem(overrides?: Partial<CartItem>): CartItem {
  return {
    productId: "prod-001",
    quantity: 1,
    price: 29.99,
    currency: "EUR",
    ...overrides,
  };
}

function makeCheckoutSession(overrides?: Partial<CheckoutSession & { total?: number; currency?: string }>): CheckoutSession & { total: number; currency: string } {
  return {
    id: "checkout-001",
    cartId: "cart-001",
    paymentMethod: "stripe",
    status: "pending",
    total: 100,
    currency: "EUR",
    ...overrides,
  } as CheckoutSession & { total: number; currency: string };
}

function makeNegotiation(overrides?: Partial<PaymentNegotiation>): PaymentNegotiation {
  return {
    availableHandlers: ["stripe", "google_pay"],
    selectedHandler: "stripe",
    amount: 100,
    currency: "EUR",
    ...overrides,
  };
}

describe("CommerceValidator - Add to Cart", () => {
  let tmpDir: string;
  let ledger: EvidenceLedger;
  let validator: CommerceValidator;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-commerce-"));
    ledger = new EvidenceLedger({ dir: tmpDir, sessionId: "commerce-test" });
    const pipeline = createDefaultPipeline();
    validator = new CommerceValidator(makePolicy(), pipeline, ledger, join(tmpDir, "commerce"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("valid item passes add to cart", () => {
    const result = validator.validateAddToCart(makeItem(), makeCart());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("blocked merchant rejected (hard)", () => {
    const result = validator.validateAddToCart(makeItem(), makeCart("banned_store"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("blocked");
    expect(result.errors[0]).toContain("banned_store");
  });

  it("blocked category rejected (hard)", () => {
    const item = makeItem({ metadata: { category: "weapons" } });
    const result = validator.validateAddToCart(item, makeCart());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("weapons");
    expect(result.errors[0]).toContain("blocked");
  });

  it("disallowed currency rejected", () => {
    const item = makeItem({ currency: "GBP" });
    const result = validator.validateAddToCart(item, makeCart());
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("GBP"))).toBe(true);
  });

  it("zero price rejected", () => {
    const item = makeItem({ price: 0 });
    const result = validator.validateAddToCart(item, makeCart());
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("positive"))).toBe(true);
  });

  it("injection in product metadata caught by scanner", () => {
    const item = makeItem({ metadata: { name: "DROP TABLE products;" } });
    const result = validator.validateAddToCart(item, makeCart());
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("prohibited content"))).toBe(true);
  });
});

describe("CommerceValidator - Checkout", () => {
  let tmpDir: string;
  let ledger: EvidenceLedger;
  let validator: CommerceValidator;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-commerce-checkout-"));
    ledger = new EvidenceLedger({ dir: tmpDir, sessionId: "commerce-checkout" });
    const pipeline = createDefaultPipeline();
    validator = new CommerceValidator(makePolicy(), pipeline, ledger, join(tmpDir, "commerce"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("under max amount passes", () => {
    const session = makeCheckoutSession({ total: 200 });
    const result = validator.validateCheckout(session);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("over max amount rejected (hard)", () => {
    const session = makeCheckoutSession({ total: 1500 });
    const result = validator.validateCheckout(session);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("over human gate threshold returns gate_required", () => {
    const session = makeCheckoutSession({ total: 600 });
    const result = validator.validateCheckout(session);
    expect(result.valid).toBe(true);
    expect(result.gate_required).toBe(true);
  });

  it("blocked currency rejected", () => {
    const session = makeCheckoutSession({ total: 100, currency: "GBP" });
    const result = validator.validateCheckout(session);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("GBP"))).toBe(true);
  });

  it("blocked payment method rejected", () => {
    const session = makeCheckoutSession({ paymentMethod: "crypto_wallet" });
    const result = validator.validateCheckout(session);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("crypto_wallet"))).toBe(true);
  });

  it("daily spend exceeded rejected", () => {
    // Use a tight daily limit for this test
    const tightPolicy = makePolicy({ max_daily_spend: 500 });
    const tightValidator = new CommerceValidator(tightPolicy, createDefaultPipeline(), ledger, join(tmpDir, "commerce-tight"));

    // First checkout succeeds and records spend
    const session1 = makeCheckoutSession({ total: 400 });
    const result1 = tightValidator.validateCheckout(session1);
    expect(result1.valid).toBe(true);

    // Second checkout would exceed the daily limit (400 + 200 = 600 > 500)
    const session2 = makeCheckoutSession({ total: 200 });
    const result = tightValidator.validateCheckout(session2);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Daily spend limit");
  });
});

describe("CommerceValidator - Payment Negotiation", () => {
  let tmpDir: string;
  let validator: CommerceValidator;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-commerce-payment-"));
    validator = new CommerceValidator(makePolicy(), null, null, join(tmpDir, "commerce"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allowed method passes", () => {
    const result = validator.validatePaymentNegotiation(makeNegotiation());
    expect(result.valid).toBe(true);
  });

  it("blocked method rejected", () => {
    const result = validator.validatePaymentNegotiation(makeNegotiation({ selectedHandler: "bitcoin" }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("bitcoin");
  });

  it("amount exceeding max detected", () => {
    const result = validator.validatePaymentNegotiation(makeNegotiation({ amount: 5000 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("exceeds maximum"))).toBe(true);
  });

  it("disallowed currency rejected", () => {
    const result = validator.validatePaymentNegotiation(makeNegotiation({ currency: "JPY" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("JPY"))).toBe(true);
  });
});

describe("CommerceValidator - Return", () => {
  let tmpDir: string;
  let validator: CommerceValidator;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-commerce-return-"));
    const pipeline = createDefaultPipeline();
    validator = new CommerceValidator(makePolicy(), pipeline, null, join(tmpDir, "commerce"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("clean reason passes", () => {
    const result = validator.validateReturn("order-123", "Product arrived damaged");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("injection in reason caught by scanner", () => {
    const result = validator.validateReturn("order-123", "Reason: DROP TABLE orders;");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("prohibited content"))).toBe(true);
  });

  it("missing orderId rejected", () => {
    const result = validator.validateReturn("", "Some reason");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Order ID"))).toBe(true);
  });
});

describe("SpendTracker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-spend-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accumulates correctly", () => {
    const tracker = new SpendTracker(1000, "EUR", tmpDir);
    tracker.record(100);
    tracker.record(200);
    expect(tracker.getToday()).toBe(300);
  });

  it("blocks when exceeded", () => {
    const tracker = new SpendTracker(500, "EUR", tmpDir);
    tracker.record(400);
    expect(tracker.canSpend(200)).toBe(false);
    expect(tracker.canSpend(100)).toBe(true);
  });

  it("resets daily", () => {
    const tracker = new SpendTracker(1000, "EUR", tmpDir);
    tracker.record(500);
    expect(tracker.getToday()).toBe(500);
    tracker.reset();
    expect(tracker.getToday()).toBe(0);
  });

  it("canSpend returns true when no limit", () => {
    const tracker = new SpendTracker(0, "EUR", tmpDir);
    tracker.record(999999);
    expect(tracker.canSpend(999999)).toBe(true);
  });
});

describe("CommerceRegistry", () => {
  it("register and retrieve merchants", () => {
    const registry = new CommerceRegistry();
    registry.registerMerchant("shop_1", {
      id: "shop_1",
      name: "Test Shop",
      capabilities: ["physical_goods"],
      paymentHandlers: ["stripe", "google_pay"],
      currency: "EUR",
    });

    const merchant = registry.getMerchant("shop_1");
    expect(merchant).not.toBeNull();
    expect(merchant!.name).toBe("Test Shop");
    expect(merchant!.paymentHandlers).toContain("stripe");
  });

  it("list merchants returns all registered", () => {
    const registry = new CommerceRegistry();
    registry.registerMerchant("a", { id: "a", name: "A", capabilities: [], paymentHandlers: [], currency: "USD" });
    registry.registerMerchant("b", { id: "b", name: "B", capabilities: [], paymentHandlers: [], currency: "EUR" });
    expect(registry.listMerchants()).toHaveLength(2);
  });

  it("getMerchant returns null for unknown", () => {
    const registry = new CommerceRegistry();
    expect(registry.getMerchant("nonexistent")).toBeNull();
  });

  it("removeMerchant removes merchant", () => {
    const registry = new CommerceRegistry();
    registry.registerMerchant("x", { id: "x", name: "X", capabilities: [], paymentHandlers: [], currency: "USD" });
    expect(registry.hasMerchant("x")).toBe(true);
    registry.removeMerchant("x");
    expect(registry.hasMerchant("x")).toBe(false);
  });
});

describe("Commerce Covenant Rules", () => {
  it("permit commerce:discover passes", () => {
    const spec = parseCovenant(`covenant CommerceTest {
      permit commerce:discover;
    }`);

    const result = evaluateCovenant(spec, { action: "commerce:discover", input: {} });
    expect(result.allowed).toBe(true);
  });

  it("forbid commerce:checkout with condition blocks", () => {
    const spec = parseCovenant(`covenant CommerceTest {
      permit commerce:discover;
      permit commerce:add_to_cart;
      forbid commerce:checkout (total > "500") [hard];
    }`);

    const result = evaluateCovenant(spec, {
      action: "commerce:checkout",
      input: { total: "600" },
    });
    expect(result.allowed).toBe(false);
    expect(result.matchedRule?.severity).toBe("hard");
  });

  it("permit commerce:add_to_cart with merchant condition", () => {
    const spec = parseCovenant(`covenant CommerceTest {
      permit commerce:add_to_cart (merchant in ["shopify_store_123", "my_shop"]);
    }`);

    const allowed = evaluateCovenant(spec, {
      action: "commerce:add_to_cart",
      input: { merchant: "shopify_store_123" },
    });
    expect(allowed.allowed).toBe(true);

    const denied = evaluateCovenant(spec, {
      action: "commerce:add_to_cart",
      input: { merchant: "unknown_store" },
    });
    expect(denied.allowed).toBe(false);
  });

  it("require commerce:payment_authorize with payment_method condition", () => {
    const spec = parseCovenant(`covenant CommerceTest {
      permit commerce:payment_authorize (payment_method in ["google_pay", "stripe"]);
      forbid commerce:checkout (currency != "EUR") [hard];
    }`);

    const allowed = evaluateCovenant(spec, {
      action: "commerce:payment_authorize",
      input: { payment_method: "stripe" },
    });
    expect(allowed.allowed).toBe(true);

    const denied = evaluateCovenant(spec, {
      action: "commerce:checkout",
      input: { currency: "USD" },
    });
    expect(denied.allowed).toBe(false);
  });
});

describe("Commerce Ledger Integration", () => {
  let tmpDir: string;
  let ledger: EvidenceLedger;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-commerce-ledger-"));
    ledger = new EvidenceLedger({ dir: tmpDir, sessionId: "commerce-ledger-test" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("all commerce actions logged in evidence ledger", () => {
    const pipeline = createDefaultPipeline();
    const validator = new CommerceValidator(makePolicy(), pipeline, ledger, join(tmpDir, "commerce"));

    // Discover
    validator.validateAction("discover", {});

    // Add to cart
    validator.validateAction("add_to_cart", { item: makeItem(), cart: makeCart() });

    // Checkout
    validator.validateAction("checkout_start", { session: makeCheckoutSession({ total: 100 }) });

    // Payment
    validator.validateAction("payment_negotiate", { negotiation: makeNegotiation() });

    // Return
    validator.validateAction("return_initiate", { orderId: "order-001", reason: "Defective product" });

    // Fulfillment
    validator.validateAction("fulfillment_query", { orderId: "order-001" });

    const entries = ledger.entries();
    const commerceEntries = entries.filter(e => (e.type as string).startsWith("commerce:"));
    expect(commerceEntries.length).toBeGreaterThanOrEqual(6);

    const types = commerceEntries.map(e => e.type);
    expect(types).toContain("commerce:discover");
    expect(types).toContain("commerce:cart_update");
    expect(types).toContain("commerce:checkout");
    expect(types).toContain("commerce:payment");
    expect(types).toContain("commerce:return");
    expect(types).toContain("commerce:fulfillment");
  });
});

describe("CommerceValidator - validateAction routing", () => {
  let tmpDir: string;
  let validator: CommerceValidator;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aep-commerce-route-"));
    validator = new CommerceValidator(makePolicy(), null, null, join(tmpDir, "commerce"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discover passes with no payload", () => {
    const result = validator.validateAction("discover", {});
    expect(result.valid).toBe(true);
  });

  it("order_status passes", () => {
    const result = validator.validateAction("order_status", { orderId: "ord-1" });
    expect(result.valid).toBe(true);
  });

  it("fulfillment_query passes", () => {
    const result = validator.validateAction("fulfillment_query", { orderId: "ord-1" });
    expect(result.valid).toBe(true);
  });
});
