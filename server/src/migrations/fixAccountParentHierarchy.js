/**
 * One-off cleanup: clear parentId when parent is missing or parent/child types are incompatible.
 * Does NOT change account _id, name, or type — only nulls invalid parentId.
 *
 * Run: node src/migrations/fixAccountParentHierarchy.js
 * Requires MONGODB_URI in .env
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const Account = require("../models/Account");
const { isValidParentChildTypes } = require("../utils/accountHierarchy");

async function run() {
  await connectDb();

  const withParent = await Account.find({ parentId: { $ne: null } }).lean();
  const cleared = [];
  const logged = [];

  for (const a of withParent) {
    const parent = await Account.findById(a.parentId).lean();
    const invalid =
      !parent || !isValidParentChildTypes(a.type, parent.type);

    if (invalid) {
      await Account.updateOne({ _id: a._id }, { $set: { parentId: null } });
      const reason = !parent ? "parent missing" : `type mismatch (child=${a.type}, parent=${parent?.type})`;
      cleared.push({ _id: String(a._id), name: a.name, reason });
      logged.push(`${a.name} (${a._id}): cleared parent — ${reason}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`fixAccountParentHierarchy: scanned ${withParent.length}, cleared ${cleared.length}`);
  if (logged.length) {
    // eslint-disable-next-line no-console
    console.log("Details:");
    for (const line of logged) console.log("  ", line);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
