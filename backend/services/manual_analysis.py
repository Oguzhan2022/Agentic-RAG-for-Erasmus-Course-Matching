"""
ManualAnalysisService — on-demand single-pair AI analysis for coordinator manual review.

Uses the v3-derived single-pair matching prompt and v2-derived single-pair
verification prompt. Results are persisted in course_matches table with source='manual'.
"""

from sqlalchemy.orm import Session

from db.models import Course, CourseMatch
from matching.deterministic_scoring import compute_deterministic_scores
from matching.semantic_scoring import semantic_match_single_pair
from matching.fusion_engine import _load_profiles, _compute_fusion_score
from verification.verifier import BatchVerifier


class ManualAnalysisService:

    @staticmethod
    def analyze(
        db: Session,
        partner_course_id: int,
        home_course_id: int,
        coordinator_id: int,
        selection_id: int,
    ) -> CourseMatch:
        """
        Run full single-pair analysis (deterministic + semantic + fusion + verification)
        and persist the result in course_matches with source='manual'.

        Returns the saved CourseMatch ORM object.
        """
        partner = db.query(Course).filter(Course.id == partner_course_id).first()
        home = db.query(Course).filter(Course.id == home_course_id).first()

        if not partner:
            raise ValueError(f"Partner course {partner_course_id} not found")
        if not home:
            raise ValueError(f"Home course {home_course_id} not found")

        # 1. Deterministic scoring (fast, pair-agnostic)
        det = compute_deterministic_scores(home, partner)

        # 2. Semantic scoring — single-pair, uses v3-derived prompt
        sem = semantic_match_single_pair(partner, home)

        # 3. Fusion — same category-aware weight logic as batch pipeline
        category = sem.get("academic_category") or "technical"
        profiles = _load_profiles()
        profile = profiles.get(category, profiles["technical"])
        overall, breakdown = _compute_fusion_score(det, sem, profile)

        # 4. Verification — single-pair, uses v2-derived prompt
        verif = BatchVerifier().verify_single_pair(partner, home, sem)

        # 5. Upsert — one record per (partner_course_id, home_course_id)
        #    If a batch record already exists, upgrade it to 'manual' with fresh scores.
        record = db.query(CourseMatch).filter(
            CourseMatch.partner_course_id == partner_course_id,
            CourseMatch.home_course_id == home_course_id,
        ).first()

        fields = dict(
            partner_course_id=partner_course_id,
            coordinator_id=coordinator_id,
            overall_score=overall,
            score_breakdown=breakdown,
            matched_topics=sem.get("matched_topics", []),
            missing_topics=sem.get("missing_topics", []),
            extra_partner_topics=sem.get("extra_partner_topics", []),
            core_home_topics=sem.get("core_home_topics", []),
            structural_notes=sem.get("structural_notes") or [],
            verification_status=verif.get("decision"),
            verification_confidence=verif.get("confidence"),
            verification_reason=verif.get("reason"),
            verification_risk_flags=verif.get("risk_flags", []),
            is_recommended=verif.get("is_recommended", False),
            content_overlap_assessment=verif.get("content_overlap_assessment"),
            core_topic_coverage=verif.get("core_topic_coverage"),
            category=category,
        )

        if record:
            # Upgrade existing record (batch→manual or re-run manual)
            record.source = "manual"
            record.selection_id = selection_id
            record.home_course_id = home_course_id
            for k, v in fields.items():
                setattr(record, k, v)
        else:
            record = CourseMatch(
                source="manual",
                selection_id=selection_id,
                home_course_id=home_course_id,
                **fields,
            )
            db.add(record)

        db.commit()
        db.refresh(record)
        return record
