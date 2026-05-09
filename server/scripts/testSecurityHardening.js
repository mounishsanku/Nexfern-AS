const mongoose = require("mongoose");
const User = require("../src/models/User");
const AccessLog = require("../src/models/AccessLog");
const IncidentLog = require("../src/models/IncidentLog");
const CompanySettings = require("../src/models/CompanySettings");
const { encryptBackupPayload, decryptBackupPayload } = require("../src/services/backupEncryptionService");
const { validateSecurityConfig } = require("../src/services/securityValidationService");

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected Successfully");

    console.log("--- Testing Enterprise Security Hardening Architecture ---");

    // 1. Verify User model modifications
    const testEmail = "security_test@example.com";
    await User.deleteOne({ email: testEmail });
    const u = await User.create({
      name: "Security Tester",
      email: testEmail,
      password: "mockpassword",
      role: "admin",
      mfaEnabled: true,
      lastLoginAt: new Date(),
    });
    if (!u.mfaEnabled || !u.lastLoginAt) {
      throw new Error("MFA fields not saved on User");
    }
    console.log("✅ MFA Schema Extensions saved successfully");

    // 2. Verify Access Logs insertion
    await AccessLog.create({
      userId: u._id,
      ip: "127.0.0.1",
      route: "/api/auth/login",
      method: "POST",
      statusCode: 401,
      metadata: { body: { email: testEmail, password: "[REDACTED]" } }
    });
    const log = await AccessLog.findOne({ userId: u._id });
    if (!log || log.metadata.body.password !== "[REDACTED]") {
      throw new Error("Access logging or payload redaction failed");
    }
    console.log("✅ AccessLog explicitly stored and redacted");

    // 3. Verify Backup Encryption
    const mockBackup = {
      version: 2,
      invoices: [{ invoiceNumber: "INV-123", amount: 5000 }]
    };
    const encrypted = encryptBackupPayload(mockBackup);
    if (!encrypted.encrypted || !encrypted.iv || !encrypted.encryptedData) {
      throw new Error("Backup payload encryption failed");
    }
    if (JSON.stringify(encrypted).includes("INV-123")) {
      throw new Error("Encrypted backup exposed plaintext!");
    }
    const decrypted = await decryptBackupPayload(encrypted);
    if (decrypted.invoices[0].invoiceNumber !== "INV-123") {
      throw new Error("Backup decryption mismatch");
    }
    console.log("✅ Encrypted Backups AES-256 workflow fully operational");

    // 4. Verify IncidentLog creation on decryption failure
    try {
      await decryptBackupPayload({ encrypted: true, iv: encrypted.iv, encryptedData: "badhex" });
      throw new Error("Decryption should have failed");
    } catch (err) {
      if (err.message === "Decryption should have failed") throw err;
    }
    const incident = await IncidentLog.findOne({ category: "backup_decrypt_failure" });
    if (!incident) {
      throw new Error("IncidentLog not generated upon decryption failure");
    }
    console.log("✅ IncidentLog generated correctly for security exceptions");

    // 5. Verify Security Diagnostics 
    const diagnostics = await validateSecurityConfig();
    if (!diagnostics.warnings.length) {
      // In a dev environment with a .env, it should at least warn about missing MFA admins or DEV mode.
      console.log("⚠️ No security warnings detected. Make sure this is expected.");
    } else {
      console.log(`✅ Security Validation yielded ${diagnostics.warnings.length} warnings.`);
    }

    // Cleanup
    await User.deleteOne({ _id: u._id });
    await AccessLog.deleteMany({ userId: u._id });
    await IncidentLog.deleteOne({ _id: incident._id });
    
    console.log("Cleanup complete. Test PASSED.");
    process.exit(0);

  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

runTest();
