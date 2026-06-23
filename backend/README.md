# SaaS Backend

Production-ready FastAPI backend for a SaaS application — async, typed end-to-end, and deployable to Railway or Render in minutes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI 0.115 (async) |
| Database | Supabase (Postgres + Storage) |
| AI Primary | Google Gemini 1.5 Pro |
| AI Fallback | Groq (LLaMA 3.3 70B) |
| Auth | JWT (access + refresh) + bcrypt |
| Payments | Stripe (subscriptions + webhooks) |
| Email | SMTP / Resend |
| Logging | structlog (JSON in prod, pretty in dev) |
| Rate Limiting | SlowAPI |
| Containerisation | Docker (multi-stage) + Docker Compose |
| Linting | Ruff + mypy |
| Testing | pytest + pytest-asyncio |

---

## Project Structure

```
app/
├── main.py                     # App factory, middleware, exception handlers
├── core/
│   ├── config.py               # All settings via pydantic-settings (typed)
│   ├── security.py             # JWT creation/validation, bcrypt
│   ├── exceptions.py           # Typed HTTP exception hierarchy
│   └── dependencies.py         # FastAPI DI: CurrentUserDep, DBDep, SubscribedUserDep
├── db/
│   └── supabase.py             # Async Supabase singleton client
├── api/v1/
│   ├── router.py               # Aggregates all v1 routers under /api/v1
│   ├── auth/                   # Register, Login, Refresh, Logout
│   ├── users/                  # Profile read/update/delete
│   ├── ai/                     # Chat completion + SSE streaming
│   ├── files/                  # Upload, list, delete (Supabase Storage)
│   ├── payments/               # Stripe checkout, portal, webhooks
│   └── notifications/          # In-app notifications + transactional email
├── services/
│   └── ai/
│       ├── base.py             # Abstract provider interface
│       ├── gemini.py           # Gemini implementation
│       ├── groq.py             # Groq implementation (fallback)
│       └── router.py           # Auto-fallback Gemini → Groq
├── middleware/
│   ├── logging.py              # Request/response tracing with request-id
│   └── rate_limit.py           # SlowAPI limiter instance
└── utils/
    └── logger.py               # structlog setup

scripts/
├── schema.sql                  # Supabase SQL schema (users, files, notifications)
└── seed.py                     # Seed test data for local development

tests/
├── conftest.py                 # Fixtures: client, auth headers, mock_db, mock_ai
└── unit/
    └── test_auth_service.py
```

---

## Quick Start

### 1. Clone & install

```bash
git clone <your-repo>
cd saas-backend

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env — fill in Supabase, Gemini, Groq, Stripe, SMTP keys
```

### 3. Apply database schema

Open your Supabase project → SQL Editor → paste and run `scripts/schema.sql`.

### 4. Run locally

```bash
make dev           # Uvicorn with hot reload on :8000
# or
make dev-docker    # Full Docker Compose stack
```

### 5. Explore the API

Open [http://localhost:8000/docs](http://localhost:8000/docs) for the interactive Swagger UI.

---

## API Reference

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Get tokens |
| POST | `/api/v1/auth/refresh` | Rotate access token |
| POST | `/api/v1/auth/logout` | Invalidate session |

### AI
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/ai/chat` | Completion (Gemini → Groq fallback) |
| POST | `/api/v1/ai/chat/stream` | SSE streaming completion |
| GET | `/api/v1/ai/health` | Provider availability |

### Files
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/files/upload` | Upload to Supabase Storage |
| GET | `/api/v1/files/` | List user's files |
| DELETE | `/api/v1/files/{id}` | Delete file |

### Payments
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/payments/checkout` | Create Stripe Checkout session |
| GET | `/api/v1/payments/subscription` | Get subscription status |
| POST | `/api/v1/payments/portal` | Stripe Customer Portal link |
| POST | `/api/v1/payments/webhook` | Stripe webhook receiver |

---

## Development Commands

```bash
make test          # Run tests with coverage report
make lint          # Ruff linter
make format        # Auto-format code
make typecheck     # mypy static analysis
make seed          # Seed local DB
make stripe-listen # Forward Stripe webhooks locally
make clean         # Remove cache/build artifacts
```

---

## Deployment

### Railway / Render

1. Push repo to GitHub
2. Connect repo in Railway or Render dashboard
3. Set all env vars from `.env.example` in the platform's environment settings
4. The `Dockerfile` handles everything — the platform auto-detects it

### Environment variables to set in production

- `ENV=production` — disables `/docs`, `/redoc`, enables JSON logging
- `DEBUG=false`
- All secrets from `.env.example`

---

## AI Fallback Logic

The `AIRouter` in `app/services/ai/router.py` handles provider failures transparently:

1. Every request goes to **Gemini** first
2. On `RateLimitError`, `ProviderError`, or timeout → automatically retries on **Groq**
3. If both fail → raises `503 Service Unavailable`

You can also force a specific provider per-request: `{ "provider": "groq" }`.

---

## Adding a New Feature

1. Create `app/api/v1/<feature>/` with `router.py`, `schemas.py`, `service.py`
2. Register the router in `app/api/v1/router.py`
3. Add any new tables to `scripts/schema.sql`
4. Write tests in `tests/unit/` or `tests/integration/`
