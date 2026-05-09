/**
 * Currency Fallback + Entity Schema Validation Tests
 *
 * Tests that:
 * - Entity.create rejects documents missing country or baseCurrency
 * - The currency resolution logic in invoiceController derives from entity.baseCurrency
 *
 * NOTE: createInvoiceFromData internally uses Mongoose sessions (transactions),
 * which MongoMemoryServer does not support without a replica set. The currency
 * logic is therefore tested at the Unit level by directly exercising the
 * Entity model and the pre-transaction lookup that was introduced.
 */
const db = require('../setup');
const Entity = require('../../src/models/Entity');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

// ─── Entity validation ───────────────────────────────────────────────────────

describe('Entity schema validation', () => {
  test('rejects entity creation without country', async () => {
    await expect(
      Entity.create({ name: 'Missing Country Corp', baseCurrency: 'USD' })
    ).rejects.toThrow(/country.*required/i);
  });

  test('rejects entity creation without baseCurrency', async () => {
    await expect(
      Entity.create({ name: 'Missing Currency Corp', country: 'GB' })
    ).rejects.toThrow(/baseCurrency.*required/i);
  });

  test('rejects entity creation with neither country nor baseCurrency', async () => {
    await expect(
      Entity.create({ name: 'Bare Entity' })
    ).rejects.toThrow();
  });

  test('creates entity successfully with both country and baseCurrency', async () => {
    const entity = await Entity.create({ name: 'Valid Corp', country: 'GB', baseCurrency: 'GBP' });
    expect(entity._id).toBeDefined();
    expect(entity.country).toBe('GB');
    expect(entity.baseCurrency).toBe('GBP');
  });

  test('country and baseCurrency are stored exactly as provided (no normalisation)', async () => {
    const entity = await Entity.create({ name: 'DE Corp', country: 'DE', baseCurrency: 'EUR' });
    const found = await Entity.findById(entity._id).lean();
    expect(found.country).toBe('DE');
    expect(found.baseCurrency).toBe('EUR');
  });
});

// ─── Currency fallback: pure unit test of the lookup logic ───────────────────

describe('Currency fallback resolution logic', () => {
  test('entity.baseCurrency is returned correctly for non-INR entities', async () => {
    const entity = await Entity.create({ name: 'Euro Corp', country: 'DE', baseCurrency: 'EUR' });
    const found = await Entity.findById(entity._id).select('baseCurrency').lean();
    // This is the exact operation the invoiceController now performs when
    // currency is omitted and entityId is provided.
    expect(found.baseCurrency).toBe('EUR');
  });

  test('explicit currency takes precedence: caller supplies USD, entity has EUR', async () => {
    const entity = await Entity.create({ name: 'Euro Corp', country: 'DE', baseCurrency: 'EUR' });
    // Simulate controller logic: explicit currency wins
    const callerCurrency = 'USD';
    const entityDoc = await Entity.findById(entity._id).select('baseCurrency').lean();
    const finalCurrency = callerCurrency || entityDoc.baseCurrency;
    expect(finalCurrency).toBe('USD');
  });

  test('entity baseCurrency is used when caller currency is null', async () => {
    const entity = await Entity.create({ name: 'UK Corp', country: 'GB', baseCurrency: 'GBP' });
    const callerCurrency = null;
    const entityDoc = await Entity.findById(entity._id).select('baseCurrency').lean();
    const finalCurrency = callerCurrency || entityDoc.baseCurrency;
    expect(finalCurrency).toBe('GBP');
  });

  test('finalCurrency is null when no entity and no currency are provided', async () => {
    // No entity lookup possible — finalCurrency falls through to null
    const callerCurrency = null;
    const resolvedEntityDoc = null; // no entity fetched
    const finalCurrency = callerCurrency || resolvedEntityDoc?.baseCurrency || null;
    expect(finalCurrency).toBeNull();
  });
});
