import os
import json
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text, DateTime,
    ForeignKey, CheckConstraint, TypeDecorator, UniqueConstraint, Table,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
from db.database import Base, DATABASE_URL

# Use JSON type for PostgreSQL, JSON-as-text for SQLite
if DATABASE_URL.startswith("postgresql"):
    from sqlalchemy.dialects.postgresql import JSON as JSONType
else:
    class JSONType(TypeDecorator):
        """Store JSON as text for SQLite compatibility."""
        impl = Text
        cache_ok = True

        def process_bind_param(self, value, dialect):
            if value is not None:
                return json.dumps(value)
            return None

        def process_result_value(self, value, dialect):
            if value is not None:
                return json.loads(value)
            return None


# Junction table for TranscriptGradeEntry <-> Home Courses (relation to Courses table)
transcript_entry_home_courses = Table(
    "transcript_entry_home_courses",
    Base.metadata,
    Column("entry_id", Integer, ForeignKey("transcript_grade_entries.id", ondelete="CASCADE"), primary_key=True),
    Column("home_course_id", Integer, ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True)
)


class University(Base):
    __tablename__ = "universities"
    __table_args__ = (
        UniqueConstraint('name', 'department_id', name='uq_university_name_dept'),
    )

    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(255), nullable=False)
    country = Column(String(100))
    city = Column(String(100))
    pdf_structure = Column(String(20), nullable=False, default="individual")
    is_home = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    ingestion_status = Column(String(20), default="pending")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    department = relationship("Department")
    courses = relationship("Course", back_populates="university", cascade="all, delete-orphan", passive_deletes=False)
    batches = relationship("IngestionBatch", back_populates="university", cascade="all, delete-orphan", passive_deletes=False)


class IngestionBatch(Base):
    __tablename__ = "ingestion_batches"

    id = Column(Integer, primary_key=True, index=True)
    university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    semester = Column(String(20))
    status = Column(String(20), default="pending")
    total_courses = Column(Integer, default=0)
    parsed_courses = Column(Integer, default=0)
    failed_courses = Column(Integer, default=0)
    error_log = Column(Text)
    started_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime)

    university = relationship("University", back_populates="batches")
    courses = relationship("Course", back_populates="batch", cascade="all, delete-orphan", passive_deletes=False)


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    ingestion_batch_id = Column(Integer, ForeignKey("ingestion_batches.id", ondelete="SET NULL"))
    course_code = Column(String(50), index=True)
    course_name = Column(String(500), nullable=False, index=True)
    ects = Column(Float)
    content = Column(Text)
    learning_outcomes = Column(Text)
    academic_context = Column(JSONType, default=dict)
    metadata_quality = Column(JSONType, default=dict)
    source_metadata = Column(JSONType, default=dict)
    raw_text = Column(Text)
    embedding = Column(Vector(384), nullable=True)
    warnings = Column(JSONType, default=list)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    university = relationship("University", back_populates="courses")
    batch = relationship("IngestionBatch", back_populates="courses")


class UploadJob(Base):
    """Tracks upload+parse jobs with queue support and cancel/pause capability."""
    __tablename__ = "upload_jobs"

    id = Column(Integer, primary_key=True, index=True)
    university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    ingestion_batch_id = Column(Integer, ForeignKey("ingestion_batches.id", ondelete="SET NULL"), nullable=True)
    semester = Column(String(20), default="unknown")
    category = Column(String(100), nullable=True)
    pdf_structure_override = Column(String(20), nullable=True)  # Override university default for this job
    # Status: queued -> uploading -> parsing -> paused | completed | cancelled | failed
    status = Column(String(20), default="queued")
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    failed_files = Column(Integer, default=0)
    current_file = Column(String(500), nullable=True)
    file_manifest = Column(JSONType, nullable=True)  # Stored file list for resume consistency
    error_log = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime, nullable=True)

    university = relationship("University")
    batch = relationship("IngestionBatch", foreign_keys=[ingestion_batch_id])


class Faculty(Base):
    __tablename__ = "faculties"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    code = Column(String(20), unique=True, nullable=False)  # e.g., "ENG", "ARCH"
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    departments = relationship("Department", back_populates="faculty")


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    code = Column(String(20), unique=True, nullable=False)  # e.g., "COM", "EE"
    faculty_id = Column(Integer, ForeignKey("faculties.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True)

    faculty = relationship("Faculty", back_populates="departments")


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)  # "super_admin", "coordinator", "student"
    description = Column(String(255))
    created_at = Column(DateTime, server_default=func.now())


class UserRoleAssignment(Base):
    __tablename__ = "user_role_assignments"
    __table_args__ = (
        CheckConstraint("department_id IS NULL OR faculty_id IS NULL", name="chk_user_role_scope"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    faculty_id = Column(Integer, ForeignKey("faculties.id", ondelete="SET NULL"), nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    role = relationship("Role")
    department = relationship("Department")
    faculty = relationship("Faculty")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    eid = Column(String(50), unique=True, nullable=False, index=True)  # CATS ID or "admin"
    email = Column(String(255), unique=True, nullable=True)
    name = Column(String(255))
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    credentials = relationship("UserCredentials", back_populates="user", uselist=False, cascade="all, delete-orphan", passive_deletes=False)
    role_assignments = relationship("UserRoleAssignment", foreign_keys=[UserRoleAssignment.user_id], backref="user")

    # Convenience properties — delegate to credentials row
    @property
    def password_hash(self):
        return self.credentials.password_hash if self.credentials else None

    @password_hash.setter
    def password_hash(self, value):
        if not self.credentials:
            self.credentials = UserCredentials()
        self.credentials.password_hash = value

    @property
    def temp_password_hash(self):
        return self.credentials.temp_password_hash if self.credentials else None

    @temp_password_hash.setter
    def temp_password_hash(self, value):
        if not self.credentials:
            self.credentials = UserCredentials()
        self.credentials.temp_password_hash = value

    @property
    def needs_cats_link(self):
        return self.credentials.needs_cats_link if self.credentials else False

    @needs_cats_link.setter
    def needs_cats_link(self, value):
        if not self.credentials:
            self.credentials = UserCredentials()
        self.credentials.needs_cats_link = value


class UserCredentials(Base):
    __tablename__ = "user_credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=True)
    temp_password_hash = Column(String(255), nullable=True)
    needs_cats_link = Column(Boolean, default=False)

    user = relationship("User", back_populates="credentials")




class MatchJob(Base):
    """Tracks batch matching jobs with queue support (pause/resume/cancel)."""
    __tablename__ = "match_jobs"

    id = Column(Integer, primary_key=True, index=True)
    partner_university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    home_university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="queued")
    llm_mode = Column(String(20), default="sequential")  # sequential or batch
    total_courses = Column(Integer, default=0)
    processed_courses = Column(Integer, default=0)
    failed_courses = Column(Integer, default=0)
    current_course = Column(String(500), nullable=True)
    course_manifest = Column(JSONType, nullable=True)
    error_log = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime, nullable=True)

    partner_university = relationship("University", foreign_keys=[partner_university_id])
    home_university = relationship("University", foreign_keys=[home_university_id])


class CourseMatch(Base):
    """Unified AI match analysis results — both batch pipeline and manual coordinator analyses.

    source='batch': Created by the batch matching pipeline (match_job_id is set).
    source='manual': Created on-demand by coordinator manual review (selection_id is set).
    """
    __tablename__ = "course_matches"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(20), default="batch")  # 'batch' or 'manual'

    # Batch pipeline context (NULL for manual analyses)
    match_job_id = Column(Integer, ForeignKey("match_jobs.id", ondelete="CASCADE"), nullable=True)

    # Manual review context (NULL for batch analyses)
    selection_id = Column(Integer, ForeignKey("student_course_selections.id", ondelete="CASCADE"), nullable=True)
    coordinator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Core match pair
    partner_course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    home_course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)

    partner_course = relationship("Course", foreign_keys=[partner_course_id])
    home_course = relationship("Course", foreign_keys=[home_course_id])

    # Fusion score
    overall_score = Column(Float)
    score_breakdown = Column(JSONType, default=dict)

    # Semantic analysis
    matched_topics = Column(JSONType, default=list)
    missing_topics = Column(JSONType, default=list)
    warnings = Column(JSONType, default=list)
    category = Column(String(20))
    rank = Column(Integer, default=1)



    # Verification Fields
    verification_status = Column(String(20), nullable=True)     # "approved", "rejected", "risk_flagged"
    verification_confidence = Column(Float, nullable=True)
    verification_reason = Column(Text, nullable=True)
    verification_risk_flags = Column(JSONType, default=list)
    is_recommended = Column(Boolean, default=False)

    # V2 Expanded Academic Insights
    core_home_topics = Column(JSONType, default=list)
    extra_partner_topics = Column(JSONType, default=list)
    structural_notes = Column(JSONType, default=list)
    content_overlap_assessment = Column(String(100), nullable=True)
    core_topic_coverage = Column(String(50), nullable=True)



    created_at = Column(DateTime, server_default=func.now())


class StudentApplication(Base):
    """Top-level application package per student per partner university."""
    __tablename__ = "student_applications"
    __table_args__ = (
        UniqueConstraint('student_id', 'partner_university_id', 'semester', name='uq_student_app'),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    partner_university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    semester = Column(String(20), nullable=True)  # "fall", "spring", "full_year"
    status = Column(String(40), default="draft")
    total_partner_ects = Column(Float, default=0)
    approved_partner_ects = Column(Float, default=0)
    submitted_at = Column(DateTime, nullable=True)
    reviewer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    student_notes = Column(Text, nullable=True)
    coordinator_notes = Column(Text, nullable=True)
    coordinator_editing = Column(Boolean, default=False)
    student_editing = Column(Boolean, default=True)
    coordinator_viewed_at = Column(DateTime, nullable=True)
    student_draft_viewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("User", foreign_keys=[student_id])
    partner_university = relationship("University", foreign_keys=[partner_university_id])
    department = relationship("Department")
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    selections = relationship("StudentCourseSelection", back_populates="application", cascade="all, delete-orphan")


class StudentCourseSelection(Base):
    """Per-course selection within a student application."""
    __tablename__ = "student_course_selections"
    __table_args__ = (
        UniqueConstraint('application_id', 'partner_course_id', name='uq_selection_course'),
    )

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("student_applications.id", ondelete="CASCADE"), nullable=False)
    partner_course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    selected_home_course_id = Column(Integer, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    course_match_id = Column(Integer, ForeignKey("course_matches.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(40), default="not_selected")
    no_match_requested = Column(Boolean, default=False)
    was_approved = Column(Boolean, default=False)  # True if course was approved then removed by student
    student_notes = Column(Text, nullable=True)
    selected_home_course_ids = Column(JSONType, default=list)   # multi-select: list of home course IDs
    selected_course_match_ids = Column(JSONType, default=list)  # multi-select: matching course_match IDs
    coordinator_override_course_ids = Column(JSONType, default=list)  # coordinator overrides: list of home course IDs

    alternative_home_course_ids = Column(JSONType, default=list)  # student-suggested alternatives
    rejected_home_course_ids = Column(JSONType, default=list)     # Courses explicitly rejected by coordinator for this selection
    alternative_reason = Column(Text, nullable=True)              # student's reason for suggestion
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    application = relationship("StudentApplication", back_populates="selections")
    partner_course = relationship("Course", foreign_keys=[partner_course_id])
    selected_home_course = relationship("Course", foreign_keys=[selected_home_course_id])
    course_match = relationship("CourseMatch", foreign_keys=[course_match_id])


class WorkflowStateLog(Base):
    """Audit trail for every state transition."""
    __tablename__ = "workflow_state_logs"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(50), nullable=False)  # 'student_application' or 'student_course_selection'
    entity_id = Column(Integer, nullable=False)
    from_state = Column(String(40), nullable=True)
    to_state = Column(String(40), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_role = Column(String(50), nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    actor = relationship("User")


class CoordinatorReview(Base):
    """Consolidated coordinator review, decision, and feedback log."""
    __tablename__ = "coordinator_reviews"

    id = Column(Integer, primary_key=True, index=True)
    coordinator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    application_id = Column(Integer, ForeignKey("student_applications.id", ondelete="CASCADE"), nullable=True)
    selection_id = Column(Integer, ForeignKey("student_course_selections.id", ondelete="SET NULL"), nullable=True)
    partner_course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=True)
    home_course_id = Column(Integer, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    course_match_id = Column(Integer, ForeignKey("course_matches.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(40), nullable=False)  # approve/reject/override/manual_review etc.
    override_details = Column(Text, nullable=True)
    override_home_course_id = Column(Integer, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    coordinator = relationship("User", foreign_keys=[coordinator_id])
    application = relationship("StudentApplication")
    selection = relationship("StudentCourseSelection")
    partner_course = relationship("Course", foreign_keys=[partner_course_id])
    home_course = relationship("Course", foreign_keys=[home_course_id])
    override_home_course = relationship("Course", foreign_keys=[override_home_course_id])



class JSONFieldDescriptor:
    def __init__(self, key, default=None):
        self.key = key
        self.default = default

    def __get__(self, instance, owner):
        if instance is None:
            return self
        if not instance.profile_data:
            return self.default
        return instance.profile_data.get(self.key, self.default)

    def __set__(self, instance, value):
        data = dict(instance.profile_data) if instance.profile_data else {}
        data[self.key] = value
        instance.profile_data = data


class UniversityProfile(Base):
    """Rich profile data for a partner university — rankings, costs, city info."""
    __tablename__ = "university_profiles"

    id = Column(Integer, primary_key=True, index=True)
    university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Store all rich profile attributes dynamically in a single, highly flexible JSON column!
    profile_data = Column(JSONType, default=dict)

    # Sources cited by LLM
    sources = Column(JSONType, default=list)

    llm_imported_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Rankings (delegated via descriptors for 100% backward compatibility)
    qs_world = JSONFieldDescriptor("qs_world")
    the_world = JSONFieldDescriptor("the_world")
    cwur_world = JSONFieldDescriptor("cwur_world")
    shanghai_world = JSONFieldDescriptor("shanghai_world")
    urap_world = JSONFieldDescriptor("urap_world")
    edurank_world = JSONFieldDescriptor("edurank_world")
    unirank_world = JSONFieldDescriptor("unirank_world")

    # Numbeo cost of living (scraped)
    numbeo_monthly_total_eur = JSONFieldDescriptor("numbeo_monthly_total_eur")
    numbeo_rent_monthly_eur = JSONFieldDescriptor("numbeo_rent_monthly_eur")
    numbeo_food_monthly_eur = JSONFieldDescriptor("numbeo_food_monthly_eur")
    numbeo_transport_monthly_eur = JSONFieldDescriptor("numbeo_transport_monthly_eur")

    # LLM-generated city profile
    city_description = JSONFieldDescriptor("city_description")
    safety_level = JSONFieldDescriptor("safety_level")
    english_friendliness = JSONFieldDescriptor("english_friendliness")
    climate = JSONFieldDescriptor("climate")
    city_population = JSONFieldDescriptor("city_population")

    # Transportation
    nearest_airport = JSONFieldDescriptor("nearest_airport")
    airport_distance_km = JSONFieldDescriptor("airport_distance_km")
    airport_transport = JSONFieldDescriptor("airport_transport")
    public_transport_quality = JSONFieldDescriptor("public_transport_quality")
    distance_to_city_center = JSONFieldDescriptor("distance_to_city_center")
    notable_connections = JSONFieldDescriptor("notable_connections", default=[])

    # Accommodation
    dorm_available = JSONFieldDescriptor("dorm_available")
    dorm_cost_min_eur = JSONFieldDescriptor("dorm_cost_min_eur")
    dorm_cost_max_eur = JSONFieldDescriptor("dorm_cost_max_eur")
    private_room_min_eur = JSONFieldDescriptor("private_room_min_eur")
    private_room_max_eur = JSONFieldDescriptor("private_room_max_eur")
    housing_difficulty = JSONFieldDescriptor("housing_difficulty")
    accommodation_notes = JSONFieldDescriptor("accommodation_notes")

    # Cost context
    erasmus_grant_sufficient = JSONFieldDescriptor("erasmus_grant_sufficient")

    # Social life
    nightlife = JSONFieldDescriptor("nightlife")
    erasmus_community = JSONFieldDescriptor("erasmus_community")
    student_organizations = JSONFieldDescriptor("student_organizations")
    key_spots = JSONFieldDescriptor("key_spots", default=[])

    # Academic
    language_of_instruction = JSONFieldDescriptor("language_of_instruction")
    english_courses_available = JSONFieldDescriptor("english_courses_available")
    notable_programs = JSONFieldDescriptor("notable_programs", default=[])
    academic_notes = JSONFieldDescriptor("academic_notes")

    # Student summary
    best_for = JSONFieldDescriptor("best_for", default=[])
    watch_out_for = JSONFieldDescriptor("watch_out_for", default=[])
    overall_rating = JSONFieldDescriptor("overall_rating")

    university = relationship("University", backref="profile")


class GradingScheme(Base):
    __tablename__ = "grading_schemes"

    id = Column(Integer, primary_key=True, index=True)
    university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    scheme_type = Column(String(50), nullable=False)
    grade_direction = Column(String(10))
    is_active = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    university = relationship("University", backref="grading_schemes")
    rules = relationship("GradeConversionRule", back_populates="scheme", cascade="all, delete-orphan", passive_deletes=False)


class GradeConversionRule(Base):
    __tablename__ = "grade_conversion_rules"

    id = Column(Integer, primary_key=True, index=True)
    grading_scheme_id = Column(Integer, ForeignKey("grading_schemes.id", ondelete="CASCADE"), nullable=False)
    local_grade_min = Column(String(20))
    local_grade_max = Column(String(20))
    local_grade_exact = Column(String(20))
    local_definition = Column(String(200))
    ects_grade = Column(String(10), nullable=False)
    description = Column(String(200))
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    scheme = relationship("GradingScheme", back_populates="rules")


class EctsIkuConversion(Base):
    __tablename__ = "ects_iku_conversion"

    id = Column(Integer, primary_key=True, index=True)
    ects_grade = Column(String(10), nullable=False, unique=True)
    iku_grade = Column(String(10), nullable=False)
    is_active = Column(Boolean, default=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False)  # "ASSIGN_ROLE", "TOGGLE_ROLE", "REMOVE_ROLE"
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    details = Column(JSONType, default=dict)
    created_at = Column(DateTime, server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])
    target_user = relationship("User", foreign_keys=[target_user_id])


class StudentTranscript(Base):
    """Uploaded transcript PDF from a returning Erasmus student."""
    __tablename__ = "student_transcripts"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    application_id = Column(Integer, ForeignKey("student_applications.id", ondelete="SET NULL"), nullable=True)
    partner_university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=True)
    partner_university_name = Column(String(500), nullable=True)
    file_path = Column(String(500), nullable=True)
    original_filename = Column(String(500))
    status = Column(String(30), default="uploaded")  # uploaded, grading_in_progress, graded, finalized
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    grading_scheme_version_id = Column(Integer, ForeignKey("grading_scheme_snapshots.id", ondelete="SET NULL"), nullable=True)
    ects_iku_version_id = Column(Integer, ForeignKey("ects_iku_snapshots.id", ondelete="SET NULL"), nullable=True)
    graded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    graded_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("User", foreign_keys=[student_id])
    application = relationship("StudentApplication")
    department = relationship("Department")
    partner_university = relationship("University")
    grader = relationship("User", foreign_keys=[graded_by])
    pinned_grading_scheme_version = relationship("GradingSchemeSnapshot", foreign_keys=[grading_scheme_version_id])
    pinned_ects_iku_version = relationship("EctsIkuSnapshot", foreign_keys=[ects_iku_version_id])
    grade_entries = relationship("TranscriptGradeEntry", back_populates="transcript", cascade="all, delete-orphan")


class TranscriptGradeEntry(Base):
    """Individual grade entry within a transcript."""
    __tablename__ = "transcript_grade_entries"

    id = Column(Integer, primary_key=True, index=True)
    transcript_id = Column(Integer, ForeignKey("student_transcripts.id", ondelete="CASCADE"), nullable=False)
    partner_course_id = Column(Integer, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    partner_course_name = Column(String(500), nullable=False, index=True)
    partner_course_code = Column(String(50), nullable=True, index=True)
    partner_ects = Column(Float, nullable=True)
    local_grade = Column(String(20), nullable=True)
    ects_grade = Column(String(10), nullable=True)
    iku_grade = Column(String(10), nullable=True)
    conversion_method = Column(String(30), nullable=True)  # auto_local, auto_ects, manual_override
    is_db_course = Column(Boolean, default=False)  # DEPRECATED — kept for backward compat, use partner_course_id check instead
    entered_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    transcript = relationship("StudentTranscript", back_populates="grade_entries")
    partner_course = relationship("Course", foreign_keys=[partner_course_id])
    home_courses = relationship("Course", secondary=transcript_entry_home_courses)

    @property
    def mapped_home_course_ids(self) -> list[int]:
        """Backward compatibility: return list of IDs of mapped home courses."""
        return [c.id for c in self.home_courses]



class GradeConversionAudit(Base):
    """Audit trail for every grade conversion (auto or manual override)."""
    __tablename__ = "grade_conversion_audit"

    id = Column(Integer, primary_key=True, index=True)
    grade_entry_id = Column(Integer, ForeignKey("transcript_grade_entries.id", ondelete="SET NULL"), nullable=True)
    transcript_id = Column(Integer, ForeignKey("student_transcripts.id", ondelete="CASCADE"), nullable=False)
    partner_course_name = Column(String(500), nullable=True)
    partner_course_code = Column(String(50), nullable=True)
    source_grade = Column(String(20))  # local_grade or ects_grade that was input
    target_iku_grade = Column(String(10))  # resulting IKU grade
    conversion_method = Column(String(30))  # auto_local, auto_ects, manual_override
    is_manual_override = Column(Boolean, default=False)
    overridden_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    previous_iku_grade = Column(String(10), nullable=True)  # old value before override
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class GradingSchemeSnapshot(Base):
    """Immutable snapshot of a grading scheme + all its rules at a point in time."""
    __tablename__ = "grading_scheme_snapshots"
    __table_args__ = (
        UniqueConstraint('grading_scheme_id', 'version_number', name='uq_scheme_snapshot_version'),
    )

    id = Column(Integer, primary_key=True, index=True)
    grading_scheme_id = Column(Integer, ForeignKey("grading_schemes.id", ondelete="SET NULL"), nullable=True)
    version_number = Column(Integer, nullable=False)
    scheme_snapshot = Column(JSONType, nullable=False)
    rules_snapshot = Column(JSONType, nullable=False)
    senate_decision_id = Column(Integer, ForeignKey("senate_decisions.id", ondelete="SET NULL"), nullable=True)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    changed_by_user = relationship("User", foreign_keys=[changed_by])
    grading_scheme = relationship("GradingScheme", foreign_keys=[grading_scheme_id])
    senate_decision = relationship("SenateDecision")


class EctsIkuSnapshot(Base):
    """Immutable snapshot of all ECTS-IKU mappings at a point in time."""
    __tablename__ = "ects_iku_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    version_number = Column(Integer, nullable=False)
    mappings_snapshot = Column(JSONType, nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    changed_by_user = relationship("User", foreign_keys=[changed_by])

class SenateDecision(Base):
    """Senate decisions — official rulings for grade conversion, course equivalency, etc."""
    __tablename__ = "senate_decisions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    decision_date = Column(DateTime, nullable=False)
    reference_no = Column(String(100), index=True, nullable=False)
    decision_type = Column(String(100), nullable=False)  # grade_conversion, course_equivalency, general
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    faculty_id = Column(Integer, ForeignKey("faculties.id", ondelete="SET NULL"), nullable=True)
    university_id = Column(Integer, ForeignKey("universities.id", ondelete="SET NULL"), nullable=True)
    summary = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    file_path = Column(String(500), nullable=True)
    original_filename = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    department = relationship("Department")
    faculty = relationship("Faculty")
    university = relationship("University")


class TransferDocument(Base):
    """Uploaded manual transfer document (PDF/DOCX) parsed by registrar."""
    __tablename__ = "transfer_documents"

    id = Column(Integer, primary_key=True, index=True)
    partner_university_id = Column(Integer, ForeignKey("universities.id", ondelete="CASCADE"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    original_filename = Column(String(500), nullable=False)
    file_path = Column(String(500))
    file_size = Column(Integer)
    student_name = Column(String(300))
    student_number = Column(String(50))
    parsing_method = Column(String(20))
    parsed_rows = Column(JSONType, default=list)
    grading_scheme_version_id = Column(Integer, ForeignKey("grading_scheme_snapshots.id", ondelete="SET NULL"))
    ects_iku_version_id = Column(Integer, ForeignKey("ects_iku_snapshots.id", ondelete="SET NULL"))
    verification_status = Column(String(30), default="not_verified")
    total_rows = Column(Integer, default=0)
    valid_rows = Column(Integer, default=0)
    invalid_rows = Column(Integer, default=0)
    manual_check_rows = Column(Integer, default=0)
    partial_rows = Column(Integer, default=0)
    review_status = Column(String(30), default="pending")
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at = Column(DateTime)
    review_notes = Column(Text)
    version_reviews = Column(JSONType, default=dict)  # {version_number: {status, by, at, notes}}
    version_files = Column(JSONType, default=dict)    # {version_number: {filename, file_path}}
    version_parsed_rows = Column(JSONType, default=dict) # {version_number: [rows]}
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    partner_university = relationship("University")
    department = relationship("Department")
    grading_scheme_version = relationship("GradingSchemeSnapshot", foreign_keys=[grading_scheme_version_id])
    ects_iku_version = relationship("EctsIkuSnapshot", foreign_keys=[ects_iku_version_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    uploader = relationship("User", foreign_keys=[uploaded_by])
    verification_results = relationship("TransferVerificationResult", back_populates="transfer_document", cascade="all, delete-orphan")


class TransferVerificationResult(Base):
    """Per-row verification result for a transfer document."""
    __tablename__ = "transfer_verification_results"
    __table_args__ = (
        UniqueConstraint('transfer_document_id', 'version_number', 'row_index', name='uq_transfer_doc_version_row'),
    )

    id = Column(Integer, primary_key=True, index=True)
    transfer_document_id = Column(Integer, ForeignKey("transfer_documents.id", ondelete="CASCADE"), nullable=False)
    row_index = Column(Integer, nullable=False, default=0)
    partner_course_name = Column(String(500), nullable=False, default="")
    partner_course_code = Column(String(50), default="")
    partner_grade = Column(String(20), default="")
    partner_ects = Column(String(10), default="")
    expected_ects_grade = Column(String(20), default="")
    expected_iku_grade = Column(String(20), default="")
    provided_ects_grade = Column(String(20), default="")
    provided_iku_grade = Column(String(20), default="")
    validation_result = Column(String(30), default="no_rule_found")
    grade_rule_used = Column(Text, default="")
    explanation = Column(Text, default="")
    explanation_version = Column(Integer, default=1)
    version_number = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    transfer_document = relationship("TransferDocument", back_populates="verification_results")


class SystemLock(Base):
    """Distributed system locks for background workers (upload, scrape, match).
    Replaces in-memory threading.Lock() for horizontal scaling safety.
    """
    __tablename__ = "system_locks"

    name = Column(String(255), primary_key=True)
    worker_id = Column(String(1000), nullable=False)
    last_heartbeat = Column(DateTime, server_default=func.now())
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    worker_pid = Column(Integer, nullable=True)
    hostname = Column(String(255), nullable=True)
