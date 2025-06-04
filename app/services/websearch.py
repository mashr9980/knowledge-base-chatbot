# import httpx
# import json
# import re
# from typing import Tuple
# import logging

# logger = logging.getLogger(__name__)

# class DirectSearchService:
#     """Service for handling web search operations using OpenAI API"""
    
#     def __init__(self, api_key: str):
#         self.api_key = api_key
#         self.base_url = "https://api.openai.com/v1"
#         self.headers = {
#             "Content-Type": "application/json",
#             "Authorization": f"Bearer {api_key}"
#         }
    
#     async def search(
#         self, 
#         query: str, 
#         model: str = "gpt-4o", 
#         timeout: float = 30.0
#     ) -> Tuple[bool, str]:
#         """Perform a direct search for the given query"""
#         try:
#             enhanced_query = self._enhance_financial_query(query)
            
#             data = {
#                 "model": model,
#                 "messages": [
#                     {
#                         "role": "system", 
#                         "content": (
#                             "You are a financial expert assistant with the most current knowledge about financial regulations, "
#                             "contribution limits, tax rates, and financial planning information up to April 2025.\n\n"
                            
#                             "When answering questions about financial topics:\n"
#                             "1. Provide the most specific, current information available for 2025\n"
#                             "2. Include exact numbers, percentages, dates, and thresholds\n"
#                             "3. Be precise about contribution limits, tax brackets, and financial deadlines\n"
#                             "4. Specify the applicable tax year in your answer\n"
#                             "5. If the information would typically be found on official websites like IRS.gov, mention this fact\n\n"
                            
#                             "For example, if asked about Roth IRA limits, include the specific contribution limit for 2025, "
#                             "any catch-up provisions, and income phaseout ranges."
#                         )
#                     },
#                     {"role": "user", "content": enhanced_query}
#                 ],
#                 "temperature": 0.1,
#                 "max_tokens": 1024
#             }
            
#             async with httpx.AsyncClient(timeout=timeout) as client:
#                 logger.info(f"Sending direct search request: {enhanced_query}")
#                 response = await client.post(
#                     f"{self.base_url}/chat/completions",
#                     headers=self.headers,
#                     json=data
#                 )
            
#             if response.status_code != 200:
#                 logger.error(f"API error: {response.status_code}, {response.text}")
#                 return False, f"(API error: {response.status_code})"
            
#             result = response.json()
            
#             if "choices" in result and len(result["choices"]) > 0:
#                 message = result["choices"][0].get("message", {})
#                 content = message.get("content", "")
                
#                 if content:
#                     return True, content
#                 else:
#                     logger.warning("Search returned empty content")
#                     return False, "(No results available)"
#             else:
#                 logger.warning("Unexpected API response structure")
#                 return False, "(Unexpected response from API)"
            
#         except httpx.RequestError as e:
#             logger.error(f"HTTP request error during search: {str(e)}")
#             return False, "(Network error during search)"
#         except json.JSONDecodeError as e:
#             logger.error(f"JSON parse error during search: {str(e)}")
#             return False, "(Error parsing search results)"
#         except Exception as e:
#             logger.error(f"Unexpected error during search: {str(e)}")
#             return False, f"(An error occurred during search: {str(e)})"
    
#     def _enhance_financial_query(self, query: str) -> str:
#         """Enhance the query to focus on financial information"""
#         if re.search(r'(in|for|limit|as of) (202[0-9]|the current year)', query, re.IGNORECASE):
#             base_query = query
#         else:
#             current_year_terms = ["current", "latest", "now", "today"]
#             if any(term in query.lower() for term in current_year_terms) or "2025" not in query:
#                 base_query = f"{query} for 2025"
#             else:
#                 base_query = query
        
#         enhanced_query = (
#             f"Provide accurate and current information about {base_query}. "
#             f"Include specific numbers, dates, limits, thresholds, and percentages "
#             f"for the 2025 tax year. Make sure to be precise about any financial limits or regulations."
#         )
        
#         return enhanced_query