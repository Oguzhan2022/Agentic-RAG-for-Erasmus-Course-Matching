import axios from 'axios';
import type {
  University, Course, CourseListResponse, IngestionBatch, UploadJob,
  FindMatchesResponse, MatchJob, MatchJobResults,
  AdminUser, Role, Department, Faculty, AuditLogEntry, TempCredentials,
  StudentApplication, EctsSummary, CourseMatchResult, WorkflowStateLogEntry,
  CoordinatorApplicationSummary, CoordinatorDashboardStats, CoordinatorDecisionRecord,
  StudentTranscript, TranscriptGradeEntry, TranscriptCourseSearchResult,
  HistoricalRecord, StudentCourseSelection, GradingScheme,
} from '../types';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,  // send auth cookies
});

// Public (no auth required)
export const getPublicStats = () =>
  api.get<{ partner_university_count: number }>('/public/stats').then(r => r.data);

// Universities
export const getUniversities = (department?: string | null, activeOnly = false, signal?: AbortSignal) =>
  api.get<University[]>('/universities', {
    params: {
      ...(department ? { department } : {}),
      active_only: activeOnly
    },
    signal
  }).then(r => r.data);

export const getDepartments = () =>
  api.get<{id: number, name: string, code: string, faculty_id?: number, faculty_name?: string}[]>('/departments').then(r => r.data);

export const getDepartmentsByFaculty = (facultyId: number) =>
  api.get<{id: number, name: string, code: string, faculty_id?: number, faculty_name?: string}[]>('/departments', {
    params: { faculty_id: facultyId },
  }).then(r => r.data);

export const getFaculties = () =>
  api.get<{id: number, name: string, code: string}[]>('/faculties').then(r => r.data);

export const getUniversity = (id: number, signal?: AbortSignal) =>
  api.get<University>(`/universities/${id}`, { signal }).then(r => r.data);

export const createUniversity = (data: {
  name: string;
  country?: string;
  city?: string;
  pdf_structure?: string;
  is_home?: boolean;
  department?: string | null;
}) => api.post<University>('/universities', data).then(r => r.data);

export const updateUniversity = (id: number, data: Partial<University>) =>
  api.patch(`/universities/${id}`, data).then(r => r.data);

export const deleteUniversity = (id: number) =>
  api.delete(`/universities/${id}`).then(r => r.data);

// IKU ECTS Scraper
export const scrapeEcts = (universityId: number, ectsUrl: string) =>
  api.post<{ job_ids: number[] }>(`/universities/${universityId}/scrape-ects`, { ects_url: ectsUrl }).then(r => r.data);

export const scrapeEctsStatus = (universityId: number) =>
  api.get<{
    status: string;
    total_courses: number;
    scraped_courses: number;
    categories: Record<string, number>;
    jobs_created: number[];
    error?: string;
  }>(`/universities/${universityId}/scrape-ects/status`).then(r => r.data);

// Courses
export const getUniversityCourses = (universityId: number, params?: {
  semester?: string;
  level?: string;
  search?: string;
  department?: string | null;
  skip?: number;
  limit?: number;
}, signal?: AbortSignal) => api.get<CourseListResponse>(`/universities/${universityId}/courses`, { params, signal }).then(r => r.data);

export const getCourse = (id: number) =>
  api.get<Course>(`/courses/${id}`).then(r => r.data);

export const getAllCourses = (params?: {
  search?: string;
  university_id?: number;
  semester?: string;
  level?: string;
  quality?: string;
  department?: string | null;
  skip?: number;
  limit?: number;
}, signal?: AbortSignal) => api.get<CourseListResponse>('/courses', { params, signal }).then(r => r.data);

export const updateCourse = (id: number, data: Partial<Course>) =>
  api.patch(`/courses/${id}`, data).then(r => r.data);

export const deleteCourse = (id: number) =>
  api.delete(`/courses/${id}`).then(r => r.data);

// Ingestion
export const uploadPdfs = (universityId: number, semester: string, files: File[]) => {
  const formData = new FormData();
  formData.append('semester', semester);
  files.forEach(file => formData.append('files', file));
  return api.post(`/universities/${universityId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

export const triggerParsing = (universityId: number, semester: string) => {
  const formData = new FormData();
  formData.append('semester', semester);
  return api.post(`/universities/${universityId}/parse`, formData).then(r => r.data);
};

export const getBatchStatus = (batchId: number) =>
  api.get<IngestionBatch>(`/ingestion/batches/${batchId}`).then(r => r.data);

export const listBatches = (universityId?: number) =>
  api.get<IngestionBatch[]>('/ingestion/batches', {
    params: universityId ? { university_id: universityId } : {},
  }).then(r => r.data);

// Queue-based Upload Jobs
export const createUploadJob = (universityId: number, semester: string, files: File[], category?: string, pdfStructure?: string) => {
  const formData = new FormData();
  formData.append('semester', semester);
  if (category) formData.append('category', category);
  if (pdfStructure) formData.append('pdf_structure', pdfStructure);
  files.forEach(file => formData.append('files', file));
  return api.post<UploadJob>(`/upload-jobs?university_id=${universityId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

export const getUploadJobs = (universityId?: number, department?: string | null) =>
  api.get<UploadJob[]>('/upload-jobs', {
    params: { university_id: universityId, department },
  }).then(r => r.data);

export const getUploadJob = (id: number) =>
  api.get<UploadJob>(`/upload-jobs/${id}`).then(r => r.data);

export const pauseUploadJob = (id: number) =>
  api.post(`/upload-jobs/${id}/pause`).then(r => r.data);

export const pauseAllUploadJobs = () =>
  api.post('/upload-jobs/pause-all').then(r => r.data);

export const resumeUploadJob = (id: number) =>
  api.post(`/upload-jobs/${id}/resume`).then(r => r.data);

export const cancelUploadJob = (id: number, deleteUniversity = false) =>
  api.post(`/upload-jobs/${id}/cancel`, null, {
    params: { delete_university: deleteUniversity },
  }).then(r => r.data);

// Matching (single course)
export const findMatches = (courseId: number, homeUniversityId: number, topK = 3) =>
  api.post<FindMatchesResponse>(`/courses/${courseId}/find-matches`, null, {
    params: { home_university_id: homeUniversityId, top_k: topK },
  }).then(r => r.data);

// Match Jobs (batch matching queue)
export const createMatchJob = (partnerUniversityId: number, homeUniversityId: number, department?: string | null) =>
  api.post<MatchJob>('/match-jobs', null, {
    params: { partner_university_id: partnerUniversityId, home_university_id: homeUniversityId, department },
  }).then(r => r.data);

export const getMatchJobs = (partnerUniversityId?: number, department?: string | null) =>
  api.get<MatchJob[]>('/match-jobs', {
    params: { partner_university_id: partnerUniversityId, department },
  }).then(r => r.data);

export const getMatchJob = (id: number) =>
  api.get<MatchJob>(`/match-jobs/${id}`).then(r => r.data);

export const pauseMatchJob = (id: number) =>
  api.post(`/match-jobs/${id}/pause`).then(r => r.data);

export const pauseAllMatchJobs = () =>
  api.post('/match-jobs/pause-all').then(r => r.data);

export const resumeAllMatchJobs = () =>
  api.post('/match-jobs/resume-all').then(r => r.data);

export const resumeMatchJob = (id: number) =>
  api.post(`/match-jobs/${id}/resume`).then(r => r.data);

export const cancelMatchJob = (id: number) =>
  api.post(`/match-jobs/${id}/cancel`).then(r => r.data);

export const getMatchJobResults = (jobId: number) =>
  api.get<MatchJobResults>(`/match-jobs/${jobId}/results`).then(r => r.data);

export const deleteMatchJob = (id: number) =>
  api.delete(`/jobs/${id}`).then(r => r.data);

export const clearUniversityMatches = (universityId: number) =>
  api.delete(`/university/${universityId}/clear`).then(r => r.data);

// CSRF Protection Interceptor
api.interceptors.request.use((config) => {
  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return undefined;
  };
  
  const csrfToken = getCookie('csrf_token');
  if (csrfToken && config.headers) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

// 401 interceptor — redirect to login on auth failure
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/')) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?redirect=${redirect}`;
    }
    return Promise.reject(error);
  }
);

// Auth
export const authLogin = (eid: string, password: string) =>
  api.post('/auth/login', { eid, password }).then(r => r.data);

export const authMe = () =>
  api.get('/auth/me').then(r => r.data);

export const authLogout = () =>
  api.post('/auth/logout').then(r => r.data);

export const authLinkCats = (eid: string, password: string, tempToken: string) =>
  api.post('/auth/link-cats', { eid, password }, {
    headers: { Authorization: `Bearer ${tempToken}` }
  }).then(r => r.data);

// Admin API
export const adminGetUsers = () =>
  api.get<AdminUser[]>('/admin/users').then(r => r.data);

export const adminGetDepartments = () =>
  api.get<Department[]>('/admin/departments').then(r => r.data);

export const adminGetRoles = () =>
  api.get<Role[]>('/admin/roles').then(r => r.data);

export const adminCreateUser = (data: {
  eid: string; name?: string;
  email?: string; password?: string;
  role_names?: string[]; department_id?: number;
}) => api.post<AdminUser>('/admin/users', data).then(r => r.data);

export const adminDeleteUser = (id: number) =>
  api.delete(`/admin/users/${id}`).then(r => r.data);

export const adminCreateDepartment = (data: { name: string; code: string; faculty_id?: number }) =>
  api.post<Department>('/admin/departments', data).then(r => r.data);

export const adminDeleteDepartment = (id: number) =>
  api.delete(`/admin/departments/${id}`).then(r => r.data);

export const adminUpdateDepartment = (id: number, data: { is_active: boolean }) =>
  api.patch<Department>(`/admin/departments/${id}`, data).then(r => r.data);

export const adminAssignRole = (userId: number, roleId: number, departmentId?: number, facultyId?: number) =>
  api.post(`/admin/users/${userId}/assign-role`, null, {
    params: { role_id: roleId, department_id: departmentId, faculty_id: facultyId }
  }).then(r => r.data);

export const adminGetFaculties = () =>
  api.get<Faculty[]>('/admin/faculties').then(r => r.data);

export const adminCreateFaculty = (data: { name: string; code: string }) =>
  api.post<Faculty>('/admin/faculties', data).then(r => r.data);

export const adminDeleteFaculty = (id: number) =>
  api.delete(`/admin/faculties/${id}`).then(r => r.data);

export const adminUpdateFaculty = (id: number, data: Record<string, unknown>) =>
  api.patch<Faculty>(`/admin/faculties/${id}`, data).then(r => r.data);

export const adminUpdateDepartmentFull = (id: number, data: Record<string, unknown>) =>
  api.patch<Department>(`/admin/departments/${id}`, data).then(r => r.data);

export const adminRemoveRole = (userId: number, assignmentId: number) =>
  api.delete(`/admin/users/${userId}/remove-role/${assignmentId}`).then(r => r.data);

export const adminToggleRole = (assignmentId: number, isActive: boolean) =>
  api.patch(`/admin/role-assignments/${assignmentId}`, { is_active: isActive }).then(r => r.data);

export const adminGetAuditLogs = (skip = 0, limit = 10) =>
  api.get<{ total: number; items: AuditLogEntry[] }>('/admin/audit-logs', { params: { skip, limit } }).then(r => r.data);

export const adminGenerateTempCredentials = (data: {
  role_names: string[]; department_id?: number; faculty_id?: number; name?: string;
}) => api.post<TempCredentials>('/admin/users/generate-temp-credentials', data).then(r => r.data);

// ── Module 3: Student API ──────────────────────────────────────

export const getStudentApplications = () =>
  api.get<StudentApplication[]>('/student/applications').then(r => r.data);

export const getStudentApplication = (id: number) =>
  api.get<StudentApplication>(`/student/applications/${id}`).then(r => r.data);

export const createStudentApplication = (partnerUniversityId: number, semester?: string) =>
  api.post('/student/applications', { partner_university_id: partnerUniversityId, semester }).then(r => r.data);

export const deleteStudentApplication = (appId: number) =>
  api.delete(`/student/applications/${appId}`).then(r => r.data);

export const selectCourse = (appId: number, data: {
  partner_course_id: number;
  home_course_id: number;
  course_match_id?: number;
  student_notes?: string;
}) => api.post(`/student/applications/${appId}/select-course`, data).then(r => r.data);

export const deselectCourse = (appId: number, partnerCourseId: number, homeCourseId?: number) =>
  api.post(`/student/applications/${appId}/deselect-course`, {
    partner_course_id: partnerCourseId,
    ...(homeCourseId !== undefined ? { home_course_id: homeCourseId } : {}),
  }).then(r => r.data);

export const requestCoordinatorReview = (appId: number, partnerCourseId: number, notes?: string) =>
  api.post(`/student/applications/${appId}/request-review`, {
    partner_course_id: partnerCourseId,
    student_notes: notes,
  }).then(r => r.data);

export const submitApplication = (appId: number) =>
  api.post(`/student/applications/${appId}/submit`).then(r => r.data);

export const finalizeApplicationStudent = (appId: number) =>
  api.post(`/student/applications/${appId}/finalize`).then(r => r.data);

export const updateApplicationNotes = (appId: number, studentNotes: string) =>
  api.patch(`/student/applications/${appId}`, { student_notes: studentNotes }).then(r => r.data);

export const getEctsSummary = (appId: number) =>
  api.get<EctsSummary>(`/student/applications/${appId}/ects-summary`).then(r => r.data);

export const resetApplication = (appId: number) =>
  api.post(`/student/applications/${appId}/reset`).then(r => r.data);

export const withdrawApplication = (appId: number) =>
  api.post(`/student/applications/${appId}/withdraw`).then(r => r.data);

export const clearReviewRequest = (appId: number, partnerCourseId: number) =>
  api.post(`/student/applications/${appId}/clear-review-request`, { partner_course_id: partnerCourseId }).then(r => r.data);

export const clearAlternativeSuggestion = (appId: number, partnerCourseId: number) =>
  api.post(`/student/applications/${appId}/clear-alternative-suggestion`, { partner_course_id: partnerCourseId }).then(r => r.data);

export const getHomeCourses = (appId: number, partnerCourseId: number, search?: string) =>
  api.get<{ courses: Course[] }>(`/student/applications/${appId}/home-courses/${partnerCourseId}`, {
    params: search ? { search } : {},
  }).then(r => r.data);

export const suggestAlternatives = (appId: number, data: {
  partner_course_id: number;
  home_course_ids: number[];
  reason: string;
}) => api.post(`/student/applications/${appId}/suggest-alternatives`, data).then(r => r.data);

export const getMatchCandidates = (appId: number, partnerCourseId: number) =>
  api.get<{ candidates: CourseMatchResult[] }>(`/student/applications/${appId}/candidates/${partnerCourseId}`).then(r => r.data);

export const getCourseMatchesByPartnerCourse = (partnerCourseId: number) =>
  api.get<{ partner_course_id: number; candidates: CourseMatchResult[]; count: number }>(
    `/course-matches/by-partner-course/${partnerCourseId}`
  ).then(r => r.data);

// ── Module 3: Workflow API ─────────────────────────────────────

export const getWorkflowHistory = (entityType: string, entityId: number) =>
  api.get<{ history: WorkflowStateLogEntry[] }>(`/workflow/${entityType}/${entityId}/history`).then(r => r.data);

// ── Module 3: Coordinator API ──────────────────────────────────

export const getCoordinatorApplications = (filters?: { status?: string; university_id?: number; department_id?: number }) =>
  api.get<CoordinatorApplicationSummary[]>('/coordinator/applications', { params: filters }).then(r => r.data);

export const getCoordinatorApplication = (id: number) =>
  api.get<{ application: StudentApplication; selections: StudentCourseSelection[] }>(`/coordinator/applications/${id}`).then(r => r.data);

export const reviewSelection = (appId: number, data: {
  selection_id: number;
  action: string;
  notes?: string;
  override_home_course_id?: number;
  reason_category?: string;
}) => api.post(`/coordinator/applications/${appId}/review-selection`, data).then(r => r.data);

export const sendBackApplication = (appId: number, notes?: string, mode?: string) =>
  api.post(`/coordinator/applications/${appId}/send-back`, { notes, mode }).then(r => r.data);

export const deleteCoordinatorApplication = (appId: number) =>
  api.delete(`/coordinator/applications/${appId}`).then(r => r.data);

export const sendNote = (appId: number, notes: string, selectionId?: number) =>
  api.post(`/coordinator/applications/${appId}/send-note`, { notes, selection_id: selectionId }).then(r => r.data);

export const setCoordinatorEditingState = (appId: number, editing: boolean) =>
  api.patch(`/coordinator/applications/${appId}/editing-state`, { editing }).then(r => r.data);

export const revertFinalization = (appId: number) =>
  api.post(`/coordinator/applications/${appId}/revert-finalization`).then(r => r.data);

export const setStudentEditingState = (appId: number, editing: boolean) =>
  api.patch(`/student/applications/${appId}/editing-state`, { editing }).then(r => r.data);

export const bulkApproveSubmitted = (appId: number) =>
  api.post(`/coordinator/applications/${appId}/bulk-approve-submitted`).then(r => r.data);

export const finalizeApplication = (appId: number) =>
  api.post(`/coordinator/applications/${appId}/finalize`).then(r => r.data);

export const getCoordinatorDashboard = (params?: { department_id?: number }) =>
  api.get<CoordinatorDashboardStats>('/coordinator/dashboard', { params }).then(r => r.data);

export const getCoordinatorDecisions = (filters?: Record<string, unknown>) =>
  api.get<CoordinatorDecisionRecord[]>('/coordinator/decisions', { params: filters }).then(r => r.data);

export const getCoordinatorDecisionStats = () =>
  api.get<{
    total: number;
    by_action: Record<string, number>;
    by_reason: Record<string, number>;
  }>('/coordinator/decisions/stats').then(r => r.data);

export const exportCoordinatorDecisions = () =>
  api.get<Blob>('/coordinator/decisions/export', { responseType: 'blob' }).then(r => r.data);

// ── Manual Review Workspace ────────────────────────────────────────────────
export const getManualReviewData = (appId: number, selectionId: number) =>
  api.get<{
    application: StudentApplication;
    selection: StudentCourseSelection;
    partner_course: Course;
    home_courses: Course[];
    match_results: CourseMatchResult[];
  }>(`/coordinator/applications/${appId}/manual-review/${selectionId}`).then(r => r.data);

export const runManualAnalysis = (appId: number, selectionId: number, homeCourseId: number) =>
  api.post(`/coordinator/applications/${appId}/manual-review/${selectionId}/analyze`,
    { home_course_id: homeCourseId }).then(r => r.data);

export const approveManualReview = (appId: number, selectionId: number, body: { home_course_id: number; notes?: string }) =>
  api.post(`/coordinator/applications/${appId}/manual-review/${selectionId}/approve`, body).then(r => r.data);

export const rejectManualReview = (appId: number, selectionId: number, body: { notes?: string }) =>
  api.post(`/coordinator/applications/${appId}/manual-review/${selectionId}/reject`, body).then(r => r.data);

// ── University Info (Coordinator) ──────────────────────────────────────────

export const getUniversityProfile = (uniId: number) =>
  api.get(`/university-info/${uniId}`).then(r => r.data);

export const getUniversityPrompt = (uniId: number) =>
  api.get<{ university_id: number; prompt: string }>(`/university-info/${uniId}/generate-prompt`).then(r => r.data);

export const importLLMData = (uniId: number, jsonData: string) =>
  api.post(`/university-info/${uniId}/import-llm`, { json_data: jsonData }).then(r => r.data);

// ── Grading Schemes ──

export const getGradingSchemes = (params?: { university_id?: number; active_only?: boolean; department_code?: string | null }) =>
  api.get<GradingScheme[]>('/grading-schemes', { params }).then(r => r.data);

export const getGradingScheme = (id: number) =>
  api.get<GradingScheme>(`/grading-schemes/${id}`).then(r => r.data);

export const createGradingScheme = (data: Record<string, unknown>) =>
  api.post('/grading-schemes', data).then(r => r.data);

export const updateGradingScheme = (id: number, data: Record<string, unknown>) =>
  api.put(`/grading-schemes/${id}`, data).then(r => r.data);

export const deleteGradingScheme = (id: number) =>
  api.delete(`/grading-schemes/${id}`).then(r => r.data);

export const addGradingRule = (schemeId: number, data: Record<string, unknown>) =>
  api.post(`/grading-schemes/${schemeId}/rules`, data).then(r => r.data);

export const updateGradingRule = (ruleId: number, data: Record<string, unknown>) =>
  api.put(`/grading-schemes/rules/${ruleId}`, data).then(r => r.data);

export const deleteGradingRule = (ruleId: number) =>
  api.delete(`/grading-schemes/rules/${ruleId}`).then(r => r.data);

export const updateRulesBatch = (schemeId: number, rules: {
  id?: number;
  local_grade_min?: string | null;
  local_grade_max?: string | null;
  local_grade_exact?: string | null;
  local_definition?: string | null;
  ects_grade: string;
  description?: string | null;
  sort_order?: number;
}[]) =>
  api.put(`/grading-schemes/${schemeId}/rules/batch`, { rules }).then(r => r.data);

export const updateEctsIkuBatch = (mappings: { ects_grade: string; iku_grade: string }[]) =>
  api.put('/grading-schemes/ects-iku/batch', { mappings }).then(r => r.data);

export const getEctsIkuConversion = () =>
  api.get('/grading-schemes/ects-iku').then(r => r.data);

export const updateEctsIkuMapping = (id: number, data: { iku_grade: string }) =>
  api.put(`/grading-schemes/ects-iku/${id}`, data).then(r => r.data);

export const getSchemeVersions = (schemeId: number) =>
  api.get(`/grading-schemes/schemes/${schemeId}/versions`).then(r => r.data);

export const linkVersionToDecision = (schemeId: number, versionId: number, senate_decision_id: number | null) =>
  api.patch(`/grading-schemes/schemes/${schemeId}/versions/${versionId}`, { senate_decision_id }).then(r => r.data);

export const getSchemeVersion = (schemeId: number, versionId: number, ectsIkuVersionId?: number | null) =>
  api.get(`/grading-schemes/schemes/${schemeId}/versions/${versionId}`, {
    params: ectsIkuVersionId ? { ects_iku_version_id: ectsIkuVersionId } : {}
  }).then(r => r.data);

export const getEctsIkuVersions = () =>
  api.get('/grading-schemes/ects-iku/versions').then(r => r.data);

export const getEctsIkuVersion = (versionId: number) =>
  api.get(`/grading-schemes/ects-iku/versions/${versionId}`).then(r => r.data);

export const createEctsIkuMapping = (data: { ects_grade: string; iku_grade: string }) =>
  api.post('/grading-schemes/ects-iku', data).then(r => r.data);

export const deleteEctsIkuMapping = (id: number) =>
  api.delete(`/grading-schemes/ects-iku/${id}`).then(r => r.data);

export const getGradeAuditLog = (params?: Record<string, unknown>) =>
  api.get('/grading-schemes/audit-log', { params }).then(r => r.data);

export const getTranscriptAudit = (transcriptId: number) =>
  api.get(`/transcripts/${transcriptId}/audit`).then(r => r.data);

export const convertGrade = (data: { local_grade: string; university_id: number; has_ects: boolean }) =>
  api.post<{
    ects_grade: string;
    iku_grade: string;
    conversion_path: string;
  }>('/grading-schemes/convert', data).then(r => r.data);

// ── Transcripts & Grade Entry ──

export const uploadTranscript = (data: {
  partner_university_id: number;
  application_id?: number | null;
  notes?: string;
  file: File;
}) => {
  const formData = new FormData();
  formData.append('partner_university_id', String(data.partner_university_id));
  if (data.application_id) formData.append('application_id', String(data.application_id));
  if (data.notes) formData.append('notes', data.notes);
  formData.append('file', data.file);
  return api.post<StudentTranscript>('/transcripts/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

export const getMyTranscripts = () =>
  api.get<StudentTranscript[]>('/transcripts/my').then(r => r.data);

export const getAllTranscripts = (departmentId?: number | null) =>
  api.get<StudentTranscript[]>('/transcripts/all', { params: { department_id: departmentId } }).then(r => r.data);

export const getTranscript = (id: number) =>
  api.get<StudentTranscript>(`/transcripts/${id}`).then(r => r.data);

export const searchTranscriptCourses = (transcriptId: number, q: string) =>
  api.get<TranscriptCourseSearchResult[]>(`/transcripts/${transcriptId}/search-courses`, {
    params: { q },
  }).then(r => r.data);

export const previewConversion = (transcriptId: number, data: {
  local_grade: string;
  has_ects: boolean;
  partner_course_id?: number | null;
  partner_course_name: string;
}) => api.post(`/transcripts/${transcriptId}/preview-conversion`, data).then(r => r.data);

export const saveTranscriptGrades = (transcriptId: number, entries: Array<{
  partner_course_id?: number | null;
  partner_course_name: string;
  partner_course_code?: string | null;
  partner_ects?: number | null;
  local_grade: string;
  has_ects: boolean;
}>) => api.post<TranscriptGradeEntry[]>(`/transcripts/${transcriptId}/grades`, { entries }).then(r => r.data);

export const updateTranscriptGradeEntry = (transcriptId: number, entryId: number, data: Record<string, unknown>) =>
  api.put<TranscriptGradeEntry>(`/transcripts/${transcriptId}/grades/${entryId}`, data).then(r => r.data);

export const deleteTranscriptGradeEntry = (transcriptId: number, entryId: number) =>
  api.delete(`/transcripts/${transcriptId}/grades/${entryId}`).then(r => r.data);

export const finalizeTranscript = (transcriptId: number) =>
  api.post<StudentTranscript>(`/transcripts/${transcriptId}/finalize`).then(r => r.data);

export const revertTranscript = (transcriptId: number) =>
  api.post<StudentTranscript>(`/transcripts/${transcriptId}/revert`).then(r => r.data);

export const updateTranscript = (id: number, data: { student_name?: string; student_eid?: string; file?: File | null; remove_file?: boolean }) => {
  const formData = new FormData();
  if (data.student_name !== undefined) formData.append('student_name', data.student_name);
  if (data.student_eid !== undefined) formData.append('student_eid', data.student_eid);
  if (data.remove_file) formData.append('remove_file', 'true');
  if (data.file) formData.append('file', data.file);
  return api.patch<StudentTranscript>(`/transcripts/${id}`, formData).then(r => r.data);
};

export const deleteTranscript = (id: number) =>
  api.delete(`/transcripts/${id}`).then(r => r.data);

export const submitTranscriptForReview = (transcriptId: number) =>
  api.post<StudentTranscript>(`/transcripts/${transcriptId}/submit-for-review`).then(r => r.data);

export const createManualTranscript = (data: {
  university_id?: number | null;
  university_name?: string | null;
  student_label: string;
  student_id?: number | null;
  department_id?: number | null;
  file?: File | null;
}) => {
  const formData = new FormData();
  if (data.university_id) formData.append('university_id', String(data.university_id));
  if (data.university_name) formData.append('university_name', data.university_name);
  formData.append('student_label', data.student_label);
  if (data.student_id) formData.append('student_id', String(data.student_id));
  if (data.department_id) formData.append('department_id', String(data.department_id));
  if (data.file) formData.append('file', data.file);
  
  return api.post<StudentTranscript>('/transcripts/manual', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

// ── Historical Records ──

export const getHistoricalRecords = (params?: { university_id?: number; source?: string }) =>
  api.get<HistoricalRecord[]>('/transcripts/historical/all', { params }).then(r => r.data);

export const getHistoricalRecord = (id: number) =>
  api.get<HistoricalRecord>(`/transcripts/historical/${id}`).then(r => r.data);

export const deleteHistoricalRecord = (id: number) =>
  api.delete(`/transcripts/historical/${id}`).then(r => r.data);

// ── Senate Decisions ──

export const getSenateDecisions = (params?: Record<string, unknown>) =>
  api.get('/senate-decisions', { params }).then(r => r.data);

export const getSenateDecision = (id: number) =>
  api.get(`/senate-decisions/${id}`).then(r => r.data);

export const uploadSenateDecision = (formData: FormData) =>
  api.post('/senate-decisions', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);

export const deleteSenateDecision = (id: number) =>
  api.delete(`/senate-decisions/${id}`).then(r => r.data);
