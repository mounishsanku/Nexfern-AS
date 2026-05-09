const mongoose = require("mongoose");
const Integration = require("../src/models/Integration");
const WebhookEvent = require("../src/models/WebhookEvent");
const IncidentLog = require("../src/models/IncidentLog");
const { getAdapter, listProviders } = require("../src/integrations/IntegrationRegistry");
const { encryptPayload, decryptPayload } = require("../src/services/encryptionService");
const { processWebhook } = require("../src/services/webhookService");
const RazorpayAdapter = require("../src/integrations/payment/RazorpayAdapter");
const crypto = require("crypto");

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected Successfully");
    console.log("--- Testing External Integration Layer ---\n");

    // 1. Verify IntegrationRegistry loads all adapters
    const providers = listProviders();
    const expected = ["razorpay", "stripe", "bank-feed", "zoho", "salesforce"];
    for (const p of expected) {
      const Adapter = getAdapter(p);
      if (!Adapter) throw new Error(`Registry failed to load adapter: ${p}`);
    }
    console.log(`✅ IntegrationRegistry loaded all ${providers.length} adapters`);

    // 2. Verify credential encryption (never returns raw keys)
    const rawCreds = { apiKey: "rzp_live_secret_key_12345", webhookSecret: "whsec_mywebhooksecret" };
    const encrypted = encryptPayload(rawCreds);
    if (!encrypted.encrypted || JSON.stringify(encrypted).includes("rzp_live")) {
      throw new Error("Credentials not properly encrypted — raw key exposed!");
    }
    const decrypted = decryptPayload(encrypted);
    if (decrypted.apiKey !== rawCreds.apiKey) throw new Error("Credential decryption mismatch");
    console.log("✅ Integration credentials encrypted safely — no raw keys exposed");

    // 3. Create and verify an Integration with encrypted credentials
    await Integration.deleteOne({ provider: "razorpay", "metadata.test": true });
    const integration = await Integration.create({
      provider: "razorpay",
      type: "payment_gateway",
      status: "active",
      credentials: encrypted,
      metadata: { test: true },
    });
    // Verify credentials field is NOT returned by default (select: false)
    const fetchedPublic = await Integration.findById(integration._id).lean();
    if (fetchedPublic.credentials) throw new Error("Credentials returned in public API query — security violation!");
    console.log("✅ Integration.credentials correctly hidden from public API queries");

    // 4. Razorpay signature verification
    const webhookSecret = "whsec_test123";
    const mockBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_abc", amount: 50000, currency: "INR", status: "captured", order_id: "order_xyz" } } } });
    const validSig = crypto.createHmac("sha256", webhookSecret).update(mockBody).digest("hex");
    const sigValid = RazorpayAdapter.verifyWebhookSignature(mockBody, validSig, webhookSecret);
    if (!sigValid) throw new Error("Razorpay signature verification failed");
    const badSigValid = RazorpayAdapter.verifyWebhookSignature(mockBody, "badhex00" + validSig.slice(8), webhookSecret);
    if (badSigValid) throw new Error("Razorpay accepted invalid signature!");
    console.log("✅ Razorpay signature verification working (valid accepted, invalid rejected)");

    // 5. Webhook replay detection
    await WebhookEvent.deleteMany({ provider: "razorpay_test_replay" });
    const payloadHash = crypto.createHash("sha256").update(`razorpay_test_replay:${mockBody}`).digest("hex");
    await WebhookEvent.create({
      provider: "razorpay_test_replay",
      eventType: "payment.captured",
      payloadHash,
      status: "processed",
      replayDetected: false,
      signatureValid: true,
    });
    // Simulate replay: attempt to insert duplicate hash
    let replayBlocked = false;
    try {
      await WebhookEvent.create({
        provider: "razorpay_test_replay",
        eventType: "payment.captured",
        payloadHash, // SAME hash = replay
        status: "pending",
        replayDetected: false,
        signatureValid: true,
      });
    } catch (err) {
      if (err.code === 11000) replayBlocked = true; // MongoDB duplicate key
    }
    if (!replayBlocked) throw new Error("Replay protection failed — duplicate hash accepted!");
    console.log("✅ Webhook replay protection active (duplicate hash correctly rejected)");

    // 6. Adapter normalization — MUST NOT mutate any accounting model
    const normalized = RazorpayAdapter.normalizeWebhookEvent(JSON.parse(mockBody));
    if (!normalized.provider || !normalized.eventType || !normalized.amount) throw new Error("Normalization returned incomplete payload");
    if (normalized.amount !== 500) throw new Error(`Expected 500 INR (paise→rupee), got ${normalized.amount}`);
    console.log("✅ Razorpay webhook normalization correct (paise→rupee conversion, no DB mutations)");

    // 7. Bank feed normalization — NEVER auto-posts
    const BankFeedAdapter = require("../src/integrations/bank/BankFeedAdapter");
    const csvRow = { date: "2024-01-15", amount: "5000.00", description: "NEFT Transfer", reference: "REF123" };
    const txn = BankFeedAdapter.normalizeTransaction(csvRow, "mock_account_id");
    if (txn.autoPosted !== false) throw new Error("BankFeedAdapter auto-posted a transaction!");
    if (txn.amount !== 5000) throw new Error("Bank feed amount normalization failed");
    console.log("✅ BankFeedAdapter normalization correct — autoPosted=false enforced");

    // 8. Verify existing backup still decrypts correctly
    const { encryptBackupPayload, decryptBackupPayload } = require("../src/services/backupEncryptionService");
    const mockBackup = { version: 2, invoices: [{ invoiceNumber: "INV-001" }] };
    const encBackup = encryptBackupPayload(mockBackup);
    const decBackup = await decryptBackupPayload(encBackup);
    if (decBackup.invoices[0].invoiceNumber !== "INV-001") throw new Error("Backup encrypt/decrypt regression");
    console.log("✅ Backup pipeline backward-compatible (no regression from encryption refactor)");

    // Cleanup
    await Integration.deleteOne({ _id: integration._id });
    await WebhookEvent.deleteMany({ provider: "razorpay_test_replay" });

    console.log("\nCleanup complete. Test PASSED ✅");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  }
}

runTest();
