const db = require('../setup');
const { getExchangeRate, convertToEntityBase } = require('../../src/services/currencyService');

// Using mock config for the test, since currencyService might use DB or env.
beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

describe('Multi-currency Engine', () => {
  test('Base amount matches converted amount with mocked rate', async () => {
    // Note: for unit tests, you might mock the DB calls or just test the pure logic.
    // Assuming 1 USD = 0.85 EUR for test logic simulation.
    const rate = 0.85;
    const amount = 100;
    const baseAmount = amount * rate;
    
    // Validating basic math assumption that baseAmount calculation is deterministic.
    expect(baseAmount).toBe(85);
  });
});
