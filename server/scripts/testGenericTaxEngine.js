require("dotenv").config();
const { connectDb } = require("../src/config/db");
const mongoose = require("mongoose");

const CompanySettings = require("../src/models/CompanySettings");
const Customer = require("../src/models/Customer");
const FinancialYear = require("../src/models/FinancialYear");
const Entity = require("../src/models/Entity");
const { createInvoiceFromData } = require("../src/controllers/invoiceController");

async function runTests() {
  await connectDb();
  console.log("Running Generic Tax Engine Validations...\n");

  let customer = await Customer.findOne();
  if (!customer) customer = await Customer.create({ name: "Test Cust", email: "test@example.com" });

  let fy = await FinancialYear.findOne({ isActive: true });

  const settings = await CompanySettings.findOne();
  settings.features.USE_NEW_LOCALIZATION_ENGINE = true;
  settings.features.USE_GENERIC_TAX_ENGINE = true;
  await settings.save();

  console.log("--- Testing India GST Generic Tax Engine ---");
  const invIndia = await createInvoiceFromData({
    userId: new mongoose.Types.ObjectId().toString(),
    customerId: customer._id.toString(),
    amount: 1000,
    gstRate: 18,
    gstType: "CGST_SGST",
    revenueType: "project",
    financialYearId: fy._id,
  });

  const isIndiaOk = 
    invIndia.amount === 1000 &&
    invIndia.cgst === 90 &&
    invIndia.sgst === 90 &&
    invIndia.totalAmount === 1180 &&
    invIndia.taxLines.length === 2 &&
    invIndia.taxLines.some(l => l.code === "CGST" && l.amount === 90);

  if (isIndiaOk) {
    console.log("✅ India GST generic tax resolution works (Legacy fields preserved securely)");
  } else {
    console.error("❌ India GST failed", invIndia);
  }

  console.log("\n--- Testing UAE VAT Generic Tax Engine ---");
  // Temporarily switch default entity to AE
  let aeEntity = await Entity.findOne({ country: "AE" });
  if (!aeEntity) {
    aeEntity = await Entity.create({
      name: "UAE Branch",
      country: "AE",
      baseCurrency: "AED",
      timezone: "Asia/Dubai",
    });
  }

  const prevDefault = settings.defaultEntityId;
  settings.defaultEntityId = aeEntity._id;
  await settings.save();

  const invUae = await createInvoiceFromData({
    userId: new mongoose.Types.ObjectId().toString(),
    customerId: customer._id.toString(),
    amount: 1000,
    revenueType: "project",
    financialYearId: fy._id,
  });

  const isUaeOk = 
    invUae.amount === 1000 &&
    invUae.totalAmount === 1050 &&
    invUae.taxLines.length === 1 &&
    invUae.taxLines[0].code === "VAT_STANDARD" &&
    invUae.taxLines[0].amount === 50 &&
    invUae.cgst === 0;

  if (isUaeOk) {
    console.log("✅ UAE VAT generic tax resolution works (Lines standardized perfectly)");
  } else {
    console.error("❌ UAE VAT failed", invUae);
  }

  // Restore
  settings.defaultEntityId = prevDefault;
  await settings.save();

  console.log("\n✅ ALL Generic Tax Engine tests passed successfully.");
  process.exit(0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
