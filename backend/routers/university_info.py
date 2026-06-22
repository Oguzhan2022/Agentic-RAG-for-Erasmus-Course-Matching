"""
University profile management — rankings scraping, Numbeo, LLM import.
Used by coordinators to build rich university profiles shown to students.
"""
import json
import logging
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.dependencies import get_db
from db.models import University, UniversityProfile, User
from backend.services.prompt_generator import generate_prompt
from authorization.middleware import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/university-info", tags=["university-info"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create_profile(uni_id: int, db: Session) -> UniversityProfile:
    profile = db.query(UniversityProfile).filter_by(university_id=uni_id).first()
    if not profile:
        profile = UniversityProfile(university_id=uni_id)
        db.add(profile)
        db.flush()
    return profile


def _profile_to_dict(uni: University, profile: Optional[UniversityProfile]) -> dict:
    if not profile:
        return {
            "university_id": uni.id,
            "university_name": uni.name,
            "city": uni.city,
            "country": uni.country,
            "rankings": {},
            "numbeo": {},
            "llm_data": None,
            "llm_imported_at": None,
        }
    return {
        "university_id": uni.id,
        "university_name": uni.name,
        "city": uni.city,
        "country": uni.country,
        "rankings": {
            "qs_world": profile.qs_world,
            "the_world": profile.the_world,
            "cwur_world": profile.cwur_world,
            "shanghai_world": profile.shanghai_world,
            "urap_world": profile.urap_world,
            "edurank_world": profile.edurank_world,
            "unirank_world": profile.unirank_world,
        },
        "numbeo": {
            "monthly_total_eur": profile.numbeo_monthly_total_eur,
            "rent_monthly_eur": profile.numbeo_rent_monthly_eur,
            "food_monthly_eur": profile.numbeo_food_monthly_eur,
            "transport_monthly_eur": profile.numbeo_transport_monthly_eur,
        },
        "llm_data": {
            "city_description": profile.city_description,
            "safety_level": profile.safety_level,
            "english_friendliness": profile.english_friendliness,
            "climate": profile.climate,
            "city_population": profile.city_population,
            "nearest_airport": profile.nearest_airport,
            "airport_distance_km": profile.airport_distance_km,
            "airport_transport": profile.airport_transport,
            "public_transport_quality": profile.public_transport_quality,
            "distance_to_city_center": profile.distance_to_city_center,
            "notable_connections": profile.notable_connections or [],
            "dorm_available": profile.dorm_available,
            "dorm_cost_min_eur": profile.dorm_cost_min_eur,
            "dorm_cost_max_eur": profile.dorm_cost_max_eur,
            "private_room_min_eur": profile.private_room_min_eur,
            "private_room_max_eur": profile.private_room_max_eur,
            "housing_difficulty": profile.housing_difficulty,
            "accommodation_notes": profile.accommodation_notes,
            "erasmus_grant_sufficient": profile.erasmus_grant_sufficient,
            "nightlife": profile.nightlife,
            "erasmus_community": profile.erasmus_community,
            "student_organizations": profile.student_organizations,
            "key_spots": profile.key_spots or [],
            "language_of_instruction": profile.language_of_instruction,
            "english_courses_available": profile.english_courses_available,
            "notable_programs": profile.notable_programs or [],
            "academic_notes": profile.academic_notes,
            "best_for": profile.best_for or [],
            "watch_out_for": profile.watch_out_for or [],
            "overall_rating": profile.overall_rating,
            "sources": profile.sources or [],
        } if profile.city_description or profile.llm_imported_at else None,
        "llm_imported_at": profile.llm_imported_at.isoformat() if profile.llm_imported_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{uni_id}")
def get_profile(uni_id: int, db: Session = Depends(get_db)):
    uni = db.query(University).filter_by(id=uni_id).first()
    if not uni:
        raise HTTPException(404, "University not found")
    profile = db.query(UniversityProfile).filter_by(university_id=uni_id).first()
    return _profile_to_dict(uni, profile)


@router.get("/{uni_id}/generate-prompt")
def get_generate_prompt(uni_id: int, db: Session = Depends(get_db),
    _user: User = Depends(require_role(["super_admin", "dept_admin", "coordinator"]))):
    uni = db.query(University).filter_by(id=uni_id).first()
    if not uni:
        raise HTTPException(404, "University not found")
    profile = db.query(UniversityProfile).filter_by(university_id=uni_id).first()
    numbeo_data = None
    if profile:
        fields = [
            profile.numbeo_monthly_total_eur,
            profile.numbeo_rent_monthly_eur,
            profile.numbeo_food_monthly_eur,
            profile.numbeo_transport_monthly_eur,
        ]
        if all(f is not None for f in fields):
            numbeo_data = {
                "monthly_total_eur": profile.numbeo_monthly_total_eur,
                "rent_monthly_eur": profile.numbeo_rent_monthly_eur,
                "food_monthly_eur": profile.numbeo_food_monthly_eur,
                "transport_monthly_eur": profile.numbeo_transport_monthly_eur,
            }
    prompt = generate_prompt(
        university_name=uni.name,
        city=uni.city or "",
        country=uni.country or "",
        existing_numbeo=numbeo_data,
    )
    return {"university_id": uni_id, "prompt": prompt}




class LLMImportPayload(BaseModel):
    json_data: str  # raw JSON string pasted by coordinator


@router.post("/{uni_id}/import-llm")
def import_llm(
    uni_id: int,
    payload: LLMImportPayload,
    db: Session = Depends(get_db),
    _user=Depends(require_role(["coordinator", "dept_admin", "super_admin"])),
):
    uni = db.query(University).filter_by(id=uni_id).first()
    if not uni:
        raise HTTPException(404, "University not found")

    raw = payload.json_data.strip()
    # Strip markdown code fences
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw.strip())
    # Strip Perplexity-style inline citations: [text](url) inside string values
    raw = re.sub(r"\s*\[[^\]]*\]\(https?://[^\)]*\)", "", raw)
    # Strip trailing commas before } or ] (common LLM mistake)
    raw = re.sub(r",\s*([}\]])", r"\1", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        fix_prompt = (
            "The JSON below has a syntax error. Fix it and return ONLY the corrected JSON — "
            "no explanation, no markdown code fences, no comments.\n\n"
            f"Error: {e}\n\n"
            f"Broken JSON:\n{raw}"
        )
        raise HTTPException(400, detail={"msg": f"Invalid JSON: {e}", "fix_prompt": fix_prompt})

    profile = _get_or_create_profile(uni_id, db)

    city_p = data.get("city_profile", {})
    trans = data.get("transportation", {})
    accom = data.get("accommodation", {})
    cost = data.get("cost_of_living", {})
    social = data.get("social_life", {})
    academic = data.get("academic", {})
    summary = data.get("student_summary", {})
    sources = data.get("sources", [])

    # LLM sometimes returns arrays as JSON strings instead of actual arrays
    def ensure_list(val):
        if isinstance(val, str):
            try:
                parsed = json.loads(val)
                return parsed if isinstance(parsed, list) else [parsed]
            except (json.JSONDecodeError, TypeError):
                return [val]
        if isinstance(val, list):
            return val
        return []

    # Rankings from LLM (in case web search returned them)
    rankings = data.get("rankings", {})
    if rankings.get("qs_world") and not profile.qs_world:
        profile.qs_world = rankings["qs_world"]
    if rankings.get("the_world") and not profile.the_world:
        profile.the_world = rankings["the_world"]
    if rankings.get("cwur_world") and not profile.cwur_world:
        profile.cwur_world = rankings["cwur_world"]
    if rankings.get("shanghai_world") and not profile.shanghai_world:
        profile.shanghai_world = rankings["shanghai_world"]
    if rankings.get("urap_world") and not profile.urap_world:
        profile.urap_world = rankings["urap_world"]
    if rankings.get("edurank_world") and not profile.edurank_world:
        profile.edurank_world = rankings["edurank_world"]
    if rankings.get("unirank_world") and not profile.unirank_world:
        profile.unirank_world = rankings["unirank_world"]

    # City profile
    profile.city_description = city_p.get("description") or data.get("city_and_environment")
    profile.safety_level = city_p.get("safety_level")
    profile.english_friendliness = city_p.get("english_friendliness")
    profile.climate = city_p.get("climate")
    profile.city_population = city_p.get("population")

    # Transportation
    profile.nearest_airport = trans.get("nearest_airport")
    profile.airport_distance_km = trans.get("airport_distance_km")
    profile.airport_transport = trans.get("airport_transport")
    profile.public_transport_quality = trans.get("public_transport_quality")
    profile.distance_to_city_center = trans.get("distance_to_city_center")
    profile.notable_connections = ensure_list(trans.get("notable_connections"))

    # Accommodation
    profile.dorm_available = accom.get("university_dorm_available")
    profile.dorm_cost_min_eur = accom.get("dorm_cost_per_term_eur_min")
    profile.dorm_cost_max_eur = accom.get("dorm_cost_per_term_eur_max")
    profile.private_room_min_eur = accom.get("private_room_monthly_eur_min")
    profile.private_room_max_eur = accom.get("private_room_monthly_eur_max")
    profile.housing_difficulty = accom.get("housing_difficulty")
    profile.accommodation_notes = accom.get("notes")

    # Cost of living (only fill Numbeo fields if not scraped yet)
    if cost.get("monthly_total_eur") and not profile.numbeo_monthly_total_eur:
        profile.numbeo_monthly_total_eur = cost["monthly_total_eur"]
    if cost.get("rent_monthly_eur") and not profile.numbeo_rent_monthly_eur:
        profile.numbeo_rent_monthly_eur = cost["rent_monthly_eur"]
    if cost.get("food_monthly_eur") and not profile.numbeo_food_monthly_eur:
        profile.numbeo_food_monthly_eur = cost["food_monthly_eur"]
    if cost.get("transport_monthly_eur") and not profile.numbeo_transport_monthly_eur:
        profile.numbeo_transport_monthly_eur = cost["transport_monthly_eur"]
    profile.erasmus_grant_sufficient = cost.get("erasmus_grant_sufficient")

    # Social
    profile.nightlife = social.get("nightlife")
    profile.erasmus_community = social.get("erasmus_community")
    profile.student_organizations = social.get("student_organizations")
    profile.key_spots = ensure_list(social.get("key_spots"))

    # Academic
    profile.language_of_instruction = academic.get("language_of_instruction")
    profile.english_courses_available = academic.get("english_courses_available")
    profile.notable_programs = ensure_list(academic.get("notable_programs"))
    profile.academic_notes = academic.get("special_notes")

    # Summary
    profile.best_for = ensure_list(summary.get("best_for"))
    profile.watch_out_for = ensure_list(summary.get("watch_out_for"))
    profile.overall_rating = summary.get("overall_rating")

    profile.sources = ensure_list(sources)
    profile.llm_imported_at = datetime.utcnow()
    db.commit()

    return {"success": True, "imported_at": profile.llm_imported_at.isoformat()}
