const fs = require('fs');
const path = require('path');

console.log('--- Testing Documentation Integrity ---');

const requiredDirs = [
  'server/src/docs',
  'docs/architecture',
  'docs/admin',
  'docs/onboarding',
  'docs/sop',
  'docs/deployment',
  'docs/support',
  'docs/release',
];

const requiredFiles = [
  'CHANGELOG.md',
  'server/src/docs/openapi.yaml',
  'docs/architecture/README.md',
  'docs/admin/README.md',
  'docs/onboarding/README.md',
  'docs/sop/README.md',
  'docs/deployment/README.md',
  'docs/support/README.md',
  'docs/release/README.md',
];

let hasErrors = false;

// 1. Verify Directories
for (const dir of requiredDirs) {
  const fullPath = path.join(__dirname, '../../', dir);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing directory: ${dir}`);
    hasErrors = true;
  } else {
    console.log(`✅ Directory exists: ${dir}`);
  }
}

// 2. Verify Files
for (const file of requiredFiles) {
  const fullPath = path.join(__dirname, '../../', file);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing file: ${file}`);
    hasErrors = true;
  } else {
    console.log(`✅ File exists: ${file}`);
  }
}

// 3. Verify .env.example
const envExamplePath = path.join(__dirname, '../.env.example');
if (fs.existsSync(envExamplePath)) {
  const content = fs.readFileSync(envExamplePath, 'utf8');
  if (!content.includes('JWT_SECRET') || !content.includes('BACKUP_ENCRYPTION_KEY')) {
    console.error(`❌ .env.example missing critical variables`);
    hasErrors = true;
  } else {
    console.log(`✅ .env.example includes critical variables`);
  }
}

// 4. OpenAPI Basic Check
const openApiPath = path.join(__dirname, '../src/docs/openapi.yaml');
if (fs.existsSync(openApiPath)) {
  const content = fs.readFileSync(openApiPath, 'utf8');
  if (!content.includes('/auth/login') || !content.includes('/invoices')) {
    console.error(`❌ openapi.yaml missing critical routes`);
    hasErrors = true;
  } else {
    console.log(`✅ openapi.yaml includes expected routes`);
  }
}

if (hasErrors) {
  console.error('\n❌ Documentation Integrity Test Failed');
  process.exit(1);
} else {
  console.log('\n✅ Documentation Integrity Test Passed');
  process.exit(0);
}
