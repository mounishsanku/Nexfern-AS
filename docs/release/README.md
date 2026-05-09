# Release Readiness Checklist

Before deploying a new version to production, verify the following:

## 1. Security
- [ ] `npm audit` shows no critical vulnerabilities.
- [ ] Feature flags are set correctly for production (`USE_MONITORING=true`).
- [ ] Rate limiters are active.

## 2. Diagnostics
- [ ] All tests pass (`npm test`).
- [ ] `runFullSystemDiagnostics` completes without errors on the staging environment.

## 3. Backups
- [ ] Verify that a test backup payload can be generated and decrypted.

## 4. Reconciliation
- [ ] Ensure bank feed parsers are functioning correctly with test data.

## 5. Analytics
- [ ] Check that cache expiration and TTL indexes are correctly configured.

## 6. Deployment
- [ ] Docker images build successfully.
- [ ] Environment validation script passes on staging.
