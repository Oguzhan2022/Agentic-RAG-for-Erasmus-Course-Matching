export type IngestionStatus = 'pending' | 'parsing' | 'parsed' | 'embedding' | 'ready' | 'failed';

export type UploadJobStatus = 'queued' | 'uploading' | 'parsing' | 'embedding' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface UploadJob {
  id: number;
  university_id: number;
  university_name?: string | null;
  ingestion_batch_id: number | null;
  semester: string;
  category: string | null;
  status: UploadJobStatus;
  total_files: number;
  processed_files: number;
  failed_files: number;
  progress_percent: number;
  current_file: string | null;
  error_log: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

export interface University {
  id: number;
  name: string;
  country: string | null;
  city: string | null;
  pdf_structure: 'consolidated' | 'individual' | 'category_based';
  is_home: boolean;
  is_active: boolean;
  ingestion_status: IngestionStatus;
  course_count?: number;
  has_active_upload?: boolean;
  department_id?: number | null;
  created_at: string | null;
  batches?: IngestionBatch[];
}

export interface IngestionBatch {
  id: number;
  university_id: number;
  semester: string;
  status: IngestionStatus;
  total_courses: number;
  parsed_courses: number;
  failed_courses: number;
  progress_percent?: number;
  error_log?: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface AcademicContext {
  primary_format: string | string[];
  assessment_mode: string | string[];
  lab_status: boolean | 'unknown';
  project_status: boolean | 'unknown';
  seminar_status: boolean | 'unknown';
  special_tags: string[];
  semester?: string | null;
  level?: string | null;
  language?: string | null;
  department?: string | null;
}

export interface MetadataQuality {
  content_available: boolean;
  outcomes_available: boolean;
  format_confidence: 'high' | 'medium' | 'low';
}

export interface Course {
  id: number;
  university_id: number;
  ingestion_batch_id: number | null;
  course_code: string | null;
  course_name: string;
  department: string | null;
  semester: string | null;
  ects: number | null;
  level: string | null;
  language: string | null;
  content: string | null;
  learning_outcomes: string | null;
  academic_context: AcademicContext;
  metadata_quality: MetadataQuality;
  source_metadata: Record<string, unknown>;
  warnings: string[];
  is_active: boolean;
  raw_text?: string;
  created_at: string | null;
}

export interface CourseListStats {
  high_quality?: number;
  with_warnings?: number;
  universities?: number;
}

export interface CourseListResponse {
  total: number;
  skip: number;
  limit: number;
  courses: Course[];
  stats?: CourseListStats;
}

// Matching types
export interface ScoreComponent {
  score: number;
  weight: number;
  weighted: number;
  evidence: string;
}

export interface MatchResult {
  home_course_id: number;
  home_course_name: string;
  home_university_id: number;
  overall_score: number;
  embedding_similarity: number;
  deterministic_scores: Record<string, { score: number; evidence: string; warnings?: string[] }>;
  semantic_scores: Record<string, unknown>;
  score_breakdown: Record<string, ScoreComponent>;
  matched_topics: string[];
  missing_topics: string[];
  warnings: string[];
  category: string;
}

export interface FindMatchesResponse {
  partner_course: {
    id: number;
    name: string;
    university_id: number;
  };
  home_university: {
    id: number;
    name: string;
  };
  detected_categories: string[];
  matches: MatchResult[];
}

export type MatchJobStatus = 'queued' | 'matching' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'verifying';

export interface MatchJob {
  id: number;
  partner_university_id: number;
  partner_university_name: string | null;
  home_university_id: number;
  home_university_name: string | null;
  status: MatchJobStatus;
  llm_mode: 'sequential' | 'batch';
  total_courses: number;
  processed_courses: number;
  failed_courses: number;
  progress_percent: number;
  current_course: string | null;
  error_log: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

export interface CourseMatchResult {
  id: number;
  rank: number;
  home_course_id: number;
  home_course_code?: string | null;
  home_course_name: string;
  home_course_ects?: number | null;
  home_course_category?: string | null;
  overall_score: number;
  score_breakdown: Record<string, ScoreComponent>;
  matched_topics: string[];
  missing_topics: string[];
  extra_partner_topics: string[];
  core_home_topics: string[];
  structural_notes: string[];
  warnings: string[];
  category: string;
  verification_status?: string | null;
  verification_confidence?: number;
  verification_reason?: string | null;
  verification_risk_flags?: string[];
  is_recommended?: boolean;
  content_overlap_assessment?: string | null;
  core_topic_coverage?: string | null;
}

export interface MatchJobResults {
  job: MatchJob;
  course_results: Array<{
    partner_course: { id: number; name: string; ects: number | null };
    matches: CourseMatchResult[];
  }>;
}

// Auth & RBAC types
export interface Role {
  id: number;
  name: string;
  description?: string;
}

export interface Faculty {
  id: number;
  name: string;
  code: string;
  is_active?: boolean;
}

export interface Department {
  id: number;
  name: string;
  code: string;
  faculty_id?: number;
  faculty_name?: string;
  faculty?: Faculty;
  is_active?: boolean;
}

export interface UserRoleAssignment {
  id: number;
  role: Role;
  department?: Department | null;
  faculty?: Faculty | null;
  is_active: boolean;
}

export interface AdminUser {
  id: number;
  eid: string;
  email?: string;
  name?: string;
  needs_cats_link: boolean;
  last_login?: string | null;
  role_assignments: UserRoleAssignment[];
}

export interface AuditLogEntry {
  id: number;
  actor_id?: number;
  action: string;
  target_user_id?: number;
  details: Record<string, unknown>;
  created_at: string;
  actor?: { id: number; eid: string; name?: string };
  target_user?: { id: number; eid: string; name?: string };
}

export interface TempCredentials {
  temp_eid: string;
  temp_password: string;
  user_id: number;
}

// Module 3: Workflow + Student Selection + Coordinator Review types
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'rejected'
  | 'learning_agreement_ready'
  | 'revision_requested';

export type SelectionStatus =
  | 'not_selected'
  | 'draft_selected'
  | 'submitted_for_review'
  | 'approved'
  | 'rejected'
  | 'manual_review_required';

export type CoordinatorAction =
  | 'approve'
  | 'reject'
  | 'override'
  | 'manual_review_required'
  | 'send_back'
  | 'send_note';

export type OverrideReasonCategory =
  | 'insufficient_core_coverage'
  | 'ects_insufficient'
  | 'structural_mismatch'
  | 'no_suitable_equivalent'
  | 'manual_review_needed'
  | 'other';

export interface StudentApplication {
  id: number;
  student_id: number;
  partner_university_id: number;
  partner_university?: { id: number; name: string; country: string; city: string };
  department?: { id: number; name: string; code: string };
  status: ApplicationStatus;
  semester?: string;
  total_partner_ects: number;
  approved_partner_ects: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  student_notes: string | null;
  coordinator_notes: string | null;
  student_editing?: boolean;
  coordinator_editing?: boolean;
  coordinator_viewed_at?: string | null;
  student_draft_viewed_at?: string | null;
  student?: { id: number; name: string; eid: string };
  created_at: string;
  updated_at: string;
  selections?: StudentCourseSelection[];
}

export interface StudentCourseSelection {
  id: number;
  application_id: number;
  partner_course_id: number;
  partner_course?: Course;
  selected_home_course_id: number | null;
  selected_home_course_ids: number[];
  selected_course_match_ids: number[];
  selected_home_course?: Course;
  course_match_id: number | null;
  status: SelectionStatus;
  no_match_requested: boolean;
  student_notes: string | null;
  coordinator_note?: string | null;
  student_explanation_snapshot?: Record<string, unknown> | null;
  coordinator_explanation_snapshot?: Record<string, unknown> | null;
  explanation_version?: number;
  rejection_count: number;
  home_course_names?: Record<number, string>;
  coordinator_override_courses?: Course[];
  selected_home_course_verifications?: Record<number, string | null>;
  selected_home_courses?: Course[];
  has_recommended_candidates?: boolean;
  alternative_home_course_ids?: number[];
  alternative_home_courses_detail?: Course[];
  alternative_home_course_names?: Record<number, string>;
  candidates?: CourseMatchResult[];
  alternative_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface EctsSummary {
  total_partner_ects: number;
  approved_partner_ects: number;
  learning_agreement_ready: boolean;
  missing_ects: number;
}

export interface CoordinatorApplicationSummary {
  id: number;
  student: { id: number; name: string; eid: string };
  partner_university: { id: number; name: string };
  department: { id: number; name: string; code: string } | null;
  status: ApplicationStatus;
  total_partner_ects: number;
  approved_partner_ects: number;
  total_selections: number;
  reviewed_selections: number;
  pending_selections: number;
  submitted_at: string | null;
}

export interface CoordinatorDashboardStats {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  manual_review_count: number;
  la_ready_count: number;
  by_university: Record<string, number>;
}

export interface WorkflowStateLogEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  from_state: string | null;
  to_state: string;
  actor_role: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CoordinatorDecisionRecord {
  id: number;
  coordinator_id: number;
  decision: string;
  override_reason_category: string | null;
  override_details: string | null;
  original_score: number | null;
  created_at: string;
}

// ── Grading Schemes ──

export interface GradeConversionRule {
  id: number;
  grading_scheme_id: number;
  local_grade_min: string | null;
  local_grade_max: string | null;
  local_grade_exact: string | null;
  local_definition: string | null;
  ects_grade: string;
  description: string | null;
  sort_order: number;
}

export interface GradingScheme {
  id: number;
  university_id: number;
  university_name: string | null;
  name: string;
  scheme_type: string;
  country: string | null;
  grade_direction: string | null;
  is_active: boolean;
  source: string | null;
  source_document: string | null;
  notes: string | null;
  senate_decision_id?: number | null;
  senate_decision_ref?: string | null;
  rules: GradeConversionRule[];
  created_at: string | null;
  updated_at: string | null;
}

export interface EctsIkuConversion {
  id: number;
  ects_grade: string;
  iku_grade: string;
}

export interface GradeConversionResult {
  input_grade: string;
  input_type: string;
  ects_grade: string;
  iku_grade: string;
  scheme_id?: number;
  scheme_name?: string;
  conversion_path: string;
}

// ── Transcripts & Grade Entry ──

export interface StudentTranscript {
  id: number;
  student_id: number;
  student_name: string | null;
  student_eid: string | null;
  application_id: number | null;
  partner_university_id: number;
  partner_university_name: string | null;
  original_filename: string | null;
  file_path: string | null;
  status: 'uploaded' | 'student_grading' | 'pending_review' | 'grading_in_progress' | 'graded' | 'finalized';
  department_id?: number | null;
  department_code?: string | null;
  grading_scheme_version_id?: number | null;
  grading_scheme_version_number?: number | null;
  ects_iku_version_id?: number | null;
  ects_iku_version_number?: number | null;
  graded_by: number | null;
  graded_at: string | null;
  notes: string | null;
  semester?: string | null;
  created_at: string | null;
  updated_at: string | null;
  grade_entries?: TranscriptGradeEntry[];
}

export interface TranscriptGradeEntry {
  id: number;
  transcript_id: number;
  partner_course_id: number | null;
  partner_course_name: string;
  partner_course_code: string | null;
  partner_ects: number | null;
  local_grade: string | null;
  ects_grade: string | null;
  iku_grade: string | null;
  grading_scheme_id: number | null;
  conversion_method: string | null;
  grading_scheme_name?: string | null;
  grading_scheme_type?: string | null;
  grading_scheme_version_id?: number | null;
  grading_scheme_version_number?: number | null;
  ects_iku_version_id?: number | null;
  ects_iku_version_number?: number | null;
  /** @deprecated Derived from partner_course_id on backend. Use partner_course_id != null instead. */
  is_db_course: boolean;
  mapped_home_course_ids?: number[];
  entered_by: number | null;
  notes: string | null;
  created_at: string | null;
  audit_log?: GradeAuditLogEntry[];
}

export interface GradeAuditLogEntry {
  id: number;
  source_grade: string | null;
  target_iku_grade: string | null;
  conversion_method: string | null;
  is_manual_override: boolean;
  previous_iku_grade: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface TranscriptCourseSearchResult {
  id: number;
  course_name: string;
  course_code: string | null;
  ects: number | null;
}

// ── Historical Records ──

export interface HistoricalRecord {
  id: number;
  source: 'auto_archive' | 'docx_import' | 'manual';
  source_transcript_id: number | null;
  student_id: number | null;
  anonymous_student_label: string | null;
  partner_university_id: number;
  partner_university_name: string | null;
  department_id: number | null;
  academic_year: string | null;
  semester: string | null;
  total_partner_ects: number;
  total_home_ects: number;
  import_batch_id: string | null;
  created_at: string | null;
  record_type: 'historical';
  courses: HistoricalRecordCourse[];
}

export interface HistoricalRecordCourse {
  id: number;
  partner_course_id: number | null;
  partner_course_name: string;
  partner_course_code: string | null;
  partner_ects: number | null;
  home_course_id: number | null;
  home_course_name: string | null;
  home_course_code: string | null;
  home_ects: number | null;
  local_grade: string | null;
  ects_grade: string | null;
  iku_grade: string | null;
  is_db_partner_course: boolean;
  is_db_home_course: boolean;
}
