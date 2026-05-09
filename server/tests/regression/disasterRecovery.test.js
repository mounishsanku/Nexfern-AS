const db = require('../setup');
const { simulateRestore } = require('../../src/services/disasterRecoveryService');
const { encryptPayload } = require('../../src/services/encryptionService');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

describe('Disaster Recovery', () => {
  test('Simulate Restore succeeds on valid payload', async () => {
    const origKey = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = 'test_encryption_key_32_bytes_ln_';

    const payload = encryptPayload({ version: 2, exportedAt: new Date().toISOString() });
    
    const { success, issues, summary } = await simulateRestore(payload);
    expect(success).toBe(true);
    expect(issues).toHaveLength(0);
    expect(summary.version).toBe(2);

    process.env.BACKUP_ENCRYPTION_KEY = origKey;
  });
});
