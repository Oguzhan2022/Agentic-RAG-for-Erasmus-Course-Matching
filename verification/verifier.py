"""
Batch Verifier — LLM-powered course match verification via LangChain.

Verifies top-3 candidate matches for a partner course using a single LLM call.
Also supports single-pair verification for coordinator manual review.
"""

import os
import json
from pathlib import Path
from typing import List, Dict, Any

from db.models import Course
from matching.llm_client import llm_client
from matching.prompt_loader import load_prompt
from dotenv import load_dotenv

load_dotenv()

PROMPT_PATH = Path(__file__).parent.parent / "matching" / "prompts" / "verification_prompt_v2.txt"
SINGLE_PROMPT_PATH = Path(__file__).parent.parent / "matching" / "prompts" / "verification_single_prompt_v1.txt"


class BatchVerifier:
    """Verifies course matches using the shared LLM client."""

    def __init__(self):
        self._prompt_template = self._load_prompt(PROMPT_PATH)
        self._single_prompt_template = self._load_prompt(SINGLE_PROMPT_PATH)

    @staticmethod
    def _load_prompt(path: Path) -> str:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def verify_matches(self, partner_course: Course, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Verify top-3 candidates for a partner course (single LLM call)."""
        prompt = self._prompt_template

        # Partner data
        prompt = prompt.replace("{partner_name}", partner_course.course_name)
        prompt = prompt.replace("{partner_department}", (partner_course.academic_context or {}).get("department") or "unknown")
        prompt = prompt.replace("{partner_level}", (partner_course.academic_context or {}).get("level") or "unknown")
        prompt = prompt.replace("{partner_ects}", str(partner_course.ects or "unknown"))
        prompt = prompt.replace("{academic_category}", candidates[0].get("category", "technical") if candidates else "technical")
        prompt = prompt.replace("{partner_content}", (partner_course.content or "unknown"))
        prompt = prompt.replace("{partner_outcomes}", (partner_course.learning_outcomes or "unknown"))
        prompt = prompt.replace("{partner_academic_context}", json.dumps(partner_course.academic_context or {}))

        for i in range(1, 4):
            if i <= len(candidates):
                c = candidates[i - 1]
                hc = c["home_course"]
                prompt = prompt.replace(f"{{home{i}_name}}", hc.course_name)
                prompt = prompt.replace(f"{{home{i}_department}}", (hc.academic_context or {}).get("department") or "unknown")
                prompt = prompt.replace(f"{{home{i}_level}}", (hc.academic_context or {}).get("level") or "unknown")
                prompt = prompt.replace(f"{{home{i}_ects}}", str(hc.ects or "unknown"))
                prompt = prompt.replace(f"{{home{i}_content}}", (hc.content or "unknown"))
                prompt = prompt.replace(f"{{home{i}_outcomes}}", (hc.learning_outcomes or "unknown"))
                prompt = prompt.replace(f"{{home{i}_academic_context}}", json.dumps(hc.academic_context or {}))
                prompt = prompt.replace(f"{{score{i}_core_home_topics}}", json.dumps(c.get("core_home_topics", [])))
                prompt = prompt.replace(f"{{score{i}_breakdown}}", json.dumps(c.get("score_breakdown", {}), indent=2))
                prompt = prompt.replace(f"{{score{i}_matched}}", json.dumps(c.get("matched_topics", [])))
                prompt = prompt.replace(f"{{score{i}_missing}}", json.dumps(c.get("missing_topics", [])))
                prompt = prompt.replace(f"{{score{i}_extra_partner}}", json.dumps(c.get("extra_partner_topics", [])))
                prompt = prompt.replace(f"{{score{i}_warnings}}", json.dumps(c.get("warnings", [])))
                prompt = prompt.replace(f"{{score{i}_structural_notes}}", json.dumps(c.get("structural_notes", [])))
            else:
                for field in [f"home{i}_name", f"home{i}_department", f"home{i}_level", f"home{i}_ects",
                              f"home{i}_content", f"home{i}_outcomes"]:
                    prompt = prompt.replace(f"{{{field}}}", "N/A")
                prompt = prompt.replace(f"{{home{i}_academic_context}}", "{}")
                for field in ["core_home_topics", "breakdown", "matched", "missing", "extra_partner", "warnings", "structural_notes"]:
                    prompt = prompt.replace(f"{{score{i}_{field}}}", "[]" if field != "breakdown" else "{}")

        response_text = llm_client.invoke_with_retry(prompt, expected_key="verifications", context="Verifier")
        if response_text is None:
            return {"verifications": self._default_verifications(len(candidates), "LLM call failed after multiple retries", "llm_failure")}

        result = llm_client.extract_json(response_text, required_key="verifications")
        if result is None or "verifications" not in result:
            llm_client._log_failed_response("Verifier", response_text)
            return {"verifications": self._default_verifications(len(candidates), "Failed to parse LLM response JSON", "json_parse_error")}

        return result

    def verify_single_pair(self, partner_course: Course, home_course: Course, match_result: dict) -> dict:
        """Verify a single partner-home pair (v2-derived single-pair prompt).

        match_result: dict from semantic_match_single_pair() with scores, topics, evidence.
        Returns a flat dict: decision, confidence, is_recommended, content_overlap_assessment,
        core_topic_coverage, risk_flags, reason.
        """
        prompt = self._single_prompt_template

        prompt = prompt.replace("{partner_name}", partner_course.course_name or "Unknown")
        prompt = prompt.replace("{partner_department}", (partner_course.academic_context or {}).get("department") or "unknown")
        prompt = prompt.replace("{partner_level}", (partner_course.academic_context or {}).get("level") or "unknown")
        prompt = prompt.replace("{partner_ects}", str(partner_course.ects or "unknown"))
        prompt = prompt.replace("{academic_category}", match_result.get("academic_category", "technical"))
        prompt = prompt.replace("{partner_content}", partner_course.content or "unknown")
        prompt = prompt.replace("{partner_outcomes}", partner_course.learning_outcomes or "unknown")
        prompt = prompt.replace("{partner_academic_context}", json.dumps(partner_course.academic_context or {}))

        prompt = prompt.replace("{home1_name}", home_course.course_name or "Unknown")
        prompt = prompt.replace("{home1_department}", (home_course.academic_context or {}).get("department") or "unknown")
        prompt = prompt.replace("{home1_level}", (home_course.academic_context or {}).get("level") or "unknown")
        prompt = prompt.replace("{home1_ects}", str(home_course.ects or "unknown"))
        prompt = prompt.replace("{home1_content}", home_course.content or "unknown")
        prompt = prompt.replace("{home1_outcomes}", home_course.learning_outcomes or "unknown")
        prompt = prompt.replace("{home1_academic_context}", json.dumps(home_course.academic_context or {}))

        prompt = prompt.replace("{score1_core_home_topics}", json.dumps(match_result.get("core_home_topics", [])))
        prompt = prompt.replace("{score1_breakdown}", json.dumps(match_result.get("score_breakdown", {}), indent=2))
        prompt = prompt.replace("{score1_matched}", json.dumps(match_result.get("matched_topics", [])))
        prompt = prompt.replace("{score1_missing}", json.dumps(match_result.get("missing_topics", [])))
        prompt = prompt.replace("{score1_extra_partner}", json.dumps(match_result.get("extra_partner_topics", [])))
        prompt = prompt.replace("{score1_warnings}", json.dumps(match_result.get("warnings", [])))
        prompt = prompt.replace("{score1_structural_notes}", json.dumps(match_result.get("structural_notes", [])))

        print(f"[Verifier-Single] partner='{partner_course.course_name}' home='{home_course.course_name}'", flush=True)

        response_text = llm_client.invoke_with_retry(prompt, expected_key="verifications", context="Verifier-Single")
        _default = {
            "decision": "risk_flagged", "confidence": 0.0, "is_recommended": False,
            "content_overlap_assessment": "partial", "core_topic_coverage": "weak",
            "risk_flags": ["llm_failure"], "reason": "LLM verification call failed after multiple retries",
        }
        if response_text is None:
            return _default

        result = llm_client.extract_json(response_text, required_key="verifications")
        if result is None or not result.get("verifications"):
            llm_client._log_failed_response("Verifier-Single", response_text)
            _default["risk_flags"] = ["json_parse_error"]
            _default["reason"] = "Failed to parse LLM verification response"
            return _default

        v = result["verifications"][0]
        v.setdefault("decision", "risk_flagged")
        v.setdefault("confidence", 0.0)
        v.setdefault("is_recommended", False)
        v.setdefault("content_overlap_assessment", "partial")
        v.setdefault("core_topic_coverage", "weak")
        v.setdefault("risk_flags", [])
        v.setdefault("reason", "")
        return v

    @staticmethod
    def _default_verifications(count: int, reason: str, flag: str) -> list:
        return [
            {
                "candidate_index": i + 1,
                "decision": "risk_flagged",
                "confidence": 0,
                "is_recommended": False,
                "reason": reason,
                "content_overlap_assessment": "partial",
                "core_topic_coverage": "weak",
                "risk_flags": [flag],
            }
            for i in range(count)
        ]


verifier = BatchVerifier()
