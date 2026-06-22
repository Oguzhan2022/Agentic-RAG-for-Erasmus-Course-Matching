"""
Metadata Validation Layer - Warning-based course data validation.

Never blocks the pipeline. Generates warnings and auto-computes metadata_quality.
"""


class CourseValidator:
    """Validates parsed course data and generates quality metadata."""

    def validate(self, course: dict) -> dict:
        """
        Validate a parsed course dict. Adds 'metadata_quality' and 'warnings' fields.
        Never raises exceptions - always returns the course dict.
        """
        warnings = []

        # Check content
        content = course.get("content")
        content_available = content not in (None, "", "unknown")

        if not content_available:
            warnings.append("Content field is missing or unknown")
        elif isinstance(content, str) and len(content.strip()) < 50:
            warnings.append("Content field is suspiciously short (less than 50 characters)")

        # Check learning outcomes
        outcomes = course.get("learning_outcomes")
        outcomes_available = outcomes not in (None, "", "unknown")

        if not outcomes_available:
            warnings.append("Learning outcomes are missing or unknown")

        # Check ECTS
        ects = course.get("ects")
        if ects is None:
            warnings.append("ECTS value could not be parsed")
        elif not isinstance(ects, (int, float)):
            warnings.append(f"ECTS value has invalid type: {type(ects).__name__}")
        elif ects <= 0:
            warnings.append(f"ECTS value is non-positive: {ects}")
        elif ects > 30:
            warnings.append(f"ECTS value looks unusually high: {ects}")

        # Check course code
        course_code = course.get("course_code")
        if course_code in (None, "", "unknown"):
            warnings.append("Course code could not be extracted")

        # Check language
        language = course.get("language")
        if language in (None, "", "unknown"):
            warnings.append("Language information is missing")

        # Check academic_context
        ac = course.get("academic_context", {})
        unknown_fields = []
        for field in ["lab_status", "project_status", "seminar_status"]:
            if ac.get(field) == "unknown":
                unknown_fields.append(field)

        if len(unknown_fields) == 3:
            warnings.append("All academic context status fields are unknown")
        elif unknown_fields:
            warnings.append(
                f"Some academic context fields are unknown: {', '.join(unknown_fields)}"
            )

        if ac.get("primary_format") == "unknown":
            warnings.append("Primary format is unknown")

        if ac.get("assessment_mode") == "unknown":
            warnings.append("Assessment mode is unknown")

        # Check department
        department = course.get("department")
        if department in (None, "", "unknown"):
            warnings.append("Department information is missing")

        # Determine format_confidence
        if content_available and outcomes_available:
            format_confidence = "high"
        elif content_available or outcomes_available:
            format_confidence = "medium"
        else:
            format_confidence = "low"

        # Set metadata_quality
        course["metadata_quality"] = {
            "content_available": content_available,
            "outcomes_available": outcomes_available,
            "format_confidence": format_confidence,
        }

        course["warnings"] = warnings
        return course

    def validate_batch(self, courses: list) -> list:
        """Validate a list of courses. Returns the validated list."""
        return [self.validate(c) for c in courses]

    def generate_report(self, courses: list) -> dict:
        """Generate a summary validation report for a batch of courses."""
        total = len(courses)
        if total == 0:
            return {"total": 0}

        high = sum(1 for c in courses if c.get("metadata_quality", {}).get("format_confidence") == "high")
        medium = sum(1 for c in courses if c.get("metadata_quality", {}).get("format_confidence") == "medium")
        low = sum(1 for c in courses if c.get("metadata_quality", {}).get("format_confidence") == "low")
        with_warnings = sum(1 for c in courses if c.get("warnings"))
        no_content = sum(1 for c in courses if not c.get("metadata_quality", {}).get("content_available"))
        no_outcomes = sum(1 for c in courses if not c.get("metadata_quality", {}).get("outcomes_available"))
        no_ects = sum(1 for c in courses if c.get("ects") is None)

        return {
            "total": total,
            "quality_distribution": {
                "high": high,
                "medium": medium,
                "low": low,
            },
            "courses_with_warnings": with_warnings,
            "missing_content": no_content,
            "missing_outcomes": no_outcomes,
            "missing_ects": no_ects,
        }
