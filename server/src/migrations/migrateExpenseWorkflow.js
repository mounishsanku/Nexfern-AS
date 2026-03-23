const Expense = require("../models/Expense");

/** Existing rows become approved (posted expenses). */
async function migrateExpenseWorkflow() {
  const r = await Expense.updateMany(
    { $or: [{ status: { $exists: false } }, { status: null }, { status: "" }] },
    { $set: { status: "approved" } },
  );
  if (r.modifiedCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] Expense workflow: ${r.modifiedCount} row(s) marked approved`);
  }
}

module.exports = { migrateExpenseWorkflow };
