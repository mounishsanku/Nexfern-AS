const db = require('../setup');
const { stageImport } = require('../../src/services/importEngine');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

describe('Import Engine', () => {
  test('Returns error on missing buffer', async () => {
    await expect(stageImport({ buffer: null, type: 'invoice' })).rejects.toThrow();
  });
});
