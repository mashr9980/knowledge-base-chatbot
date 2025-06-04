from langchain_openai import ChatOpenAI
from app.config import settings

class LLMModel:
    def __init__(self):
        self.llm = None
        self.max_len = 2048  

    def load_model(self):
        self.llm = ChatOpenAI(
            model_name=settings.MODEL_NAME,
            temperature=settings.TEMPERATURE,
            openai_api_key=settings.OPENAI_API_KEY,
            max_tokens=self.max_len,
            streaming=True
        )
        return self.llm

    def get_llm(self):
        if self.llm is None:
            self.load_model()
        return self.llm