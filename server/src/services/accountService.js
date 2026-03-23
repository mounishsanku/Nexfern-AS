/**
 * accountService.js
 *
 * Reusable helpers for resolving Account documents by name.
 * Uses an in-process Map cache so repeated lookups within a request
 * (e.g. multiple voucher entries for the same account) hit the DB only once.
 */

const Account = require("../models/Account");

// In-process cache: name → Account doc (plain object)
const _cache = new Map();

/**
 * Return the Account document for `name`.
 * If it doesn't exist, create it with the given `defaultType`.
 * Results are cached for the lifetime of the process.
 */
async function getAccountByName(name, defaultType = "expense") {
  const key = String(name).trim();

  if (_cache.has(key)) return _cache.get(key);

  let account = await Account.findOne({ name: key }).lean();

  if (!account) {
    account = await Account.create({ name: key, type: defaultType, isActive: true });
    account = account.toObject ? account.toObject() : account;
  }

  _cache.set(key, account);
  return account;
}

/**
 * Resolve a name to its ObjectId only.
 */
async function getAccountIdByName(name, defaultType = "expense") {
  const account = await getAccountByName(name, defaultType);
  return account._id;
}

/**
 * Warm the cache with all active accounts.
 * Call once on startup so the first voucher creation is instant.
 */
async function warmCache() {
  const accounts = await Account.find({ isActive: true }).lean();
  for (const a of accounts) {
    _cache.set(a.name, a);
  }
  console.log(`accountService: cache warmed with ${accounts.length} account(s).`);
}

module.exports = { getAccountByName, getAccountIdByName, warmCache };
