const mongoose = require("mongoose");
const xlsx = require("xlsx");
const { connectDb } = require("../src/config/db");
const { stageImport, executeImport } = require("../src/services/importEngine");
const Entity = require("../src/models/Entity");
const FinancialYear = require("../src/models/FinancialYear");
const User = require("../src/models/User");
const Expense = require("../src/models/Expense");
const Invoice = require("../src/models/Invoice");
const Voucher = require("../src/models/Voucher");
const AuditLog = require("../src/models/AuditLog");

async function runTest() {
  await connectDb();

  console.log("--- Testing Import Engine Architecture ---");

  // Get active FY and Entity
  const fy = await FinancialYear.findOne({ status: "active" });
  if (!fy) throw new Error("No active financial year found");
  
  const entity = await Entity.findOne();
  if (!entity) throw new Error("No entity found");

  const admin = await User.findOne({ role: "admin" });
  if (!admin) throw new Error("No admin user found");



  const Customer = require("../src/models/Customer");
  let cust = await Customer.findOne();
  if (!cust) {
    [cust] = await Customer.create([{ name: "Test Customer", email: "test@example.com" }]);
  }

  // Create a mock Excel Buffer
  const rows = [
    {
      customerId: String(cust._id),
      amount: 1500,
      gstRate: 18,
      gstType: "CGST_SGST",
      currency: "INR"
    },
    {
      customerId: String(cust._id),
      amount: null,
      gstRate: 18,
      gstType: "CGST_SGST",
    }
  ];

  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

  console.log("1. Simulating upload & staging...");
  let job = await stageImport({
    buffer,
    fileName: "test_expenses.xlsx",
    entityId: entity._id,
    type: "invoice",
    source: "excel",
    userId: admin._id
  });

  console.log(`   Job Status after staging: ${job.status}`);
  console.log(`   Valid Rows: ${job.summary.validRows}, Error Rows: ${job.summary.errorRows}`);
  if (job.summary.errorRows === 0) {
      throw new Error("Validation failed to catch invalid row");
  }

  // Force job to ready for testing partial execution (usually the UI might let you confirm "Skip errors and import")
  // Or we just test execution on valid rows. Our execute loop executes all previewData.
  // Actually, our loop executes ALL rows, but fails those that throw.
  job.status = "ready";
  await job.save();

  console.log("2. Simulating execution...");
  job = await executeImport(job._id, fy._id);
  
  console.log(`   Job Status after execution: ${job.status}`);
  console.log(`   Imported Rows: ${job.summary.importedRows}`);

  if (job.summary.importedRows !== 1) {
    throw new Error("Expected exactly 1 row to successfully import");
  }

  console.log("3. Verifying accounting integrity constraints...");
  const importedInvoice = await Invoice.findOne({ amount: 1500, customer: cust._id }).sort({ createdAt: -1 });
  if (!importedInvoice) throw new Error("Invoice not found in DB");
  
  const voucher = await Voucher.findOne({ referenceId: importedInvoice._id, referenceType: "invoice" });
  if (!voucher) throw new Error("Voucher not generated for imported invoice!");

  const audit = await AuditLog.findOne({ resourceId: importedInvoice._id, action: "CREATE" });
  if (!audit) throw new Error("Audit log missing for imported invoice!");

  console.log("✅ Import engine correctly integrates with Controllers");
  console.log("✅ Voucher engine securely bridged");
  console.log("✅ Auditing perfectly preserved");
  
  // Cleanup
  await Invoice.deleteOne({ _id: importedInvoice._id });
  await Voucher.deleteOne({ _id: voucher._id });
  // Cannot delete AuditLog as it's immutable, which is a feature.

  console.log("Cleanup complete. Test PASSED.");
  process.exit(0);
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
