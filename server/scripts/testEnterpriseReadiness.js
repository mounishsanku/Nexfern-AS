const { execSync } = require('child_process');

console.log('=== Nexfern Enterprise Readiness Validation ===');

try {
  console.log('\n[1/4] Running Documentation Integrity Tests...');
  execSync('node scripts/testDocumentationIntegrity.js', { stdio: 'inherit' });

  console.log('\n[2/4] Running DevOps Infrastructure Tests...');
  execSync('node -r dotenv/config scripts/testDevOpsInfrastructure.js', { stdio: 'inherit' });

  console.log('\n[3/4] Running Enterprise Release Gate (Tests & Coverage)...');
  execSync('node scripts/releaseGate.js', { stdio: 'inherit' });

  console.log('\n[4/4] Verifying Frontend Build Readiness...');
  execSync('npm run build', { cwd: '../client', stdio: 'inherit' });

  console.log('\n✅ ENTERPRISE READINESS VERIFIED. All systems GO.');
  process.exit(0);
} catch (err) {
  console.error('\n❌ ENTERPRISE READINESS FAILED. DO NOT DEPLOY.');
  process.exit(1);
}
