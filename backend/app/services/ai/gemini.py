import asyncio
from typing import AsyncIterator

from google import genai
from google.genai import types

from app.core.config import settings
from app.core.exceptions import AIProviderException, AIRateLimitException
from app.services.ai.base import AIMessage, AIResponse, BaseAIProvider
from app.utils.logger import logger


class GeminiProvider(BaseAIProvider):
    name = "gemini"

    def __init__(self) -> None:
        self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
        self._model = settings.GEMINI_MODEL

    def _build_history(self, messages: list[AIMessage]) -> list[types.Content]:
        """Convert our AIMessage list to Gemini's content format."""
        role_map = {"user": "user", "assistant": "model"}
        contents = []
        for m in messages:
            contents.append(types.Content(role=role_map.get(m.role, "user"), parts=[types.Part.from_text(m.content)]))
        return contents

    async def chat(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AIResponse:
        try:
            config = types.GenerateContentConfig(
                temperature=temperature,
                maxOutputTokens=max_tokens,
                systemInstruction=system_prompt,
            )
            contents = self._build_history(messages)

            response = await asyncio.to_thread(
                self._client.models.generate_content,
                model=self._model,
                contents=contents,
                config=config,
            )

            # Access metadata mapping if present
            in_tokens = 0
            out_tokens = 0
            if response.usage_metadata:
                in_tokens = response.usage_metadata.prompt_token_count
                out_tokens = response.usage_metadata.candidates_token_count

            return AIResponse(
                content=response.text,
                model=self._model,
                provider=self.name,
                input_tokens=in_tokens,
                output_tokens=out_tokens,
            )
        except Exception as e:
            # Note: We catch generic Exception because specific exception types
            # have changed in google-genai
            error_str = str(e)
            if "ResourceExhausted" in error_str or "429" in error_str:
                raise AIRateLimitException()
            logger.error("Gemini API error", error=error_str)
            raise AIProviderException(f"Gemini error: {error_str}")

    async def stream(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        try:
            config = types.GenerateContentConfig(
                temperature=temperature,
                maxOutputTokens=max_tokens,
                systemInstruction=system_prompt,
            )
            contents = self._build_history(messages)

            def _stream():
                return self._client.models.generate_content_stream(
                    model=self._model,
                    contents=contents,
                    config=config,
                )

            response_stream = await asyncio.to_thread(_stream)
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            error_str = str(e)
            if "ResourceExhausted" in error_str or "429" in error_str:
                raise AIRateLimitException()
            logger.error("Gemini stream error", error=error_str)
            raise AIProviderException(error_str)

    async def health_check(self) -> bool:
        try:
            await asyncio.to_thread(
                self._client.models.generate_content,
                model=self._model,
                contents="ping",
            )
            return True
        except Exception:
            return False
