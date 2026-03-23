const mongoose = require("mongoose");
const Account = require("../models/Account");
const {
  assertValidParentAccount,
  wouldCreateParentCycle,
} = require("../utils/accountHierarchy");

// ---------------------------------------------------------------------------
// Default accounts to seed on first startup
// ---------------------------------------------------------------------------

const DEFAULT_ACCOUNTS = [
  { name: "Cash",                       type: "asset"     },
  { name: "Bank",                       type: "asset"     },
  { name: "Accounts Receivable",        type: "asset"     },
  { name: "GST Payable",                type: "liability" },
  { name: "TDS Payable",                type: "liability" },
  { name: "Payroll Deductions Payable", type: "liability" },
  { name: "Suspense (Adjustment Account)", type: "liability" },
  { name: "Deferred Revenue",           type: "liability" },
  { name: "Sales",                type: "revenue"   },
  { name: "Revenue",              type: "revenue"   },
  { name: "General Expense",      type: "expense"   },
  { name: "Rent Expense",         type: "expense"   },
  { name: "Marketing Expense",    type: "expense"   },
  { name: "Expense",              type: "expense"   },
  { name: "Salary Expense",       type: "expense"   },
  { name: "Retained Earnings",    type: "equity"    },
  { name: "Owner's Capital",      type: "equity"    },
];

async function seedDefaultAccounts() {
  for (const acct of DEFAULT_ACCOUNTS) {
    await Account.updateOne(
      { name: acct.name },
      { $setOnInsert: acct },
      { upsert: true }
    );
  }
  await Account.updateOne(
    { name: "Payroll Deductions Payable" },
    { $set: { type: "liability" } }
  );
  console.log("Chart of Accounts: default accounts seeded.");
}

// ---------------------------------------------------------------------------
// GET /api/accounts
// ---------------------------------------------------------------------------

async function listAccounts(_req, res) {
  try {
    const accounts = await Account.find({ isActive: true })
      .sort({ type: 1, name: 1 })
      .lean();
    return res.json(accounts);
  } catch (err) {
    console.error("listAccounts error:", err);
    return sendStructuredError(res, {
      code: "DB_OPERATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/accounts/:id
// ---------------------------------------------------------------------------

async function getAccount(req, res) {
  try {
    const account = await Account.findById(req.params.id).lean();
    if (!account) return res.status(404).json({ message: "Account not found" });
    return res.json(account);
  } catch (err) {
    console.error("getAccount error:", err);
    return sendStructuredError(res, {
      code: "DB_OPERATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/accounts
// ---------------------------------------------------------------------------

async function createAccount(req, res) {
  try {
    const { name, type, parentId } = req.body ?? {};
    if (!name || !type) {
      return res.status(400).json({ message: "name and type are required", code: "ACCOUNT_FIELDS_REQUIRED" });
    }
    const normalizedType = String(type).toLowerCase();
    const allowed = ["asset", "liability", "equity", "revenue", "expense"];
    if (!allowed.includes(normalizedType)) {
      return res.status(400).json({ message: "invalid account type", code: "INVALID_ACCOUNT_TYPE" });
    }

    let resolvedParentId = null;
    if (parentId !== undefined && parentId !== null && parentId !== "") {
      if (!mongoose.Types.ObjectId.isValid(String(parentId))) {
        return res.status(400).json({ message: "invalid parentId", code: "INVALID_PARENT_ID" });
      }
      resolvedParentId = parentId;
    }

    const parentCheck = await assertValidParentAccount(Account, {
      type: normalizedType,
      parentId: resolvedParentId,
      excludeAccountId: null,
    });
    if (!parentCheck.ok) {
      return res.status(400).json({ message: parentCheck.message, code: parentCheck.code });
    }

    const account = await Account.create({
      name: String(name).trim(),
      type: normalizedType,
      parentId: resolvedParentId,
    });
    return res.status(201).json(account);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with that name already exists", code: "DUPLICATE_ACCOUNT_NAME" });
    }
    console.error("createAccount error:", err);
    return sendStructuredError(res, {
      code: "ACCOUNT_CREATE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/accounts/:id
// ---------------------------------------------------------------------------

async function updateAccount(req, res) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid account id", code: "INVALID_ACCOUNT_ID" });
    }

    const existing = await Account.findById(id).lean();
    if (!existing) return res.status(404).json({ message: "Account not found", code: "ACCOUNT_NOT_FOUND" });

    const { name, type, parentId, isActive } = req.body ?? {};
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (type !== undefined) {
      const normalizedType = String(type).toLowerCase();
      const allowed = ["asset", "liability", "equity", "revenue", "expense"];
      if (!allowed.includes(normalizedType)) {
        return res.status(400).json({ message: "invalid account type", code: "INVALID_ACCOUNT_TYPE" });
      }
      update.type = normalizedType;
    }
    if (parentId !== undefined) {
      update.parentId = parentId && String(parentId).trim() !== "" ? parentId : null;
    }
    if (isActive !== undefined) update.isActive = Boolean(isActive);

    const nextType = update.type !== undefined ? update.type : existing.type;
    const nextParentId = update.parentId !== undefined ? update.parentId : existing.parentId;

    if (nextParentId) {
      if (!mongoose.Types.ObjectId.isValid(String(nextParentId))) {
        return res.status(400).json({ message: "invalid parentId", code: "INVALID_PARENT_ID" });
      }
      const parentCheck = await assertValidParentAccount(Account, {
        type: nextType,
        parentId: nextParentId,
        excludeAccountId: id,
      });
      if (!parentCheck.ok) {
        return res.status(400).json({ message: parentCheck.message, code: parentCheck.code });
      }
      const cycle = await wouldCreateParentCycle(Account, id, nextParentId);
      if (cycle) {
        return res.status(400).json({
          message: "Invalid parent: would create a circular hierarchy",
          code: "INVALID_ACCOUNT_HIERARCHY",
        });
      }
    }

    const account = await Account.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true }
    ).lean();

    if (!account) return res.status(404).json({ message: "Account not found", code: "ACCOUNT_NOT_FOUND" });
    return res.json(account);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with that name already exists", code: "DUPLICATE_ACCOUNT_NAME" });
    }
    console.error("updateAccount error:", err);
    return sendStructuredError(res, {
      code: "ACCOUNT_UPDATE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { listAccounts, getAccount, createAccount, updateAccount, seedDefaultAccounts };
