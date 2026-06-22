import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Card, Table, Row, Col, Statistic, Typography, Spin, Empty, Tag, Input,
  Button, Checkbox, Tooltip, Divider, Alert, Descriptions, Space, message,
} from 'antd';
import {
  BankOutlined, BookOutlined, EnvironmentOutlined,
  SearchOutlined, ArrowLeftOutlined, CalendarOutlined,
  FileTextOutlined, ExperimentOutlined, RightOutlined,
  InfoCircleOutlined, CheckCircleOutlined, WarningOutlined,
  CloseCircleOutlined, GlobalOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getUniversities, getUniversityCourses, getCourseMatchesByPartnerCourse } from '../api/client';
import MatchCandidateCard from '../components/MatchCandidateCard';
import type { Course, CourseMatchResult, University } from '../types';
import { useTranslation } from 'react-i18next';

const { Title, Text, Paragraph } = Typography;

const SEM_TAG: Record<string, { color: string; labelKey: string }> = {
  fall:   { color: 'orange', labelKey: 'partnerUniversities.browser.fall' },
  spring: { color: 'green',  labelKey: 'partnerUniversities.browser.spring' },
  both:   { color: 'blue',   labelKey: 'partnerUniversities.browser.both' },
};

/* ── Tri-state dot (lab/project/seminar) ─────────────────────────── */
function TriDot({ label, value }: { label: string; value: boolean | 'unknown' }) {
  const color = value === true ? '#52c41a' : value === false ? '#ff4d4f' : '#bfbfbf';
  const Icon = value === true ? CheckCircleOutlined : value === false ? CloseCircleOutlined : QuestionCircleOutlined;
  const { t } = useTranslation();
  const text = value === true ? t('partnerUniversities.details.components.yes') : value === false ? t('partnerUniversities.details.components.no') : t('partnerUniversities.details.components.unknown');
  return (
    <Tooltip title={`${label}: ${text}`}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 4, fontSize: 11,
        background: value === true ? '#f6ffed' : value === false ? '#fff2f0' : '#fafafa',
        border: `1px solid ${value === true ? '#b7eb8f' : value === false ? '#ffa39e' : '#e8e8e8'}`,
        color,
      }}>
        <Icon style={{ fontSize: 10 }} />
        <span style={{ color: '#555' }}>{label}</span>
      </span>
    </Tooltip>
  );
}

/* ── AI Candidates panel ─────────────────────────────────────────── */
function CandidatesPanel({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['partner-course-matches', courseId],
    queryFn: () => getCourseMatchesByPartnerCourse(courseId),
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Spin size="small" />
        <Text style={{ fontSize: 12, color: '#999' }}>{t('partnerUniversities.browser.loading')}</Text>
      </div>
    );
  }

  const candidates: CourseMatchResult[] = data?.candidates || [];

  return (
    <div>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <ExperimentOutlined style={{ color: '#c0392b', fontSize: 13 }} />
        <Text style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666' }}>
          {t('partnerUniversities.details.aiMatches')}
        </Text>
        {candidates.length > 0 && (
          <Tag style={{ margin: 0, fontSize: 10 }}>{candidates.length}</Tag>
        )}
      </div>

      {/* Disclaimer */}
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message={
          <Text style={{ fontSize: 11 }}>
            {t('partnerUniversities.details.aiDisclaimer')}
          </Text>
        }
        style={{ marginBottom: 12, borderRadius: 6, padding: '6px 12px' }}
      />

      {candidates.length === 0 ? (
        <div style={{ padding: '8px 0', color: '#bfbfbf', fontSize: 12, fontStyle: 'italic' }}>
          {t('partnerUniversities.details.noAiMatches')}
        </div>
      ) : (
        candidates.map((m, i) => {
          const vs = m.verification_status;
          const statusLabel =
            vs === 'approved'     ? { icon: <CheckCircleOutlined />, color: '#52c41a',  text: t('partnerUniversities.status.approved') } :
            vs === 'risk_flagged' ? { icon: <WarningOutlined />,     color: '#faad14',  text: t('partnerUniversities.status.rejected') } : // note: risk_flagged maps to rejected label in some cases or use unique key
            vs === 'rejected'     ? { icon: <CloseCircleOutlined />, color: '#ff4d4f',  text: t('partnerUniversities.status.rejected') } :
                                    null;
          return (
            <div key={m.id} style={{ marginBottom: 10 }}>
              {statusLabel && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: statusLabel.color,
                  marginBottom: 4,
                }}>
                  {statusLabel.icon} {statusLabel.text}
                </div>
              )}
              <MatchCandidateCard match={m} rank={i + 1} />
            </div>
          );
        })
      )}
    </div>
  );
}

/* ── Expandable course row ───────────────────────────────────────── */
function CourseRow({ course, isOpen, onToggle }: { course: Course; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const open = isOpen;
  const sem = (course.semester || '').toLowerCase();
  const semCfg = SEM_TAG[sem];
  const ac = course.academic_context;
  const mq = course.metadata_quality;

  const hasContent  = !!(course.content && course.content !== 'unknown');
  const hasOutcomes = !!(course.learning_outcomes && course.learning_outcomes !== 'unknown');

  const fmtArr = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v : (v && v !== 'unknown' ? [v] : []);

  return (
    <div style={{ borderBottom: '1px solid #f0f0f0' }}>
      {/* ── Collapsed row ── */}
      <div
        onClick={onToggle}
        className="course-row-item"
        style={{
          display: 'grid',
          gridTemplateColumns: '20px 130px 1fr 36px 72px',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          cursor: 'pointer',
          background: open ? '#fafafa' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        {/* Chevron */}
        <RightOutlined style={{
          fontSize: 9, color: '#bfbfbf',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'none',
          justifySelf: 'center',
        }} />

        {/* Code */}
        <div className="course-code-col" style={{
          fontFamily: 'monospace', fontSize: 11, color: '#888',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {course.course_code && course.course_code !== 'unknown'
            ? course.course_code
            : <span style={{ color: '#d9d9d9' }}>—</span>}
        </div>

        {/* Name */}
        <div style={{ fontWeight: 500, fontSize: 13, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {course.course_name}
        </div>

        {/* ECTS circle */}
        <Tooltip title={t('partnerUniversities.details.ects')}>
          <span style={{
            width: 32, height: 32, borderRadius: '50%',
            background: course.ects != null ? '#1a1a1a' : 'transparent',
            color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800, fontFamily: 'monospace',
            justifySelf: 'center',
          }}>
            {course.ects != null ? course.ects : <span style={{ color: '#d9d9d9', fontWeight: 400 }}>—</span>}
          </span>
        </Tooltip>

        {/* Semester tag */}
        <div className="course-sem-col" style={{ display: 'flex', justifyContent: 'flex-start' }}>
          {semCfg
            ? <Tag color={semCfg.color} style={{ margin: 0, fontSize: 11 }}>{t(semCfg.labelKey)}</Tag>
            : <span style={{ color: '#d9d9d9', fontSize: 11 }}>—</span>
          }
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {open && (
        <div className="course-details-expanded" style={{ padding: '12px 16px 24px', background: '#fafafa' }}>

          {/* Basic info grid */}
          <div style={{ marginBottom: 16, paddingTop: 12 }}>
            <div style={sectionLabel}>
              <InfoCircleOutlined /> {t('partnerUniversities.details.title')}
            </div>
            <Descriptions
              size="small"
              className="course-desc-list"
              column={{ xs: 1, sm: 2, md: 4 }}
              style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #f0f0f0' }}
              labelStyle={{ fontSize: 11, color: '#999', fontWeight: 500 }}
              contentStyle={{ fontSize: 12, color: '#333', fontWeight: 500 }}
            >
              {course.course_code && course.course_code !== 'unknown' && (
                <Descriptions.Item label={t('partnerUniversities.details.code')}>
                  <span style={{ fontFamily: 'monospace' }}>{course.course_code}</span>
                </Descriptions.Item>
              )}
              {course.ects != null && (
                <Descriptions.Item label={t('partnerUniversities.details.ects')}>{course.ects}</Descriptions.Item>
              )}
              {course.level && course.level !== 'unknown' && (
                <Descriptions.Item label={t('partnerUniversities.details.level')} >
                  <span style={{ textTransform: 'capitalize' }}>{course.level}</span>
                </Descriptions.Item>
              )}
              {course.semester && course.semester !== 'unknown' && (
                <Descriptions.Item label={t('partnerUniversities.details.semester')}>
                  <span style={{ textTransform: 'capitalize' }}>{course.semester}</span>
                </Descriptions.Item>
              )}
              {course.language && course.language !== 'unknown' && (
                <Descriptions.Item label={t('partnerUniversities.details.language')}>
                  <GlobalOutlined style={{ marginRight: 4 }} />{course.language}
                </Descriptions.Item>
              )}
              {course.department && course.department !== 'unknown' && (
                <Descriptions.Item label={t('partnerUniversities.details.department')}>{course.department}</Descriptions.Item>
              )}
            </Descriptions>
          </div>

          {/* Academic context */}
          {ac && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}><ExperimentOutlined /> {t('partnerUniversities.details.academicContext')}</div>
              <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
                {fmtArr(ac.primary_format).length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f5f5f5' }}>
                    <span style={{ fontSize: 11, color: '#999', fontWeight: 600, minWidth: 90, flexShrink: 0 }}>{t('partnerUniversities.details.format')}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {fmtArr(ac.primary_format).map((f, i) => (
                        <Tag key={i} color="blue" style={{ fontSize: 11, margin: 0 }}>{f}</Tag>
                      ))}
                    </div>
                  </div>
                )}
                {fmtArr(ac.assessment_mode).length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f5f5f5' }}>
                    <span style={{ fontSize: 11, color: '#999', fontWeight: 600, minWidth: 90, flexShrink: 0 }}>{t('partnerUniversities.details.assessment')}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {fmtArr(ac.assessment_mode).map((m, i) => (
                        <Tag key={i} color="purple" style={{ fontSize: 11, margin: 0 }}>{m}</Tag>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: (ac.special_tags || []).length > 0 ? '1px solid #f5f5f5' : undefined }}>
                  <span style={{ fontSize: 11, color: '#999', fontWeight: 600, minWidth: 90, flexShrink: 0 }}>{t('partnerUniversities.details.components.title')}</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <TriDot label={t('partnerUniversities.details.components.lab')}     value={ac.lab_status} />
                    <TriDot label={t('partnerUniversities.details.components.project')} value={ac.project_status} />
                    <TriDot label={t('partnerUniversities.details.components.seminar')} value={ac.seminar_status} />
                  </div>
                </div>
                {(ac.special_tags || []).length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, color: '#999', fontWeight: 600, minWidth: 90, flexShrink: 0 }}>{t('partnerUniversities.details.tags')}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(ac.special_tags || []).map((t, i) => (
                        <Tag key={i} style={{ fontSize: 11, margin: 0 }}>{t}</Tag>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metadata quality */}
          {mq && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}><CheckCircleOutlined /> {t('partnerUniversities.details.dataQuality.title')}</div>
              <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #f0f0f0', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#999' }}>{t('partnerUniversities.details.dataQuality.content')}:</span>
                  <Tag color={mq.content_available ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>
                    {mq.content_available ? t('partnerUniversities.details.dataQuality.available') : t('partnerUniversities.details.dataQuality.missing')}
                  </Tag>
                </div>
                <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#999' }}>{t('partnerUniversities.details.dataQuality.outcomes')}:</span>
                  <Tag color={mq.outcomes_available ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>
                    {mq.outcomes_available ? t('partnerUniversities.details.dataQuality.available') : t('partnerUniversities.details.dataQuality.missing')}
                  </Tag>
                </div>
                <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#999' }}>{t('partnerUniversities.details.dataQuality.confidence')}:</span>
                  <Tag color={mq.format_confidence === 'high' ? 'green' : mq.format_confidence === 'medium' ? 'orange' : 'red'} style={{ margin: 0, fontSize: 10, textTransform: 'uppercase' }}>
                    {mq.format_confidence}
                  </Tag>
                </div>
              </div>
            </div>
          )}

          {/* Content */}
          {hasContent && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}><FileTextOutlined /> {t('partnerUniversities.details.description')}</div>
              <div style={{
                background: '#fff', borderRadius: 8, padding: '12px 14px',
                border: '1px solid #f0f0f0', maxHeight: 200, overflowY: 'auto',
              }}>
                <Paragraph style={{ fontSize: 13, lineHeight: 1.7, color: '#444', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {course.content}
                </Paragraph>
              </div>
            </div>
          )}

          {/* Learning outcomes */}
          {hasOutcomes && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}><BookOutlined /> {t('partnerUniversities.details.learningOutcomes')}</div>
              <div style={{
                background: '#fff', borderRadius: 8, padding: '12px 14px',
                border: '1px solid #f0f0f0', maxHeight: 200, overflowY: 'auto',
              }}>
                <Paragraph style={{ fontSize: 13, lineHeight: 1.7, color: '#444', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {course.learning_outcomes}
                </Paragraph>
              </div>
            </div>
          )}

          {/* Warnings */}
          {(course.warnings || []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}><WarningOutlined /> {t('partnerUniversities.details.warnings')}</div>
              <div style={{ background: '#fffbe6', borderRadius: 8, padding: '10px 14px', border: '1px solid #ffe58f' }}>
                {course.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#ad6800', lineHeight: 1.8 }}>• {t(`partnerUniversities.details.warningMessages.${w}`, { defaultValue: w })}</div>
                ))}
              </div>
            </div>
          )}

          <Divider style={{ margin: '16px 0 14px' }} />

          {/* AI match candidates */}
          <CandidatesPanel courseId={course.id} />
        </div>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: '#aaa', marginBottom: 6,
  display: 'flex', alignItems: 'center', gap: 5,
};

/* ── Course browser ──────────────────────────────────────────────── */
function CourseBrowser({
  university,
  onBack,
}: {
  university: { id: number; name: string; city?: string | null; country?: string | null; course_count?: number | null };
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [semFilter, setSemFilter] = useState<string[]>([]);
  const [openCourseId, setOpenCourseId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleToggle = useCallback((id: number) => {
    setOpenCourseId(prev => prev === id ? null : id);
  }, []);

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedSearch(val), 350);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['partner-uni-courses', university.id, debouncedSearch],
    queryFn: () => getUniversityCourses(university.id, {
      search: debouncedSearch || undefined,
      limit: 300,
    }),
    staleTime: 60_000,
  });

  const filtered: Course[] = React.useMemo(() => {
    const all = data?.courses || [];
    if (semFilter.length === 0) return all;
    return all.filter(c => {
      const s = (c.semester || '').toLowerCase();
      if (semFilter.includes('fall') && semFilter.includes('spring')) return true;
      if (semFilter.includes('fall'))   return s === 'fall'   || s === 'both';
      if (semFilter.includes('spring')) return s === 'spring' || s === 'both';
      return true;
    });
  }, [data, semFilter]);

  const toggle = (sem: string) =>
    setSemFilter(prev => prev.includes(sem) ? [] : [sem]);

  return (
    <div>
      {/* University header */}
      <Card
        style={{
          marginBottom: 16, borderRadius: 12,
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 100%)',
          border: 'none',
        }}
        styles={{ body: { padding: '18px 24px' } }}
      >
        <div className="uni-header-banner" style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            className="mobile-back-btn"
            style={{ 
              background: 'rgba(255,255,255,0.08)', 
              border: '1px solid rgba(255,255,255,0.1)', 
              color: '#fff', 
              borderRadius: '50%',
              width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              marginTop: 4
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, background: '#c0392b',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <BankOutlined style={{ color: '#fff', fontSize: 16 }} />
              </div>
              <Title level={5} style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>
                {university.name}
              </Title>
            </div>
            {(university.city || university.country) && (
              <div style={{ color: '#aaa', fontSize: 12, marginLeft: 44 }}>
                <EnvironmentOutlined style={{ marginRight: 4 }} />
                {[university.city, university.country].filter(Boolean).join(', ')}
              </div>
            )}
            {university.course_count != null && (
              <div className="uni-course-count-mobile" style={{ marginTop: 8, marginLeft: 44 }}>
                 <Tag color="rgba(255,255,255,0.1)" style={{ color: '#888', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }}>{t('partnerUniversities.browser.coursesCount', { count: university.course_count })}</Tag>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Search + filter bar */}
      <Card
        style={{ borderRadius: 10, border: '1px solid #e8e8e8', marginBottom: 12 }}
        styles={{ body: { padding: '10px 16px' } }}
      >
        <div className="course-filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            placeholder={t('partnerUniversities.browser.searchPlaceholder')}
            value={search}
            onChange={e => handleSearch(e.target.value)}
            allowClear
            style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
          />
          <Divider type="vertical" style={{ height: 22, margin: '0 4px' }} />
          <div className="semester-filter-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 11, color: '#999', fontWeight: 500, whiteSpace: 'nowrap' }}>
              <CalendarOutlined style={{ marginRight: 4 }} />{t('partnerUniversities.browser.semester')}
            </Text>
            <Checkbox checked={semFilter.includes('fall')} onChange={() => toggle('fall')}>
              <span style={{ fontSize: 12, color: '#d46b08', fontWeight: 500 }}>{t('partnerUniversities.browser.fall')}</span>
            </Checkbox>
            <Checkbox checked={semFilter.includes('spring')} onChange={() => toggle('spring')}>
              <span style={{ fontSize: 12, color: '#389e0d', fontWeight: 500 }}>{t('partnerUniversities.browser.spring')}</span>
            </Checkbox>
          </div>
          <Text style={{ marginLeft: 'auto', fontSize: 12, color: '#999' }}>
            {isLoading ? t('partnerUniversities.browser.loading') : t('partnerUniversities.browser.coursesCount', { count: filtered.length })}
          </Text>
        </div>
      </Card>

      {/* Course list */}
      <Card style={{ borderRadius: 10, border: '1px solid #e8e8e8', overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
        {/* Column header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '20px 130px 1fr 36px 72px',
          gap: 12,
          padding: '8px 16px',
          background: '#fafafa', borderBottom: '1px solid #f0f0f0',
        }} className="course-row-header">
          <div />
          <div className="course-code-col" style={colHeader}>{t('partnerUniversities.details.code')}</div>
          <div style={colHeader}>{t('partnerUniversities.university')}</div>
          <div style={{ ...colHeader, textAlign: 'center' }}>{t('partnerUniversities.details.ects')}</div>
          <div className="course-sem-col" style={colHeader}>{t('partnerUniversities.details.semester')}</div>
        </div>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
            <div style={{ marginTop: 12, color: '#999', fontSize: 13 }}>{t('partnerUniversities.browser.loading')}</div>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: 48 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {search ? t('partnerUniversities.browser.noMatches', { search }) : t('partnerUniversities.browser.noFilters')}
                </Text>
              }
            />
          </div>
        )}

        {!isLoading && filtered.map(course => (
          <CourseRow
            key={course.id}
            course={course}
            isOpen={openCourseId === course.id}
            onToggle={() => handleToggle(course.id)}
          />
        ))}
      </Card>
    </div>
  );
}

const colHeader: React.CSSProperties = {
  fontSize: 10, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.06em', color: '#c0c0c0',
};

/* ── Main page ───────────────────────────────────────────────────── */
export default function PartnerUniversitiesPage() {
  const { t } = useTranslation();
  const { activeDepartment } = useAuth();
  const navigate = useNavigate();
  const { uniId } = useParams<{ uniId?: string }>();
  const selectedId = uniId ? Number(uniId) : null;

  const { data: universities = [], isLoading } = useQuery({
    queryKey: ['universities', activeDepartment, 'activeOnly'],
    queryFn: () => getUniversities(activeDepartment || undefined, true),
    staleTime: 60_000,
  });

  const partners = universities.filter((u: University) => !u.is_home);
  const totalCourses = partners.reduce((s: number, u: University) => s + (u.course_count || 0), 0);
  const selectedUni = selectedId ? partners.find(u => u.id === selectedId) : null;

  const columns = [
    {
      title: t('partnerUniversities.university'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <div>
          <a
            onClick={() => navigate(`/partner-universities/${record.id}`)}
            style={{ fontWeight: 500, fontSize: 13, color: '#1a1a1a' }}
          >
            {name}
          </a>
          {(record.city || record.country) && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              <EnvironmentOutlined style={{ marginRight: 3, fontSize: 10 }} />
              {[record.city, record.country].filter(Boolean).join(', ')}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('partnerUniversities.country'),
      dataIndex: 'country',
      key: 'country',
      width: 130,
      render: (v: string | null) => <span style={{ fontSize: 12, color: '#555' }}>{v || '—'}</span>,
    },
    {
      title: t('partnerUniversities.courses'),
      dataIndex: 'course_count',
      key: 'course_count',
      width: 90,
      align: 'center' as const,
      render: (v: number) => (
        <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 14, color: v ? '#1a1a1a' : '#bfbfbf' }}>
          {v || 0}
        </span>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 150,
      render: (_: unknown, record: any) => (
        <Space size={4}>
          {record.has_profile && (
            <Button
              size="small"
              type="text"
              icon={<InfoCircleOutlined />}
              style={{ fontSize: 12, color: '#888' }}
              onClick={(e) => { e.stopPropagation(); navigate(`/partner-universities/${record.id}/info`); }}
            >
              {t('partnerUniversities.actions.info')}
            </Button>
          )}
          <Button
            size="small"
            type="text"
            style={{ fontSize: 12, color: '#c0392b', fontWeight: 500 }}
            onClick={() => navigate(`/partner-universities/${record.id}`)}
          >
            {t('partnerUniversities.actions.browse')} →
          </Button>
        </Space>
      ),
    },
  ];

  if (selectedUni) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <CourseBrowser university={selectedUni} onBack={() => navigate('/partner-universities')} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('partnerUniversities.title')}</span>}
              value={partners.length}
              prefix={<BankOutlined style={{ color: '#c0392b', fontSize: 16 }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('partnerUniversities.totalCourses')}</span>}
              value={totalCourses}
              prefix={<BookOutlined style={{ color: '#c0392b', fontSize: 16 }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
      </Row>

      <Card className="partner-uni-list" styles={{ header: { borderBottom: '1px solid #ededed' } }}>
        <Table
          columns={columns}
          dataSource={partners}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('partnerUniversities.noUniversities')}
                style={{ padding: '32px 0' }}
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}
