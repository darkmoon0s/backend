# Insight AI Backend

NestJS 10 REST API for Insight AI GEO SaaS platform.

## Quick Start

```bash
npm install
npx prisma generate --schema=database/prisma/schema.prisma
npm run dev
```

API runs on `http://localhost:4000`
Swagger docs at `http://localhost:4000/docs`

## Environment Variables

Create `.env` file:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/insight_ai?schema=public"
REDIS_HOST="localhost"
REDIS_PORT="6379"
JWT_SECRET="your-secret-key"

# Optional AI providers
GROQ_API_KEY="your-groq-key"
GEMINI_API_KEY="your-gemini-key"
```

## Database

```bash
npx prisma generate --schema=database/prisma/schema.prisma
npx prisma migrate dev --schema=database/prisma/schema.prisma
npm run seed
```

## Deploy to Railway

### Option 1: Railway Dashboard
1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub repo
3. Set **Root Directory** to `backend`
4. Railway auto-detects `Dockerfile.prod` and `railway.json`
5. Add environment variables in Railway dashboard:
   - `DATABASE_URL` — Railway PostgreSQL plugin URL
   - `REDIS_HOST` / `REDIS_PORT` — Railway Redis plugin
   - `JWT_SECRET` — random secure string
   - `GROQ_API_KEY` / `GEMINI_API_KEY` — optional

### Option 2: Railway CLI
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Create project
railway init

# Add PostgreSQL plugin
railway add postgresql

# Add Redis plugin
railway add redis

# Set environment variables
railway variables set JWT_SECRET=your-secret-key
railway variables set GROQ_API_KEY=your-key

# Deploy
railway up
```

### Getting the Database URL
After adding the PostgreSQL plugin:
```bash
railway variables get DATABASE_URL
```

### After Deploy
- API URL: check Railway dashboard for the generated URL
- Swagger docs: `<your-api-url>/docs`
- Health check: `<your-api-url>/health`
- Update `NEXT_PUBLIC_API_URL` in the frontend to point to this URL

## Scripts

- `npm run dev` — Development with hot reload
- `npm run build` — Production build
- `npm run start:prod` — Run production build
- `npm run seed` — Seed demo data
- `npm run prisma:generate` — Generate Prisma client
