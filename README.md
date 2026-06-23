# SynapseAI

> **The AI agent that lives inside your workflow.**  
> SynapseAI connects to your tools — Gmail, Slack, GitHub, Notion, and more — and takes real action on your behalf, with your approval.

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [AI Agent Design](#ai-agent-design)
- [Integrations](#integrations)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Overview

SynapseAI is a **full-stack, production-ready AI Agent SaaS platform**. Users connect their third-party tools via OAuth and interact with a conversational AI agent that can:

- **Read and write** emails, calendar events, Slack messages, GitHub issues, and more
- **Search the web** in real time via Tavily
- **Search a personal knowledge base** (RAG over uploaded documents)
- **Pause and ask for confirmation** before taking any sensitive or destructive action

The system is built around a **multi-step agentic tool loop** powered by Google Gemini (primary) with Groq LLaMA 3.3 70B as an automatic fallback.

---

## Architecture

```
+--------------------------------------------------+
|                    Frontend                      |
|            Next.js 14 (App Router)               |
|   Landing  |  Auth  |  Dashboard  |  Agent Chat  |
+------------------------+-------------------------+
                         | HTTPS / WebSocket
+------------------------v-------------------------+
|                    Backend                       |
|            FastAPI (async, Python 3.11+)         |
|                                                  |
|   +-------------+   +--------------------------+ |
|   |  REST API   |   |      Agent Engine        | |
|   |  /api/v1/*  |   |  ChatAgent + ToolLoop    | |
|   +-------------+   +------------+-------------+ |
|                                  |               |
|   +------------------------------v-------------+ |
|   |              Services Layer               |  |
|   |  AI Router | Composio | Payments | Email  |  |
|   +------------------------------+------------+  |
+--------------------------------------------------+
                         |
     +-------------------+--------------------+
     |                   |                    |
 Supabase             Redis            Stripe / SMTP
 Postgres +       (optional)          Composio APIs
 Storage           token cache        Tavily Search
```

---

## Features

| Feature | Description |
|---|---|
| Agentic Tool Loop | Multi-step reasoning — up to 5 tool call iterations per turn |
| AI Fallback | Gemini primary, Groq fallback — fully automatic, transparent to user |
| Human-in-the-Loop | Sensitive actions require explicit user approval before executing |
| OAuth Integrations | Gmail, Slack, GitHub, Notion, Linear, Calendar, Sheets, LinkedIn |
| Conversation Memory | Sliding-window history + automatic summarization for long sessions |
| Knowledge Base (RAG) | Upload files, vector search, grounded answers |
| Web Search | Real-time search via Tavily, triggered on demand |
| Stripe Billing | Subscription checkout, customer portal, webhook handling |
| Analytics | Per-user usage tracking dashboard |
| JWT Auth | Access + refresh token rotation, bcrypt password hashing |
| Rate Limiting | Per-user and global rate limiting via SlowAPI |
| Docker Ready | Multi-stage Dockerfile + Docker Compose for local stack |

---

## Tech Stack

### Backend

| Layer | Technology |
|---|---|
| Framework | FastAPI 0.115 (async) |
| Language | Python 3.11+ |
| Database | Supabase (PostgreSQL + Storage) |
| Cache | Redis (optional — token denylist) |
| AI Primary | Google Gemini 2.0 Flash |
| AI Fallback | Groq — LLaMA 3.3 70B |
| Integrations | Composio (OAuth + tool execution) |
| Web Search | Tavily Search API |
| Payments | Stripe (subscriptions + webhooks) |
| Email | SMTP / Resend |
| Auth | JWT (access + refresh) + bcrypt |
| Scheduler | APScheduler (background jobs) |
| Logging | structlog (JSON prod / pretty dev) |
| Rate Limiting | SlowAPI |
| Testing | pytest + pytest-asyncio |
| Linting | Ruff + mypy |
| Container | Docker multi-stage + Docker Compose |

### Frontend

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS |
| Auth | Supabase Auth (client SDK) |
| Real-time | WebSocket (agent streaming) |
| Icons | Lucide React |

---

## Project Structure

```
SynapseAI/
+-- backend/
|   +-- app/
|   |   +-- agents/                  # Agent engine
|   |   |   +-- chat_agent.py        # Core agentic tool loop
|   |   |   +-- websocket_handler.py # WebSocket streaming
|   |   |   +-- prompt_builder.py    # System prompt construction
|   |   |   +-- memory/              # Conversation history + summarization
|   |   |   +-- tools/
|   |   |       +-- composio_toolkit.py
|   |   |       +-- tavily_search.py
|   |   |       +-- knowledge_base.py
|   |   |       +-- confirmation.py  # Human-in-the-loop gate
|   |   |       +-- router.py        # Semantic tool routing
|   |   +-- api/v1/                  # REST endpoints
|   |   |   +-- agent/               # Chat, WebSocket, confirmations
|   |   |   +-- ai/                  # Direct AI completion endpoints
|   |   |   +-- analytics/           # Usage statistics
|   |   |   +-- files/               # File upload / storage
|   |   |   +-- notifications/       # In-app + email notifications
|   |   |   +-- payments/            # Stripe integration
|   |   |   +-- preferences/         # User preferences
|   |   |   +-- users/               # Profile management
|   |   +-- core/                    # Config, auth, exceptions, DI
|   |   +-- db/                      # Supabase async client singleton
|   |   +-- middleware/              # Logging, rate limiting
|   |   +-- services/
|   |   |   +-- ai/                  # Gemini, Groq, AI router
|   |   |   +-- cache/               # Redis client
|   |   |   +-- composio_oauth.py    # OAuth wiring
|   |   |   +-- email/               # Transactional email
|   |   |   +-- payments/            # Stripe service
|   |   |   +-- scheduler/           # Background jobs
|   |   +-- utils/
|   +-- scripts/
|   |   +-- schema.sql               # Supabase schema
|   |   +-- agent_migration.sql      # Agent tables
|   |   +-- rag_setup.sql            # Vector search setup
|   +-- tests/
|   +-- Dockerfile
|   +-- docker-compose.yml
|   +-- Makefile
|   +-- requirements.txt
|
+-- frontend/
    +-- app/
    |   +-- page.tsx                 # Landing page
    |   +-- sign-in/
    |   +-- sign-up/
    |   +-- dashboard/
    |       +-- page.tsx             # Agent chat interface
    |       +-- analytics/
    |       +-- integrations/
    |       +-- settings/
    +-- components/
    +-- hooks/
    +-- lib/
    +-- package.json
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Google AI Studio](https://aistudio.google.com) API key (Gemini)
- A [Groq](https://console.groq.com) API key (free)
- A [Composio](https://composio.dev) API key

---

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# Configure environment
cp .env.example .env
# Fill in your keys in .env

# Apply database schema (Supabase SQL Editor)
# Run in order: schema.sql -> agent_migration.sql -> rag_setup.sql

# Run dev server
make dev                         # Uvicorn with hot reload on :8000
```

API docs: http://localhost:8000/docs

---

### Frontend Setup

```bash
cd frontend

npm install

cp .env.local.example .env.local
# Set NEXT_PUBLIC_API_URL and Supabase keys

npm run dev                      # Next.js on :3000
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Model name (default: `gemini-2.0-flash`) |
| `GROQ_API_KEY` | Groq API key (fallback AI) |
| `COMPOSIO_API_KEY` | Composio API key |
| `TAVILY_API_KEY` | Tavily search API key |
| `JWT_SECRET_KEY` | Secret for signing JWTs |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `REDIS_URL` | Redis connection URL (optional) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `ENV` | `development` or `production` |

See `backend/.env.example` for the full reference.

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login, receive JWT tokens |
| POST | `/api/v1/auth/refresh` | Rotate access token |
| POST | `/api/v1/auth/logout` | Invalidate session |

### Agent

| Method | Endpoint | Description |
|---|---|---|
| WS | `/api/v1/agent/ws/{session_id}` | WebSocket agent chat (streaming) |
| POST | `/api/v1/agent/chat` | Non-streaming chat |
| POST | `/api/v1/agent/confirm/{id}` | Approve/reject pending action |
| GET | `/api/v1/agent/sessions` | List conversation sessions |
| DELETE | `/api/v1/agent/sessions/{id}` | Delete a session |

### Files & AI

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/files/upload` | Upload file to knowledge base |
| GET | `/api/v1/files/` | List user files |
| DELETE | `/api/v1/files/{id}` | Delete a file |
| POST | `/api/v1/ai/chat` | Direct AI completion |
| POST | `/api/v1/ai/chat/stream` | SSE streaming completion |

### Payments

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/payments/checkout` | Create Stripe checkout session |
| GET | `/api/v1/payments/subscription` | Get subscription status |
| POST | `/api/v1/payments/portal` | Billing portal link |
| POST | `/api/v1/payments/webhook` | Stripe webhook receiver |

---

## AI Agent Design

The agent runs a deterministic tool loop (up to `MAX_TOOL_ITERATIONS = 5`):

```
User Message
     |
     v
 Load Memory (sliding window + summary)
     |
     v
 Semantic Tool Routing -> select relevant Composio apps
     |
     v
 Gemini API call (with tools)
     |
     +-- finish_reason == "tool_calls"?
     |     +-- Yes -> needs_confirmation?
     |     |           +-- Yes -> pause, yield ConfirmationEvent (wait for user)
     |     |           +-- No  -> execute tool -> append result -> loop
     |     +-- No  -> yield text reply -> break
     |
     + (on Gemini error) -> Groq Fallback (text only)
     |
     v
 Save to Memory -> maybe_summarize
     |
     v
 yield AgentTurn (metadata)
```

**Confirmation gate**: Actions tagged as sensitive (e.g. `GMAIL_SEND_EMAIL`, `SLACK_SEND_MESSAGE`) are intercepted. The agent pauses and surfaces a human-readable summary to the UI. Execution only proceeds when the user explicitly approves.

---

## Integrations

Connected via [Composio](https://composio.dev) OAuth:

| App | Capabilities |
|---|---|
| Gmail | Read, search, send, reply to emails |
| Google Calendar | Create, update, list events |
| Slack | Send messages, read channels |
| GitHub | Create issues, open PRs, search repos |
| Notion | Create and update pages/databases |
| Google Sheets | Read and write spreadsheet data |
| Linear | Create and update issues, projects |
| LinkedIn | Post updates, read profile |
| Browserbase | Headless browser automation |

---

## Deployment

### Backend — Railway / Render

```bash
# Set all env vars from .env.example in your platform dashboard
# The Dockerfile handles everything — platform auto-detects it
# Set ENV=production to disable /docs and enable JSON logging
```

### Frontend — Vercel

```bash
cd frontend
vercel
# Set NEXT_PUBLIC_API_URL in your Vercel project environment settings
```

### Docker Compose (self-hosted)

```bash
cd backend
make dev-docker     # Starts API + Redis
```

---

## Contributing

1. Fork the repo and create a feature branch: `git checkout -b feature/my-feature`
2. Follow the existing code structure (router -> schemas -> service pattern)
3. Run `make lint && make typecheck && make test` before submitting
4. Open a PR with a clear description of what changed and why

---

## License

MIT (c) 2025 SynapseAI
