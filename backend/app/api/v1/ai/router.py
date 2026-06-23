from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.v1.ai.schemas import ChatRequest, ChatResponse, HealthResponse
from app.core.dependencies import CurrentUserDep, DBDep
from app.services.ai.base import AIMessage
from app.services.ai.router import ai_router

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, current_user: CurrentUserDep):
    """Single-turn or multi-turn AI chat completion."""
    messages = [AIMessage(role=m.role, content=m.content) for m in payload.messages]
    response = await ai_router.chat(
        messages,
        system_prompt=payload.system_prompt,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        force_provider=payload.provider,
    )
    return ChatResponse(
        content=response.content,
        model=response.model,
        provider=response.provider,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
    )


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, current_user: CurrentUserDep):
    """Server-Sent Events streaming chat response."""
    messages = [AIMessage(role=m.role, content=m.content) for m in payload.messages]

    async def generator():
        async for chunk in ai_router.stream(
            messages,
            system_prompt=payload.system_prompt,
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
            force_provider=payload.provider,
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generator(), media_type="text/event-stream")


@router.get("/health", response_model=HealthResponse)
async def ai_health():
    """Check availability of AI providers."""
    status = await ai_router.health_check()
    return HealthResponse(providers=status)
