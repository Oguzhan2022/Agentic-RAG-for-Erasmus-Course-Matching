"""
Shared LangChain LLM client for matching and verification.

Uses ChatGoogleGenerativeAI (LangChain wrapper around Gemini API).
Single model instance, single rate limiter, single retry loop, single JSON parser.
Ollama compatibility: no with_structured_output() — JSON parse is manual.
"""

import os
import re
import json
import time
from pathlib import Path
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

load_dotenv()

USE_OPENROUTER = os.getenv("USE_OPENROUTER", "false").lower() == "true"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_MODEL_NAME = os.getenv("OPENROUTER_MODEL_NAME", "google/gemini-2.5-flash")

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemma-4-31b-it")
RATE_LIMIT_SECONDS = 25

if USE_OPENROUTER:
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY not found in .env when USE_OPENROUTER is True")
else:
    if not API_KEY:
        raise ValueError("GEMINI_API_KEY not found in .env")

SAFETY_SETTINGS = {
    "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
    "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
    "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE",
}

GENERATION_CONFIG = {
    "temperature": 0.1,
    "max_output_tokens": 32768,
    "response_mime_type": "application/json",
}


class OpenRouterWrapper:
    """Wrapper to make ChatOpenAI behave like ChatGoogleGenerativeAI in our pipeline."""
    def __init__(self, model: ChatOpenAI, system_instruction: str = None):
        self.model = model
        self.system_instruction = system_instruction

    def invoke(self, input, config=None, **kwargs):
        if self.system_instruction:
            from langchain_core.messages import SystemMessage, HumanMessage
            if isinstance(input, str):
                input = [
                    SystemMessage(content=self.system_instruction),
                    HumanMessage(content=input)
                ]
            elif isinstance(input, list):
                if not any(isinstance(m, SystemMessage) for m in input):
                    input = [SystemMessage(content=self.system_instruction)] + list(input)
        return self.model.invoke(input, config=config, **kwargs)

    def __getattr__(self, name):
        return getattr(self.model, name)


class LLMClient:
    """Singleton LangChain LLM client shared by semantic_scoring and verifier."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._last_call_time: float = 0
        self._model: Optional[any] = None
        self._strict_model: Optional[any] = None

    def _get_model(self, strict: bool = False):
        """Lazily initialize and cache model instances."""
        if USE_OPENROUTER:
            if strict:
                if self._strict_model is None:
                    model_inst = ChatOpenAI(
                        model=OPENROUTER_MODEL_NAME,
                        openai_api_key=OPENROUTER_API_KEY,
                        openai_api_base="https://openrouter.ai/api/v1",
                        temperature=GENERATION_CONFIG["temperature"],
                        max_tokens=GENERATION_CONFIG["max_output_tokens"],
                        model_kwargs={"response_format": {"type": "json_object"}},
                        stop=["The user said", "Internal Monologue:", "Thought:"],
                    )
                    self._strict_model = OpenRouterWrapper(model_inst)
                return self._strict_model

            if self._model is None:
                model_inst = ChatOpenAI(
                    model=OPENROUTER_MODEL_NAME,
                    openai_api_key=OPENROUTER_API_KEY,
                    openai_api_base="https://openrouter.ai/api/v1",
                    temperature=GENERATION_CONFIG["temperature"],
                    max_tokens=GENERATION_CONFIG["max_output_tokens"],
                    model_kwargs={"response_format": {"type": "json_object"}},
                )
                self._model = OpenRouterWrapper(model_inst)
            return self._model

        if strict:
            if self._strict_model is None:
                self._strict_model = ChatGoogleGenerativeAI(
                    model=MODEL_NAME,
                    google_api_key=API_KEY,
                    temperature=GENERATION_CONFIG["temperature"],
                    max_output_tokens=GENERATION_CONFIG["max_output_tokens"],
                    response_mime_type=GENERATION_CONFIG["response_mime_type"],
                    safety_settings=SAFETY_SETTINGS,
                    stop=["The user said", "Internal Monologue:", "Thought:"],
                )
            return self._strict_model

        if self._model is None:
            self._model = ChatGoogleGenerativeAI(
                model=MODEL_NAME,
                google_api_key=API_KEY,
                temperature=GENERATION_CONFIG["temperature"],
                max_output_tokens=GENERATION_CONFIG["max_output_tokens"],
                response_mime_type=GENERATION_CONFIG["response_mime_type"],
                safety_settings=SAFETY_SETTINGS,
            )
        return self._model

    def _rate_limit(self):
        """Enforce rate limiting between API calls (shared across match + verify)."""
        now = time.time()
        elapsed = now - self._last_call_time
        if elapsed < RATE_LIMIT_SECONDS:
            time.sleep(RATE_LIMIT_SECONDS - elapsed)
        self._last_call_time = time.time()

    def extract_json(self, text: str, required_key: str = None) -> Optional[dict]:
        """Stack-based JSON scanner — finds the object containing required_key.

        Handles both "candidates" (matching) and "verifications" (verification).
        Auto-wraps raw lists when the model returns them directly.
        """
        if not text or not text.strip():
            return None

        potential_objects = []
        depth = 0
        start_idx = -1
        opening_char = None

        for i, char in enumerate(text):
            if char in ('{', '['):
                if depth == 0:
                    start_idx = i
                    opening_char = char
                depth += 1
            elif char in ('}', ']'):
                if depth > 0:
                    depth -= 1
                    if depth == 0 and start_idx != -1:
                        is_match = (opening_char == '{' and char == '}') or \
                                   (opening_char == '[' and char == ']')
                        if is_match:
                            obj_str = text[start_idx:i + 1]
                            try:
                                obj = json.loads(obj_str)
                                # Handle raw list returns
                                if isinstance(obj, list):
                                    if obj and isinstance(obj[0], dict):
                                        first = obj[0]
                                        if "candidate_index" in first or "domain_score" in first:
                                            return {"academic_category": "technical", "candidates": obj}
                                        if "decision" in first or "candidate_index" in first:
                                            return {"verifications": obj}
                                        # Check for verifications list without decision
                                        if any(k in first for k in ("is_recommended", "confidence", "reason")):
                                            return {"verifications": obj}

                                if required_key:
                                    if isinstance(obj, dict) and required_key in obj:
                                        return obj

                                potential_objects.append(obj)
                            except Exception:
                                pass
                        start_idx = -1
                        opening_char = None

        if potential_objects:
            dicts = [o for o in potential_objects if isinstance(o, dict)]
            if dicts:
                return max(dicts, key=lambda x: len(str(x)))
            return max(potential_objects, key=lambda x: len(str(x)))

        # Markdown code-block fallback
        try:
            cleaned = text.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r'^```[a-z]*\n?', '', cleaned)
                cleaned = re.sub(r'\n?```$', '', cleaned.strip())
            return json.loads(cleaned)
        except Exception:
            pass

        return None

    def _log_failed_response(self, context: str, response_text: str):
        log_dir = Path("logs")
        log_dir.mkdir(exist_ok=True)
        log_file = log_dir / "failed_responses.log"

        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"\n{'=' * 80}\n")
            f.write(f"TIMESTAMP: {timestamp}\n")
            f.write(f"CONTEXT: {context}\n")
            f.write(f"{'-' * 40} RAW RESPONSE {'-' * 40}\n")
            f.write(response_text)
            f.write(f"\n{'=' * 80}\n")
        print(f"[{context}] Failed to parse JSON. Full response logged to logs/failed_responses.log", flush=True)

    def invoke_with_retry(
        self,
        prompt: str,
        expected_key: str = None,
        max_retries: int = 10,
        context: str = "LLMClient",
    ) -> Optional[str]:
        """Send prompt via ChatGoogleGenerativeAI with retry and validation.

        Retries on: empty response, JSON parse failure, quota/429, network errors.
        Switches to strict model on retry 2+ (suppresses chain-of-thought).
        """
        retries = 0

        while retries < max_retries:
            try:
                self._rate_limit()

                is_strict = (retries >= 1)
                model = self._get_model(strict=is_strict)

                if is_strict:
                    print(f"[{context}] Switch to strict fallback (retry {retries}/{max_retries})", flush=True)

                response = model.invoke(prompt)
                full_text = response.text if hasattr(response, "text") and response.text else str(response.content)

                if not full_text or not full_text.strip():
                    retries += 1
                    print(f"[{context}] Empty response, retry {retries}/{max_retries}", flush=True)
                    continue

                if expected_key:
                    extracted = self.extract_json(full_text, expected_key)
                    if extracted is None:
                        retries += 1
                        print(f"[{context}] JSON parse failed, retry {retries}/{max_retries}", flush=True)
                        continue

                return full_text

            except Exception as e:
                retries += 1
                error_msg = str(e).lower()
                if "quota" in error_msg or "429" in error_msg or "resource" in error_msg:
                    wait = 30 * retries
                    print(f"[{context}] Rate limited, waiting {wait}s (retry {retries}/{max_retries})", flush=True)
                    time.sleep(wait)
                elif "500" in error_msg or "internal" in error_msg or "503" in error_msg or "unavailable" in error_msg:
                    wait = min(10 * (2 ** min(retries, 5)), 120)
                    print(f"[{context}] Server error (500/503), waiting {wait}s (retry {retries}/{max_retries})", flush=True)
                    time.sleep(wait)
                else:
                    print(f"[{context}] API error: {e} (retry {retries}/{max_retries})", flush=True)
                    time.sleep(5)

        return None


llm_client = LLMClient()
