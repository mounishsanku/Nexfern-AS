## MERN structure

This workspace now contains a MERN setup under:

- `client/` — React (Vite) + TypeScript + Tailwind
- `server/` — Node.js + Express + Mongoose

## Run frontend

```bash
cd client
npm install
npm run dev
```

## Run backend

Create an env file:

```bash
cd server
copy .env.example .env
```

Start the server:

```bash
npm install
npm run dev
```

Test the API:

```bash
curl http://localhost:5001/api/test
```

Expected response:

```text
API working
```

