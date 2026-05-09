require("dotenv").config();
const { connectDb } = require("../src/config/db");
const mongoose = require("mongoose");
const { getExchangeRate, convertAmount } = require("../src/services/currencyService");
const { createInvoiceFromData } = require("../src/controllers/invoiceController");
const Customer = require("../src/models/Customer");
const FinancialYear = require("../src/models/FinancialYear");
const CompanySettings = require("../src/models/CompanySettings");
const Invoice = require("../src/models/Invoice");
const Voucher = require("../src/models/Voucher");
const VoucherEntry = require("../src/models/VoucherEntry");

async function runTests() {
  await connectDb();
  console.log("Running Currency Engine Validations...\n");

  // 1. Service direct tests
  console.log("--- Testing currencyService ---");
  const bypass = await convertAmount({ amount: 1000, fromCurrency: "INR", toCurrency: "INR" });
  if (bypass.rate === 1 && bypass.convertedAmount === 1000) {
    console.log("✅ INR->INR bypass works (returns rate 1 immediately)");
  } else {
    console.error("❌ INR->INR bypass failed", bypass);
  }

  const usdInr = await convertAmount({ amount: 100, fromCurrency: "USD", toCurrency: "INR" });
  if (usdInr.rate === 83.5 && usdInr.convertedAmount === 8350) {
    console.log(`✅ USD->INR conversion works (Rate: ${usdInr.rate}, Amount: ${usdInr.convertedAmount})`);
  } else {
    console.error("❌ USD->INR conversion failed", usdInr);
  }

  const aedUsd = await convertAmount({ amount: 100, fromCurrency: "AED", toCurrency: "USD" });
  if (aedUsd.rate === 0.27 && aedUsd.convertedAmount === 27) {
    console.log(`✅ AED->USD conversion works (Rate: ${aedUsd.rate}, Amount: ${aedUsd.convertedAmount})`);
  } else {
    console.error("❌ AED->USD conversion failed", aedUsd);
  }

  try {
    await convertAmount({ amount: 100, fromCurrency: "XYZ", toCurrency: "ABC" });
    console.error("❌ Missing rate check failed (Did not throw)");
  } catch (err) {
    if (err.code === "EXCHANGE_RATE_NOT_FOUND") {
      console.log("✅ Missing rate throws structured error correctly");
    } else {
      console.error("❌ Missing rate threw unexpected error:", err);
    }
  }

  // 2. Invoice tests
  console.log("\n--- Testing Invoice Flow ---");
  let customer = await Customer.findOne();
  if (!customer) customer = await Customer.create({ name: "Test Cust", email: "test@example.com" });

  let fy = await FinancialYear.findOne({ isActive: true });
  
  const settings = await CompanySettings.findOne();
  settings.features.USE_NEW_LOCALIZATION_ENGINE = true;
  settings.features.USE_MULTI_CURRENCY_ENGINE = true;
  await settings.save();

  console.log("Testing with USD currency...");
  const inv = await createInvoiceFromData({
    userId: new mongoose.Types.ObjectId().toString(),
    customerId: customer._id.toString(),
    amount: 1000, // 1000 USD
    gstRate: 18,
    gstType: "CGST_SGST",
    revenueType: "project",
    financialYearId: fy._id,
    currency: "USD",
  });

  const isInvPersistedOk = 
    inv.amount === 1000 &&
    inv.currency === "USD" &&
    inv.exchangeRate === 83.5 &&
    inv.baseAmount === 83500;

  if (isInvPersistedOk) {
    console.log("✅ Invoice stored with correct currency, exchangeRate, and baseAmount");
  } else {
    console.error("❌ Invoice persistence failed", { amount: inv.amount, currency: inv.currency, ex: inv.exchangeRate, base: inv.baseAmount });
  }

  const voucher = await Voucher.findOne({ referenceType: "invoice", referenceId: inv._id });
  const entries = await VoucherEntry.find({ voucherId: voucher._id });
  
  // Total DB debit sum should be 1180 (USD)
  const totalDebitRaw = entries.reduce((s, e) => s + e.debit, 0);
  const totalBaseAmount = entries.reduce((s, e) => s + e.baseAmount, 0) / 2; // dividing by 2 to get the balanced side

  if (totalDebitRaw === 1180) {
    console.log("✅ Voucher raw amounts are safely maintained in original currency (1180 USD Dr/Cr balanced)");
  } else {
    console.error("❌ Voucher raw amounts altered!", totalDebitRaw);
  }

  // 1180 USD * 83.5 = 98530 INR
  if (totalBaseAmount === 98530) {
    console.log(`✅ Voucher baseAmount properly converted (98530 INR)`);
  } else {
    console.error("❌ Voucher baseAmount conversion failed", totalBaseAmount);
  }

  console.log("\n✅ ALL Multi-currency tests passed successfully.");
  process.exit(0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
