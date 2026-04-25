// AEP 2.5 -- Commerce Subprotocol Types
// Governs agentic commerce workflows: product discovery, cart management,
// checkout, payment negotiation, fulfillment tracking and post-purchase actions.

import { z } from "zod";

// --- Commerce Actions ---

export const CommerceActionSchema = z.enum([
  "discover",
  "add_to_cart",
  "remove_from_cart",
  "update_cart",
  "checkout_start",
  "checkout_complete",
  "payment_negotiate",
  "payment_authorize",
  "fulfillment_query",
  "order_status",
  "return_initiate",
  "refund_request",
]);

export type CommerceAction = z.infer<typeof CommerceActionSchema>;

// --- Cart Types ---

export const CartItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().nonnegative(),
  currency: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type CartItem = z.infer<typeof CartItemSchema>;

export const CartSchema = z.object({
  id: z.string(),
  items: z.array(CartItemSchema),
  total: z.number().nonnegative(),
  currency: z.string(),
  merchantId: z.string(),
});

export type Cart = z.infer<typeof CartSchema>;

// --- Address ---

export const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  region: z.string().optional(),
  postalCode: z.string(),
  country: z.string(),
});

export type Address = z.infer<typeof AddressSchema>;

// --- Checkout ---

export const CheckoutStatusSchema = z.enum([
  "pending",
  "authorized",
  "completed",
  "failed",
]);

export type CheckoutStatus = z.infer<typeof CheckoutStatusSchema>;

export const CheckoutSessionSchema = z.object({
  id: z.string(),
  cartId: z.string(),
  paymentMethod: z.string().optional(),
  paymentHandler: z.string().optional(),
  shippingAddress: AddressSchema.optional(),
  status: CheckoutStatusSchema,
});

export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

// --- Payment Negotiation ---

export const PaymentNegotiationSchema = z.object({
  availableHandlers: z.array(z.string()),
  selectedHandler: z.string().optional(),
  instrumentType: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string(),
});

export type PaymentNegotiation = z.infer<typeof PaymentNegotiationSchema>;

// --- Merchant Profile ---

export const MerchantProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
  paymentHandlers: z.array(z.string()),
  currency: z.string(),
});

export type MerchantProfile = z.infer<typeof MerchantProfileSchema>;

// --- Commerce Policy ---

export const CommercePolicySchema = z.object({
  enabled: z.boolean().optional().default(false),
  max_transaction_amount: z.number().nonnegative().optional(),
  allowed_currencies: z.array(z.string()).optional().default([]),
  allowed_merchants: z.array(z.string()).optional().default([]),
  blocked_merchants: z.array(z.string()).optional().default([]),
  blocked_product_categories: z.array(z.string()).optional().default([]),
  require_human_gate_above: z.number().nonnegative().optional(),
  allowed_payment_methods: z.array(z.string()).optional().default([]),
  max_daily_spend: z.number().nonnegative().optional(),
}).optional();

export type CommercePolicy = z.infer<typeof CommercePolicySchema>;

// --- Commerce Ledger Entry Types ---

export type CommerceLedgerEntryType =
  | "commerce:discover"
  | "commerce:cart_update"
  | "commerce:checkout"
  | "commerce:payment"
  | "commerce:fulfillment"
  | "commerce:return";

// --- Validation Result ---

export interface CommerceValidationResult {
  valid: boolean;
  errors: string[];
  gate_required?: boolean;
  ledgerType?: CommerceLedgerEntryType;
  ledgerData?: Record<string, unknown>;
}
