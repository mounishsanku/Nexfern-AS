/**
 * StripeAdapter.js — Payment gateway adapter for Stripe.
 *
 * SAFETY RULES (enforced):
 *  - This adapter MUST NOT create vouchers, payments, or mutate the ledger.
 *  - It only verifies, normalizes, and returns a trusted payload.
 *  - Accounting mutations happen downstream in paymentController.js.
 *
 * Status: SKELETON — full implementation in future phase when Stripe is onboarded.
 */
const crypto = require("crypto");

class StripeAdapter {
  static get providerName() {
    return "stripe";
  }

  /**
   * Verifies a Stripe webhook signature using the Stripe-Signature header.
   * Implements Stripe's timestamp-based verification scheme.
   */
  static verifyWebhookSignature(rawBody, stripeSignatureHeader, webhookSecret) {
    if (!rawBody || !stripeSignatureHeader || !webhookSecret) return false;
    try {
      const parts = stripeSignatureHeader.split(",").reduce((acc, part) => {
        const [k, v] = part.split("=");
        acc[k] = v;
        return acc;
      }, {});

      const timestamp = parts.t;
      const sigV1 = parts.v1;
      if (!timestamp || !sigV1) return false;

      const payload = `${timestamp}.${rawBody}`;
      const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(payload)
        .digest("hex");

      return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(sigV1, "hex")
      );
    } catch {
      return false;
    }
  }

  /**
   * Normalizes a Stripe webhook payload into a provider-agnostic event.
   * Returns a normalized event object — does NOT mutate the database.
   */
  static normalizeWebhookEvent(rawPayload) {
    const eventType = rawPayload?.type || "";
    const dataObject = rawPayload?.data?.object || {};

    return {
      provider: "stripe",
      eventType,
      amount: dataObject.amount ? dataObject.amount / 100 : null,
      currency: (dataObject.currency || "usd").toUpperCase(),
      status: dataObject.status || null,
      referenceId: dataObject.id || null,
      externalPaymentId: dataObject.payment_intent || dataObject.id || null,
      metadata: { raw: rawPayload },
    };
  }
}

module.exports = StripeAdapter;
