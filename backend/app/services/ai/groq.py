from typing import AsyncIterator

from groq import AsyncGroq, RateLimitError, APIError

from app.core.config import settings
from app.core.exceptions import AIProviderException, AIRateLimitException
from app.services.ai.base import AIMessage, AIResponse, BaseAIProvider
from app.utils.logger import logger


class GroqProvider(BaseAIProvider):
    name = "groq"

    def __init__(self) -> None:
        self._client = AsyncGroq(api_key=settings.GROQ_API_KEY)

    def _format_messages(
        self,
        messages: list[AIMessage],
        system_prompt: str | None,
    ) -> list[dict]:
        formatted = []
        if system_prompt:
            formatted.append({"role": "system", "content": system_prompt})
        formatted.extend({"role": m.role, "content": m.content} for m in messages)
        return formatted

    async def chat(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AIResponse:
        try:
            response = await self._client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=self._format_messages(messages, system_prompt),
                temperature=temperature,
                max_tokens=max_tokens,
            )
            choice = response.choices[0]
            return AIResponse(
                content=choice.message.content or "",
                model=response.model,
                provider=self.name,
                input_tokens=response.usage.prompt_tokens,
                output_tokens=response.usage.completion_tokens,
                finish_reason=choice.finish_reason,
            )
        except RateLimitError:
            raise AIRateLimitException()
        except APIError as e:
            logger.error("Groq API error", error=str(e))
            raise AIProviderException(f"Groq error: {e.message}")

    async def stream(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        try:
            response = await self._client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=self._format_messages(messages, system_prompt),
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in response:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except RateLimitError:
            raise AIRateLimitException()
        except APIError as e:
            logger.error("Groq stream error", error=str(e))
            raise AIProviderException(str(e))

    async def health_check(self) -> bool:
        try:
            await self._client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            return True
        except Exception:
            return False
