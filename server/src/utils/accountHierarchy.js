/**
 * Chart of Accounts parent/child rules (production-safe).
 *
 * - Sub-accounts must belong to the same account class as their parent.
 * - Assets → parent must be asset (or none). Cannot sit under liability/revenue/expense/equity.
 * - Liabilities → parent must be liability (or none). Cannot sit under asset.
 * - Equity → no parent OR equity parent only.
 * - Revenue → no parent OR revenue parent only.
 * - Expense → no parent OR expense parent only.
 */

const VALID_TYPES = ["asset", "liability", "equity", "revenue", "expense"];

/**
 * @param {string} childType
 * @param {string|null|undefined} parentType  Parent account's type (ignored if null)
 * @returns {boolean}
 */
function isValidParentChildTypes(childType, parentType) {
  if (parentType == null || parentType === undefined) return true;
  const c = String(childType || "").toLowerCase();
  const p = String(parentType || "").toLowerCase();
  if (!VALID_TYPES.includes(c) || !VALID_TYPES.includes(p)) return false;
  return c === p;
}

/**
 * @param {import("mongoose").Model} Account
 * @param {string} type Child account type
 * @param {string|null|undefined} parentId
 * @param {string|null|undefined} excludeAccountId For updates: current account id (cannot parent self)
 */
async function assertValidParentAccount(Account, { type, parentId, excludeAccountId }) {
  if (!parentId) return { ok: true };

  if (excludeAccountId && String(parentId) === String(excludeAccountId)) {
    return {
      ok: false,
      message: "Account cannot be its own parent",
      code: "INVALID_PARENT_SELF",
    };
  }

  const parent = await Account.findById(parentId).lean();
  if (!parent) {
    return { ok: false, message: "Parent account not found", code: "PARENT_NOT_FOUND" };
  }

  if (!isValidParentChildTypes(type, parent.type)) {
    return {
      ok: false,
      message: "Invalid parent account for this type",
      code: "INVALID_ACCOUNT_HIERARCHY",
    };
  }

  return { ok: true };
}

/**
 * True if assigning newParentId as parent of accountId would create a cycle.
 * That happens when newParentId is accountId itself, or newParentId is any descendant of accountId
 * (would make an ancestor point into its own subtree).
 * @param {import("mongoose").Model} Account
 * @param {string} accountId
 * @param {string|null|undefined} newParentId
 */
async function wouldCreateParentCycle(Account, accountId, newParentId) {
  if (!newParentId || !accountId) return false;
  if (String(newParentId) === String(accountId)) return true;

  const queue = [accountId];
  const seen = new Set();
  const maxNodes = 5000;
  let n = 0;
  while (queue.length && n < maxNodes) {
    const id = queue.shift();
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    n += 1;
    if (key === String(newParentId)) return true;
    const children = await Account.find({ parentId: id }).select("_id").lean();
    for (const ch of children) queue.push(ch._id);
  }
  return false;
}

module.exports = {
  VALID_TYPES,
  isValidParentChildTypes,
  assertValidParentAccount,
  wouldCreateParentCycle,
};
