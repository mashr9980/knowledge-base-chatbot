# import os
# import chromadb
# import numpy as np
# from typing import List, Dict, Optional
# from sentence_transformers import SentenceTransformer
# from app.config import settings

# class VectorStore:
#     def __init__(self):
#         self.client = chromadb.PersistentClient(path="./chroma_db")
#         self.collection = self.client.get_or_create_collection(
#             name="knowledge_base",
#             metadata={"hnsw:space": "cosine"}
#         )
#         self.model = SentenceTransformer('all-MiniLM-L6-v2')
    
#     def generate_embedding(self, text: str) -> Optional[np.ndarray]:
#         """Generate embedding for text."""
#         try:
#             embedding = self.model.encode(text, convert_to_numpy=True)
#             return embedding
#         except Exception as e:
#             print(f"Error generating embedding: {str(e)}")
#             return None
    
#     def add_documents(self, documents: List[Dict]) -> bool:
#         """Add documents to vector store."""
#         try:
#             texts = [doc["text"] for doc in documents]
#             embeddings = [self.generate_embedding(text) for text in texts]
#             ids = [doc["id"] for doc in documents]
#             metadatas = [{"document_id": doc["document_id"]} for doc in documents]
            
#             # Filter out None embeddings
#             valid_data = [
#                 (id_, text, emb.tolist(), meta) 
#                 for id_, text, emb, meta in zip(ids, texts, embeddings, metadatas)
#                 if emb is not None
#             ]
            
#             if valid_data:
#                 ids, texts, embeddings, metadatas = zip(*valid_data)
#                 self.collection.add(
#                     embeddings=list(embeddings),
#                     documents=list(texts),
#                     metadatas=list(metadatas),
#                     ids=list(ids)
#                 )
            
#             return True
#         except Exception as e:
#             print(f"Error adding documents to vector store: {str(e)}")
#             return False
    
#     def search(self, query: str, n_results: int = 5) -> List[Dict]:
#         """Search for similar documents."""
#         try:
#             query_embedding = self.generate_embedding(query)
#             if query_embedding is None:
#                 return []
            
#             results = self.collection.query(
#                 query_embeddings=[query_embedding.tolist()],
#                 n_results=n_results
#             )
            
#             formatted_results = []
#             if results["documents"] and results["documents"][0]:
#                 for i, doc in enumerate(results["documents"][0]):
#                     formatted_results.append({
#                         "text": doc,
#                         "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
#                         "distance": results["distances"][0][i] if results["distances"] else 0
#                     })
            
#             return formatted_results
#         except Exception as e:
#             print(f"Error searching vector store: {str(e)}")
#             return []
    
#     def clear_collection(self):
#         """Clear all documents from the collection."""
#         try:
#             self.client.delete_collection("knowledge_base")
#             self.collection = self.client.get_or_create_collection(
#                 name="knowledge_base",
#                 metadata={"hnsw:space": "cosine"}
#             )
#         except Exception as e:
#             print(f"Error clearing collection: {str(e)}")