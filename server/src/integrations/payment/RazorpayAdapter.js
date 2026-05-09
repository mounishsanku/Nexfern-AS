/**
 * RazorpayAdapter.js — Payment gateway adapter for Razorpay.
 *
 * SAFETY RULES (enforced):
 *  - This adapter MUST NOT create vouchers, payments, or mutate the ledger.
 *  - It only verifies, normalizes, and returns a trusted payload.
 *  - Accounting mutations happen downstream in paymentController.js.
 */
const crypto = require("crypto");

class RazorpayAdapter {
  static get providerName() {
    return "razorpay";
  }

  /**
   * Verifies Razorpay webhook signature.
   * @param {string} rawBody - Raw request body string
   * @param {string} signature - X-Razorpay-Signature header
   * @param {string} webhookSecret - Decrypted webhook secret from Integration
   */
  static verifyWebhookSignature(rawBody, signature, webhookSecret) {
    if (!rawBody || !signature || !webhookSecret) return false;
    try {
      const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      const eBuf = Buffer.from(expected, "hex");
      const sBuf = Buffer.from(signature, "hex");
      if (eBuf.length !== sBuf.length) return false;
      return crypto.timingSafeEqual(eBuf, sBuf);
    } catch {
      return false;
    }
  }

  /**
   * Verifies a Razorpay order payment (non-webhook path).
   * @param {object} params - { orderId, paymentId, signature }
   * @param {string} keySecret - Decrypted Razorpay key_secret
   * @returns {{ valid: boolean }}
   */
  static verifyPaymentSignature({ orderId, paymentId, signature }, keySecret) {
    if (!orderId || !paymentId || !signature || !keySecret) {
      return { valid: false, reason: "Missing required parameters" };
    }
    try {
      const body = `${orderId}|${paymentId}`;
      const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
      const eBuf = Buffer.from(expected, "hex");
      const sBuf = Buffer.from(signature, "hex");
      if (eBuf.length !== sBuf.length) return { valid: false, reason: "Signature length mismatch" };
      return { valid: crypto.timingSafeEqual(eBuf, sBuf) };
    } catch {
      return { valid: false, reason: "Signature verification error" };
    }
  }

  /**
   * Normalizes a Razorpay webhook payload into a provider-agnostic event.
   * Returns a normalized event object — does NOT mutate the database.
   */
  static normalizeWebhookEvent(rawPayload) {
    const event = rawPayload?.event || "";
    const entity = rawPayload?.payload?.payment?.entity || rawPayload?.payload?.order?.entity || {};

    return {
      provider: "razorpay",
      eventType: event,
      amount: entity.amount ? entity.amount / 100 : null, // Razorpay sends paise
      currency: entity.currency || "INR",
      status: entity.status || null,
      referenceId: entity.order_id || entity.id || null,
      externalPaymentId: entity.id || null,
      metadata: { raw: rawPayload },
    };
  }
}

module.exports = RazorpayAdapter;
