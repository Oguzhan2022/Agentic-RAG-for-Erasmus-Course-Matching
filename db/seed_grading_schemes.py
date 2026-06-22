"""Seed grading schemes and conversion rules for all partner universities.

Run: python -m db.seed_grading_schemes
"""
from db.database import SessionLocal, engine, Base
from db.models import (
    University, GradingScheme, GradeConversionRule, EctsIkuConversion,
)

# Ensure tables exist
Base.metadata.create_all(bind=engine)

# ── University lookup helpers ──
# (name_substring, country, pdf_structure) for missing universities
MISSING_UNIVERSITIES = [
    ("Romanian-American University", "Romania", "individual"),
    ("Gábor Dénes University", "Hungary", "individual"),
    ("Óbuda University", "Hungary", "individual"),
    ("Estonian Entrepreneurship University of Applied Sciences", "Estonia", "individual"),
    ("Technical University of Varna", "Bulgaria", "individual"),
]


def _get_default_department_id(db):
    """Get the first active department (COM) as default."""
    from db.models import Department
    dept = db.query(Department).filter(Department.code == "COM").first()
    return dept.id if dept else None

# ── Grading scheme definitions ──
# Each entry: (university_name_substring, scheme_data, rules_list)
# rule: (min, max, exact, definition, ects, description, sort_order)
SCHEMES = [
    # ── 1. Germany — Deggendorf, Nürnberg, Brandenburg ──
    {
        "universities": ["Deggendorf", "Nürnberg", "Brandenburg"],
        "scheme": {
            "name": "German Grading System",
            "scheme_type": "numeric_range",
            "grade_direction": "desc",
            "source": "proposed",
            "source_document": "Alman Üniversiteler.xlsx",
        },
        "rules": [
            ("1.0", "1.5", None, "Sehr Gut (Excellent)", "A", "Excellent", 1),
            ("1.6", "2.5", None, "Gut (Very Good)", "B", "Very Good", 2),
            ("2.6", "3.5", None, "Befriedigend (Satisfactory)", "C", "Satisfactory", 3),
            ("3.6", "4.0", None, "Ausreichend (Sufficient)", "D", "Sufficient", 4),
            ("4.1", "5.0", None, "Nicht Ausreichend (Fail)", "F", "Fail", 5),
            (None, None, "BE", "Passed", "P", "Pass", 6),
            (None, None, "NB", "Failed", "Fail", "Failed", 7),
            (None, None, "EN", "Fail at final attempt", "Fail", "Failed", 8),
        ],
    },
    # ── 2. Germany — Karlsruhe (HKA) ──
    {
        "universities": ["Karlsruhe"],
        "scheme": {
            "name": "German Grading System (HKA)",
            "scheme_type": "numeric_range",
            "grade_direction": "desc",
            "source": "senate_decision",
            "source_document": "SKM_C250i25041515300.pdf (25.07.2019, No: 2018-2019/28)",
        },
        "rules": [
            ("1.00", "1.59", None, "Excellent", "A", "Excellent", 1),
            ("1.60", "2.59", None, "Good", "B", "Good", 2),
            ("2.60", "3.59", None, "Satisfactory", "C", "Satisfactory", 3),
            ("3.60", "4.09", None, "Sufficient", "D", "Sufficient", 4),
            ("4.10", "5.00", None, "Fail", "F", "Fail", 5),
            (None, None, "BE", "Passed", "P", "Pass", 6),
            (None, None, "NB", "Failed", "Fail", "Failed", 7),
            (None, None, "EN", "Failed and no resits possible", "Fail", "Failed", 8),
            (None, None, "AN", "Registered for examination", "Fail", "Failed", 9),
            (None, None, "PV", "Incomplete", "Fail", "Failed", 10),
            (None, None, "KV", "Incomplete", "Fail", "Failed", 11),
        ],
    },
    # ── 3. Austria — Fachhochschule Vorarlberg (FHV) ──
    {
        "universities": ["Vorarlberg", "FHV"],
        "scheme": {
            "name": "Austrian Grading System",
            "scheme_type": "numeric_discrete",
            "grade_direction": "desc",
            "source": "proposed",
            "source_document": "Vorarlberg.xlsx",
        },
        "rules": [
            (None, None, "1", "Sehr Gut", "A", "Excellent", 1),
            (None, None, "2", "Gut", "B", "Very Good", 2),
            (None, None, "3", "Befriedigend", "C", "Satisfactory", 3),
            (None, None, "4", "Genügend", "D", "Sufficient", 4),
            (None, None, "5", "Nicht Genügend", "F", "Fail", 5),
        ],
    },
    # ── 4. Poland — Lodz, Kielce, Nysa ──
    {
        "universities": ["Lodz", "Kielce", "Nysa"],
        "scheme": {
            "name": "Polish Grading System",
            "scheme_type": "numeric_discrete",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Lodz University of Technology.xlsx",
        },
        "rules": [
            (None, None, "5.0", "Bardzo dobry (Very Good)", "A", "Very Good", 1),
            (None, None, "4.5", "Dobry plus (Good Plus)", "B", "Good Plus", 2),
            (None, None, "4.0", "Dobry (Good)", "C", "Good", 3),
            (None, None, "3.5", "Dostateczny plus (Satisfactory Plus)", "D", "Satisfactory Plus", 4),
            (None, None, "3.0", "Dostateczny (Satisfactory)", "E", "Satisfactory", 5),
            (None, None, "2.0", "Niedostateczny (Fail)", "F", "Fail", 6),
        ],
    },
    # ── 5. Czech Republic — Ostrava ──
    {
        "universities": ["Ostrava"],
        "scheme": {
            "name": "Czech Point-Based System (Ostrava)",
            "scheme_type": "numeric_range",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Ostrava.xlsx",
        },
        "rules": [
            ("91", "100", None, "Excellent", "A", "Excellent", 1),
            ("81", "90", None, "Very Good", "B", "Very Good", 2),
            ("71", "80", None, "Good", "C", "Good", 3),
            ("61", "70", None, "Satisfactory", "D", "Satisfactory", 4),
            ("51", "60", None, "Sufficient", "E", "Sufficient", 5),
            ("0", "50", None, "Fail", "F", "Fail", 6),
        ],
    },
    # ── 6. Czech Republic — Pardubice ──
    {
        "universities": ["Pardubice"],
        "scheme": {
            "name": "Czech Grading System (Pardubice)",
            "scheme_type": "numeric_discrete",
            "grade_direction": "desc",
            "source": "senate_decision",
            "source_document": "PARDUBICE ÜNİVERİTESİ (19.03.2015, No: 2014-2015/17)",
        },
        "rules": [
            (None, None, "1", None, "A", "Excellent", 1),
            (None, None, "1.5", None, "A", "Excellent", 2),
            (None, None, "2", None, "B", "Very Good", 3),
            (None, None, "2.5", None, "B", "Very Good", 4),
            (None, None, "3", None, "C", "Good", 5),
            (None, None, "4", None, "F", "Fail", 6),
        ],
    },
    # ── 7. Italy — Milano ──
    {
        "universities": ["Milano", "Milan"],
        "scheme": {
            "name": "Italian Grading System (0-30)",
            "scheme_type": "numeric_range",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Università degli Studi di Milano.xlsx",
            "notes": "No E grade — jumps from D to F",
        },
        "rules": [
            ("29", "30", None, "Ottimo / Eccellente", "A", "Excellent", 1),
            ("26", "28", None, "Molto Buono", "B", "Very Good", 2),
            ("22", "25", None, "Buono", "C", "Good", 3),
            ("18", "21", None, "Discreto", "D", "Sufficient", 4),
            ("1", "17", None, "Sufficiente", "F", "Fail", 5),
        ],
    },
    # ── 8. Portugal — Bragança ──
    {
        "universities": ["Braganca", "Bragança"],
        "scheme": {
            "name": "Portuguese Grading System (0-20)",
            "scheme_type": "numeric_range",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Polytechnic Institute of Bragança.xlsx",
        },
        "rules": [
            ("18", "20", None, None, "A", "Excellent", 1),
            ("16", "17", None, None, "B", "Very Good", 2),
            ("14", "15", None, None, "C", "Good", 3),
            ("12", "13", None, None, "D", "Satisfactory", 4),
            ("10", "11", None, None, "E", "Sufficient", 5),
            ("0", "9", None, None, "F", "Fail", 6),
        ],
    },
    # ── 9. Bulgaria — Varna ──
    {
        "universities": ["Varna"],
        "scheme": {
            "name": "Bulgarian Grading System",
            "scheme_type": "numeric_range",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Technical University of Varna.xlsx",
        },
        "rules": [
            ("5.50", "6.00", None, "Excellent", "A", "Excellent", 1),
            ("4.50", "5.49", None, "Very Good", "B", "Very Good", 2),
            ("3.50", "4.49", None, "Good", "C", "Good", 3),
            ("3.00", "3.49", None, "Sufficient", "D", "Sufficient", 4),
            ("2.01", "2.99", None, "Pass", "E", "Pass", 5),
            ("2.00", "2.00", None, "Fail", "F", "Fail", 6),
        ],
    },
    # ── 10. Romania — Romanian-American University ──
    {
        "universities": ["Romanian-American"],
        "scheme": {
            "name": "Romanian Grading System (1-10)",
            "scheme_type": "numeric_range",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Romanian-American University.xlsx",
        },
        "rules": [
            (None, None, "10", None, "A", "Excellent", 1),
            (None, None, "9", None, "B", "Very Good", 2),
            ("7", "8", None, None, "C", "Good", 3),
            (None, None, "6", None, "D", "Satisfactory", 4),
            (None, None, "5", None, "E", "Sufficient", 5),
            ("0", "4", None, None, "F", "Fail", 6),
            (None, None, "P", "Passed", "P", "Pass", 7),
        ],
    },
    # ── 11. Hungary — Gábor Dénes, Óbuda ──
    {
        "universities": ["Gábor Dénes", "Gabor Denes", "Óbuda", "Obuda"],
        "scheme": {
            "name": "Hungarian Grading System",
            "scheme_type": "numeric_discrete",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Gábor Dénes University.xlsx",
        },
        "rules": [
            (None, None, "5", "Excellent (Jeles)", "A", "Excellent", 1),
            (None, None, "4", "Good (Jó)", "B", "Good", 2),
            (None, None, "3", "Satisfactory (Közepes)", "C", "Satisfactory", 3),
            (None, None, "2", "Pass (Elégséges)", "D", "Pass", 4),
            (None, None, "1", "Fail (Elégtelen)", "F", "Fail", 5),
        ],
    },
    # ── 12. Estonia — EUAS ──
    {
        "universities": ["Estonian Entrepreneurship", "EUAS"],
        "scheme": {
            "name": "Estonian Grading System",
            "scheme_type": "numeric_discrete",
            "grade_direction": "asc",
            "source": "proposed",
            "source_document": "Estonian Entrepreneurship University of Applied Sciences.xlsx",
        },
        "rules": [
            (None, None, "5", "Excellent (Jeles)", "A", "Excellent", 1),
            (None, None, "4", "Good (Jó)", "B", "Good", 2),
            (None, None, "3", "Satisfactory (Közepes)", "C", "Satisfactory", 3),
            (None, None, "2", "Pass (Elégséges)", "D", "Pass", 4),
            (None, None, "1", "Fail (Elégtelen)", "F", "Fail", 5),
        ],
    },
]


def _find_university(db, name_substring):
    """Find a university by case-insensitive name substring match."""
    return db.query(University).filter(
        University.name.ilike(f"%{name_substring}%")
    ).first()


def _ensure_university(db, name, country, pdf_structure="individual"):
    """Find or create a university."""
    uni = db.query(University).filter(University.name.ilike(f"%{name}%")).first()
    if uni:
        return uni
    uni = University(name=name, country=country, pdf_structure=pdf_structure, is_active=True)
    dept_id = _get_default_department_id(db)
    if dept_id:
        uni.department_id = dept_id
    db.add(uni)
    db.flush()
    return uni


def seed_grading_schemes():
    db = SessionLocal()
    try:
        # ── Add missing universities ──
        print("Ensuring missing universities exist...")
        for name, country, pdf_struct in MISSING_UNIVERSITIES:
            uni = _ensure_university(db, name, country, pdf_struct)
            print(f"  University: {uni.name} (id={uni.id})")
        db.commit()

        # ── Seed grading schemes ──
        scheme_count = 0
        rule_count = 0

        for scheme_def in SCHEMES:
            scheme_data = scheme_def["scheme"]
            matched_unis = set()

            for uni_sub in scheme_def["universities"]:
                uni = _find_university(db, uni_sub)
                if uni:
                    matched_unis.add(uni)

            if not matched_unis:
                print(f"  SKIP (no university found): {scheme_data['name']} "
                      f"— searched: {scheme_def['universities']}")
                continue

            for uni in matched_unis:
                # Check if scheme already exists for this university
                existing = db.query(GradingScheme).filter(
                    GradingScheme.university_id == uni.id,
                    GradingScheme.name == scheme_data["name"],
                ).first()
                if existing:
                    print(f"  EXISTS: {scheme_data['name']} for {uni.name}")
                    continue

                scheme = GradingScheme(
                    university_id=uni.id,
                    name=scheme_data.get("name"),
                    scheme_type=scheme_data.get("scheme_type"),
                    grade_direction=scheme_data.get("grade_direction"),
                    notes=scheme_data.get("notes"),
                )
                db.add(scheme)
                db.flush()
                scheme_count += 1

                for min_val, max_val, exact, definition, ects, desc, order in scheme_def["rules"]:
                    rule = GradeConversionRule(
                        grading_scheme_id=scheme.id,
                        local_grade_min=min_val,
                        local_grade_max=max_val,
                        local_grade_exact=exact,
                        local_definition=definition,
                        ects_grade=ects,
                        description=desc,
                        sort_order=order,
                    )
                    db.add(rule)
                    rule_count += 1

                print(f"  CREATED: {scheme_data['name']} for {uni.name} ({len(scheme_def['rules'])} rules)")

        # ── Seed ECTS → IKU if empty ──
        ects_count = db.query(EctsIkuConversion).count()
        if ects_count == 0:
            ects_data = [
                ("A", "A"), ("B", "A-"), ("C", "B+"), ("D", "C+"), ("E", "C"),
                ("FX", "F"), ("F", "F"), ("P", "Y"), ("Fail", "Z"),
            ]
            for ects, iku in ects_data:
                db.add(EctsIkuConversion(
                    ects_grade=ects, iku_grade=iku,
                ))
            db.commit()
            print(f"  SEEDED: ECTS->IKU table ({len(ects_data)} rows)")
        else:
            print(f"  EXISTS: ECTS->IKU table ({ects_count} rows)")

        db.commit()
        print(f"\nDone! Created {scheme_count} schemes, {rule_count} rules.")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_grading_schemes()
