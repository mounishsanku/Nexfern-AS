# Deployment Documentation

## 1. Docker Deployment
Nexfern FinanceOS provides a multi-stage `Dockerfile`.
To build:
```bash
docker build -t nexfern .
```
To run via Docker Compose:
```bash
docker-compose up -d
```

## 2. Environment Variables
Reference `.env.example` for all required variables.
**CRITICAL:** In production, you must set:
- `NODE_ENV=production`
- `JWT_SECRET` (minimum 32 chars)
- `BACKUP_ENCRYPTION_KEY` (exactly 32 chars)

## 3. Production Checklist
- [ ] MongoDB is secured with authentication.
- [ ] Environment variables are injected securely (e.g., AWS Secrets Manager, Kubernetes Secrets).
- [ ] Rate limiting is enabled.
- [ ] Monitoring dashboard is accessible to admins.

## 4. Scaling
- The application is stateless (except for uploaded files).
- Use a shared storage volume for `/uploads` if running multiple instances.
- MongoDB should be deployed as a replica set for high availability.
