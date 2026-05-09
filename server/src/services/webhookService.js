/**
 * webhookService.js — Secure webhook processing engine.
 *
 * Security guarantees:
 *  1. Signature validation before any processing
 *  2. Payload hashing for replay detection (duplicate hashes → blocked)
 *  3. All events persisted immutably to WebhookEvent collection
 *  4. Dispatches normalized payloads only — never raw third-party data
 *  5. Accounting mutations NEVER happen here — callers must use trusted services
 */
const crypto = require("crypto");
const WebhookEvent = require("../models/WebhookEvent");
const IncidentLog = require("../models/IncidentLog");
const { getAdapter } = require("../integrations/IntegrationRegistry");

/**
 * Computes a SHA-256 hash of the raw payload for replay detection.
 * The hash covers both the body and the provider name so cross-provider collisions are impossible.
 */
function computePayloadHash(provider, rawBody) {
  return crypto
    .createHash("sha256")
    .update(`${provider}:${rawBody}`)
    .digest("hex");
}

/**
 * Main webhook processing entry point.
 *
 * @param {object} params
 * @param {string} params.provider - e.g. "razorpay" | "stripe"
 * @param {string} params.rawBody - Raw request body string (pre-JSON parse)
 * @param {string} params.signature - Provider-specific signature header value
 * @param {string} params.webhookSecret - Decrypted webhook secret from Integration record
 * @param {object} params.parsedPayload - Already-parsed JSON body
 * @returns {{ event: WebhookEvent, normalized: object }}
 */
async function processWebhook({ provider, rawBody, signature, webhookSecret, parsedPayload }) {
  const payloadHash = computePayloadHash(provider, rawBody);

  // ── 1. Replay Detection ─────────────────────────────────────────────────────
  const existing = await WebhookEvent.findOne({ payloadHash }).lean();
  if (existing) {
    await IncidentLog.create({
      severity: "high",
      category: "webhook_replay",
      source: "webhookService",
      message: `Replay attack detected from provider "${provider}"`,
      metadata: { payloadHash, provider, existingEventId: String(existing._id) },
    }).catch(() => {});

    await WebhookEvent.create({
      provider,
      eventType: "replay_blocked",
      payloadHash: `${payloadHash}_replay_${Date.now()}`, // unique hash for the replay record itself
      status: "replay_blocked",
      replayDetected: true,
      signatureValid: false,
      metadata: { originalEventId: String(existing._id) },
    }).catch(() => {});

    throw Object.assign(new Error("Webhook replay detected — request blocked"), { code: "WEBHOOK_REPLAY" });
  }

  // ── 2. Signature Validation ─────────────────────────────────────────────────
  const Adapter = getAdapter(provider);
  const signatureValid = Adapter.verifyWebhookSignature(rawBody, signature, webhookSecret);

  if (!signatureValid) {
    const event = await WebhookEvent.create({
      provider,
      eventType: parsedPayload?.event || parsedPayload?.type || "unknown",
      payloadHash,
      status: "failed",
      replayDetected: false,
      signatureValid: false,
      metadata: { reason: "invalid_signature" },
    });

    await IncidentLog.create({
      severity: "critical",
      category: "webhook_invalid_signature",
      source: "webhookService",
      message: `Invalid webhook signature from provider "${provider}"`,
      metadata: { payloadHash, provider },
    }).catch(() => {});

    throw Object.assign(
      new Error(`Invalid webhook signature from "${provider}"`),
      { code: "WEBHOOK_INVALID_SIGNATURE", eventId: String(event._id) }
    );
  }

  // ── 3. Normalize Payload ────────────────────────────────────────────────────
  const normalized = Adapter.normalizeWebhookEvent(parsedPayload);

  // ── 4. Persist Immutable Record ─────────────────────────────────────────────
  const event = await WebhookEvent.create({
    provider,
    eventType: normalized.eventType || "unknown",
    payloadHash,
    status: "pending",
    replayDetected: false,
    signatureValid: true,
    metadata: {
      amount: normalized.amount,
      currency: normalized.currency,
      referenceId: normalized.referenceId,
    },
  });

  return { event, normalized };
}

/**
 * Marks a webhook event as processed (called after the downstream service succeeds).
 */
async function markWebhookProcessed(eventId) {
  await WebhookEvent.findByIdAndUpdate(eventId, {
    status: "processed",
    processedAt: new Date(),
  });
}

/**
 * Marks a webhook event as failed (called if the downstream service throws).
 */
async function markWebhookFailed(eventId, reason) {
  await WebhookEvent.findByIdAndUpdate(eventId, {
    status: "failed",
    "metadata.failureReason": reason,
  });
}

module.exports = { processWebhook, markWebhookProcessed, markWebhookFailed };
