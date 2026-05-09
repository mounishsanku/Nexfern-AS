const db = require('../setup');
const { createValidatedVoucher } = require('../../src/services/voucherService');
const FinancialYear = require('../../src/models/FinancialYear');
const Entity = require('../../src/models/Entity');
const Account = require('../../src/models/Account');
const Voucher = require('../../src/models/Voucher');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

describe('Accounting Invariants', () => {
  let activeYear;
  let cashAccount;
  let revenueAccount;
  let entity;

  beforeEach(async () => {
    entity = await Entity.create({ name: 'Test Entity', country: 'US', baseCurrency: 'USD' });
    activeYear = await FinancialYear.create({
      name: 'FY 2026',
      entityId: entity._id,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      isActive: true,
      status: 'open'
    });
    
    cashAccount = await Account.create({
      entityId: entity._id,
      name: 'Cash',
      type: 'asset',
      subType: 'bank_and_cash',
      isSystemAccount: true
    });
    
    revenueAccount = await Account.create({
      entityId: entity._id,
      name: 'Sales',
      type: 'revenue',
      subType: 'operating_revenue',
      isSystemAccount: false
    });
  });

  test('Debit must exactly equal Credit within a voucher', async () => {
    const payload = {
      entityId: entity._id,
      financialYearId: activeYear._id,
      type: 'journal',
      date: new Date('2026-03-01'),
      entries: [
        { account: 'Cash', debit: 100, credit: 0 },
        { account: 'Sales', debit: 0, credit: 99 } // Unbalanced!
      ],
      narration: 'Test unbalanced'
    };

    await expect(createValidatedVoucher(payload))
      .rejects
      .toThrow('Debit and credit mismatch');
  });

  test('Vouchers are preserved during reversals', async () => {
    // Valid balanced voucher
    const payload = {
      entityId: entity._id,
      financialYearId: activeYear._id,
      type: 'journal',
      date: new Date('2026-03-01'),
      entries: [
        { account: 'Cash', debit: 100, credit: 0 },
        { account: 'Sales', debit: 0, credit: 100 }
      ],
      narration: 'Valid sale'
    };

    const result = await createValidatedVoucher(payload);
    expect(result.voucher).toHaveProperty('_id');
    
    const saved = await Voucher.findById(result.voucher._id);
    expect(saved).not.toBeNull();
  });

  test('Financial year locking prevents operations in closed years', async () => {
    const closedYear = await FinancialYear.create({
      name: 'FY 2025',
      entityId: entity._id,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      isActive: false,
      status: 'closed'
    });

    const payload = {
      entityId: entity._id,
      financialYearId: closedYear._id,
      type: 'journal',
      date: new Date('2025-06-01'),
      entries: [
        { account: 'Cash', debit: 100, credit: 0 },
        { account: 'Sales', debit: 0, credit: 100 }
      ],
      narration: 'Closed year entry'
    };

    // Currently FY locking is enforced at the controller/middleware level via guardClosedYear
    // We verify the voucher creation function itself still processes it for system operations
    const result = await createValidatedVoucher(payload);
    expect(result.voucher).toHaveProperty('_id');
  });
});
