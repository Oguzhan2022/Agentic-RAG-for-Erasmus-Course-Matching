"""
LangChain LLM client for course parsing and OCR.

Based on matching/llm_client.py pattern. No fallback model —
content block / JSON parse failures retry with strict mode.
"""

import os
import re
import json
import time
import base64
from pathlib import Path
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from dotenv import load_dotenv

load_dotenv()

USE_OPENROUTER = os.getenv("USE_OPENROUTER", "false").lower() == "true"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_MODEL_NAME = os.getenv("OPENROUTER_MODEL_NAME", "google/gemini-2.5-flash")

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_PARSING_MODEL_NAME", "gemma-4-31b-it")

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

STRICT_INSTRUCTION = (
    "You are a helpful assistant. Provide direct, immediate answers. "
    "Do NOT write internal monologue, chain-of-thought, or thinking blocks. "
    "Just output the final answer directly."
)

STOP_SEQUENCES = ["The user said", "Internal Monologue:", "Thought:"]


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


class ParsingLLMClient:
    """Singleton LangChain LLM client for parsing and OCR.

    Two model instances cached:
      - _model  — normal (allows chain-of-thought)
      - _strict_model — suppresses thinking via system_instruction + stop

    No fallback model. Failures retry with strict mode.
    """

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
        """Lazy-init and cache model instances."""
        if USE_OPENROUTER:
            if strict:
                if self._strict_model is None:
                    model_inst = ChatOpenAI(
                        model=OPENROUTER_MODEL_NAME,
                        openai_api_key=OPENROUTER_API_KEY,
                        openai_api_base="https://openrouter.ai/api/v1",
                        temperature=0.1,
                        max_tokens=32768,
                        stop=STOP_SEQUENCES,
                        timeout=1800,
                    )
                    self._strict_model = OpenRouterWrapper(model_inst, STRICT_INSTRUCTION)
                return self._strict_model

            if self._model is None:
                model_inst = ChatOpenAI(
                    model=OPENROUTER_MODEL_NAME,
                    openai_api_key=OPENROUTER_API_KEY,
                    openai_api_base="https://openrouter.ai/api/v1",
                    temperature=0.1,
                    max_tokens=32768,
                    stop=STOP_SEQUENCES,
                    timeout=1800,
                )
                self._model = OpenRouterWrapper(model_inst)
            return self._model

        if strict:
            if self._strict_model is None:
                self._strict_model = ChatGoogleGenerativeAI(
                    model=MODEL_NAME,
                    google_api_key=API_KEY,
                    temperature=0.1,
                    max_output_tokens=32768,
                    safety_settings=SAFETY_SETTINGS,
                    stop=STOP_SEQUENCES,
                    timeout=1800,
                    model_kwargs={"system_instruction": STRICT_INSTRUCTION},
                )
            return self._strict_model

        if self._model is None:
            self._model = ChatGoogleGenerativeAI(
                model=MODEL_NAME,
                google_api_key=API_KEY,
                temperature=0.1,
                max_output_tokens=32768,
                safety_settings=SAFETY_SETTINGS,
                stop=STOP_SEQUENCES,
                timeout=1800,
            )
        return self._model

    def _rate_limit(self, min_interval: float = 25):
        """Enforce minimum interval between API calls."""
        now = time.time()
        elapsed = now - self._last_call_time
        wait = max(0, min_interval - elapsed)
        if wait > 0:
            time.sleep(wait)
        self._last_call_time = time.time()

    # ── JSON utilities (from parser.py) ──────────────────────────────────────

    @staticmethod
    def _strip_thinking(text: str) -> str:
        """Remove <think>...</think> blocks from model output."""
        return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    @staticmethod
    def sanitize_json(s: str) -> str:
        """Remove problematic control characters and fix invalid escapes."""
        s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
        s = s.replace("\\'", "'")
        return s

    @staticmethod
    def repair_json(s: str) -> str:
        """Attempt to fix common JSON issues from LLM output."""
        s = re.sub(r',\s*([}\]])', r'\1', s)
        if '"' not in s and "'" in s:
            s = s.replace("'", '"')
        s = re.sub(r'(?<=[{,\s])(\w+)\s*:', r'"\1":', s)
        s = re.sub(r'//.*?$', '', s, flags=re.MULTILINE)
        open_braces = s.count('{') - s.count('}')
        open_brackets = s.count('[') - s.count(']')
        s += '}' * max(0, open_braces)
        s += ']' * max(0, open_brackets)
        return s

    def extract_json(self, text: str, required_key: str = None) -> Optional[dict]:
        """Stack-based JSON scanner — finds the object containing required_key.

        Handles raw list returns, markdown code blocks, and thinking blocks.
        """
        if not text or not text.strip():
            return None

        text = self._strip_thinking(text)

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
                                if isinstance(obj, list):
                                    if obj and isinstance(obj[0], dict):
                                        first = obj[0]
                                        if "candidate_index" in first or "domain_score" in first:
                                            return {"academic_category": "technical", "candidates": obj}
                                        if "decision" in first or "course_name" in first:
                                            return {"verifications": obj} if "decision" in first else obj
                                        if any(k in first for k in ("is_recommended", "confidence", "reason")):
                                            return {"verifications": obj}
                                    return obj

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
        log_file = log_dir / "failed_responses_parsing.log"

        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"\n{'=' * 80}\n")
            f.write(f"TIMESTAMP: {timestamp}\n")
            f.write(f"CONTEXT: {context}\n")
            f.write(f"{'-' * 40} RAW RESPONSE {'-' * 40}\n")
            f.write(response_text)
            f.write(f"\n{'=' * 80}\n")
        print(f"[ParsingLLM-{context}] Failed response logged to logs/failed_responses_parsing.log", flush=True)

    # ── Public API ───────────────────────────────────────────────────────────

    def invoke_with_retry(
        self,
        prompt: str,
        min_interval: float = 25,
        max_retries: int = 100,
        start_strict: bool = True,
        expect_json: bool = True,
        final_hint: str = None,
        context: str = "Parser",
    ) -> Optional[str]:
        """Send a text prompt with retry and rate limiting.

        Args:
            prompt: The prompt to send.
            min_interval: Minimum seconds between API calls (10 OCR, 25 extraction).
            max_retries: Maximum retry attempts.
            start_strict: If True, use strict model from the first attempt.
            expect_json: If True, validate via extract_json and retry on failure.
            final_hint: Extra instruction appended on the final retry attempt.
            context: Label for log output.

        Returns:
            Raw response text, or None if all retries exhausted.
        """
        retries = 0

        while retries < max_retries:
            try:
                self._rate_limit(min_interval)

                is_strict = start_strict or retries >= 1
                model = self._get_model(strict=is_strict)

                if retries >= 1 and not start_strict:
                    print(f"[ParsingLLM-{context}] Switch to strict mode (retry {retries}/{max_retries})", flush=True)

                current_prompt = prompt
                if final_hint and retries == max_retries - 1:
                    current_prompt = prompt + "\n\n" + final_hint

                response = model.invoke(current_prompt)
                full_text = response.text if hasattr(response, "text") and response.text else str(response.content)

                if not full_text or not full_text.strip():
                    retries += 1
                    print(f"[ParsingLLM-{context}] Empty/blocked response, retry {retries}/{max_retries}", flush=True)
                    continue

                if expect_json:
                    extracted = self.extract_json(full_text)
                    if extracted is None:
                        retries += 1
                        print(f"[ParsingLLM-{context}] JSON parse failed, retry {retries}/{max_retries}", flush=True)
                        continue

                return full_text

            except Exception as e:
                retries += 1
                error_msg = str(e).lower()
                if "quota" in error_msg or "429" in error_msg or "resource" in error_msg:
                    wait = 30 * retries
                    print(f"[ParsingLLM-{context}] Rate limited, waiting {wait}s (retry {retries}/{max_retries})", flush=True)
                    time.sleep(wait)
                elif "500" in error_msg or "internal" in error_msg or "503" in error_msg or "unavailable" in error_msg:
                    wait = min(10 * (2 ** min(retries, 5)), 120)
                    print(f"[ParsingLLM-{context}] Server error (500/503), waiting {wait}s (retry {retries}/{max_retries})", flush=True)
                    time.sleep(wait)
                else:
                    print(f"[ParsingLLM-{context}] API error: {e} (retry {retries}/{max_retries})", flush=True)
                    time.sleep(5)

        return None

    def invoke_multimodal(
        self,
        image_bytes: bytes,
        prompt: str,
        min_interval: float = 10,
        max_retries: int = 20,
        context: str = "OCR",
    ) -> str:
        """Send an image + text prompt for OCR via LangChain multimodal.

        No JSON parsing — returns raw text directly.

        Args:
            image_bytes: PNG image bytes of the page.
            prompt: Text instruction for the model.
            min_interval: Minimum seconds between API calls.
            max_retries: Maximum retry attempts.
            context: Label for log output.

        Returns:
            Extracted text, or empty string if all retries exhausted.
        """
        retries = 0
        b64 = base64.b64encode(image_bytes).decode()

        while retries < max_retries:
            try:
                self._rate_limit(min_interval)

                is_strict = retries >= 1
                model = self._get_model(strict=is_strict)

                if retries >= 1:
                    print(f"[ParsingLLM-{context}] Retry {retries}/{max_retries} (strict={is_strict})", flush=True)

                msg = HumanMessage(content=[
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ])
                response = model.invoke([msg])
                full_text = response.text if hasattr(response, "text") and response.text else str(response.content)

                if not full_text or not full_text.strip():
                    retries += 1
                    print(f"[ParsingLLM-{context}] Empty/blocked response, retry {retries}/{max_retries}", flush=True)
                    continue

                return full_text

            except Exception as e:
                retries += 1
                error_msg = str(e).lower()
                if "quota" in error_msg or "429" in error_msg or "resource" in error_msg:
                    wait = 30 * retries
                    print(f"[ParsingLLM-{context}] Rate limited, waiting {wait}s (retry {retries}/{max_retries})", flush=True)
                    time.sleep(wait)
                elif "500" in error_msg or "internal" in error_msg or "503" in error_msg or "unavailable" in error_msg:
                    wait = min(10 * (2 ** min(retries, 5)), 120)
                    print(f"[ParsingLLM-{context}] Server error (500/503), waiting {wait}s (retry {retries}/{max_retries})", flush=True)
                    time.sleep(wait)
                else:
                    print(f"[ParsingLLM-{context}] API error: {e} (retry {retries}/{max_retries})", flush=True)
                    time.sleep(5)

        return ""


parsing_llm_client = ParsingLLMClient()
