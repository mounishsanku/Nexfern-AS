const db = require('../setup');
const { 
  suggestMatches, 
  confirmMatch, 
  runReconciliationDiagnostics 
} = require('../../src/services/reconciliationEngine');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

describe('Reconciliation Engine', () => {
  test('Diagnostics should return warnings for empty system', async () => {
    const { warnings } = await runReconciliationDiagnostics();
    expect(warnings).toBeInstanceOf(Array);
  });

  // More in-depth tests require setting up BankTransactions, Invoices, Payments, etc.
  // This verifies the engine module is accessible and returns expected structure.
});
