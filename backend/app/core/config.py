from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, EmailStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────
    APP_NAME: str = "SaaS Backend"
    APP_VERSION: str = "1.0.0"
    ENV: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    SECRET_KEY: str
    ALLOWED_ORIGINS: str = ""

    # ── Auth / JWT ────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Supabase ──────────────────────────────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_STORAGE_BUCKET: str = "uploads"

    # ── Redis ─────────────────────────────────────────────────────────────────────
    REDIS_URL: str | None = None  # e.g. redis://localhost:6379/0

    # ── AI Providers ──────────────────────────────────────────────────────
    # ── Composio ──────────────────────────────────────────────────────────────
    COMPOSIO_API_KEY: str

    # ── Agent ─────────────────────────────────────────────────────────────────
    AGENT_MAX_ITERATIONS: int = 8
    AGENT_WINDOW_SIZE: int = 20
    AGENT_SUMMARIZE_THRESHOLD: int = 40

    GEMINI_API_KEY: str
    GEMINI_MODEL: str = "gemini-2.0-flash"
    GROQ_API_KEY: str
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    AI_TIMEOUT_SECONDS: int = 30
    AI_MAX_RETRIES: int = 2

    # ── Tavily Search ──────────────────────────────────────────────────────
    TAVILY_API_KEY: str | None = None
    TAVILY_MAX_RESULTS: int = 5

    # ── Payments (Stripe) ─────────────────────────────────────────────────
    STRIPE_SECRET_KEY: str
    STRIPE_WEBHOOK_SECRET: str
    STRIPE_PRICE_ID_MONTHLY: str = ""
    STRIPE_PRICE_ID_YEARLY: str = ""

    # ── Email ─────────────────────────────────────────────────────────────
    SMTP_HOST: str = "smtp.resend.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = "resend"
    SMTP_PASSWORD: str
    EMAIL_FROM: EmailStr = "noreply@yourapp.com"
    EMAIL_FROM_NAME: str = "YourApp"

    # ── Storage ───────────────────────────────────────────────────────────
    MAX_UPLOAD_SIZE_MB: int = 10
    ALLOWED_MIME_TYPES: str = "image/jpeg,image/png,image/webp,application/pdf,text/plain"

    # ── Rate Limiting ─────────────────────────────────────────────────────
    RATE_LIMIT_PER_MINUTE: int = 60


    @property
    def is_production(self) -> bool:
        return self.ENV == "production"

    @property
    def is_development(self) -> bool:
        return self.ENV == "development"

    APP_BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
