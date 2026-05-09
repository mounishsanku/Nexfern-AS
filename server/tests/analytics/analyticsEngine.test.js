const db = require('../setup');
const { generateKPISummary, runAnalyticsDiagnostics } = require('../../src/services/analyticsEngine');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

describe('Analytics Engine', () => {
  test('Diagnostics return correctly on empty system', async () => {
    const { systemStatus, warnings } = await runAnalyticsDiagnostics();
    expect(warnings).toBeInstanceOf(Array);
    expect(warnings).toBeInstanceOf(Array);
  });
});
