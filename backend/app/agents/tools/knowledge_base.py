from typing import Any
from app.services.ai.rag_service import RAGService
from app.utils.logger import logger

KNOWLEDGE_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "search_my_knowledge_base",
        "description": "Search through your own uploaded documents and files (PDFs, CSVs, etc.) to find specific information or context.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant information in the documents."
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of relevant chunks to retrieve."
                }
            },
            "required": ["query"]
        }
    }
}

async def search_knowledge_base(user_id: str, query: str, limit: int = 5) -> str:
    """
    Tool implementation for RAG search.
    """
    logger.info("Agent searching knowledge base", user_id=user_id, query=query)
    rag = RAGService(user_id)
    results = await rag.query(query, limit=limit)
    
    if not results:
        return "No relevant information found in your documents."
    
    formatted = "\n\n---\n\n".join(results)
    return f"Relevant information found in your documents:\n\n{formatted}"
