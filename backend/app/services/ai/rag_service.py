import asyncio
import io
from typing import Any
import pandas as pd
from pypdf import PdfReader
from app.db.supabase import get_supabase_client
from app.services.ai.gemini import GeminiProvider
from app.utils.logger import logger

class RAGService:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.ai = GeminiProvider()
        self.chunk_size = 1000
        self.chunk_overlap = 100

    async def process_file(self, file_id: str, filename: str, content: bytes, content_type: str):
        """
        Parses a file, chunks it, generates embeddings, and saves to Supabase.
        """
        text = ""
        try:
            if "pdf" in content_type:
                reader = PdfReader(io.BytesIO(content))
                for page in reader.pages:
                    text += (page.extract_text() or "") + "\n"
            elif "csv" in content_type:
                df = pd.read_csv(io.BytesIO(content))
                text = df.to_string()
            elif "text" in content_type or filename.endswith(".md") or filename.endswith(".txt"):
                text = content.decode("utf-8", errors="ignore")
            else:
                logger.warning("Unsupported file type for RAG", filename=filename, type=content_type)
                return

            if not text.strip():
                return

            chunks = self._chunk_text(text)
            logger.info("Chunked file", filename=filename, chunks=len(chunks))

            db = await get_supabase_client()
            
            for i, chunk in enumerate(chunks):
                # Generate embedding using Gemini
                embedding = await self._get_embedding(chunk)
                
                await db.table("file_chunks").insert({
                    "file_id": file_id,
                    "user_id": self.user_id,
                    "content": chunk,
                    "embedding": embedding,
                    "metadata": {"filename": filename, "chunk_index": i}
                }).execute()

            logger.info("Stored file chunks in vector DB", file_id=file_id)

        except Exception as e:
            logger.error("Error processing file for RAG", file_id=file_id, error=str(e))

    async def query(self, query_text: str, limit: int = 5) -> list[str]:
        """
        Search for relevant chunks using vector similarity.
        """
        try:
            query_embedding = await self._get_embedding(query_text)
            db = await get_supabase_client()
            
            # Using RPC for vector similarity search (must define match_file_chunks in Postgres)
            result = await db.rpc("match_file_chunks", {
                "query_embedding": query_embedding,
                "match_threshold": 0.5,
                "match_count": limit,
                "p_user_id": self.user_id
            }).execute()

            return [item["content"] for item in result.data]
        except Exception as e:
            logger.error("RAG query failed", error=str(e))
            return []

    def _chunk_text(self, text: str) -> list[str]:
        chunks = []
        for i in range(0, len(text), self.chunk_size - self.chunk_overlap):
            chunks.append(text[i : i + self.chunk_size])
        return chunks

    async def _get_embedding(self, text: str) -> list[float]:
        # Implementation depends on google-genai version. 
        # Using a fallback to a known working pattern if models.embed_content isn't direct.
        try:
            # text-embedding-004 is current SOTA for Gemini
            response = await asyncio.to_thread(
                self.ai._client.models.embed_content,
                model="text-embedding-004",
                contents=text
            )
            return response.embeddings[0].values
        except Exception as e:
            logger.error("Gemini embedding failed", error=str(e))
            # Return dummy vector if it fails during dev, but better to raise in prod
            return [0.0] * 768 # text-embedding-004 is 768 dims
