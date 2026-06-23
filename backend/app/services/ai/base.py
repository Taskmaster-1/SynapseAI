from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class AIMessage:
    role: str  # "user" | "assistant" | "system"
    content: str


@dataclass
class AIResponse:
    content: str
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str = "stop"
    metadata: dict = field(default_factory=dict)


class BaseAIProvider(ABC):
    """Abstract interface every AI provider must implement."""

    name: str = "base"

    @abstractmethod
    async def chat(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AIResponse:
        """Single-turn or multi-turn completion."""
        ...

    @abstractmethod
    async def stream(
        self,
        messages: list[AIMessage],
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        """Streaming completion — yields text chunks."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Returns True if the provider is reachable."""
        ...
