.PHONY: help dev build test lint format typecheck seed clean

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Local dev ─────────────────────────────────────────────────────────────────
dev:  ## Start API with hot reload (no Docker)
	uvicorn app.main:app --reload --reload-dir app --port 8000

dev-docker:  ## Start full stack via Docker Compose
	docker compose up --build

dev-stripe:  ## Start stack + Stripe CLI webhook forwarding
	docker compose --profile stripe up --build

# ── Build ─────────────────────────────────────────────────────────────────────
build:  ## Build production Docker image
	docker build --target runtime -t saas-backend:latest .

# ── Tests ─────────────────────────────────────────────────────────────────────
test:  ## Run all tests with coverage
	pytest

test-unit:  ## Run only unit tests
	pytest tests/unit

test-integration:  ## Run only integration tests
	pytest tests/integration

test-watch:  ## Run tests in watch mode (requires pytest-watch)
	ptw -- --testpaths tests/unit

# ── Code quality ──────────────────────────────────────────────────────────────
lint:  ## Run ruff linter
	ruff check app tests

format:  ## Auto-format with ruff
	ruff format app tests
	ruff check --fix app tests

typecheck:  ## Run mypy static type checking
	mypy app

check: lint typecheck  ## Run all checks

# ── Database ──────────────────────────────────────────────────────────────────
seed:  ## Seed local database with test data
	python scripts/seed.py

smoke:  ## Run end-to-end smoke test (server must be running)
	python scripts/smoke_test.py

quickstart:  ## Validate .env then start the server
	python scripts/quickstart.py

# ── Stripe ────────────────────────────────────────────────────────────────────
stripe-listen:  ## Forward Stripe webhooks to local dev server
	stripe listen --forward-to localhost:8000/api/v1/payments/webhook

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:  ## Remove cache and build artifacts
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name htmlcov -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .coverage .ruff_cache .mypy_cache dist build
	@echo "✅ Clean!"

deploy-railway:  ## Deploy to Railway (requires RAILWAY_TOKEN)
	npm install -g @railway/cli && railway up --service api --detach

deploy-render:  ## Copy render.yaml to project root and push
	cp deploy/render.yaml render.yaml && git add render.yaml && echo "render.yaml ready — push to trigger deploy"

migrate:  ## Print reminder to apply all SQL migrations in order
	@echo "Apply these in Supabase SQL Editor (in order):"
	@echo "  1. scripts/schema.sql"
	@echo "  2. scripts/agent_migration.sql"
	@echo "  3. scripts/final_migration.sql"
