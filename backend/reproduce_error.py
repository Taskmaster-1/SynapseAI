import asyncio
from app.agents.chat_agent import ChatAgent
from unittest.mock import MagicMock

async def test_hi():
    db = MagicMock()
    # Mocking memory manager methods
    agent = ChatAgent(user_id="00000000-0000-0000-0000-000000000001", db=db)
    
    print("Testing 'hi' message...")
    try:
        async for chunk in agent.stream(session_id="sess-123", user_message="hi"):
            if isinstance(chunk, str):
                print(chunk, end="", flush=True)
            else:
                print(f"\nTurn complete: {chunk}")
    except Exception as e:
        print(f"\nCaught error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_hi())
