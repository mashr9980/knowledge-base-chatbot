import asyncio
from ollama import AsyncClient
from app.config import settings

class LLMModel:
    def __init__(self):
        self.client = None
        self.model_name = settings.MODEL_NAME
        self.temperature = settings.TEMPERATURE
        self.top_p = settings.TOP_P
        self.max_tokens = 2048

    def get_client(self):
        if self.client is None:
            self.client = AsyncClient(
                host=settings.OLLAMA_BASE_URL
            )
        return self.client

    async def stream_chat(self, messages, callback=None):
        """Stream chat responses with callback for each token"""
        client = self.get_client()
        
        try:
            stream = await client.chat(
                model=self.model_name,
                messages=messages,
                stream=True,
                options={
                    'temperature': self.temperature,
                    'top_p': self.top_p,
                    'num_predict': self.max_tokens
                }
            )
            
            full_response = ""
            async for chunk in stream:
                if chunk and 'message' in chunk and 'content' in chunk['message']:
                    token = chunk['message']['content']
                    full_response += token
                    
                    if callback:
                        should_continue = await callback(token)
                        if should_continue is False:
                            # logger.info("Token streaming stopped by callback")
                            break
            
            return full_response
            
        except Exception as e:
            raise Exception(f"Error in Ollama streaming: {str(e)}")

    async def generate_response(self, messages):
        """Generate non-streaming response"""
        client = self.get_client()
        
        try:
            response = await client.chat(
                model=self.model_name,
                messages=messages,
                stream=False,
                options={
                    'temperature': self.temperature,
                    'top_p': self.top_p,
                    'num_predict': self.max_tokens
                }
            )
            
            return response['message']['content']
            
        except Exception as e:
            raise Exception(f"Error in Ollama generation: {str(e)}")

    def get_llm(self):
        """For backward compatibility with existing code"""
        return self