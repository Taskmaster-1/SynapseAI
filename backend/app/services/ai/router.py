import asyncio
from typing import AsyncIterator

from app.core.config import settings
from app.core.exceptions import AIProviderException, AIRateLimitException
from app.services.ai.base import AIMessage, AIResponse, BaseAIProvider
from app.services.ai.gemini import GeminiProvider
from app.services.ai.groq import GroqProvider
from app.utils.logger import logger


class AIRouter:
    """
    Wraps primary (Gemini) and fallback (Groq) providers.
    Automatically retries on the fallback when the primary fails.
    """

    def __init__(self) -> None:
        self._primary: BaseAIProvider = GeminiProvider()
        self._fallback: BaseAIProvider = GroqProvider()

    async def chat(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        force_provider: str | None = None,
    ) -> AIResponse:
        providers = self._get_chain(force_provider)

        last_error: Exception | None = None
        for attempt, provider in enumerate(providers):
            try:
                logger.info("AI chat attempt", provider=provider.name, attempt=attempt)
                return await asyncio.wait_for(
                    provider.chat(
                        messages,
                        system_prompt=system_prompt,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    ),
                    timeout=settings.AI_TIMEOUT_SECONDS,
                )
            except AIRateLimitException:
                logger.warning("AI rate limit hit", provider=provider.name)
                last_error = AIRateLimitException()
                continue
            except (AIProviderException, asyncio.TimeoutError) as e:
                logger.warning("AI provider failed", provider=provider.name, error=str(e))
                last_error = e
                continue

        raise last_error or AIProviderException("All AI providers failed")

    async def stream(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        force_provider: str | None = None,
    ) -> AsyncIterator[str]:
        providers = self._get_chain(force_provider)

        for provider in providers:
            try:
                async for chunk in provider.stream(
                    messages,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                ):
                    yield chunk
                return
            except (AIProviderException, AIRateLimitException) as e:
                logger.warning("AI stream failed", provider=provider.name, error=str(e))
                continue

        raise AIProviderException("All AI providers failed during streaming")

    def _get_chain(self, force_provider: str | None) -> list[BaseAIProvider]:
        if force_provider == "groq":
            return [self._fallback]
        if force_provider == "gemini":
            return [self._primary]
        return [self._primary, self._fallback]

    async def health_check(self) -> dict[str, bool]:
        primary_ok, fallback_ok = await asyncio.gather(
            self._primary.health_check(),
            self._fallback.health_check(),
            return_exceptions=True,
        )
        return {
            self._primary.name: primary_ok is True,
            self._fallback.name: fallback_ok is True,
        }


# Singleton instance for the whole application
ai_router = AIRouter()
