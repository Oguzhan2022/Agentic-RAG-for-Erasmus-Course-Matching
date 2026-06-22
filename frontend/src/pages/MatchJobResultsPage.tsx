import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Card, Row, Col, Tag, Progress, Collapse, Typography,
  Space, Alert, Empty, Button, Divider, Spin, Descriptions,
} from 'antd';
import CourseDetailsPanel from '../components/CourseDetailsPanel';
import {
  ArrowLeftOutlined,
  SwapOutlined,
  WarningOutlined,
  ExperimentOutlined,
  BookOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  HomeOutlined,
} from '@ant-design/icons';

import { getMatchJobResults, getCourse } from '../api/client';
import type { CourseMatchResult } from '../types';

const { Title, Text } = Typography;

// ── Config ──────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  technical:    { label: 'Technical', color: '#1890ff', icon: <ExperimentOutlined /> },
  social:       { label: 'Social',    color: '#722ed1', icon: <BookOutlined /> },
  studio_based: { label: 'Studio',    color: '#fa8c16', icon: <ThunderboltOutlined /> },
};

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  queued:    { color: '#1677ff', icon: <ClockCircleOutlined />,   label: 'Queued' },
  matching:  { color: '#fa8c16', icon: <SyncOutlined spin />,     label: 'Matching' },
  verifying: { color: '#13c2c2', icon: <SyncOutlined spin />,     label: 'Verifying' },
  paused:    { color: '#595959', icon: <PauseCircleOutlined />,   label: 'Paused' },
  completed: { color: '#52c41a', icon: <CheckCircleOutlined />,   label: 'Completed' },
  cancelled: { color: '#8c8c8c', icon: <CloseCircleOutlined />,   label: 'Cancelled' },
  failed:    { color: '#ff4d4f', icon: <WarningOutlined />,       label: 'Failed' },
};

const VERIFICATION_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  approved:     { color: '#52c41a', icon: <CheckCircleOutlined />, label: 'Approved' },
  rejected:     { color: '#ff4d4f', icon: <CloseCircleOutlined />, label: 'Rejected' },
  risk_flagged: { color: '#faad14', icon: <WarningOutlined />,     label: 'Risk Flagged' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 0.7) return '#52c41a';
  if (score >= 0.4) return '#faad14';
  return '#ff4d4f';
}

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const percent = Math.round(score * 100);
  const color = scoreColor(score);
  return (
    <Progress
      type="circle"
      percent={percent}
      size={size}
      strokeColor={color}
      format={() => (
        <span style={{ fontSize: size * 0.22, fontWeight: 700, color }}>{percent}%</span>
      )}
    />
  );
}

function ScoreBreakdownBar({ label, score, weight, evidence }: {
  label: string; score: number; weight: number; evidence: string;
}) {
  const percent = Math.round(score * 100);
  const color = scoreColor(score);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{label}</Text>
        <Space size={6}>
          <Tag color="default" style={{ fontSize: 10, margin: 0 }}>{Math.round(weight * 100)}%w</Tag>
          <Text strong style={{ fontSize: 12, color }}>{percent}%</Text>
        </Space>
      </div>
      <Progress percent={percent} showInfo={false} strokeColor={color} size="small" />
      {evidence && (
        <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.3, display: 'block' }}>
          {evidence}
        </Text>
      )}
    </div>
  );
}

// ── Match Card ───────────────────────────────────────────────────────────────

const BREAKDOWN_ORDER = ['content', 'outcomes', 'domain', 'ects', 'metadata', 'title'];

function MatchResultCard({ cr }: { cr: any }) {
  const { t } = useTranslation();
  
  const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    technical:    { label: t('matching.results.categories.technical'), color: '#1890ff', icon: <ExperimentOutlined /> },
    social:       { label: t('matching.results.categories.social'),    color: '#722ed1', icon: <BookOutlined /> },
    studio_based: { label: t('matching.results.categories.studio'),    color: '#fa8c16', icon: <ThunderboltOutlined /> },
  };

  const VERIFICATION_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    approved:     { color: '#52c41a', icon: <CheckCircleOutlined />, label: t('status.approved') },
    rejected:     { color: '#ff4d4f', icon: <CloseCircleOutlined />, label: t('status.rejected') },
    risk_flagged: { color: '#faad14', icon: <WarningOutlined />,     label: t('status.manualReview') },
  };
  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text strong style={{ fontSize: 15 }}>{cr.partner_course.name}</Text>
          {cr.partner_course.ects && (
            <Tag style={{ fontSize: 11 }}>{cr.partner_course.ects} {t('courseTable.columns.ects')}</Tag>
          )}
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('matching.results.matchesFound', { count: cr.matches.length })}
          </Text>
        </div>
      }
      style={{ marginBottom: 16, borderRadius: 10, border: '1px solid #e8e8e8' }}
      styles={{ header: { background: '#fafafa' } }}
    >
      {/* Partner course details — full width, collapsible */}
      <div style={{ marginBottom: 12 }}>
        <CourseDetailsPanel
          courseId={cr.partner_course.id}
          label={t('matching.results.partnerDetails')}
          icon={<FileTextOutlined style={{ color: '#fa8c16' }} />}
          columns={2}
        />
      </div>
      <Divider style={{ margin: '0 0 12px 0' }} />
      <Row gutter={[16, 16]}>
        {cr.matches.map((match: CourseMatchResult) => {
          const catCfg = CATEGORY_CONFIG[match.category] || CATEGORY_CONFIG.technical;
          const breakdown = match.score_breakdown || {};
          const rankColor = match.rank === 1 ? '#52c41a' : match.rank === 2 ? '#faad14' : '#d9d9d9';

          return (
            <Col xs={24} lg={8} key={match.rank}>
              <Card
                size="small"
                style={{
                  borderRadius: 8,
                  border: `2px solid ${match.rank === 1 ? '#52c41a33' : '#f0f0f0'}`,
                  height: '100%',
                }}
                styles={{ body: { padding: 16 } }}
              >
                {/* Rank + Score */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: rankColor, color: match.rank === 3 ? '#666' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, marginBottom: 8,
                    }}>
                      #{match.rank}
                    </div>
                    <ScoreRing score={match.overall_score} size={68} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.3 }}>
                      {match.home_course_name}
                    </Text>
                    <Tag
                      icon={catCfg.icon}
                      color={catCfg.color}
                      style={{ fontSize: 10, marginTop: 6 }}
                    >
                      {catCfg.label}
                    </Tag>
                  </div>
                </div>

                {/* Verification Result */}
                {match.verification_status && (
                  <div style={{
                    marginBottom: 12,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: match.verification_status === 'approved' ? '#f6ffed' : match.verification_status === 'rejected' ? '#fff1f0' : '#fffbe6',
                    border: `1px solid ${match.verification_status === 'approved' ? '#b7eb8f' : match.verification_status === 'rejected' ? '#ffa39e' : '#ffe58f'}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Space size={4}>
                        {VERIFICATION_CONFIG[match.verification_status]?.icon}
                        <Text strong style={{ fontSize: 11, color: VERIFICATION_CONFIG[match.verification_status]?.color }}>
                          {VERIFICATION_CONFIG[match.verification_status]?.label.toUpperCase()}
                        </Text>
                      </Space>
                      <Space size={4}>
                        {match.content_overlap_assessment && (
                          <Tag color="blue" style={{ fontSize: 9, margin: 0 }}>
                            {t(`matching.results.assessments.${match.content_overlap_assessment}`).toUpperCase()}
                          </Tag>
                        )}
                        {match.core_topic_coverage && (
                          <Tag style={{ fontSize: 9, margin: 0 }}>
                            {t(`matching.results.assessments.${match.core_topic_coverage}`).toUpperCase()} {t('matching.results.coverage')}
                          </Tag>
                        )}
                      </Space>
                    </div>
                    {match.verification_reason && (
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.4 }}>
                        {match.verification_reason}
                      </Text>
                    )}
                    {match.is_recommended && (
                      <Tag color="gold" style={{ marginTop: 6, fontSize: 10, fontWeight: 'bold' }}>
                        {t('matching.results.officialRecommendation')}
                      </Tag>
                    )}
                  </div>
                )}

                <Divider style={{ margin: '8px 0' }} />

                {/* Core Home Topics */}
                {Array.isArray(match.core_home_topics) && match.core_home_topics.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                      {t('matching.results.coreHomeTopics')}
                    </Text>
                    <div>
                      {match.core_home_topics.slice(0, 5).map((t: string, i: number) => (
                        <Tag key={i} color="orange" style={{ fontSize: 10, margin: '0 2px 3px 0' }}>{t}</Tag>
                      ))}
                    </div>
                  </div>
                )}

                {/* Matched Topics */}
                {Array.isArray(match.matched_topics) && match.matched_topics.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                      {t('matching.results.syllabusMatches')}
                    </Text>
                    <div>
                      {match.matched_topics.slice(0, 6).map((t: string, i: number) => (
                        <Tag key={i} color="green" style={{ fontSize: 10, margin: '0 2px 3px 0' }}>{t}</Tag>
                      ))}
                      {match.matched_topics.length > 6 && (
                        <Tag style={{ fontSize: 10 }}>+{match.matched_topics.length - 6}</Tag>
                      )}
                    </div>
                  </div>
                )}

                {/* Missing Topics */}
                {Array.isArray(match.missing_topics) && match.missing_topics.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                      {t('matching.results.missingFromPartner')}
                    </Text>
                    <div>
                      {match.missing_topics.slice(0, 4).map((t: string, i: number) => (
                        <Tag key={i} color="red" style={{ fontSize: 10, margin: '0 2px 3px 0' }}>{t}</Tag>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extra Partner Topics (Enrichment) */}
                {Array.isArray(match.extra_partner_topics) && match.extra_partner_topics.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                      {t('matching.results.extraPartnerTopics')}
                    </Text>
                    <div>
                      {match.extra_partner_topics.slice(0, 4).map((t: string, i: number) => (
                        <Tag key={i} color="cyan" style={{ fontSize: 10, margin: '0 2px 3px 0' }}>{t}</Tag>
                      ))}
                    </div>
                  </div>
                )}

                {/* Structural Notes */}
                {Array.isArray(match.structural_notes) && match.structural_notes.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {match.structural_notes.map((n: string, i: number) => (
                      <Alert
                        key={i}
                        message={n}
                        type="info"
                        banner
                        showIcon
                        icon={<ThunderboltOutlined style={{ fontSize: 10 }} />}
                        style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3, background: '#f0f5ff', border: 'none' }}
                      />
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {Array.isArray(match.warnings) && match.warnings.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {match.warnings.slice(0, 2).map((w: string, i: number) => (
                      <Alert
                        key={i}
                        message={w}
                        type="warning"
                        banner
                        showIcon
                        icon={<WarningOutlined style={{ fontSize: 10 }} />}
                        style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3 }}
                      />
                    ))}
                  </div>
                )}

                {/* Home Course Details */}
                <CourseDetailsPanel
                  courseId={match.home_course_id}
                  label={t('matching.results.homeDetails')}
                  icon={<HomeOutlined style={{ color: '#1677ff' }} />}
                />

                {/* Score Breakdown */}
                <Collapse
                  size="small"
                  ghost
                  items={[{
                    key: 'bd',
                    label: <Text style={{ fontSize: 11, color: '#999' }}>{t('matching.results.scoreBreakdown')}</Text>,
                    children: (
                      <div>
                        {BREAKDOWN_ORDER.map(key => {
                          const comp = breakdown[key] as
                            { score: number; weight: number; evidence: string } | undefined;
                          if (!comp) return null;
                          return (
                            <ScoreBreakdownBar
                              key={key}
                              label={t(`matching.results.breakdown.${key}`)}
                              score={comp.score}
                              weight={comp.weight}
                              evidence={comp.evidence}
                            />
                          );
                        })}
                      </div>
                    ),
                  }]}
                />
              </Card>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function MatchJobResultsPage() {
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const id = Number(jobId);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['match-job-results', id],
    queryFn: () => getMatchJobResults(id),
    enabled: !!id,
    staleTime: 30000,
  });

  const job = data?.job;
  const results = data?.course_results || [];
  const backPath = '/matching';
  const pageTitle = t('matching.results.pageTitle');

  const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    queued:    { color: '#1677ff', icon: <ClockCircleOutlined />,   label: t('status.queued') },
    matching:  { color: '#fa8c16', icon: <SyncOutlined spin />,     label: t('status.matching') },
    verifying: { color: '#13c2c2', icon: <SyncOutlined spin />,     label: t('status.verifying') },
    paused:    { color: '#595959', icon: <PauseCircleOutlined />,   label: t('status.paused') },
    completed: { color: '#52c41a', icon: <CheckCircleOutlined />,   label: t('status.completed') },
    cancelled: { color: '#8c8c8c', icon: <CloseCircleOutlined />,   label: t('status.cancelled') },
    failed:    { color: '#ff4d4f', icon: <WarningOutlined />,       label: t('status.failed') },
  };

  const statusCfg = job ? (STATUS_CONFIG[job.status] || STATUS_CONFIG.queued) : null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(backPath)}
          style={{ marginTop: 4 }}
        >
          {t('matching.results.back')}
        </Button>
        <div style={{ flex: 1 }}>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            {pageTitle}
          </Title>
          {job && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {statusCfg && (
                <Tag icon={statusCfg.icon} color={statusCfg.color} style={{ fontSize: 11, fontWeight: 600 }}>
                  {statusCfg.label.toUpperCase()}
                </Tag>
              )}
              <Text strong style={{ fontSize: 14 }}>{job.partner_university_name}</Text>
              <SwapOutlined style={{ color: '#bbb' }} />
              <Text style={{ fontSize: 13, color: '#666' }}>{job.home_university_name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                · {t('matching.results.stats.courses', { count: results.length })} · {t('matching.results.stats.processed', { processed: job.processed_courses, total: job.total_courses })}
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#888' }}>{t('matching.results.loading')}</div>
        </div>
      )}

      {isError && (
        <Alert type="error" message={t('matching.results.failedLoad')} showIcon />
      )}

      {!isLoading && !isError && results.length === 0 && (
        <Card style={{ borderRadius: 10, textAlign: 'center', padding: '60px 24px' }}>
          <Empty description={t('matching.results.noResults')} />
        </Card>
      )}

      {results.map((cr: any, idx: number) => (
        <MatchResultCard key={idx} cr={cr} />
      ))}
    </div>
  );
}
