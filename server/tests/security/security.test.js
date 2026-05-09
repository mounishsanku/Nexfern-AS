const { slidingWindowRateLimit } = require('../../src/middleware/rateLimitMiddleware');
const { encryptPayload, decryptPayload } = require('../../src/services/encryptionService');

describe('Security Infrastructure', () => {
  test('Backup Encryption payload is verified correctly', () => {
    // Mock the BACKUP_ENCRYPTION_KEY to 32 bytes for this test
    const origKey = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = 'test_encryption_key_32_bytes_ln_';

    const mockData = { version: '1.0.0', invoices: [] };
    const encrypted = encryptPayload(mockData);

    expect(encrypted.encrypted).toBe(true);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.encryptedData).toBeDefined();

    const decrypted = decryptPayload(encrypted);
    expect(decrypted).toEqual(mockData);

    process.env.BACKUP_ENCRYPTION_KEY = origKey;
  });

  test('Rate Limiter correctly blocks exceeded limits', () => {
    const limiter = slidingWindowRateLimit({ windowMs: 5000, max: 2, keyPrefix: 'test' });
    let blockedCount = 0;
    
    const mockReq = { ip: '1.1.1.1' };
    const mockRes = {
      status: () => ({ json: () => { blockedCount++; } }),
      set: () => {}
    };
    const next = jest.fn();

    // Call 1
    limiter(mockReq, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Call 2
    limiter(mockReq, mockRes, next);
    expect(next).toHaveBeenCalledTimes(2);

    // Call 3 - should block
    limiter(mockReq, mockRes, next);
    expect(blockedCount).toBe(1);
    expect(next).toHaveBeenCalledTimes(2); // Should not increase
  });
});
