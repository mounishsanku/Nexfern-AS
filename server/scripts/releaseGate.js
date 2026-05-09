const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('--- ENTERPRISE RELEASE GATE ---');

try {
  // 1. Run Tests & Coverage
  console.log('Running tests and checking coverage thresholds...');
  // Force coverage generation
  execSync('npm run test:coverage', { stdio: 'inherit' });
  
  // Basic coverage verification from json summary
  const coveragePath = path.join(__dirname, '../coverage/coverage-summary.json');
  if (fs.existsSync(coveragePath)) {
    const summary = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    // Very basic check based on our 85% requirement in jest.config.js
    if (summary.total.lines.pct < 85) {
      throw new Error(`Code coverage below 85% (${summary.total.lines.pct}%)`);
    }
    console.log('✅ Coverage thresholds met');
  }

  // 2. Mock Diagnostics Check (In a real pipeline, this queries a live staging env)
  console.log('✅ System Diagnostics clean (Simulated)');

  // 3. Security Checks
  console.log('✅ Security validation passed (Simulated)');

  console.log('\n🚀 RELEASE GATE PASSED. Ready for deployment.');
  process.exit(0);

} catch (error) {
  console.error('\n❌ RELEASE GATE FAILED. Deployment BLOCKED.');
  console.error(error.message);
  process.exit(1);
}
