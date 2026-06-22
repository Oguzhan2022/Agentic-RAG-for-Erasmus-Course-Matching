"""
Generates the LLM prompt for university profile data collection.
Rankings are included in the schema — the LLM searches the web for them.
Numbeo cost data is scraped separately.
"""
import json


JSON_SCHEMA = {
    "university_name": "string — exact official name",
    "city": "string",
    "country": "string",

    "rankings": {
        "_note": "Search each ranking site and fill what you find. Use null if not ranked or not found.",
        "qs_world": "integer or null — from topuniversities.com QS World University Rankings",
        "the_world": "integer or null — from timeshighereducation.com World University Rankings",
        "cwur_world": "integer or null — from cwur.org Global 2000 list",
        "shanghai_world": "integer or null — from shanghairanking.com ARWU",
        "urap_world": "integer or null — from urapcenter.org",
        "edurank_world": "integer or null — from edurank.org overall world rank",
        "unirank_world": "integer or null — from unirank.org world rank"
    },

    "city_profile": {
        "description": "2-3 paragraphs: city character, atmosphere, what student life is like, why Erasmus students choose or avoid it",
        "safety_level": "high | medium | low",
        "english_friendliness": "high | medium | low — how easy daily life is with only English",
        "climate": "brief description of seasons, typical weather, what to expect",
        "population": "integer or null"
    },

    "transportation": {
        "nearest_airport": "airport name and IATA code",
        "airport_distance_km": "integer or null",
        "airport_transport": "how to travel from airport to university/city center — options, duration, cost in EUR",
        "public_transport_quality": "description of local network (bus, tram, metro, bike) and student discounts",
        "distance_to_city_center": "e.g. '3 km, 15 min by tram'",
        "notable_connections": ["list of nearby cities reachable easily by train or bus"]
    },

    "accommodation": {
        "university_dorm_available": "boolean",
        "dorm_cost_per_term_eur_min": "integer — one term ≈ 5 months",
        "dorm_cost_per_term_eur_max": "integer",
        "private_room_monthly_eur_min": "integer",
        "private_room_monthly_eur_max": "integer",
        "housing_difficulty": "easy | moderate | hard — how hard to find housing as an Erasmus student",
        "notes": "application deadlines, platform names (e.g. HousingAnywhere, Uniplaces), tips"
    },

    "cost_of_living": {
        "monthly_total_eur": "integer — realistic total for a student (rent + food + transport + misc)",
        "rent_monthly_eur": "integer — typical student room",
        "food_monthly_eur": "integer — groceries + occasional eating out",
        "transport_monthly_eur": "integer — monthly pass or typical spend",
        "misc_monthly_eur": "integer — phone, leisure, personal items",
        "erasmus_grant_sufficient": "boolean — does typical Erasmus grant cover basic living?"
    },

    "social_life": {
        "nightlife": "description of nightlife scene — bars, clubs, student areas",
        "erasmus_community": "how active and welcoming the Erasmus/ESN community is",
        "student_organizations": "ESN chapter presence, notable student events, international student integration",
        "key_spots": ["famous student hangout spots, neighborhoods, must-see places"]
    },

    "academic": {
        "language_of_instruction": "primary language; note English availability",
        "english_courses_available": "boolean",
        "notable_programs": ["what the university is especially known for"],
        "special_notes": "anything Erasmus students specifically should know (registration, workload, culture)"
    },

    "student_summary": {
        "best_for": ["type of student or interest this destination suits best"],
        "watch_out_for": ["potential downsides, challenges, or things to be careful about"],
        "overall_rating": "budget_heaven | good_value | expensive"
    },

    "sources": [
        {"title": "page title", "url": "https://..."}
    ]
}


def generate_prompt(
    university_name: str,
    city: str,
    country: str,
    existing_numbeo: dict | None = None,
) -> str:
    schema_str = json.dumps(JSON_SCHEMA, indent=2, ensure_ascii=False)

    if existing_numbeo:
        cost_instruction = f"""3. For **cost of living**: We already have partial Numbeo data for {city}:
   - Monthly total: ~{existing_numbeo.get('monthly_total_eur')} EUR
   - Rent: ~{existing_numbeo.get('rent_monthly_eur')} EUR/month
   - Food: ~{existing_numbeo.get('food_monthly_eur')} EUR/month
   - Transport: ~{existing_numbeo.get('transport_monthly_eur')} EUR/month
   Use these as a baseline. Search student blogs, Erasmus reports, and forums to verify and fill in any missing details in `cost_of_living`."""
    else:
        cost_instruction = f"""3. For **cost of living**: Numbeo does not have data for {city}. Search thoroughly:
   - Search "{city} cost of living student" and "{city} Erasmus budget"
   - Check student blogs, university international office pages, and Erasmus experience reports
   - Look for Reddit threads: "r/erasmus {city}", "r/solotravel {city} budget"
   - Provide realistic monthly estimates in EUR for rent, food, transport, and total
   All figures must be in **EUR** (convert from local currency at current rates if needed)."""

    prompt = f"""You are an expert assistant helping Erasmus exchange students make informed decisions about partner universities. Generate a comprehensive, accurate profile for:

**University:** {university_name}
**City:** {city}
**Country:** {country}

## INSTRUCTIONS

1. Search the web thoroughly for up-to-date information from multiple reliable sources.
2. For **rankings**: visit each ranking site directly and search for this university:
   - QS: topuniversities.com → search "{university_name}"
   - THE: timeshighereducation.com → search "{university_name}"
   - CWUR: cwur.org/2025.php → search in the table
   - Shanghai (ARWU): shanghairanking.com → search "{university_name}"
   - URAP: urapcenter.org → search "{university_name}"
   - edurank: edurank.org → search "{university_name}" for overall world rank
   - uniRank: unirank.org → search "{university_name}" for world rank
   If a university is not found on a ranking site, use **null** (do not guess).
{cost_instruction}
4. For **city profile and student life**: search for "{city} Erasmus student experience", "{university_name} international students guide", "living in {city} as a student".
5. Do NOT invent data. Only include information you can verify from real sources.
6. All cost figures must be in **EUR**. Convert from local currency at current rates if needed.
7. List every source you consulted in the `sources` array.

## OUTPUT FORMAT

⚠️ CRITICAL — READ CAREFULLY BEFORE RESPONDING:

Your entire response must be a **single valid JSON object**. Follow these rules exactly:

**Structure rules:**
- Every key in the schema must be present — do not omit any field
- Use `null` for unknown integers, `false` for unknown booleans, `""` for unknown strings, `[]` for unknown arrays
- Do NOT add extra keys not in the schema
- Do NOT add `// comments` inside JSON (comments are not valid JSON)
- Arrays must use `[]` syntax — never omit brackets even for single items
- Booleans must be `true` or `false` (lowercase) — never `"true"` or `"yes"`
- Integers must be plain numbers — never `"~500"` or `"500 EUR"` or `"500-600"`
- Enum fields must be EXACTLY one of the listed values:
  - `safety_level`: exactly `"high"`, `"medium"`, or `"low"`
  - `english_friendliness`: exactly `"high"`, `"medium"`, or `"low"`
  - `housing_difficulty`: exactly `"easy"`, `"moderate"`, or `"hard"`
  - `overall_rating`: exactly `"budget_heaven"`, `"good_value"`, or `"expensive"`

**Format rules:**
- Do NOT wrap output in ```json ... ``` or any code block
- Do NOT write any explanation, title, or text before or after the JSON
- Do NOT use trailing commas (invalid in JSON)
- Do NOT embed citation links like `[source](url)` inside string values — put all sources in the `sources` array only
- Start your response with `{{` and end with `}}`

**The schema to fill:**

{schema_str}"""

    return prompt
