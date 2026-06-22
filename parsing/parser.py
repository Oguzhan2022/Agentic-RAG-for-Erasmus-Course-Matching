"""
Refactored Course Parser - Structured extraction from PDF course catalogs.

Supports two modes:
  Mode A (consolidated): Single PDF with multiple courses (Deggendorf, Brandenburg, Nurnberg)
    - Phase 1: Index courses by page
    - Phase 2: Extract verbatim text blocks
    - Phase 3: Structured JSON extraction from raw text
  Mode B (individual): One PDF per course (all other universities)
    - Single-phase structured extraction
"""

import os
import json
import re
import argparse
from pathlib import Path
from dotenv import load_dotenv

from parsing.pdf_utils import (
    extract_text_with_page_markers,
    extract_text_simple,
    extract_pages_from_string,
    ocr_pdf_via_images,
)
from parsing.llm_client import parsing_llm_client

load_dotenv()

# University parsing configuration
UNIVERSITY_CONFIG = {
    "Deggendorf Institute of Technology": {
        "mode": "consolidated",
        "ocr_semesters": ["fall"],
    },
    "Technical University Brandenburg": {
        "mode": "consolidated",
        "ocr_semesters": [],
    },
    "Nürnberg Georg Simon Ohm Technical University": {
        "mode": "consolidated",
        "ocr_semesters": [],
    },
    "İstanbul Kültür Üniversitesi": {
        "mode": "category_based",
        "categories": {
            "Core Courses": "core",
            "Departmental Elective Courses": "departmental_elective",
            "Elective Courses": "elective",
        },
    },
}

# Folder-to-semester mapping
SEMESTER_MAP = {
    "fall": "fall",
    "spring": "spring",
    "ws": "fall",
    "ss": "spring",
    "winter": "fall",
    "summer": "spring",
}

PROMPTS_DIR = Path(__file__).parent / "prompts"


def _load_prompt(filename):
    """Load a prompt template from the prompts directory."""
    with open(PROMPTS_DIR / filename, "r", encoding="utf-8") as f:
        return f.read()


class CourseParser:
    """LLM-based course parser with structured JSON extraction."""

    def __init__(self):
        self._client = parsing_llm_client
        self.extraction_prompt_template = _load_prompt("course_extraction_prompt.txt")

        # Phase 1 & 2 prompts for consolidated mode (inline, from original course_parser.py)
        self.phase1_prompt_template = """
Below is a long OCR-extracted text of a university course catalogue. It contains page markers like "==Start of OCR for page X==".

YOUR TASK:
1. Scan the text from beginning to end.
2. For each course, identify the course name and which page or pages its full description spans in the text.
3. Identify the course name and which page or pages it spans in the text. (Determine page numbers from the "==Start of OCR for page X==" markers).
4. CRITICAL: DO NOT include the page numbers of the Table of Contents in the "pages" list. Even if the course name appears in the ToC (e.g., page 1 or 2), ignore those pages for indexing. Only include pages starting from the actual course description.
5. Return only a list in the following JSON format. Do not provide any other explanation.
6. Fluid Mechanics and Impact Entrepreneurship are ONLY EXAMPLES from a different catalogue. DO NOT include them in your output unless you explicitly find them in the PROVIDED TEXT below:
7. Do not miss any course !!!
8. Ignore department/program names and any repeated headers; only extract entries that have an actual course description.
9. First extract all course names from the Table of Contents as a reference list if it's available. Then ensure every one of these courses appears in your final output. If a course from the Table of Contents is missing, search again in the full text and include it.
10. Each "Course title" marks the start of a new course. End the previous course right before it.

Must obey rule 7

EXPECTED JSON FORMAT:
[
  {{
    "course_name": "Fluid Mechanics",
    "pages": [13]
  }},
  {{
    "course_name": "Impact Entrepreneurship – Developing Social and Ecological Innovations",
    "pages": [15, 16]
  }}
]

TEXT:
{full_pdf_text}
"""

        self.phase2_prompt_template = """
Below is a raw OCR text taken from specific pages of a university course catalogue.

TARGET COURSE: "{target_course_name}"

YOUR TASK:
1. Find ONLY the block belonging to the course named "{target_course_name}" within the given text.
2. Start this course block from the "Course name {target_course_name}" expression and capture ONLY all information belonging to that course VERBATIM until the content of this course ends (until the "Course name" heading of the next course or until the end of the text).
3. VERY IMPORTANT: NEVER summarize the text, omit any sentences, or skip anything while copying. Include all subheadings (Learning objectives, Content, Type of assessment, etc.).
4. CLEANUP: If there are markers like "==Screenshot for page X==", "==Start of OCR for page X==", "==End of OCR for page X==" and page numbers immediately following them (e.g., 15, 16) within your copied block, DELETE them. Merge text breaks.
5. Return ONLY the following format. Use triple backticks for the code block. Do not make any explanations.
6. Do not copy information belonging to other courses.
7. Capture all information until reaching the next course.
8. Clean page numbers from the text.
9. Only give text from exactly the course name. Do not give text from next course.

EXPECTED FORMAT:
course_name: {target_course_name}
raw_block_text:
```
Course name {target_course_name}\\nLearning objectives...\\nContent...\\n[CLEANED AND SEAMLESS VERBATIM TEXT]\\nType of assessment...
```

TEXT (Relevant and next pages):
{relevant_pages_text}
"""

    @staticmethod
    def _strip_thinking(text):
        """Remove <think>...</think> blocks from thinking model output."""
        return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    def _parse_json_from_response(self, response_text):
        """Extract and parse JSON object from LLM response text. Delegates to client."""
        if response_text is None:
            return None
        result = self._client.extract_json(response_text)
        if result is None:
            return None
        # repair_json + sanitize_json fallback for stubborn cases
        if isinstance(result, dict):
            return result
        # Client returned a list or other — try repair
        repaired = self._client.repair_json(self._client.sanitize_json(response_text))
        try:
            return json.loads(repaired, strict=False)
        except json.JSONDecodeError:
            return None

    def _parse_json_array_from_response(self, response_text):
        """Extract and parse JSON array from LLM response text. Delegates to client."""
        if response_text is None:
            return []
        result = self._client.extract_json(response_text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            # Single object in a dict → wrap in list
            return [result]
        return []

    def _extract_structured(self, raw_text, max_retries=100):
        """
        Send raw course text through the structured extraction prompt.
        Returns a dict matching the course schema, or None on failure.
        Retry + strict mode + quota handling delegated to client.
        """
        base_prompt = self.extraction_prompt_template.format(course_text=raw_text)

        response_text = self._client.invoke_with_retry(
            base_prompt,
            min_interval=25,
            max_retries=max_retries,
            start_strict=True,
            expect_json=True,
            final_hint="IMPORTANT: Return ONLY a valid JSON object. If the document is in a non-English language, use the English course name if available. Focus on extractable fields only. Do NOT include any text outside the JSON. Do NOT include thinking or reasoning.",
            context="ExtractStructured",
        )

        if response_text is None:
            print("  Structured extraction failed — all retries exhausted.", flush=True)
            return None

        result = self._parse_json_from_response(response_text)
        if result and "course_name" in result:
            return result

        print("  Failed to extract structured data from response.", flush=True)
        return None

    def _extract_verbatim_block(self, target_course, chunked_text):
        """Phase 2: Extract verbatim text block for a specific course."""
        prompt = self.phase2_prompt_template.format(
            target_course_name=target_course,
            relevant_pages_text=chunked_text,
        )
        response_text = self._client.invoke_with_retry(
            prompt,
            min_interval=25,
            start_strict=True,
            expect_json=False,
            context="ExtractVerbatim",
        )

        if response_text is None:
            print(f"  Could not extract verbatim block for: {target_course}", flush=True)
            return None

        try:
            text = self._strip_thinking(response_text)
            content_match = re.search(r'```(?:\w+)?\n?(.*?)```', text, re.DOTALL)
            if content_match:
                return content_match.group(1).strip()

            # Fallback: try JSON
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                sanitized = self._client.sanitize_json(json_match.group(0))
                data = json.loads(sanitized, strict=False)
                if "raw_block_text" in data:
                    return data["raw_block_text"]

            print(f"  Could not find verbatim block for: {target_course}", flush=True)
            return None
        except Exception as e:
            print(f"  Error parsing verbatim response for {target_course}: {e}", flush=True)
            return None

    # ---- Mode A: Consolidated PDF parsing ----

    def parse_consolidated_pdf(self, pdf_path, semester="unknown", do_ocr=False):
        """
        Parse a consolidated PDF containing multiple courses.
        Uses 3 phases: index -> verbatim extract -> structured extraction.
        """
        print(f"[Consolidated] Processing: {pdf_path}", flush=True)

        # Extract full text
        if do_ocr:
            print("Performing Multimodal OCR...", flush=True)
            full_text = ocr_pdf_via_images(pdf_path)
            print("OCR complete.", flush=True)
        else:
            full_text = extract_text_with_page_markers(pdf_path)

        # Phase 1: Index courses
        print("Phase 1: Indexing courses...", flush=True)
        phase1_prompt = self.phase1_prompt_template.format(full_pdf_text=full_text)
        response_text = self._client.invoke_with_retry(
            phase1_prompt,
            min_interval=25,
            start_strict=True,
            expect_json=True,
            context="Phase1Index",
        )
        if response_text is None:
            print("Phase 1 failed — all retries exhausted.", flush=True)
            return []
        course_index = self._parse_json_array_from_response(response_text)
        print(f"Found {len(course_index)} courses:", flush=True)
        for idx, ci in enumerate(course_index, 1):
            print(f"  {idx:2d}. {ci.get('course_name', '???')}  ->  pages {ci.get('pages', [])}", flush=True)

        results = []

        for i, item in enumerate(course_index):
            target_course = item["course_name"]
            target_pages = item["pages"]

            extended_pages = list(target_pages) + [max(target_pages) + 1]

            print(f"[{i+1}/{len(course_index)}] Processing: {target_course}", flush=True)

            # Phase 2: Verbatim extraction
            print("  Phase 2: Verbatim extraction...", flush=True)
            chunked_text = extract_pages_from_string(full_text, extended_pages)
            raw_block = self._extract_verbatim_block(target_course, chunked_text)

            if not raw_block:
                print(f"  Skipping {target_course} - no verbatim block.", flush=True)
                continue

            # Phase 3: Structured extraction
            print("  Phase 3: Structured extraction...", flush=True)
            structured = self._extract_structured(raw_block)

            if structured:
                # If user selected "unknown", try to detect semester from PDF content
                if semester == "unknown":
                    detected = structured.get("detected_semester", "unknown")
                    structured["semester"] = detected if detected in ("fall", "spring", "both") else "unknown"
                else:
                    structured["semester"] = semester
                structured["raw_text"] = raw_block
                results.append(structured)
            else:
                print(f"  Failed structured extraction for: {target_course}", flush=True)
                # Save raw data as fallback
                results.append({
                    "course_code": "unknown",
                    "course_name": target_course,
                    "department": "unknown",
                    "ects": None,
                    "level": "unknown",
                    "language": "unknown",
                    "content": "unknown",
                    "learning_outcomes": "unknown",
                    "academic_context": {
                        "primary_format": "unknown",
                        "assessment_mode": "unknown",
                        "lab_status": "unknown",
                        "project_status": "unknown",
                        "seminar_status": "unknown",
                        "special_tags": [],
                    },
                    "semester": semester,
                    "raw_text": raw_block,
                })

        return results

    # ---- Mode B: Individual PDF parsing ----

    def parse_individual_pdf(self, pdf_path, semester="unknown"):
        """
        Parse a single-course PDF or TXT file. Direct text extraction + structured extraction.
        Returns a single structured course dict, or None on failure.
        """
        filename = os.path.basename(pdf_path)
        print(f"[Individual] Processing: {filename}", flush=True)

        if pdf_path.lower().endswith(".txt"):
            try:
                with open(pdf_path, "r", encoding="utf-8") as f:
                    raw_text = f.read()
            except UnicodeDecodeError:
                with open(pdf_path, "r", encoding="latin-1") as f:
                    raw_text = f.read()
        else:
            raw_text = extract_text_simple(pdf_path)

            if not raw_text or len(raw_text.strip()) < 20:
                print(f"  Very little text extracted, trying OCR...", flush=True)
                raw_text = ocr_pdf_via_images(pdf_path)

        if not raw_text or len(raw_text.strip()) < 20:
            print(f"  Skipping {filename} - no extractable text.", flush=True)
            return None

        structured = self._extract_structured(raw_text)

        if structured:
            # If user selected "unknown", try to detect semester from PDF content
            if semester == "unknown":
                detected = structured.get("detected_semester", "unknown")
                structured["semester"] = detected if detected in ("fall", "spring", "both") else "unknown"
            else:
                structured["semester"] = semester
            structured["raw_text"] = raw_text
            return structured

        # Fallback: return minimal record
        course_name_guess = os.path.splitext(filename)[0]
        return {
            "course_code": "unknown",
            "course_name": course_name_guess,
            "department": "unknown",
            "ects": None,
            "level": "unknown",
            "language": "unknown",
            "content": "unknown",
            "learning_outcomes": "unknown",
            "academic_context": {
                "primary_format": "unknown",
                "assessment_mode": "unknown",
                "lab_status": "unknown",
                "project_status": "unknown",
                "seminar_status": "unknown",
                "special_tags": [],
            },
            "semester": semester,
            "raw_text": raw_text,
        }

    # ---- Batch parsing utilities ----

    def parse_university_folder(self, university_name, base_path):
        """
        Parse all courses for a university based on its folder structure.
        Returns list of structured course dicts with source metadata.
        """
        config = UNIVERSITY_CONFIG.get(university_name, {"mode": "individual"})
        mode = config["mode"]
        base = Path(base_path)
        all_courses = []

        if mode == "consolidated":
            ocr_semesters = config.get("ocr_semesters", [])
            for semester_folder in base.iterdir():
                if not semester_folder.is_dir():
                    continue
                semester = self._detect_semester(semester_folder.name)
                do_ocr = semester in ocr_semesters
                pdf_files = list(semester_folder.glob("*.pdf"))
                for pdf_file in pdf_files:
                    courses = self.parse_consolidated_pdf(
                        str(pdf_file), semester=semester, do_ocr=do_ocr
                    )
                    for c in courses:
                        c["source"] = {
                            "source_type": "partner",
                            "category": None,
                            "pdf_filename": pdf_file.name,
                        }
                    all_courses.extend(courses)

        elif mode == "category_based":
            categories = config.get("categories", {})
            for folder in base.iterdir():
                if not folder.is_dir():
                    continue
                category = categories.get(folder.name)
                pdf_files = list(folder.glob("*.pdf"))
                for pdf_file in pdf_files:
                    course = self.parse_individual_pdf(str(pdf_file), semester="unknown")
                    if course:
                        course["source"] = {
                            "source_type": "home",
                            "category": category,
                            "pdf_filename": pdf_file.name,
                        }
                        all_courses.append(course)

        else:  # individual
            for semester_folder in base.iterdir():
                if not semester_folder.is_dir():
                    continue
                semester = self._detect_semester(semester_folder.name)
                pdf_files = list(semester_folder.glob("*.pdf"))
                for pdf_file in pdf_files:
                    course = self.parse_individual_pdf(str(pdf_file), semester=semester)
                    if course:
                        course["source"] = {
                            "source_type": "partner",
                            "category": None,
                            "pdf_filename": pdf_file.name,
                        }
                        all_courses.append(course)

        return all_courses

    @staticmethod
    def _detect_semester(folder_name):
        """Detect semester from folder name."""
        lower = folder_name.lower()
        for key, semester in SEMESTER_MAP.items():
            if key in lower:
                return semester
        return "unknown"


if __name__ == "__main__":
    parser_cli = argparse.ArgumentParser(description="Course Parser - Structured Extraction")
    parser_cli.add_argument("mode", choices=["consolidated", "individual", "folder"],
                            help="Parsing mode")
    parser_cli.add_argument("path", help="Path to PDF file or university folder")
    parser_cli.add_argument("output", help="Output JSON file path")
    parser_cli.add_argument("--semester", default="unknown", help="Semester (fall/spring)")
    parser_cli.add_argument("--ocr", action="store_true", help="Use OCR for text extraction")
    parser_cli.add_argument("--university", default=None, help="University name (for folder mode)")

    args = parser_cli.parse_args()

    course_parser = CourseParser()

    if args.mode == "consolidated":
        results = course_parser.parse_consolidated_pdf(args.path, args.semester, args.ocr)
    elif args.mode == "individual":
        result = course_parser.parse_individual_pdf(args.path, args.semester)
        results = [result] if result else []
    elif args.mode == "folder":
        university_name = args.university or os.path.basename(args.path)
        results = course_parser.parse_university_folder(university_name, args.path)

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nSaved {len(results)} courses to: {args.output}", flush=True)
