import React, { useState, useEffect, useRef } from 'react';
import {
  Card, Row, Col, Table, Descriptions, Button, Modal, Form, Input, Select, Tag,
  Typography, Spin, Empty, message, Alert, Space, Divider, Timeline, Collapse,
  Progress,
} from 'antd';
import {
  RobotOutlined, CheckCircleOutlined, CloseCircleOutlined,
  BookOutlined, ArrowLeftOutlined, ClockCircleOutlined,
  SwapOutlined, ThunderboltOutlined, WarningOutlined, HomeOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getManualReviewData, runManualAnalysis, approveManualReview, rejectManualReview, api } from '../api/client';
import CourseDetailsPanel from '../components/CourseDetailsPanel';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreLabel(s: number | null | undefined) {
  if (s == null) return '—';
  return `${Math.round(s * 100)}%`;
}

const CAT_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  technical:    { label: 'manualReview.categories.technical', color: '#1890ff', icon: <ExperimentOutlined /> },
  social:       { label: 'manualReview.categories.social',    color: '#722ed1', icon: <BookOutlined /> },
  studio_based: { label: 'manualReview.categories.studio',    color: '#fa8c16', icon: <ThunderboltOutlined /> },
};

const VER_CFG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  approved:     { color: '#52c41a', icon: <CheckCircleOutlined />, label: 'manualReview.verification.approved' },
  rejected:     { color: '#ff4d4f', icon: <CloseCircleOutlined />, label: 'manualReview.verification.rejected' },
  risk_flagged: { color: '#faad14', icon: <WarningOutlined />,     label: 'manualReview.verification.risk_flagged' },
};

/** Inline analysis card matching StudentCourseSelectionPage layout exactly */
function AnalysisCard({ a }: { a: any }) {
  const { t } = useTranslation();
  const pct = Math.round((a.overall_score ?? 0) * 100);
  const color = pct >= 70 ? '#52c41a' : pct >= 40 ? '#faad14' : '#ff4d4f';
  const vs = a.verification_status;
  const structuralNotes: string[] = a.structural_notes ? [a.structural_notes] : [];
  const warnings: string[] = a.verification_risk_flags ?? [];

  return (
    <div>
      {/* Rank + Score ring + Course name + Category tags */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <Progress type="circle" percent={pct} size={68} strokeColor={color}
            format={() => <span style={{ fontSize: 14, fontWeight: 700, color }}>{pct}%</span>} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.3 }}>
            {a.home_course_code ? `${a.home_course_code} — ${a.home_course_name}` : a.home_course_name}
          </Typography.Text>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {a.academic_category && (
              <Tag icon={CAT_CFG[a.academic_category]?.icon} color={CAT_CFG[a.academic_category]?.color} style={{ fontSize: 10 }}>
                {t(CAT_CFG[a.academic_category]?.label || '').toUpperCase()}
              </Tag>
            )}
          </div>
        </div>
      </div>

      {/* Verification block */}
      {vs && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6,
          background: vs === 'approved' ? '#f6ffed' : vs === 'rejected' ? '#fff1f0' : '#fffbe6',
          border: `1px solid ${vs === 'approved' ? '#b7eb8f' : vs === 'rejected' ? '#ffa39e' : '#ffe58f'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Space size={4}>
              {VER_CFG[vs]?.icon}
              <Typography.Text strong style={{ fontSize: 11, color: VER_CFG[vs]?.color }}>
                {t(VER_CFG[vs]?.label || '').toUpperCase()}
              </Typography.Text>
            </Space>
            <Space size={4}>
              {a.content_overlap_assessment && (
                <Tag color="blue" style={{ fontSize: 9, margin: 0 }}>
                  {t(`manualReview.assessments.${a.content_overlap_assessment.toLowerCase()}`, { defaultValue: a.content_overlap_assessment.toUpperCase() })}
                </Tag>
              )}
              {a.core_topic_coverage && (
                <Tag style={{ fontSize: 9, margin: 0 }}>
                  {t(`manualReview.assessments.${a.core_topic_coverage.toLowerCase()}`, { defaultValue: a.core_topic_coverage.toUpperCase() })} {t('manualReview.coverage')}
                </Tag>
              )}
            </Space>
          </div>
          {a.verification_reason && (
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.4 }}>
              {a.verification_reason}
            </Typography.Text>
          )}
          {vs === 'approved' && (
            <Tag color="gold" style={{ marginTop: 6, fontSize: 10, fontWeight: 'bold' }}>{t('manualReview.aiRecommendation')}</Tag>
          )}
        </div>
      )}

      <Divider style={{ margin: '8px 0' }} />

      {/* Core Home Topics */}
      {(a.core_home_topics ?? []).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>{t('manualReview.coreHomeTopics')}</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {a.core_home_topics.map((t: string, i: number) => (
              <Tag key={i} color="orange" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
            ))}
          </div>
        </div>
      )}

      {/* Syllabus Matches */}
      {(a.matched_topics ?? []).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>{t('manualReview.syllabusMatches')} ({a.matched_topics.length})</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {a.matched_topics.map((t: string, i: number) => (
              <Tag key={i} color="green" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
            ))}
          </div>
        </div>
      )}

      {/* Missing Topics */}
      {(a.missing_topics ?? []).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>{t('manualReview.missingFromPartner')} ({a.missing_topics.length})</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {a.missing_topics.map((t: string, i: number) => (
              <Tag key={i} color="red" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
            ))}
          </div>
        </div>
      )}

      {/* Enrichment */}
      {(a.extra_partner_topics ?? []).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>{t('manualReview.enrichment')} ({a.extra_partner_topics.length})</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {a.extra_partner_topics.map((t: string, i: number) => (
              <Tag key={i} color="cyan" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
            ))}
          </div>
        </div>
      )}

      {/* Home Course Details */}
      {a.home_course_id && (
        <CourseDetailsPanel
          courseId={a.home_course_id}
          label={t('manualReview.selectedHomeCourse')}
          icon={<HomeOutlined style={{ color: '#1890ff' }} />}
          columns={1}
        />
      )}

      {/* Match Details (score breakdown + notes + warnings) */}
      <Collapse size="small" ghost style={{ background: 'transparent' }} items={[{
        key: '1',
        label: (
          <Space size={6}>
            <SwapOutlined style={{ color: '#722ed1' }} />
            <Typography.Text style={{ fontSize: 12, fontWeight: 500 }}>{t('manualReview.matchDetails')}</Typography.Text>
          </Space>
        ),
        children: (
          <div>
            {structuralNotes.filter((n: string) => !/(partner|both courses|one or both)/i.test(n)).map((n, i) => (
              <Alert key={`sn-${i}`} message={n} type="info" banner showIcon
                icon={<ThunderboltOutlined style={{ fontSize: 10 }} />}
                style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3, background: '#f0f5ff', border: 'none' }} />
            ))}
            {warnings.filter((w: string) => !/(partner|both courses|one or both)/i.test(w)).map((w, i) => (
              <Alert key={`w-${i}`} message={w} type="warning" banner showIcon
                icon={<WarningOutlined style={{ fontSize: 10 }} />}
                style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3 }} />
            ))}
            {a.score_breakdown && Object.keys(a.score_breakdown).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 6 }}>{t('manualReview.scoreBreakdown')}</Typography.Text>
                {Object.entries(a.score_breakdown).map(([key, comp]: [string, any]) => {
                  const bp = Math.round(comp.score * 100);
                  const bc = bp >= 70 ? '#52c41a' : bp >= 40 ? '#faad14' : '#ff4d4f';
                  return (
                    <div key={key} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <Typography.Text style={{ fontSize: 11, fontWeight: 500, textTransform: 'capitalize' }}>{key}</Typography.Text>
                        <Space size={4}>
                          <Tag style={{ fontSize: 9, margin: 0 }}>{Math.round(comp.weight * 100)}%w</Tag>
                          <Typography.Text strong style={{ fontSize: 11, color: bc }}>{bp}%</Typography.Text>
                        </Space>
                      </div>
                      <Progress percent={bp} showInfo={false} strokeColor={bc} size="small" />
                      {comp.evidence && (
                        <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>{comp.evidence}</Typography.Text>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ),
      }]} />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function CoordinatorManualReviewPage() {
  const { t } = useTranslation();
  const { selectionId } = useParams<{ selectionId: string }>();
  const [searchParams] = useSearchParams();
  const appId = Number(searchParams.get('appId'));
  const selId = Number(selectionId);
  const queryClient = useQueryClient();

  const [selectedHomeId, setSelectedHomeId] = useState<number | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<any | null>(null);
  const [notes, setNotes] = useState('');
  const [homeCourses, setHomeCourses] = useState<any[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);

  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['manual-review', appId, selId],
    queryFn: () => getManualReviewData(appId, selId),
    enabled: !!appId && !!selId,
  });

  // Initialize from DB on page load / refresh + pre-load home courses
  useEffect(() => {
    if (!data) return;
    
    // Auto-select first suggestion if only one exists
    if (((data as any).student_suggestions?.length || 0) === 1 && !selectedHomeId) {
      setSelectedHomeId((data as any).student_suggestions[0].id);
    }
    // Pre-fill coordinator note
    if ((data as any).coordinator_note && !notes) {
      setNotes((data as any).coordinator_note);
    }
    // Pre-select override course
    if ((data as any).coordinator_override_course?.id && !selectedHomeId) {
      setSelectedHomeId((data as any).coordinator_override_course.id);
    }
    // Pre-load home university courses
    const homeUniId = (data as any).home_university_id || 1;
    if (homeUniId && homeCourses.length === 0) {
      loadHomeCourses(homeUniId);
    }
  }, [data]);

  // When user picks a home course, auto-load cached result
  useEffect(() => {
    if (!selectedHomeId || !data) return;
    const candidates = [
      ...((data as any).existing_analyses || []),
      ...((data as any).batch_matches || [])
    ];
    const result = candidates.find((a: any) => a.home_course_id === selectedHomeId) ?? null;
    if (result) setActiveAnalysis(result);
    else setActiveAnalysis(null);
  }, [selectedHomeId, data]);

  const analyzeMutation = useMutation({
    mutationFn: () => runManualAnalysis(appId, selId, selectedHomeId!),
    onSuccess: (result) => {
      setActiveAnalysis(result);
      queryClient.invalidateQueries({ queryKey: ['manual-review', appId, selId] });
      message.success(t('manualReview.analysisComplete'));
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('manualReview.analysisFailed')),
  });

  const broadcastAndClose = () => {
    const bc = new BroadcastChannel('app-updates');
    bc.postMessage({ type: 'REFRESH_APP', appId });
    bc.close();
    closeTimeoutRef.current = setTimeout(() => window.close(), 1500);
  };

  const approveMutation = useMutation({
    mutationFn: () => approveManualReview(appId, selId, { home_course_id: selectedHomeId!, notes }),
    onSuccess: () => {
      message.success(t('manualReview.approvedSuccess'));
      broadcastAndClose();
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('manualReview.approvalFailed')),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectManualReview(appId, selId, { notes: notes || undefined }),
    onSuccess: () => {
      message.success(t('manualReview.rejectedSuccess'));
      broadcastAndClose();
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('manualReview.rejectionFailed')),
  });

  // Load home university courses (initial or on search)
  const loadHomeCourses = async (univId: number, q?: string) => {
    setHomeLoading(true);
    try {
      const params: Record<string, any> = { university_id: univId, limit: 1 };
      if (q && q.length >= 1) params.search = q;
      // First call: get total count
      const probe = await api.get('/courses', { params });
      const total = probe.data?.total ?? 200;
      // Second call: fetch all
      const res = await api.get('/courses', { params: { ...params, limit: Math.min(total, 2000) } });
      setHomeCourses(res.data?.courses ?? []);
    } catch {
      setHomeCourses([]);
    } finally {
      setHomeLoading(false);
    }
  };

  const searchHomeCourses = (q: string) => {
    // Student's home university ID is needed. Falling back to a safe check.
    const univId = (data as any).home_university_id || 1; // 1 is usually IKU
    loadHomeCourses(univId, q || undefined);
  };

  if (isLoading) return (
    <div style={{ textAlign: 'center', padding: 80 }}>
      <Spin size="large" />
    </div>
  );

  if (!data) return <Alert type="error" message={t('manualReview.loadingFailed')} style={{ margin: 40 }} />;

  // Suggestions: student's alternative courses OR their current selection if it's not yet finalized
  // Suggestions: student's alternative courses
  const suggestions: any[] = (data as any).student_suggestions || [];

  // All analyses from root arrays
  const allAnalyses: any[] = [
    ...((data as any).existing_analyses || []).map((a: any) => ({ ...a, source: 'manual' })),
    ...((data as any).batch_matches || []).map((a: any) => ({ ...a, source: 'batch' }))
  ].sort((a: any, b: any) => (b.overall_score ?? 0) - (a.overall_score ?? 0));

  // Dropdown options: student suggestions + searched courses
  const suggestionOptions = suggestions.map((s: any) => ({
    value: s.id,
    label: `[${t('manualReview.studentSuggestion')}] ${s.course_code ? s.course_code + ' — ' : ''}${s.course_name} (${s.ects ?? '?'} ECTS)`,
  }));
  const searchOptions = homeCourses
    .filter((c: any) => !suggestions.some((s: any) => s.id === c.id))
    .map((c: any) => ({
      value: c.id,
      label: `${c.course_code ? c.course_code + ' — ' : ''}${c.course_name} (${c.ects ?? '?'} ECTS)`,
    }));

  const allOptions = [
    ...(suggestionOptions.length > 0 ? [{ label: t('manualReview.studentSuggestion'), options: suggestionOptions }] : []),
    ...searchOptions,
  ];

  // Find selected home course detail (from suggestion or search)
  const selectedSuggestion = suggestions.find((s: any) => s.id === selectedHomeId);
  const selectedSearched = homeCourses.find((c: any) => c.id === selectedHomeId);
  const selectedCourseDetail = selectedSuggestion || selectedSearched;

  // True when the selected home course is the student's own suggestion
  const isSuggestion = !!selectedHomeId && suggestions.some((s: any) => s.id === selectedHomeId);

  const hasCachedResult = false; // allow re-analysis; upsert handles duplicates

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => window.close()}>{t('manualReview.close')}</Button>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('manualReview.title')}</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('manualReview.student')}: <Text strong>{
              (data as any).student?.name ||
              (data as any).student?.full_name ||
              (data as any).student_name ||
              (data as any).student?.eid || 
              t('manualReview.student')
            }</Text> &nbsp;·&nbsp;
            {t('manualReview.status')}: <Tag color={
              (data as any).status === 'approved' ? '#52c41a' :
              (data as any).status === 'rejected' ? '#ff4d4f' :
              (data as any).status === 'manual_review_required' ? '#eb2f96' :
              (data as any).status === 'submitted_for_review' ? '#fa8c16' :
              '#d9d9d9'
            }>{(data as any).status ? t(`applicationStatus.${(data as any).status}.label`, { defaultValue: (data as any).status.replace(/_/g, ' ').toUpperCase() }) : 'PENDING'}</Tag>
          </Text>
        </div>
      </div>


      {/* Student reason banners */}
      {(data as any).no_match_requested && (
        <Alert
          type="warning"
          message={<Text strong>{t('coordinatorReview.noSelectionDesc') || 'Student requested manual review — no suitable match found'}</Text>}
          style={{ marginBottom: 12 }}
        />
      )}
      {(data as any).alternative_reason && (
        <Alert
          type="info"
          message={<><Text strong>{t('manualReview.studentSuggestionNote') || 'Student\'s Suggestion Note'}: </Text>{(data as any).alternative_reason}</>}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Row 1: Partner + Suggestion side by side */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card
            title={<Text strong style={{ fontSize: 12, color: '#8c8c8c' }}>{t('manualReview.partnerCourseAbroad')}</Text>}
            style={{ borderRadius: 10, border: '1px solid #1677ff', height: '100%' }}
            styles={{ body: { padding: '16px' } }}
          >
            {data?.partner_course?.id ? (
              <div>
                <Title level={5} style={{ margin: '0 0 16px 0', color: '#000' }}>
                  {data?.partner_course?.course_code ? `${data.partner_course.course_code} — ` : ''}
                  {data?.partner_course?.course_name || (data?.partner_course as any)?.name || 'Untitled Course'}
                </Title>
                <CourseDetailsPanel courseId={data.partner_course.id} label="" alwaysOpen columns={2} />
              </div>
            ) : (
              <Empty description={t('manualReview.noPartnerData')} />
            )}
          </Card>
        </Col>
        <Col span={12}>
          {selectedHomeId ? (
            <Card
              title={<Text strong style={{ fontSize: 12, color: '#8c8c8c' }}>
                {suggestions.some((s: any) => s.id === selectedHomeId) ? t('manualReview.studentSuggestion') : t('manualReview.selectedHomeCourse')}
              </Text>}
              style={{ borderRadius: 10, border: '1px solid #08979c', height: '100%' }}
              styles={{ body: { padding: '16px' } }}
            >
              <Title level={5} style={{ margin: '0 0 16px 0', color: '#000' }}>
                {selectedCourseDetail?.course_code ? `${selectedCourseDetail.course_code} — ` : ''}
                {selectedCourseDetail?.course_name || (selectedCourseDetail as any)?.name || 'Untitled Course'}
              </Title>
              <CourseDetailsPanel courseId={selectedHomeId} label="" alwaysOpen columns={2} />
            </Card>
          ) : suggestions.length > 0 ? (
            <Card
              title={<Text strong style={{ fontSize: 12, color: '#8c8c8c' }}>{t('manualReview.studentSuggestion')}</Text>}
              style={{ borderRadius: 10, border: '1px solid #08979c', height: '100%' }}
              styles={{ body: { padding: '16px' } }}
            >
              <Title level={5} style={{ margin: '0 0 16px 0', color: '#000' }}>
                {suggestions[0].course_code ? `${suggestions[0].course_code} — ` : ''}
                {suggestions[0].course_name || suggestions[0].name || 'Untitled Course'}
              </Title>
              <CourseDetailsPanel courseId={suggestions[0].id} label="" alwaysOpen columns={2} />
            </Card>
          ) : (
            <Card style={{ borderRadius: 10, border: '1px dashed #d9d9d9', height: '100%', background: '#fafafa' }}
              styles={{ body: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180 } }}>
              <Empty description={t('manualReview.noStudentSuggestion')} />
            </Card>
          )}
        </Col>
      </Row>

      {/* Row 2: Home course selector + Run Analysis */}
      <Card style={{ borderRadius: 10, marginBottom: 16 }} styles={{ body: { padding: '14px 16px' } }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          <BookOutlined style={{ marginRight: 6 }} />
          {t('manualReview.selectHomeToAnalyze')}
        </Text>
        <Row gutter={12} align="middle">
          <Col flex={1}>
            <Select
              style={{ width: '100%' }}
              placeholder={homeLoading ? t('manualReview.loading') : homeCourses.length > 0 ? t('manualReview.searchPlaceholder') : t('manualReview.searchPlaceholder')}
              value={selectedHomeId}
              onChange={setSelectedHomeId}
              showSearch
              filterOption={false}
              onSearch={searchHomeCourses}
              loading={homeLoading}
              options={allOptions}
              allowClear
              placement="bottomLeft"
              listHeight={220}
              getPopupContainer={() => document.body}
              dropdownStyle={{ zIndex: 9999 }}
              notFoundContent={homeLoading ? <Spin size="small" /> : t('manualReview.noResults')}
            />
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<RobotOutlined />}
              disabled={!selectedHomeId || hasCachedResult}
              loading={analyzeMutation.isPending}
              onClick={() => analyzeMutation.mutate()}
              style={{
                background: 'linear-gradient(135deg, #c0392b, #96281b)',
                borderColor: 'transparent',
                boxShadow: '0 2px 8px rgba(192,57,43,0.4)',
                fontWeight: 600,
                letterSpacing: '0.02em',
                height: 36,
                paddingInline: 20,
                color: '#fff',
              }}
            >
              {t('manualReview.runAnalysis')}
            </Button>
          </Col>
        </Row>
        {selectedCourseDetail && (
          <div style={{ marginTop: 10, padding: '6px 10px', background: '#fff1f0', borderRadius: 6, border: '1px solid #ffa39e' }}>
            <Text style={{ fontSize: 12 }}>
              <Text strong>{t('manualReview.selectedCourseLabel')}: </Text>
              {selectedCourseDetail.course_code ? `${selectedCourseDetail.course_code} — ` : ''}
              {selectedCourseDetail.course_name}
              {selectedCourseDetail.ects ? ` · ${selectedCourseDetail.ects} ECTS` : ''}
              {(selectedCourseDetail.category || selectedCourseDetail.source_metadata?.category)
                ? ` · ${selectedCourseDetail.category || selectedCourseDetail.source_metadata?.category}`
                : ''}
            </Text>
          </div>
        )}
      </Card>

      {/* Row 3+4: Split when analysis exists, stacked otherwise */}
      {activeAnalysis ? (
        <Row gutter={16} align="top">
          {/* Left: AI Analysis Result */}
          <Col span={14}>
            <Card
              style={{ borderRadius: 10, marginBottom: 16 }}
              styles={{ body: { padding: '14px 16px' } }}
              title={
                <Space>
                  <RobotOutlined style={{ color: '#722ed1' }} />
                  <Text strong>{t('manualReview.aiAnalysisResult')}</Text>
                  <Tag color={activeAnalysis.source === 'batch' ? 'blue' : 'purple'} style={{ fontSize: 10 }}>
                    {t(`manualReview.sources.${activeAnalysis.source}`, { defaultValue: activeAnalysis.source === 'batch' ? 'Batch Pipeline' : 'Manual' })}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    {activeAnalysis.created_at ? new Date(activeAnalysis.created_at).toLocaleString('en-GB') : ''}
                  </Text>
                </Space>
              }
            >
              <AnalysisCard a={activeAnalysis} />

              {/* All analyses sorted by score */}
              {allAnalyses.length > 0 && (
                <div style={{ marginTop: 14, borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6, letterSpacing: 0.5 }}>
                    {t('manualReview.allAnalyzedCourses')}
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {allAnalyses.map((a: any) => {
                      const pct = Math.round((a.overall_score ?? 0) * 100);
                      const color = pct >= 70 ? '#52c41a' : pct >= 40 ? '#faad14' : '#ff4d4f';
                      const isActive = activeAnalysis?.home_course_id === a.home_course_id;
                      return (
                        <div
                          key={a.id}
                          onClick={() => { setActiveAnalysis(a); setSelectedHomeId(a.home_course_id); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                            background: isActive ? '#fff1f0' : '#fafafa',
                            border: `1px solid ${isActive ? '#ffa39e' : '#f0f0f0'}`,
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{
                            minWidth: 36, height: 36, borderRadius: '50%',
                            border: `2px solid ${color}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color, flexShrink: 0,
                          }}>{pct}%</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, display: 'block' }}>
                              {a.home_course_code ? `${a.home_course_code} — ` : ''}{a.home_course_name}
                            </Text>
                            <Space size={4}>
                              <Tag style={{ fontSize: 9, margin: 0 }}
                                color={a.source === 'batch' ? 'blue' : 'purple'}>
                                {t(`manualReview.sources.${a.source}`, { defaultValue: a.source })}
                              </Tag>
                              {a.verification_status && (
                                <Tag style={{ fontSize: 9, margin: 0 }}
                                  color={a.verification_status === 'approved' ? 'green' : a.verification_status === 'risk_flagged' ? 'orange' : 'red'}>
                                  {t(`manualReview.verification.${a.verification_status}`)}
                                </Tag>
                              )}
                            </Space>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          </Col>

          {/* Right: Decision Panel */}
          <Col span={10}>
            <Card
              style={{ borderRadius: 10, position: 'sticky', top: 16 }}
              styles={{ body: { padding: '14px 16px' } }}
              title={<Text strong>{t('manualReview.decision')}</Text>}
            >
              {/* Current decision banner */}
              {(data as any).coordinator_note && (
                <div style={{
                  marginBottom: 12, padding: '8px 12px', borderRadius: 6,
                  background: (data as any).status === 'approved' ? '#f6ffed' : '#fff7e6',
                  border: `1px solid ${(data as any).status === 'approved' ? '#b7eb8f' : '#d46b08'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <Text strong style={{ fontSize: 11, color: '#d46b08' }}>
                      {t('manualReview.previousDecision')}
                    </Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                    {t('manualReview.actions.note', { defaultValue: 'Note' })}: "{(data as any).coordinator_note}"
                  </Text>
                </div>
              )}
              <div style={{ marginBottom: 10 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{t('manualReview.notesOptional')}</Text>
                <TextArea
                  rows={4}
                  placeholder={t('manualReview.notesPlaceholder')}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  disabled={!selectedHomeId}
                  loading={approveMutation.isPending}
                  block
                  onClick={() => {
                    const courseName = selectedCourseDetail
                      ? `${selectedCourseDetail.course_code ? selectedCourseDetail.course_code + ' — ' : ''}${selectedCourseDetail.course_name}`
                      : `Course #${selectedHomeId}`;
                    Modal.confirm({
                      title: isSuggestion ? t('manualReview.overrideSuggestionConfirmTitle') : t('manualReview.overrideConfirmTitle'),
                      content: (
                        <div style={{ fontSize: 13 }}>
                          <div style={{ marginBottom: 6 }}>
                            <Text type="secondary">{t('manualReview.selectedCourseLabel')}: </Text>
                            <Text strong>{courseName}</Text>
                          </div>
                          {notes && (
                            <div style={{ marginBottom: 6 }}>
                              <Text type="secondary">{t('manualReview.actions.note', { defaultValue: 'Your note' })}: </Text>
                              <Text italic>"{notes}"</Text>
                            </div>
                          )}
                          <Text type="secondary">{t('manualReview.overrideDesc')}</Text>
                        </div>
                      ),
                      okText: t('manualReview.override'),
                      onOk: () => approveMutation.mutate(),
                    });
                  }}
                  style={{ background: '#d46b08', borderColor: '#d46b08' }}
                >
                  {isSuggestion ? t('manualReview.overrideWithSuggestion') : t('manualReview.override')}
                </Button>
              </Space>
              {!selectedHomeId && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{t('manualReview.selectToEnable')}</Text>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      ) : (
        /* No analysis yet — single-column decision panel */
        <Card
          style={{ borderRadius: 10 }}
          styles={{ body: { padding: '14px 16px' } }}
          title={<Text strong>{t('manualReview.decision')}</Text>}
        >
          {/* Current decision banner */}
          {(data as any).coordinator_note && (
            <div style={{
              marginBottom: 12, padding: '8px 12px', borderRadius: 6,
              background: (data as any).status === 'approved' ? '#f6ffed' : '#fff1f0',
              border: `1px solid ${(data as any).status === 'approved' ? '#b7eb8f' : '#ffa39e'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <Text strong style={{ fontSize: 11, color: '#d46b08' }}>
                  {t('manualReview.previousDecision')}
                </Text>
              </div>
              {(data as any).coordinator_override_course && (
                <Text style={{ fontSize: 12, display: 'block' }}>
                  {(data as any).coordinator_override_course.course_code
                    ? `${(data as any).coordinator_override_course.course_code} — `
                    : ''}
                  {(data as any).coordinator_override_course.course_name}
                  {(data as any).coordinator_override_course.ects
                    ? ` · ${(data as any).coordinator_override_course.ects} ECTS`
                    : ''}
                </Text>
              )}
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                {t('manualReview.actions.note', { defaultValue: 'Note' })}: "{(data as any).coordinator_note}"
              </Text>
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{t('manualReview.notesOptional')}</Text>
            <TextArea
              rows={3}
              placeholder={t('manualReview.notesPlaceholder')}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
          <Space wrap>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              disabled={!selectedHomeId}
              loading={approveMutation.isPending}
              onClick={() => {
                const courseName = selectedCourseDetail
                  ? `${selectedCourseDetail.course_code ? selectedCourseDetail.course_code + ' — ' : ''}${selectedCourseDetail.course_name}`
                  : `Course #${selectedHomeId}`;
                Modal.confirm({
                  title: isSuggestion ? t('manualReview.overrideSuggestionConfirmTitle') : t('manualReview.overrideConfirmTitle'),
                  content: (
                    <div style={{ fontSize: 13 }}>
                      <div style={{ marginBottom: 6 }}>
                        <Text type="secondary">{t('manualReview.selectedCourseLabel')}: </Text>
                        <Text strong>{courseName}</Text>
                      </div>
                      {notes && (
                        <div style={{ marginBottom: 6 }}>
                          <Text type="secondary">{t('manualReview.actions.note', { defaultValue: 'Your note' })}: </Text>
                          <Text italic>"{notes}"</Text>
                        </div>
                      )}
                      <Text type="secondary">{t('manualReview.overrideDesc')}</Text>
                    </div>
                  ),
                  okText: t('manualReview.override'),
                  onOk: () => approveMutation.mutate(),
                });
              }}
              style={{ background: '#d46b08', borderColor: '#d46b08' }}
            >
              {isSuggestion ? t('manualReview.overrideWithSuggestion') : t('manualReview.override')}
            </Button>
          </Space>
          {!selectedHomeId && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>{t('manualReview.selectToEnable')}</Text>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
