const mongoose = require("mongoose");
require("dotenv").config();
const { connectDb } = require("../src/config/db");

const Invoice = require("../src/models/Invoice");
const Voucher = require("../src/models/Voucher");
const VoucherEntry = require("../src/models/VoucherEntry");
const CompanySettings = require("../src/models/CompanySettings");
const Customer = require("../src/models/Customer");
const FinancialYear = require("../src/models/FinancialYear");
const { createInvoiceFromData } = require("../src/controllers/invoiceController");

async function runTest() {
  await connectDb();

  // Setup prerequisites
  let customer = await Customer.findOne();
  if (!customer) customer = await Customer.create({ name: "Test Cust", email: "test@example.com" });

  let fy = await FinancialYear.findOne({ isActive: true });
  if (!fy) {
    fy = await FinancialYear.create({
      yearLabel: "2026-2027",
      startDate: new Date("2026-04-01"),
      endDate: new Date("2027-03-31"),
      isActive: true
    });
  }

  const settings = await CompanySettings.findOne();
  if (!settings) throw new Error("CompanySettings missing");

  // 1. Test Feature Flag OFF
  settings.features.USE_NEW_LOCALIZATION_ENGINE = false;
  await settings.save();
  
  console.log("\n--- Testing Feature Flag OFF (Legacy Flow) ---");
  const invOld = await createInvoiceFromData({
    userId: new mongoose.Types.ObjectId().toString(),
    customerId: customer._id.toString(),
    amount: 1000,
    gstRate: 18,
    gstType: "CGST_SGST",
    revenueType: "project",
    financialYearId: fy._id,
  });

  console.log("Invoice Old:");
  console.log(`Amount: ${invOld.amount}, CGST: ${invOld.cgst}, SGST: ${invOld.sgst}, Total: ${invOld.totalAmount}`);
  
  const voucherOld = await Voucher.findOne({ referenceType: "invoice", referenceId: invOld._id });
  const entriesOld = await VoucherEntry.find({ voucherId: voucherOld._id });
  console.log(`Voucher Old Total Dr: ${entriesOld.reduce((sum, e) => sum + e.debit, 0)}`);

  // 2. Test Feature Flag ON
  settings.features.USE_NEW_LOCALIZATION_ENGINE = true;
  await settings.save();

  console.log("\n--- Testing Feature Flag ON (Localization Flow) ---");
  const invNew = await createInvoiceFromData({
    userId: new mongoose.Types.ObjectId().toString(),
    customerId: customer._id.toString(),
    amount: 1000,
    gstRate: 18,
    gstType: "CGST_SGST",
    revenueType: "project",
    financialYearId: fy._id,
  });

  console.log("Invoice New:");
  console.log(`Amount: ${invNew.amount}, CGST: ${invNew.cgst}, SGST: ${invNew.sgst}, Total: ${invNew.totalAmount}`);
  console.log("Tax Lines:", JSON.stringify(invNew.taxLines));
  console.log("Entity ID:", invNew.entityId);
  console.log("Currency:", invNew.currency);
  
  const voucherNew = await Voucher.findOne({ referenceType: "invoice", referenceId: invNew._id });
  const entriesNew = await VoucherEntry.find({ voucherId: voucherNew._id });
  console.log(`Voucher New Total Dr: ${entriesNew.reduce((sum, e) => sum + e.debit, 0)}`);
  console.log(`Voucher New Entity ID: ${voucherNew.entityId}`);
  console.log(`Voucher Entries New Currencies: ${entriesNew.map(e => e.currency).join(", ")}`);

  // Compare
  if (
    invOld.amount === invNew.amount &&
    invOld.cgst === invNew.cgst &&
    invOld.sgst === invNew.sgst &&
    invOld.totalAmount === invNew.totalAmount &&
    entriesOld.reduce((sum, e) => sum + e.debit, 0) === entriesNew.reduce((sum, e) => sum + e.debit, 0)
  ) {
    console.log("\n✅ SUCCESS: Both execution paths produce identical financial totals and voucher sums.");
  } else {
    console.error("\n❌ FAILED: Totals do not match.");
  }

  process.exit(0);
}

runTest().catch(e => { console.error(e); process.exit(1); });
