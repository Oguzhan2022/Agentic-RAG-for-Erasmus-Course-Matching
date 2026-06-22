"""
JSON response schemas — kept for reference only.
Runtime structured output uses manual JSON parsing via matching/llm_client.py
(ollama compatibility — no with_structured_output()).
"""

BATCH_MATCH_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "academic_category": {
            "type": "STRING",
            "enum": [
                "technical", "social_science", "arts_design", "health",
                "natural_science", "business", "humanities", "interdisciplinary",
            ],
        },
        "candidates": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "candidate_index": {"type": "INTEGER"},
                    "core_home_topics": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "domain_score": {"type": "INTEGER"},
                    "content_score": {"type": "INTEGER"},
                    "outcomes_score": {"type": "INTEGER"},
                    "matched_topics": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "missing_topics": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "extra_partner_topics": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "domain_evidence": {"type": "STRING"},
                    "content_evidence": {"type": "STRING"},
                    "outcomes_evidence": {"type": "STRING"},
                    "structural_notes": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "warnings": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": [
                    "candidate_index", "core_home_topics",
                    "domain_score", "content_score", "outcomes_score",
                    "matched_topics", "missing_topics", "extra_partner_topics",
                    "domain_evidence", "content_evidence", "outcomes_evidence",
                    "structural_notes", "warnings",
                ],
            },
        },
    },
    "required": ["academic_category", "candidates"],
}

VERIFICATION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "verifications": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "candidate_index": {"type": "INTEGER"},
                    "decision": {
                        "type": "STRING",
                        "enum": ["approved", "rejected", "risk_flagged"],
                    },
                    "confidence": {"type": "NUMBER"},
                    "is_recommended": {"type": "BOOLEAN"},
                    "content_overlap_assessment": {
                        "type": "STRING",
                        "enum": ["genuine", "partial", "superficial"],
                    },
                    "core_topic_coverage": {
                        "type": "STRING",
                        "enum": ["strong", "moderate", "weak"],
                    },
                    "risk_flags": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "reason": {"type": "STRING"},
                },
                "required": [
                    "candidate_index", "decision", "confidence",
                    "is_recommended", "content_overlap_assessment",
                    "core_topic_coverage", "risk_flags", "reason",
                ],
            },
        },
    },
    "required": ["verifications"],
}
