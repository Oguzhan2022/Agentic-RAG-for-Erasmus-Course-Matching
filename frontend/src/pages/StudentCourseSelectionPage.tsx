import React, { useState, useEffect, useRef } from 'react';
import {
  Card, Collapse, Button, Tag, Typography, Spin, Empty,
  Modal, Descriptions, Alert, message, Row, Col, Space, Divider, Progress, Tooltip,
  Input, Checkbox, Table, Radio,
} from 'antd';
import {
  ArrowLeftOutlined, SwapOutlined, BookOutlined, CheckCircleOutlined,
  ExclamationCircleOutlined, SendOutlined,
  DownOutlined, UpOutlined, ExperimentOutlined, ThunderboltOutlined,
  WarningOutlined, CloseCircleOutlined, CloseCircleFilled, ClearOutlined, BulbOutlined, SearchOutlined, HomeOutlined, EditOutlined, UndoOutlined,
  FileTextOutlined, SyncOutlined, FilePdfOutlined, FileExcelOutlined, CloseOutlined, PlusOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// xlsx is lazy-loaded in export function
import {
  getStudentApplication, selectCourse, deselectCourse, submitApplication, finalizeApplicationStudent,
  getEctsSummary, requestCoordinatorReview, getMatchCandidates, resetApplication,
  getHomeCourses, suggestAlternatives, clearReviewRequest, clearAlternativeSuggestion,
  withdrawApplication, updateApplicationNotes, setStudentEditingState,
} from '../api/client';
import ApplicationStatusBadge from '../components/ApplicationStatusBadge';
import CourseDetailsPanel from '../components/CourseDetailsPanel';
import EctsProgressBar from '../components/EctsProgressBar';

const { Title, Text } = Typography;

const CAT_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  technical: { label: 'Technical', color: '#1890ff', icon: <ExperimentOutlined /> },
  social: { label: 'Social', color: '#722ed1', icon: <BookOutlined /> },
  studio_based: { label: 'Studio', color: '#fa8c16', icon: <ThunderboltOutlined /> },
};

const VER_CFG: Record<string, { color: string; icon: React.ReactNode; labelKey: string }> = {
  approved: { color: '#52c41a', icon: <CheckCircleOutlined />, labelKey: 'applicationDetail.labels.aiApproved' },
  rejected: { color: '#ff4d4f', icon: <CloseCircleOutlined />, labelKey: 'applicationDetail.labels.aiRejected' },
  risk_flagged: { color: '#faad14', icon: <WarningOutlined />, labelKey: 'applicationDetail.labels.aiRisk' },
};

/** Modal: ask coordinator to review — with optional alternative course selection when no good candidates */
function CoordinatorReviewRequestModal({
  open, appId, partnerCourseId, hasRecommendedCandidates,
  initialNote, initialAlternativeIds, initialAlternativeReason,
  onClose, onSaved, reviewRequestMutation, takenHomeIds,
}: {
  open: boolean; appId: number; partnerCourseId: number;
  hasRecommendedCandidates: boolean;
  initialNote: string; initialAlternativeIds: number[]; initialAlternativeReason: string;
  onClose: () => void; onSaved: () => void; reviewRequestMutation: any;
  takenHomeIds: Set<number>;
}) {
  const { t } = useTranslation();
  const [note, setNote] = React.useState(initialNote);
  const [altSearch, setAltSearch] = React.useState('');
  const [altIds, setAltIds] = React.useState<number[]>(initialAlternativeIds);
  const [altReason, setAltReason] = React.useState(initialAlternativeReason);

  React.useEffect(() => {
    if (open) {
      setNote(initialNote);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: homeData, isLoading: homeLoading } = useQuery({
    queryKey: ['home-courses', appId, partnerCourseId, altSearch],
    queryFn: () => getHomeCourses(appId, partnerCourseId, altSearch || undefined),
    enabled: open && !hasRecommendedCandidates && !!partnerCourseId,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await reviewRequestMutation.mutateAsync({ partnerCourseId, note });
    },
    onSuccess: () => { message.success(t('applicationDetail.messages.requestSent')); onSaved(); onClose(); },
    onError: () => message.error(t('applicationDetail.messages.requestFailed')),
  });

  const homeCourses = [...(homeData?.courses || [])].sort((a: any, b: any) => {
    const aS = altIds.includes(a.id) ? 0 : 1;
    const bS = altIds.includes(b.id) ? 0 : 1;
    return aS - bS || a.course_name.localeCompare(b.course_name);
  });

  const toggleAlt = (id: number) => {
    // Collision check disabled
    setAltIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const canSubmit = note.trim().length > 0;

  return (
    <Modal
      open={open}
      title={<Space><ExclamationCircleOutlined style={{ color: '#faad14' }} />{t('applicationDetail.modals.askReview.title')}</Space>}
      onCancel={onClose}
      onOk={() => saveMutation.mutate()}
      okText={t('applicationDetail.modals.askReview.send')}
      confirmLoading={saveMutation.isPending}
      okButtonProps={{ disabled: !canSubmit }}
      cancelText={t('applicationDetail.labels.cancel')}
      width={500}
    >
      <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        {t('applicationDetail.modals.askReview.desc')}
      </p>

      {/* Note textarea — always shown */}
      <div style={{ marginBottom: hasRecommendedCandidates ? 0 : 16 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500 }}>
          {t('applicationDetail.modals.askReview.noteLabel')} <span style={{ color: '#ff4d4f' }}>*</span>
        </label>
        <Input.TextArea
          rows={3}
          placeholder={t('applicationDetail.modals.askReview.notePlaceholder')}
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
        />
        <div style={{ textAlign: 'right', fontSize: 11, color: '#bbb', marginTop: 4 }}>
          {note.length} / 500
        </div>
      </div>
    </Modal>
  );
}

/** Modal: student suggests alternative home courses + reason */
function AlternativeSuggestModal({
  open, appId, partnerCourseId, existingIds, existingReason, onClose, onSaved, takenHomeIds,
}: {
  open: boolean; appId: number; partnerCourseId: number;
  existingIds: number[]; existingReason: string;
  onClose: () => void; onSaved: () => void;
  takenHomeIds: Set<number>;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<number[]>(existingIds);
  const [reason, setReason] = React.useState(existingReason);

  // Reset local state when modal opens
  React.useEffect(() => {
    if (open) { setSelectedIds(existingIds); setReason(existingReason); setSearch(''); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery({
    queryKey: ['home-courses', appId, partnerCourseId, search],
    queryFn: () => getHomeCourses(appId, partnerCourseId, search || undefined),
    enabled: open && !!partnerCourseId,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: () => suggestAlternatives(appId, {
      partner_course_id: partnerCourseId,
      home_course_ids: selectedIds,
      reason,
    }),
    onSuccess: () => { message.success(t('applicationDetail.messages.altSaved')); onSaved(); onClose(); },
    onError: () => message.error(t('applicationDetail.messages.altFailed')),
  });

  const courses = [...(data?.courses || [])].sort((a: any, b: any) => {
    const aSelected = selectedIds.includes(a.id) ? 0 : 1;
    const bSelected = selectedIds.includes(b.id) ? 0 : 1;
    return aSelected - bSelected || a.course_name.localeCompare(b.course_name);
  });

  const toggle = (id: number) => {
    // Collision check disabled
    setSelectedIds(prev => prev.includes(id) ? [] : [id]);
  };

  return (
    <Modal
      open={open}
      title={<Space><BulbOutlined style={{ color: '#fa8c16' }} />{t('applicationDetail.modals.suggestAlt.title')}</Space>}
      onCancel={onClose}
      onOk={() => saveMutation.mutate()}
      okText={t('applicationDetail.modals.suggestAlt.save')}
      confirmLoading={saveMutation.isPending}
      okButtonProps={{ disabled: selectedIds.length === 0 || !reason.trim() }}
      width={620}
    >
      <div style={{ marginBottom: 8, color: '#666', fontSize: 12 }}>
        {t('applicationDetail.modals.suggestAlt.desc')}
      </div>

      {/* Search */}
      <Input
        prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        placeholder={t('applicationDetail.modals.suggestAlt.search')}
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {/* Course list */}
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, marginBottom: 12 }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
        ) : courses.length === 0 ? (
          <Empty description={t('applicationDetail.modals.suggestAlt.noCourses')} image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ padding: '20px 0' }} />
        ) : (
          courses.map((c: any) => {
            const isTaken = takenHomeIds.has(c.id) && !selectedIds.includes(c.id);
            return (
              <div
                key={c.id}
                onClick={() => toggle(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', cursor: 'pointer',
                  background: selectedIds.includes(c.id) ? '#fff7e6' : 'transparent',
                  borderBottom: '1px solid #f5f5f5',
                  transition: 'background 0.1s',
                  opacity: isTaken ? 0.6 : 1,
                }}
              >
                <Radio checked={selectedIds.includes(c.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: selectedIds.includes(c.id) ? 600 : 400 }}>
                    {c.course_code && <Tag style={{ fontSize: 10, marginRight: 6 }}>{c.course_code}</Tag>}
                    {c.course_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {[c.department, c.ects ? `${c.ects} ${t('courseTable.columns.ects')}` : null, c.level].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {selectedIds.includes(c.id) && <CheckCircleOutlined style={{ color: '#fa8c16' }} />}
              </div>
            );
          })
        )}
      </div>

      {/* Selected summary */}
      {selectedIds.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: '#fa8c16', fontWeight: 500 }}>
          {t('applicationDetail.modals.suggestAlt.selected', { count: selectedIds.length })}
        </div>
      )}

      {/* Reason textarea */}
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500 }}>
          {t('applicationDetail.modals.suggestAlt.reasonLabel')} <span style={{ color: '#ff4d4f' }}>*</span>
        </label>
        <Input.TextArea
          rows={3}
          placeholder={t('applicationDetail.modals.suggestAlt.reasonPlaceholder')}
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={500}
        />
        <div style={{ textAlign: 'right', fontSize: 11, color: '#bbb', marginTop: 4 }}>
          {reason.length} / 500
        </div>
      </div>
    </Modal>
  );
}

/** Inline 3-column match candidates grid */
function InlineCandidates({
  appId, partnerCourse, selectedHomeIds, isEditable, onRefresh, onNamesResolved, takenHomeIds, rejectedHomeIds, hasOtherRequest,
}: {
  appId: number; partnerCourse: any; selectedHomeIds: number[];
  isEditable: boolean; onRefresh: () => void;
  onNamesResolved?: (names: Record<number, string>) => void;
  takenHomeIds: Set<number>;
  rejectedHomeIds: number[];
  hasOtherRequest?: boolean;
}) {
  const { t } = useTranslation();
  const partnerCourseId = partnerCourse?.id;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['candidates', appId, partnerCourseId],
    queryFn: () => getMatchCandidates(appId, partnerCourseId),
    enabled: !!partnerCourseId,
    staleTime: 60_000,
  });

  // Lift candidate names to parent whenever data loads
  React.useEffect(() => {
    if (data?.candidates && onNamesResolved) {
      const map: Record<number, string> = {};
      data.candidates.forEach((c: any) => {
        let label = c.home_course_code
          ? `${c.home_course_code} — ${c.home_course_name}`
          : c.home_course_name;
        if (c.home_course_ects) {
          label += ` — ${c.home_course_ects} ${t('courseTable.columns.ects')}`;
        }
        map[c.home_course_id] = label;
      });
      onNamesResolved(map);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle: select calls the same endpoint; backend handles add/remove
  const toggleMutation = useMutation({
    mutationFn: (match: any) => selectCourse(appId, {
      partner_course_id: partnerCourseId,
      home_course_id: match.home_course_id,
      course_match_id: match.id,
    }),
    onSuccess: (_data, match: any) => {
      const wasSelected = selectedHomeIds.includes(match.home_course_id);
      message.success(wasSelected ? t('applicationDetail.messages.matchDeselected') : t('applicationDetail.messages.matchSelected'));
      onRefresh();
    },
    onError: () => message.error(t('applicationDetail.messages.updateFailed')),
  });

  if (isLoading) return <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>;
  const candidates = [...(data?.candidates || [])].sort((a: any, b: any) => {
    if (b.overall_score !== a.overall_score) return b.overall_score - a.overall_score;
    return a.id - b.id;
  });
  if (!candidates.length) return <Empty description={t('applicationDetail.labels.noMatchCandidates')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  return (
    <div style={{ marginTop: 24 }}>
      <div className="candidates-grid-header" style={{
        display: 'grid',
        gridTemplateColumns: '80px 1.4fr 110px 1.4fr 270px',
        padding: '16px 20px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '12px 12px 0 0',
        fontSize: 12,
        fontWeight: 500,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        borderBottom: 'none'
      }}>
        <div style={{ paddingLeft: 19 }}>{t('applicationDetail.sections.selection')}</div>
        <div style={{ paddingLeft: 0 }}>{t('applicationDetail.sections.homeCourse')}</div>
        <div style={{ textAlign: 'center' }}>{t('applicationDetail.sections.match')}</div>
        <div style={{ paddingLeft: 0 }}>{t('applicationDetail.sections.hostCourse')}</div>
        <div style={{ paddingLeft: 4 }}>{t('applicationDetail.sections.status')}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: '#f8fafc', padding: '0 0 12px 0', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
        {candidates.map((c: any) => {
          const pct = Math.round(c.overall_score * 100);
          const isRejected = c.verification_status === 'rejected';
          const isExplicitlyRejected = (rejectedHomeIds || []).includes(c.home_course_id);
          const isRisk = c.verification_status === 'risk_flagged';
          
          // Color logic: Prioritize verification status
          let color = (pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444'); // default based on score
          if (isRisk) color = '#f59e0b';
          if (isRejected || isExplicitlyRejected) color = '#ef4444';

          const isSel = selectedHomeIds.includes(c.home_course_id);
          const isExp = expanded.has(c.id);

          return (
            <div key={c.id} style={{
              background: isSel ? '#f0f9ff' : '#fff',
              border: `1px solid ${isSel ? '#bae6fd' : '#e2e8f0'}`,
              borderRadius: 12,
              boxShadow: isSel ? '0 4px 12px rgba(14, 165, 233, 0.08)' : '0 2px 4px rgba(0,0,0,0.02)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              overflow: 'hidden'
            }}
            onMouseEnter={e => {
              if (!isSel) {
                e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.06)';
                e.currentTarget.style.borderColor = '#cbd5e1';
              }
            }}
            onMouseLeave={e => {
              if (!isSel) {
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';
                e.currentTarget.style.borderColor = '#e2e8f0';
              }
            }}
            >
              <div
                onClick={() => setExpanded(prev => {
                  const n = new Set(prev);
                  n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                  return n;
                })}
                className="candidates-grid-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1.4fr 110px 1.4fr 270px',
                  alignItems: 'center',
                  padding: '16px 20px',
                  cursor: 'pointer'
                }}
              >
                {/* Column 1: Selection */}
                <div className="cand-col-select" style={{ paddingLeft: 19 }}>
                  <Button
                    size="middle"
                    type={isSel ? 'primary' : 'default'}
                    danger={isSel}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: isSel ? '0 4px 12px rgba(239, 68, 68, 0.2)' : 'none',
                      border: isSel ? 'none' : '2px solid #e2e8f0',
                      background: isSel ? undefined : '#fff'
                    }}
                    loading={toggleMutation.isPending && toggleMutation.variables?.home_course_id === c.home_course_id}
                    onClick={(e) => { e.stopPropagation(); toggleMutation.mutate(c); }}
                    disabled={!isSel && (isExplicitlyRejected || hasOtherRequest)}
                    icon={isSel ? <CloseOutlined /> : <PlusOutlined />}
                  />
                  <Text className="select-label-text" style={{
                    fontSize: 10,
                    color: isSel ? '#ef4444' : '#64748b',
                    fontWeight: 900,
                    marginTop: 6,
                    display: 'block',
                    textAlign: 'center',
                    width: 60,
                    marginLeft: -9,
                    letterSpacing: '0.02em'
                  }}>
                    {isSel ? t('applicationDetail.actions.remove') : t('applicationDetail.actions.select')}
                  </Text>
                </div>

                {/* Column 2: Home Course */}
                <div className="cand-col-home" style={{ paddingLeft: 0, paddingRight: 16 }}>
                  <Space direction="vertical" size={2}>
                    <Text strong style={{ fontSize: 13, color: '#000', letterSpacing: '-0.01em' }}>
                      {c.home_course_code || '—'}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.3, fontWeight: 600 }}>
                      {c.home_course_name}
                    </Text>
                    <Space size={4} style={{ marginTop: 4 }}>
                      <Tag style={{ fontSize: 9, margin: 0, borderRadius: 6, background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', fontWeight: 600 }}>{c.home_course_ects} {t('courseTable.columns.ects')}</Tag>
                      {c.home_course_category && (
                        <Tag style={{ fontSize: 9, margin: 0, borderRadius: 6, background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', fontWeight: 600 }}>
                          {(() => { const catKey = c.home_course_category.toLowerCase().replace(/\s+/g, '_'); const translated = t(`applicationDetail.labels.courseCategories.${catKey}`, { defaultValue: '' }); return translated || c.home_course_category.toUpperCase(); })()}
                        </Tag>
                      )}
                    </Space>
                  </Space>
                </div>

                {/* Column 3: Match */}
                <div className="cand-col-match" style={{ textAlign: 'center' }}>
                  <div style={{ 
                    width: 60, height: 60, borderRadius: '50%', border: `3px solid ${color}20`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto', background: `${color}05`
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: color, lineHeight: 1 }}>{pct}%</div>
                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800 }}>{t('applicationDetail.labels.rank')} #{c.rank}</div>
                  </div>
                </div>

                {/* Column 4: Host Course */}
                <div className="cand-col-host" style={{ paddingRight: 16 }}>
                  <Space direction="vertical" size={2}>
                    <Text strong style={{ fontSize: 13, color: '#000', letterSpacing: '-0.01em' }}>
                      {partnerCourse?.course_code || '—'}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.3, fontWeight: 600 }}>
                      {partnerCourse?.course_name}
                    </Text>
                    <Tag style={{ fontSize: 9, margin: 0, width: 'fit-content', marginTop: 4, borderRadius: 6, background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}>{partnerCourse?.ects} {t('courseTable.columns.ects')}</Tag>
                  </Space>
                </div>

                {/* Column 5: Status Badges & Triggers (2x2 Grid) */}
                <div className="cand-col-status" style={{
                  display: 'grid',
                  gridTemplateColumns: '125px 125px',
                  gap: '8px 12px',
                  width: 262,
                  paddingLeft: 4
                }}>
                  {/* Row 1: AI Status and Overlap Status */}
                  <div>
                    {isRejected || isExplicitlyRejected ? (
                      <Tooltip title={t('applicationDetail.tooltips.rejected')}>
                        <Tag color="error" style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}>{t('applicationDetail.labels.aiRejected')}</Tag>
                      </Tooltip>
                    ) : isRisk ? (
                      <Tooltip title={t('applicationDetail.tooltips.risk')}>
                        <Tag color="warning" style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}>{t('applicationDetail.labels.aiRisk')}</Tag>
                      </Tooltip>
                    ) : (
                      <Tooltip title={t('applicationDetail.tooltips.approved')}>
                        <Tag color="success" style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}>{t('applicationDetail.labels.aiApproved')}</Tag>
                      </Tooltip>
                    )}
                  </div>

                  <div>
                    {c.content_overlap_assessment ? (
                      <Tag color="processing" style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
                        {t(`applicationDetail.labels.coverage.${c.content_overlap_assessment.toLowerCase()}`) || c.content_overlap_assessment.toUpperCase()}
                      </Tag>
                    ) : <div style={{ height: 28 }} />}
                  </div>

                  {/* Row 2: Analysis Triggers */}
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(prev => {
                        const n = new Set(prev);
                        n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                        return n;
                      });
                    }}
                    style={{ 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
                      height: 28, borderRadius: 6, transition: 'all 0.2s',
                      background: isExp ? '#eff6ff' : '#f8fafc',
                      border: `1px solid ${isExp ? '#3b82f6' : '#e2e8f0'}`,
                      width: '100%'
                    }}
                    onMouseEnter={e => !isExp && (e.currentTarget.style.background = '#f1f5f9')}
                    onMouseLeave={e => !isExp && (e.currentTarget.style.background = '#f8fafc')}
                  >
                    <Text style={{ fontSize: 10, color: isExp ? '#2563eb' : '#64748b', fontWeight: 700 }}>
                      {isExp ? t('applicationDetail.actions.hideAnalysis') : t('applicationDetail.actions.matchAnalysis')}
                    </Text>
                    <DownOutlined style={{ fontSize: 9, color: isExp ? '#2563eb' : '#64748b', transform: isExp ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </div>

                  <div onClick={e => e.stopPropagation()}>
                    <CourseDetailsPanel
                      courseId={c.home_course_id}
                      label={t('applicationDetail.actions.homeDetails')}
                      icon={<HomeOutlined style={{ color: '#0ea5e9', fontSize: 11 }} />}
                    />
                  </div>
                </div>
              </div>

              {/* Expandable Details */}
              {isExp && (
                <div className="cand-expanded-details" style={{
                  padding: '20px 24px 24px 96px',
                  borderTop: '1px dashed #e2e8f0',
                  background: '#f8fafc'
                }}>
                  <Row gutter={[32, 24]}>
                    <Col span={10}>
                      {/* Verification Notes */}
                      {c.verification_reason && (
                        <div style={{ padding: '12px', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 24 }}>
                          <Text strong style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{t('applicationDetail.labels.aiAnalysisNote')}</Text>
                          <Text style={{ fontSize: 12, color: '#334155', fontStyle: 'italic' }}>"{c.verification_reason}"</Text>
                        </div>
                      )}

                      {/* Topics Analysis */}
                      <div style={{ marginBottom: 20 }}>
                        <Text strong style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('applicationDetail.labels.topicsAnalysis')}</Text>
                        
                        <div style={{ marginBottom: 12 }}>
                          <Text type="secondary" style={{ fontSize: 10, fontWeight: 700 }}>{t('applicationDetail.labels.coreHomeTopics')}</Text>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {c.core_home_topics?.map((t: string, i: number) => (
                              <Tag key={i} style={{ fontSize: 10, borderRadius: 4, whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{t}</Tag>
                            ))}
                          </div>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                          <Text style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>{t('applicationDetail.labels.syllabusMatches')}</Text>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {c.matched_topics?.map((t: string, i: number) => (
                              <Tag key={i} color="green" style={{ fontSize: 10, borderRadius: 4, whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{t}</Tag>
                            ))}
                          </div>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                          <Text style={{ fontSize: 10, fontWeight: 700, color: '#ef4444' }}>{t('applicationDetail.labels.missingFromHost')}</Text>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {c.missing_topics?.map((t: string, i: number) => (
                              <Tag key={i} color="red" style={{ fontSize: 10, borderRadius: 4, whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{t}</Tag>
                            ))}
                          </div>
                        </div>

                        {c.extra_partner_topics?.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <Text style={{ fontSize: 10, fontWeight: 700, color: '#06b6d4' }}>{t('applicationDetail.labels.enrichment')}</Text>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {c.extra_partner_topics.map((t: string, i: number) => (
                                <Tag key={i} color="cyan" style={{ fontSize: 10, borderRadius: 4, whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{t}</Tag>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Col>

                    <Col span={7}>
                      {/* Score Breakdown */}
                      <Text strong style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('applicationDetail.labels.scoreBreakdown')}</Text>
                      {c.score_breakdown && Object.entries(c.score_breakdown).map(([key, comp]: [string, any]) => {
                        const sPct = Math.round(comp.score * 100);
                        const sColor = sPct >= 70 ? '#22c55e' : sPct >= 40 ? '#f59e0b' : '#ef4444';
                        return (
                          <div key={key} style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <Text style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{t(`applicationDetail.labels.analysis.${key.toLowerCase()}`)}</Text>
                              <Text strong style={{ fontSize: 11, color: sColor }}>{sPct}%</Text>
                            </div>
                            <Progress percent={sPct} showInfo={false} strokeColor={sColor} strokeWidth={4} />
                            {comp.evidence && (
                              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2, lineHeight: 1.2 }}>{comp.evidence}</Text>
                            )}
                          </div>
                        );
                      })}
                    </Col>

                    <Col span={7}>
                      {/* Structural Checks & Details */}
                      <Text strong style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('applicationDetail.labels.structuralChecks')}</Text>
                      
                      <div style={{ marginBottom: 16 }}>
                        {c.structural_notes?.map((n: string, i: number) => (
                          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, background: '#f0fdf4', padding: '4px 8px', borderRadius: 4 }}>
                            <CheckCircleOutlined style={{ fontSize: 10, color: '#22c55e', marginTop: 3 }} />
                            <Text style={{ fontSize: 10, color: '#166534' }}>{n}</Text>
                          </div>
                        ))}
                        {c.warnings?.map((w: string, i: number) => (
                          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, background: '#fff7ed', padding: '4px 8px', borderRadius: 4 }}>
                            <WarningOutlined style={{ fontSize: 10, color: '#f59e0b', marginTop: 3 }} />
                            <Text style={{ fontSize: 10, color: '#9a3412' }}>{w}</Text>
                          </div>
                        ))}
                      </div>

                    </Col>
                  </Row>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StudentCourseSelectionPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedCourses, setExpandedCourses] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [candidateNameMap, setCandidateNameMap] = useState<Record<number, string>>({});
  const [overrideNotes, setOverrideNotes] = useState<Record<number, string>>({});

  const [suggestModal, setSuggestModal] = useState<{ partnerCourseId: number; existingIds: number[]; existingReason: string } | null>(null);
  const [laModalVisible, setLaModalVisible] = useState(false);
  const [reviewModal, setReviewModal] = useState<{
    partnerCourseId: number;
    hasRecommendedCandidates: boolean;
    initialNote: string;
    initialAlternativeIds: number[];
    initialAlternativeReason: string;
  } | null>(null);
  const handleNamesResolved = (names: Record<number, string>) =>
    setCandidateNameMap(prev => ({ ...prev, ...names }));

  const { data: app, isLoading: appLoading } = useQuery({
    queryKey: ['student-app', id],
    queryFn: () => getStudentApplication(Number(id)),
    enabled: !!id,
  });

  // Compute globally taken home IDs to prevent double matching
  const takenHomeIds = React.useMemo(() => {
    const taken = new Set<number>();
    const sels = app?.selections || [];
    sels.forEach((sel: any) => {
      if (sel.status !== 'not_selected') {
        if (sel.selected_home_course_id) taken.add(sel.selected_home_course_id);
        (sel.selected_home_course_ids || []).forEach((id: number) => taken.add(id));
      }
      (sel.alternative_home_course_ids || []).forEach((id: number) => taken.add(id));
      (sel.coordinator_override_courses || []).forEach((oc: any) => taken.add(oc.id));
    });
    return taken;
  }, [app]);



  // Pre-populate candidateNameMap from backend-resolved names (avoids "Course #X" fallback)
  React.useEffect(() => {
    if (!app?.selections) return;
    const merged: Record<number, string> = {};
    for (const sel of app?.selections || []) {
      if (sel.home_course_names) {
        Object.assign(merged, sel.home_course_names);
      }
    }
    if (Object.keys(merged).length > 0) {
      setCandidateNameMap(prev => ({ ...merged, ...prev }));
    }
  }, [app]);

  const { data: ects } = useQuery({
    queryKey: ['ects-summary', id],
    queryFn: () => getEctsSummary(Number(id)),
    enabled: !!id,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Flush any pending note before submitting
      if (noteDebounceRef.current) {
        clearTimeout(noteDebounceRef.current);
        noteDebounceRef.current = null;
      }
      if (appNote !== null && appNote !== (app?.student_notes || '')) {
        await updateApplicationNotes(Number(id), appNote);
      }
      return submitApplication(Number(id));
    },
    onSuccess: () => {
      message.success(t('applicationDetail.messages.submitted'));
      refresh();
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('applicationDetail.messages.submitFailed')),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeApplicationStudent(Number(id)),
    onSuccess: () => {
      message.success(t('applicationDetail.messages.finalized'));
      refresh();
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('applicationDetail.messages.finalizeFailed')),
  });


  const withdrawMutation = useMutation({
    mutationFn: () => withdrawApplication(Number(id)),
    onSuccess: () => {
      message.success(t('applicationDetail.messages.withdrawn'));
      refresh();
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('applicationDetail.messages.withdrawFailed')),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetApplication(Number(id)),
    onSuccess: () => {
      message.success(t('applicationDetail.messages.resetSuccess'));
      setCandidateNameMap({});
      refresh();
    },
    onError: () => message.error(t('applicationDetail.messages.resetFailed')),
  });

  const deselectMutation = useMutation({
    mutationFn: ({ partnerCourseId, homeCourseId }: { partnerCourseId: number; homeCourseId?: number }) =>
      deselectCourse(Number(id), partnerCourseId, homeCourseId),
    onSuccess: () => refresh(),
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to deselect'),
  });

  const selectMutation = useMutation({
    mutationFn: ({ partner_course_id, home_course_id }: { partner_course_id: number; home_course_id: number }) =>
      selectCourse(Number(id), { partner_course_id, home_course_id }),
    onSuccess: () => refresh(),
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to add course'),
  });

  const reviewRequestMutation = useMutation({
    mutationFn: ({ partnerCourseId, note }: { partnerCourseId: number; note?: string }) =>
      requestCoordinatorReview(Number(id), partnerCourseId, note),
    onSuccess: () => { message.success(t('applicationDetail.messages.requestSent')); refresh(); },
    onError: (err: any) => message.error(err.response?.data?.detail || t('applicationDetail.messages.requestFailed')),
  });

  const clearReviewMutation = useMutation({
    mutationFn: (partnerCourseId: number) => clearReviewRequest(Number(id), partnerCourseId),
    onSuccess: () => { message.success(t('applicationDetail.messages.matchDeselected')); refresh(); },
    onError: (err: any) => message.error(err.response?.data?.detail || t('applicationDetail.messages.updateFailed')),
  });

  const clearAlternativeMutation = useMutation({
    mutationFn: (partnerCourseId: number) => clearAlternativeSuggestion(Number(id), partnerCourseId),
    onSuccess: () => { message.success(t('applicationDetail.messages.matchDeselected')); refresh(); },
    onError: (err: any) => message.error(err.response?.data?.detail || t('applicationDetail.messages.updateFailed')),
  });



  const [appNote, setAppNote] = useState<string | null>(null);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNoteMutation = useMutation({
    mutationFn: (notes: string) => updateApplicationNotes(Number(id), notes),
    onError: () => message.error('Failed to save note'),
  });

  useEffect(() => {
    return () => {
      if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    };
  }, []);

  const handleNoteChange = (val: string) => {
    setAppNote(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      saveNoteMutation.mutate(val);
    }, 1000);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['student-app', id] });
    queryClient.invalidateQueries({ queryKey: ['ects-summary', id] });
    queryClient.invalidateQueries({ queryKey: ['candidates'] });
    queryClient.invalidateQueries({ queryKey: ['student-applications'] });
  };

  const getExportData = () => {
    return selections
      .filter((s: any) => s.status === 'approved')
      .map((s: any) => {
        const isOverridden = (s.coordinator_override_courses?.length || 0) > 0;
        const homeCourses = isOverridden 
          ? s.coordinator_override_courses 
          : (s.selected_home_courses || (s.selected_home_course ? [s.selected_home_course] : []));
        const homeCourseText = homeCourses?.map((hc: any) => `${hc.course_code || ''} ${hc.course_name}`).join(', ') || 'N/A';
        const homeEcts = homeCourses?.reduce((sum: number, hc: any) => sum + (hc.ects || 0), 0) || 0;
        
        return {
          partnerCode: s.partner_course?.course_code || '-',
          partnerName: s.partner_course?.course_name || 'Unknown',
          partnerEcts: s.partner_course?.ects || 0,
          homeCourseText,
          homeEcts,
        };
      });
  };

  const sanitizeForPDF = (str: string | number) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
      .replace(/ü/g, 'u').replace(/Ü/g, 'U')
      .replace(/ş/g, 's').replace(/Ş/g, 'S')
      .replace(/ı/g, 'i').replace(/İ/g, 'I')
      .replace(/ö/g, 'o').replace(/Ö/g, 'O')
      .replace(/ç/g, 'c').replace(/Ç/g, 'C');
  };

  const handleExportPDF = () => {
    const doc = new jsPDF('landscape');
    doc.setFontSize(16);
    doc.text(sanitizeForPDF(`Learning Agreement - ${app?.student?.name || 'Student'}`), 14, 15);
    doc.setFontSize(12);
    doc.text(sanitizeForPDF(`Partner University: ${app?.partner_university?.name || '-'}`), 14, 22);
    
    const tableData = getExportData().map((r: any) => [
      sanitizeForPDF(r.partnerCode), sanitizeForPDF(r.partnerName), sanitizeForPDF(r.partnerEcts),
      sanitizeForPDF(r.homeCourseText), sanitizeForPDF(r.homeEcts)
    ]);

    autoTable(doc, {
      startY: 30,
      head: [['Partner Code', 'Partner Course', 'Partner ECTS', 'Home Course(s)', 'Home ECTS']],
      body: tableData,
    });

    doc.save(`${app?.student?.eid || 'student'}_learning_agreement.pdf`);
  };

  const handleExportXLSX = async () => {
    const XLSX = await import('xlsx');
    const data = getExportData().map((r: any) => ({
      'Partner Code': r.partnerCode,
      'Partner Course': r.partnerName,
      'Partner ECTS': r.partnerEcts,
      'Home Course(s)': r.homeCourseText,
      'Home ECTS': r.homeEcts,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Learning Agreement");
    XLSX.writeFile(wb, `${app?.student?.eid || 'student'}_learning_agreement.xlsx`);
  };

  if (appLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#888' }}>{t('applicationDetail.messages.loading')}</div>
      </div>
    );
  }

  if (!app) return <Empty description={t('applicationDetail.emptyState')} />;

  // Sync local note state with server data on first load
  if (appNote === null && app.student_notes !== undefined) {
    setAppNote(app.student_notes || '');
  }

  const rawSelections = app.selections || [];
  const isSubmitted = ['submitted', 'learning_agreement_ready'].includes(app.status);

  // Smart sort: priority depends on app state
  // Smart sort: priority depends on app state, but always put actions (Overrides/Rejects) at top
  const selectionSortOrder = (s: any): number => {
    const isOverridden = (s.coordinator_override_courses?.length || 0) > 0;
    const hasAlternative = (s.alternative_home_course_ids?.length || 0) > 0;
    const wasApprovedRemoved = (s.was_approved || false) && s.status === 'not_selected' && !isOverridden;
    const isOverriddenRemoved = isOverridden && s.status === 'not_selected';
    const isRemoved = wasApprovedRemoved || isOverriddenRemoved;
    
    // Active / Decided (Top)
    if (isOverridden && !isOverriddenRemoved) return 0;
    if (s.status === 'rejected') return 1;
    if (s.status === 'approved') return 2;
    if (s.status === 'draft_selected') return 3;
    if (s.status === 'submitted_for_review') return 4;
    if (s.no_match_requested) return 5;
    if (hasAlternative) return 6;

    // Suggestions (AI REC)
    if (s.status === 'not_selected' && s.has_recommended_candidates && !isRemoved) return 7; 

    // Removed / Empty (Bottom)
    if (isRemoved) return 8; // "REMOVED" badge items go under "AI REC"
    return 9; // Completely empty/unselected ones
  };


  const filteredSelections = [...rawSelections].filter((s: any) => {
    const term = searchTerm.toLowerCase();
    const pc = s.partner_course || {};
    const hc = s.selected_home_course || {};
    const hcNames = Object.values(s.home_course_names || {}).join(' ').toLowerCase();
    
    return (
      pc.course_name?.toLowerCase().includes(term) ||
      pc.course_code?.toLowerCase().includes(term) ||
      hc.course_name?.toLowerCase().includes(term) ||
      hc.course_code?.toLowerCase().includes(term) ||
      hcNames.includes(term)
    );
  }).sort((a: any, b: any) => {
    const orderDiff = selectionSortOrder(a) - selectionSortOrder(b);
    if (orderDiff !== 0) return orderDiff;
    
    // Secondary sort: Rank #1 score (descending)
    const aScore = a.max_score || a.student_explanation_snapshot?.overall_score || 0;
    const bScore = b.max_score || b.student_explanation_snapshot?.overall_score || 0;
    return bScore - aScore;
  });

  const selections = filteredSelections;
  const coordinatorHasOpened = !!app?.coordinator_viewed_at;
  const isEditable = (
    ['draft', 'revision_requested', 'rejected'].includes(app?.status || '')
  ) && !submitMutation.isPending && !finalizeMutation.isPending;
  
  // True only when coordinator sent it back
  const isSentBack = (app?.status === 'revision_requested' || app?.status === 'rejected') && !!app?.submitted_at;
  const hasPendingOverrides = false; // Legacy state removed
  const canSubmit = (['draft', 'revision_requested', 'rejected'].includes(app?.status || '')) && !submitMutation.isPending && !finalizeMutation.isPending;

  const isLcReadyCondition =
    (app?.approved_partner_ects || 0) >= 28 &&
    selections.every((s: any) => ['approved', 'not_selected', 'rejected'].includes(s.status));

  const toggleCandidates = (selId: number) => {
    setExpandedCourses(prev => {
      const n = new Set(prev);
      n.has(selId) ? n.delete(selId) : n.add(selId);
      return n;
    });
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginBottom: 12 }}>
          {t('applicationDetail.back')}
        </Button>
        <div className="app-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Space size={8} align="center">
              <SwapOutlined style={{ color: '#1677ff', fontSize: 18 }} />
              <Title level={3} style={{ margin: 0 }}>{app.partner_university?.name || 'Unknown University'}</Title>
            </Space>
            <div style={{ marginTop: 4 }}>
              <ApplicationStatusBadge status={app.status} />
            </div>
          </div>
        </div>
        {isSentBack && (
          <Alert
            message={t('applicationDetail.revisionTitle')}
            description={t('applicationDetail.revisionDesc')}
            type="warning"
            showIcon
            style={{ marginTop: 12, borderRadius: 8 }}
          />
        )}
        {app.coordinator_notes && (
          <Alert message={t('applicationDetail.coordinatorNotes')} description={app.coordinator_notes} type="info" style={{ marginTop: 12, borderRadius: 8 }} showIcon />
        )}
      </div>

      {/* ECTS Summary */}
      {ects && (() => {
        const localSelections = app?.selections || [];
        
        // Match the LA Ready button logic exactly:
        // Approved = status is 'approved' OR has an override, BUT MUST NOT BE 'not_selected'
        const localApprovedEcts = localSelections
          .filter((s: any) => 
            s.status !== 'not_selected' && 
            (s.status === 'approved' || (s.coordinator_override_courses?.length || 0) > 0)
          )
          .reduce((sum: number, s: any) => sum + (s.partner_course?.ects || 0), 0);

        // Selected = Total ECTS the student is "requesting" (everything not removed/rejected)
        const localSelectedEcts = localSelections
          .filter((s: any) => 
            s.status !== 'rejected' &&
            (
              ['draft_selected', 'submitted_for_review', 'approved', 'manual_review_required', 'reviewed'].includes(s.status) ||
              (s.alternative_home_course_ids?.length || 0) > 0 ||
              s.no_match_requested
            )
          )
          .reduce((sum: number, s: any) => sum + (s.partner_course?.ects || 0), 0);

        const suggestedEcts = localSelections
          .filter((s: any) => 
            s.status !== 'rejected' &&
            ((s.alternative_home_course_ids?.length || 0) > 0 || s.no_match_requested) &&
            !((s.coordinator_override_courses?.length || 0) > 0)
          )
          .reduce((sum: number, s: any) => sum + (s.partner_course?.ects || 0), 0);
        
        const draftEcts = localSelections
          .filter((s: any) => 
            (s.status === 'draft_selected' || s.status === 'submitted_for_review') &&
            !((s.coordinator_override_courses?.length || 0) > 0) &&
            !((s.alternative_home_course_ids?.length || 0) > 0 || s.no_match_requested) &&
            s.status !== 'not_selected'
          )
          .reduce((sum: number, s: any) => sum + (s.partner_course?.ects || 0), 0);

        const hasSubmittedItems = localSelections.some(s =>
          s.status === 'submitted_for_review' &&
          !((s.coordinator_override_courses?.length || 0) > 0)
        );

        const hasReviewRequests = localSelections.some((s: any) => s.no_match_requested);

        // Dynamic Home ECTS calculation
        const localHomeActive = new Map<number, number>();
        const localHomeApproved = new Map<number, number>();

        localSelections.forEach((s: any) => {
          if (s.status === 'rejected' || s.status === 'not_selected' || s.no_match_requested) return;

          const hmap = new Map<number, number>();
          const hasOverride = (s.coordinator_override_courses?.length || 0) > 0;
          if (hasOverride) {
            s.coordinator_override_courses.forEach((c: any) => hmap.set(c.id, c.ects || 0));
          } else {
            if (s.selected_home_courses && s.selected_home_courses.length > 0) {
              s.selected_home_courses.forEach((c: any) => hmap.set(c.id, c.ects || 0));
            } else if (s.selected_home_course && s.selected_home_course_ids?.includes(s.selected_home_course.id)) {
              hmap.set(s.selected_home_course.id, s.selected_home_course.ects || 0);
            } else if (s.selected_home_course && (!s.selected_home_course_ids || s.selected_home_course_ids.length === 0)) {
               hmap.set(s.selected_home_course.id, s.selected_home_course.ects || 0);
            }
          }
          if (s.alternative_home_courses_detail) {
            s.alternative_home_courses_detail.forEach((c: any) => hmap.set(c.id, c.ects || 0));
          }

          const isActive = ['draft_selected', 'submitted_for_review', 'approved', 'manual_review_required', 'reviewed'].includes(s.status) || (s.alternative_home_course_ids?.length || 0) > 0 || hasOverride;
          if (isActive) hmap.forEach((ects, id) => localHomeActive.set(id, ects));

          const isApproved = ['approved'].includes(s.status) || hasOverride;
          if (isApproved) hmap.forEach((ects, id) => localHomeApproved.set(id, ects));
        });

        const homeSelectedEcts = Array.from(localHomeActive.values()).reduce((sum, ects) => sum + ects, 0);
        const homeApprovedEcts = Array.from(localHomeApproved.values()).reduce((sum, ects) => sum + ects, 0);

        return (
          <EctsProgressBar
            selected={localSelectedEcts}
            approved={localApprovedEcts}
            suggested={suggestedEcts}
            suggestedLabel="Suggested/Review Req"
            draft={draftEcts}
            draftLabel={hasSubmittedItems ? "Submitted" : "Draft"}
            homeSelected={homeSelectedEcts}
            homeApproved={homeApprovedEcts}
            homeTarget={30}
          />
        );
      })()}

      {/* Learning Agreement Readiness / Threshold Warning */}
      {(() => {
        const approvedEcts = ects?.approved_partner_ects || 0;
        const totalSelected = ects?.total_partner_ects || 0;
        const isReady = app?.status === 'learning_agreement_ready';
        const pendingCount = selections.filter(s =>
          ['submitted_for_review', 'rejected'].includes(s.status)
        ).length;

        if (isReady) {
          return (
            <Alert
              className="la-ready-alert"
              message={t('applicationDetail.learningAgreement')}
              description={t('applicationDetail.finalizeDesc')}
              type="success" showIcon icon={<CheckCircleOutlined />}
              style={{ marginBottom: 16, borderRadius: 8, border: '1px solid #b7eb8f' }}
              action={
                <Button 
                  type="primary"
                  size="middle"
                  icon={<FileTextOutlined />}
                  onClick={() => setLaModalVisible(true)}
                  style={{ 
                    backgroundColor: '#52c41a', 
                    borderColor: '#52c41a',
                    borderRadius: '8px',
                    fontWeight: 700,
                    padding: '0 40px',
                    height: '44px',
                    minWidth: '240px',
                    fontSize: '15px'
                  }}
                >
                  {t('applicationDetail.viewDetails')}
                </Button>
              }
            />
          );
        }

        return null;
      })()}


      {/* Course List */}
      <Card
        className="course-card-header"
        title={<Space><BookOutlined /><span>{t('applicationDetail.matchedCourses')} ({selections.length})</span></Space>}
        extra={
          <Input 
            placeholder={t('applicationDetail.searchPlaceholder')} 
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            allowClear
            style={{ width: 250 }}
          />
        }
        style={{ borderRadius: 10, border: '1px solid #e8e8e8' }}
        styles={{ header: { background: '#fafafa', borderRadius: '10px 10px 0 0' } }}
      >
        {selections.length > 0 ? (
          <Collapse
            accordion
            onChange={(keys) => {
              const activeKey = Array.isArray(keys) ? keys[0] : keys;
              if (activeKey) {
                setExpandedCourses(new Set([Number(activeKey)]));
              }
            }}
            items={selections.map((sel: any) => {
            const pc = sel.partner_course || {};
            const isOverridden = (sel.coordinator_override_courses?.length || 0) > 0;
            const wasApprovedRemoved = (sel.was_approved || false) && sel.status === 'not_selected' && !isOverridden;
            const hasSelection = ((sel.selected_home_course_ids?.length > 0 || !!sel.selected_home_course_id) || isOverridden) && sel.status !== 'not_selected';
            const hasAlternative = (sel.alternative_home_course_ids?.length || 0) > 0;
            
            // Fixed: Get the actual top recommendation even if selection changes
            const topRec = sel.top_candidate || sel.selected_home_course;
            const hc = hasSelection ? sel.selected_home_course : topRec;

            // Build badge list — can show multiple at once
            const statusBadges: { label: string; color: string }[] = [];
            const isLocked = isOverridden || sel.status === 'approved' || sel.status === 'rejected';

            if (isOverridden) {
              if (sel.status === 'not_selected') {
                statusBadges.push({ label: t('applicationDetail.labels.status.removed'), color: '#8c8c8c' });
              } else {
                statusBadges.push({ label: t('applicationDetail.labels.status.overridden'), color: '#52c41a' });
              }
            } else if (wasApprovedRemoved) {
              statusBadges.push({ label: t('applicationDetail.labels.status.removed'), color: '#8c8c8c' });
            } else if (['approved','rejected','submitted_for_review','manual_review_required','draft_selected'].includes(sel.status)) {
              const map: Record<string, { label: string; color: string }> = {
                approved:               { label: t('applicationDetail.labels.status.approved'),   color: '#52c41a' },
                rejected:               { label: t('applicationDetail.labels.status.rejected'),   color: '#ff4d4f' },
                submitted_for_review:   { label: t('applicationDetail.labels.status.submitted'),  color: '#fa8c16' },
                manual_review_required: { label: t('applicationDetail.labels.status.submitted'),  color: '#fa8c16' },
                draft_selected:         { label: t('applicationDetail.labels.status.draft'),      color: '#434343' },
              };
              statusBadges.push(map[sel.status]);
            } else {
              if (sel.no_match_requested) statusBadges.push({ label: t('applicationDetail.labels.status.reviewReq'), color: '#eb2f96' });
              if (hasAlternative)         statusBadges.push({ label: `${t('applicationDetail.labels.status.suggested')} ${sel.alternative_home_course_ids.length}`, color: '#13c2c2' });
              
              if (sel.has_recommended_candidates && !hasAlternative && !sel.no_match_requested) {
                statusBadges.push({ label: t('applicationDetail.labels.status.aiRec'), color: '#1677ff' });
              }
              
              if (!sel.no_match_requested && !hasAlternative && !sel.has_recommended_candidates) {
                statusBadges.push({ label: t('applicationDetail.labels.status.notSelected'), color: '#8c8c8c' });
              }
            }

            const candidatesOpen = expandedCourses.has(sel.id);

            return {
              key: sel.id,
              label: (
                <div className="collapse-header-content" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Space size={8} wrap>
                      <Text strong style={{ fontSize: 14 }}>{pc.course_code || '—'}</Text>
                      <Text style={{ fontSize: 13 }}>{pc.course_name}</Text>
                      {pc.ects && <Tag style={{ fontSize: 10 }}>{pc.ects} {t('applicationDetail.labels.creditUnit')}</Tag>}
                    </Space>
                  </div>
                  <div>
                    <Space size={6} wrap className="collapse-header-tags">
                      {/* Show selected/approved home courses in header */}
                      {(() => {
                        const verMap: Record<number, string | null> = sel.selected_home_course_verifications || {};
                        const verColor = (hcId: number) => {
                          const v = verMap[hcId];
                          if (v === 'approved') return 'green';
                          if (v === 'risk_flagged') return 'gold';
                          if (v === 'rejected') return 'red';
                          return 'blue'; // Draft or pending
                        };

                        // 1. Show coordinator override courses first (if any)
                        if (isOverridden) {
                          return sel.coordinator_override_courses.map((oc: any) => (
                            <Tag 
                              key={oc.id} 
                              color={hasSelection ? "green" : "default"} 
                              style={{ 
                                fontSize: 10,
                                textDecoration: !hasSelection ? 'line-through' : 'none',
                                opacity: !hasSelection ? 0.6 : 1
                              }}
                            >
                              {oc.course_code ? `${oc.course_code} — ${oc.course_name}` : oc.course_name}
                              {oc.ects ? ` — ${oc.ects} ${t('applicationDetail.labels.creditUnit')}` : ''}
                            </Tag>
                          ));
                        }

                        // 2. Show student selected home courses
                        if (sel.selected_home_course_ids?.length > 0) {
                          return sel.selected_home_course_ids.map((hcId: number) => (
                            <Tag key={hcId} color={sel.status === 'approved' ? 'green' : (isOverridden ? 'default' : verColor(hcId))} style={{ fontSize: 10 }}>
                              <span style={{ textDecoration: isOverridden ? 'line-through' : 'none' }}>
                                {(hc && hcId === sel.selected_home_course_id)
                                  ? `${hc.course_code} — ${hc.course_name}${hc.ects ? ` — ${hc.ects} ${t('applicationDetail.labels.creditUnit')}` : ''}`
                                  : (candidateNameMap[hcId] ?? sel.home_course_names?.[hcId] ?? `#${hcId}`)}
                              </span>
                            </Tag>
                          ));
                        }

                        // 3. Fallback hint — only show for courses with actual AI recommendations
                        if (hc && !hasSelection && !sel.no_match_requested && !hasAlternative && sel.has_recommended_candidates) {
                          return (
                            <Tag color={verColor(hc.id)} style={{ fontSize: 10 }}>
                              {hc.course_code} — {hc.course_name}{hc.ects ? ` — ${hc.ects} ${t('applicationDetail.labels.creditUnit')}` : ''}
                            </Tag>
                          );
                        }
                        return null;
                      })()}
                      {statusBadges.map((b, i) => (
                        <Tag 
                          key={i} 
                          color={b.color} 
                          style={{ 
                            fontSize: 10, 
                            fontWeight: 600,
                          }}
                        >
                          {b.label}
                        </Tag>
                      ))}
                      {/* Override / Approved row action: Remove / Add button inline */}
                      {(isOverridden || sel.status === 'approved' || wasApprovedRemoved) && isEditable && (
                        <Button
                          size="small"
                          danger={hasSelection}
                          style={hasSelection ? undefined : { borderColor: '#52c41a', color: '#52c41a' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasSelection) {
                              deselectMutation.mutate({ partnerCourseId: sel.partner_course_id });
                            } else {
                              // Restore: override → override course, approved → original selection
                              const restoreId = isOverridden
                                ? (sel.selected_home_course_id ?? sel.coordinator_override_courses?.[0]?.id)
                                : sel.selected_home_course_id;
                              if (restoreId) {
                                selectMutation.mutate({
                                  partner_course_id: sel.partner_course_id,
                                  home_course_id: restoreId,
                                });
                              }
                            }
                          }}
                        >
                          {hasSelection ? t('applicationDetail.actions.remove') : t('applicationDetail.labels.add')}
                        </Button>
                      )}
                    </Space>
                  </div>
                </div>
              ),
              children: (
                <div>
                  {/* Your Selections — show all selected candidates */}
                  {((sel.selected_home_course_ids?.length > 0 || !!sel.selected_home_course_id)) && sel.status !== 'not_selected' && (
                    <div style={{
                      padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                      background: '#f6ffed', border: '1px solid #b7eb8f',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <Text strong style={{ fontSize: 12 }}>
                            {t('applicationDetail.labels.yourSelections', { count: (sel.selected_home_course_ids?.length || (sel.selected_home_course_id ? 1 : 0)) })}
                          </Text>
                        </Space>
                      </div>
                      <div className="your-selection-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(sel.selected_home_course_ids?.length
                          ? sel.selected_home_course_ids
                          : sel.selected_home_course_id ? [sel.selected_home_course_id] : []
                        ).map((hcId: number) => (
                          <Tag
                            key={hcId}
                            color={isOverridden ? 'default' : (sel.status === 'approved' ? 'green' : 'blue')}
                            closable={isEditable && !isLocked}
                            onClose={(isEditable && !isLocked) ? (e) => {
                              e.preventDefault();
                              deselectMutation.mutate({ partnerCourseId: sel.partner_course_id, homeCourseId: hcId });
                            } : undefined}
                            style={{ fontSize: 11, opacity: isOverridden ? 0.7 : 1 }}
                          >
                            <span style={{ textDecoration: isOverridden ? 'line-through' : 'none', display: 'inline-flex', maxWidth: '100%' }}>
                              <Text ellipsis style={{ fontSize: 11, color: 'inherit', maxWidth: '100%' }}>
                                {(hcId === sel.selected_home_course_id && hc)
                                  ? `${hc.course_code} — ${hc.course_name}${hc.ects ? ` — ${hc.ects} ${t('applicationDetail.labels.creditUnit')}` : ''}`
                                  : (candidateNameMap[hcId] ?? sel.home_course_names?.[hcId] ?? `Course #${hcId}`)}
                              </Text>
                            </span>
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}


                  {/* Override Info Panel (Read-only since coordinator is final) */}
                  {isOverridden && (
                    <div style={{ 
                      marginBottom: 12, 
                      padding: '12px 16px', 
                      borderRadius: 12, 
                      border: '1.5px solid #52c41a', 
                      background: 'linear-gradient(135deg, #f6ffed 0%, #ffffff 100%)',
                      boxShadow: '0 2px 8px rgba(82, 196, 26, 0.08)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Space size={6}>
                          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                          <Text strong style={{ color: '#52c41a', fontSize: 14 }}>
                            {t('applicationDetail.labels.decisionFinal')}
                          </Text>
                        </Space>
                        <Tag color="green" style={{ borderRadius: 10, fontWeight: 600 }}>{t('applicationDetail.labels.status.approved')}</Tag>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,0.8)', padding: '10px', borderRadius: 10, border: '1px solid rgba(82, 196, 26, 0.2)', marginBottom: 8 }}>
                        {sel.coordinator_override_courses?.map((oc: any) => (
                          <div key={oc.id} style={{ marginBottom: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <Text strong style={{ fontSize: 12 }}>{oc.course_code ? `${oc.course_code} — ` : ''}{oc.course_name}</Text>
                              <Tag color="blue" style={{ fontSize: 9, borderRadius: 6 }}>{oc.ects} {t('applicationDetail.labels.creditUnit')}</Tag>
                            </div>
                          </div>
                        ))}
                      </div>

                      {sel.coordinator_note ? (
                        <div style={{ padding: '10px 12px', background: 'rgba(255, 255, 255, 0.7)', borderRadius: 10, border: '1px solid rgba(82, 196, 26, 0.3)', marginTop: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: 600, color: '#237804', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{t('applicationDetail.labels.coordinatorNote')}</Text>
                          <Text style={{ fontSize: 12, color: '#434343', fontStyle: 'italic' }}>"{sel.coordinator_note}"</Text>
                        </div>
                      ) : (
                        <div style={{ padding: '10px 12px', background: 'rgba(255, 255, 255, 0.3)', borderRadius: 10, marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>{t('applicationDetail.labels.decisionApproved')}</Text>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Rejection Info Panel */}
                  {sel.status === 'rejected' && (
                    <div style={{ 
                      marginBottom: 12, 
                      padding: '12px 16px', 
                      borderRadius: 12, 
                      border: '1.5px solid #ff4d4f', 
                      background: 'linear-gradient(135deg, #fff2f0 0%, #ffffff 100%)',
                      boxShadow: '0 2px 8px rgba(255, 77, 79, 0.08)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Space size={6}>
                          <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 16 }} />
                          <Text strong style={{ color: '#cf1322', fontSize: 14 }}>
                            {t('applicationDetail.labels.notApproved')}
                          </Text>
                        </Space>
                        <Tag color="red" style={{ borderRadius: 10, fontWeight: 600 }}>{t('applicationDetail.labels.status.rejected')}</Tag>
                      </div>

                      <div style={{ marginBottom: 10 }}>
                        <Text style={{ fontSize: 12, color: '#555', lineHeight: 1.5, display: 'block' }}>
                          {t('applicationDetail.labels.notApprovedDesc')}
                        </Text>
                      </div>

                      {sel.coordinator_note ? (
                        <div style={{ padding: '8px 10px', background: 'rgba(255, 255, 255, 0.8)', borderRadius: 10, border: '1px solid #ffa39e' }}>
                          <Text style={{ fontSize: 11, fontWeight: 600, color: '#cf1322', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{t('applicationDetail.labels.reasonNote')}</Text>
                          <Text style={{ fontSize: 12, color: '#333', fontStyle: 'italic' }}>"{sel.coordinator_note}"</Text>
                        </div>
                      ) : (
                        <div style={{ padding: '10px 12px', background: 'rgba(255, 255, 255, 0.3)', borderRadius: 10, marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>{t('applicationDetail.labels.notApprovedShort')}</Text>
                        </div>
                      )}
                    </div>
                  )}


                  {/* No-candidate flow: combined review + alternative */}
                  {!(sel.has_recommended_candidates ?? true) && (sel.no_match_requested || (sel.alternative_home_course_ids?.length || 0) > 0) && (
                    <Card className="alt-suggest-card" size="small" style={{ marginBottom: 10, borderRadius: 8, border: '1px solid #f0f0f0' }} styles={{ body: { padding: 0 } }}>
                      {sel.no_match_requested && (
                        <div style={{ padding: '10px 12px', borderBottom: (sel.alternative_home_course_ids?.length || 0) > 0 ? '1px solid #f0f0f0' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <Space size={6} align="start">
                              <ExclamationCircleOutlined style={{ color: '#cf1322', marginTop: 2 }} />
                              <div>
                                <Text strong style={{ fontSize: 12, color: '#cf1322', display: 'block' }}>{t('applicationDetail.labels.reviewRequested')}</Text>
                              {sel.student_notes && (
                                <Text style={{ fontSize: 12, color: '#555' }}>"{sel.student_notes}"</Text>
                              )}
                            </div>
                          </Space>
                          {(isEditable && !isLocked) && (
                            <Button size="small" type="text" danger style={{ fontSize: 11, flexShrink: 0 }}
                              loading={clearReviewMutation.isPending || clearAlternativeMutation.isPending}
                              onClick={async () => {
                                await clearReviewMutation.mutateAsync(sel.partner_course_id);
                                if ((sel.alternative_home_course_ids?.length || 0) > 0) {
                                  await clearAlternativeMutation.mutateAsync(sel.partner_course_id);
                                }
                              }}>
                              {t('applicationDetail.actions.remove')}
                            </Button>
                          )}
                          </div>
                        </div>
                      )}
                      {(sel.alternative_home_course_ids?.length || 0) > 0 && (
                        <div style={{ padding: '8px 12px', background: '#fffbf0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <Space size={6} style={{ marginBottom: 6 }}>
                                <BulbOutlined style={{ color: '#d48806' }} />
                                <Text strong style={{ fontSize: 12, color: '#d48806' }}>
                                  {t('applicationDetail.modals.suggestAlt.title')} ({sel.alternative_home_course_ids.length})
                                </Text>
                              </Space>
                              <div className="your-selection-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {sel.alternative_home_course_ids.map((hcId: number) => (
                                  <Tag key={hcId} style={{ fontSize: 11, maxWidth: '100%', display: 'inline-flex' }}>
                                    <Text ellipsis style={{ fontSize: 11, color: 'inherit', maxWidth: '100%' }}>
                                      {candidateNameMap[hcId] ?? sel.home_course_names?.[hcId] ?? `#${hcId}`}
                                    </Text>
                                  </Tag>
                                ))}
                              </div>
                              {sel.alternative_reason && (
                                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>"{sel.alternative_reason}"</Text>
                              )}
                            </div>
                            {(isEditable && !isLocked && !sel.no_match_requested) && (
                              <Button size="small" type="text" danger style={{ fontSize: 11, flexShrink: 0 }}
                                loading={clearAlternativeMutation.isPending || clearReviewMutation.isPending}
                                onClick={async () => {
                                  await clearAlternativeMutation.mutateAsync(sel.partner_course_id);
                                  if (sel.no_match_requested) {
                                    await clearReviewMutation.mutateAsync(sel.partner_course_id);
                                  }
                                }}>
                                {t('applicationDetail.actions.remove')}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </Card>
                  )}

                  {/* Has-candidate flow: review box */}
                  {(sel.has_recommended_candidates ?? true) && sel.no_match_requested && (
                    <Card size="small" style={{ marginBottom: 10, borderRadius: 8, border: '1px solid #ffa39e', background: '#fff1f0' }} styles={{ body: { padding: '10px 12px' } }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Space size={6} align="start">
                          <ExclamationCircleOutlined style={{ color: '#cf1322', marginTop: 2 }} />
                          <div>
                            <Text strong style={{ fontSize: 12, color: '#cf1322', display: 'block' }}>{t('applicationDetail.labels.pendingReview')}</Text>
                            {sel.student_notes && (
                              <Text style={{ fontSize: 12, color: '#555' }}>"{sel.student_notes}"</Text>
                            )}
                          </div>
                        </Space>
                        {(isEditable && !isLocked) && (
                          <Button size="small" type="text" danger style={{ fontSize: 11, flexShrink: 0 }}
                            loading={clearReviewMutation.isPending || clearAlternativeMutation.isPending}
                            onClick={async () => {
                              await clearReviewMutation.mutateAsync(sel.partner_course_id);
                              if ((sel.alternative_home_course_ids?.length || 0) > 0) {
                                await clearAlternativeMutation.mutateAsync(sel.partner_course_id);
                              }
                            }}>
                            {t('applicationDetail.actions.remove')}
                          </Button>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* Has-candidate flow: alternative suggestion box */}
                  {(sel.has_recommended_candidates ?? true) && (sel.alternative_home_course_ids?.length || 0) > 0 && (
                    <Card className="alt-suggest-card" size="small" style={{ marginBottom: 10, borderRadius: 8, border: '1px solid #ffe58f', background: '#fffbf0' }} styles={{ body: { padding: '10px 12px' } }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <Space size={6} style={{ marginBottom: 6 }}>
                            <BulbOutlined style={{ color: '#d48806' }} />
                            <Text strong style={{ fontSize: 12, color: '#d48806' }}>
                              {t('applicationDetail.modals.suggestAlt.title')} ({sel.alternative_home_course_ids.length})
                            </Text>
                          </Space>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {sel.alternative_home_course_ids.map((hcId: number) => (
                              <Tag key={hcId} style={{ fontSize: 11 }}>{sel.home_course_names?.[hcId] ?? candidateNameMap[hcId] ?? `#${hcId}`}</Tag>
                            ))}
                          </div>
                          {sel.alternative_reason && (
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>"{sel.alternative_reason}"</Text>
                          )}
                        </div>
                        {(isEditable && !isLocked) && (
                          <Button size="small" type="text" danger style={{ fontSize: 11, flexShrink: 0 }}
                            loading={clearAlternativeMutation.isPending || clearReviewMutation.isPending}
                            onClick={async () => {
                              await clearAlternativeMutation.mutateAsync(sel.partner_course_id);
                              if (sel.no_match_requested) {
                                await clearReviewMutation.mutateAsync(sel.partner_course_id);
                              }
                            }}>
                            {t('applicationDetail.actions.remove')}
                          </Button>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* Actions & Details Row */}
                  <div className="course-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Space size={8}>
                      {isEditable && !isLocked && (
                        <>
                          <Button type="primary" onClick={() => toggleCandidates(sel.id)} danger={candidatesOpen}>
                            {candidatesOpen ? t('applicationDetail.actions.hideAnalysis') : t('applicationDetail.sections.match')}
                            {candidatesOpen ? <UpOutlined /> : <DownOutlined />}
                          </Button>
                          {!hasSelection && (
                            <Tooltip title={
                              hasSelection ? t('applicationDetail.tooltips.deselectFirst') : 
                              (sel.alternative_home_course_ids?.length || 0) > 0 ? t('applicationDetail.tooltips.removeAltFirst') : ""
                            }>
                              <Button
                                icon={<ExclamationCircleOutlined />}
                                disabled={hasSelection || (sel.alternative_home_course_ids?.length || 0) > 0}
                                onClick={() => setReviewModal({
                                  partnerCourseId: sel.partner_course_id,
                                  hasRecommendedCandidates: sel.has_recommended_candidates ?? true,
                                  initialNote: sel.student_notes || '',
                                  initialAlternativeIds: sel.alternative_home_course_ids || [],
                                  initialAlternativeReason: sel.alternative_reason || '',
                                })}
                                style={sel.no_match_requested
                                  ? { borderColor: '#eb2f96', color: '#eb2f96', background: '#fff0f6' }
                                  : { color: '#666' }}
                                onMouseEnter={e => {
                                  if (sel.no_match_requested) {
                                    e.currentTarget.style.background = '#ffd6e7';
                                  } else if (!hasSelection) {
                                    e.currentTarget.style.borderColor = '#4096ff';
                                    e.currentTarget.style.color = '#4096ff';
                                  }
                                }}
                                onMouseLeave={e => {
                                  if (sel.no_match_requested) {
                                    e.currentTarget.style.background = '#fff0f6';
                                  } else {
                                    e.currentTarget.style.borderColor = '#d9d9d9';
                                    e.currentTarget.style.color = '#666';
                                  }
                                }}
                              >
                                {t('applicationDetail.actions.askReview')}
                                {sel.no_match_requested && (
                                  <Tag color="pink" style={{ marginLeft: 4, fontSize: 10 }}>1</Tag>
                                )}
                              </Button>
                            </Tooltip>
                          )}
                          <Tooltip title={
                            hasSelection ? t('applicationDetail.tooltips.deselectFirst') : 
                            sel.no_match_requested ? t('applicationDetail.tooltips.removeReviewFirst') : ""
                          }>
                            <Button
                              icon={<BulbOutlined />}
                              disabled={hasSelection || sel.no_match_requested}
                              onClick={() => setSuggestModal({
                                partnerCourseId: sel.partner_course_id,
                                existingIds: sel.alternative_home_course_ids || [],
                                existingReason: sel.alternative_reason || '',
                              })}
                              style={{ 
                                borderColor: '#fa8c16', 
                                color: '#fa8c16',
                                background: (sel.alternative_home_course_ids?.length > 0) ? '#fff7e6' : 'transparent'
                              }}
                              onMouseEnter={e => {
                                if (!hasSelection && !sel.no_match_requested) {
                                  e.currentTarget.style.background = '#fff7e6';
                                  e.currentTarget.style.borderColor = '#ffa940';
                                }
                              }}
                              onMouseLeave={e => {
                                if (!hasSelection && !sel.no_match_requested) {
                                  e.currentTarget.style.background = (sel.alternative_home_course_ids?.length > 0) ? '#fff7e6' : 'transparent';
                                  e.currentTarget.style.borderColor = '#fa8c16';
                                }
                              }}
                            >
                              {t('applicationDetail.actions.suggestAltAction')}
                              {sel.alternative_home_course_ids?.length > 0 && (
                                <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>
                                  {sel.alternative_home_course_ids.length}
                                </Tag>
                              )}
                            </Button>
                          </Tooltip>
                        </>
                      )}
                    </Space>

                    {/* Details always on the right */}
                    <CourseDetailsPanel
                      courseId={sel.partner_course_id}
                      label={t('applicationDetail.actions.partnerDetails')}
                      icon={<BookOutlined style={{ color: '#fa8c16' }} />}
                      columns={2}
                      variant="button"
                    />
                  </div>

                  {/* Inline Candidates Grid */}
                  {candidatesOpen && (
                    <InlineCandidates
                      appId={Number(id)}
                      partnerCourse={sel.partner_course || pc}
                      selectedHomeIds={sel.selected_home_course_ids || (sel.selected_home_course_id ? [sel.selected_home_course_id] : [])}
                      isEditable={isEditable}
                      onRefresh={refresh}
                      onNamesResolved={handleNamesResolved}
                      takenHomeIds={takenHomeIds}
                      rejectedHomeIds={sel.rejected_home_course_ids || []}
                      hasOtherRequest={sel.no_match_requested || (sel.alternative_home_course_ids?.length || 0) > 0}
                    />
                  )}
                </div>
              ),
            };
          })}
        />
        ) : (
          <Empty 
            description={searchTerm ? t('applicationDetail.noCoursesFound') : t('applicationDetail.emptyState')} 
            style={{ margin: '40px 0' }} 
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>

      {/* Student General Note */}
      <Card
        size="small"
        style={{ marginTop: 12, borderRadius: 10, border: '1px solid #e8e8e8' }}
        title={
          <Space size={6}>
            <FileTextOutlined />
            <span style={{ fontSize: 13 }}>{t('applicationDetail.yourNotes')}</span>
            {saveNoteMutation.isPending && (
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>{t('applicationDetail.labels.saving')}</Text>
            )}
            {!saveNoteMutation.isPending && appNote === (app.student_notes || '') && appNote !== '' && (
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>{t('applicationDetail.labels.saved')}</Text>
            )}
          </Space>
        }
      >
        <Input.TextArea
          rows={3}
          placeholder={t('applicationDetail.notesPlaceholder')}
          value={appNote ?? ''}
          onChange={e => handleNoteChange(e.target.value)}
          disabled={!canSubmit}
          style={{ borderRadius: 6 }}
        />
      </Card>

      {/* Footer Actions */}
      {canSubmit && (
        <Card className="footer-card" size="small" style={{ marginTop: 16, borderRadius: 10, border: '1px solid #e8e8e8' }}>
          <Row className="footer-actions-row" justify="space-between" align="middle">
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {isLcReadyCondition 
                  ? t('applicationDetail.labels.allApproved')
                  : t('applicationDetail.labels.adjustSelections')}
              </Text>
            </Col>
            <Col>
              <Space>
                {!isSentBack && (
                  <Button
                    icon={<ClearOutlined />}
                    danger
                    disabled={!selections.some((s: any) => s.selected_home_course_ids?.length || s.selected_home_course_id)}
                    loading={resetMutation.isPending}
                    onClick={() => Modal.confirm({
                      title: t('applicationDetail.resetConfirm'),
                      content: t('applicationDetail.resetDesc'),
                      okText: t('applicationDetail.reset'),
                      okButtonProps: { danger: true },
                      onOk: () => resetMutation.mutate(),
                    })}
                  >
                    {t('applicationDetail.reset')}
                  </Button>
                )}

                <Button type="primary" icon={<SendOutlined />}
                  onClick={() => {
                    const activeStatuses = ['draft_selected', 'submitted_for_review', 'approved', 'manual_review_required', 'reviewed'];
                    const selectedEcts = selections
                      .filter((s: any) => 
                        s.status !== 'rejected' &&
                        (activeStatuses.includes(s.status) || (s.alternative_home_course_ids?.length || 0) > 0 || s.no_match_requested)
                      )
                      .reduce((sum: number, s: any) => sum + (s.partner_course?.ects || 0), 0);
                    if (selectedEcts < 28) {
                      message.warning(t('applicationDetail.messages.minPartnerEcts', { current: selectedEcts }));
                      return;
                    }
                    const hasReviewRequests = selections.some((s: any) => s.no_match_requested);
                    const homeEctsForSubmit = (app as any)?.total_home_ects ?? 0;
                    if (!hasReviewRequests && homeEctsForSubmit < 30) {
                      message.warning(t('applicationDetail.messages.minHomeEcts', { current: homeEctsForSubmit }));
                      return;
                    }
                    Modal.confirm({
                      title: t('applicationDetail.modals.submit.title'),
                      content: (
                        <div>
                          <p>{t('applicationDetail.modals.submit.content', { partnerEcts: selectedEcts, homeEcts: homeEctsForSubmit })}</p>
                          <p style={{ color: '#ff4d4f', fontWeight: 600 }}>
                            {t('applicationDetail.modals.submit.warning')}
                          </p>
                        </div>
                      ),
                      okText: t('applicationDetail.modals.submit.ok'),
                      onOk: () => submitMutation.mutate(),
                      okButtonProps: { type: 'primary' }
                    });
                  }}
                  loading={submitMutation.isPending}>
                  {t('applicationDetail.modals.submit.ok')}
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {isSubmitted && app?.status !== 'learning_agreement_ready' && (
        <Card size="small" style={{ marginTop: 16, borderRadius: 8, background: '#f5f5f5', border: '1px solid #d9d9d9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 32, height: 32, borderRadius: '50%', background: '#1677ff', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <SyncOutlined spin style={{ color: '#fff' }} />
            </div>
            <div>
              <Text strong>{t('applicationDetail.labels.underReview')}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('applicationDetail.labels.underReviewDesc')}
              </Text>
            </div>
          </div>
        </Card>
      )}

      {/* Ask Coordinator to Review Modal */}
      {reviewModal && (
        <CoordinatorReviewRequestModal
          open={!!reviewModal}
          appId={Number(id)}
          partnerCourseId={reviewModal.partnerCourseId}
          hasRecommendedCandidates={reviewModal.hasRecommendedCandidates}
          initialNote={reviewModal.initialNote}
          initialAlternativeIds={reviewModal.initialAlternativeIds}
          initialAlternativeReason={reviewModal.initialAlternativeReason}
          onClose={() => setReviewModal(null)}
          onSaved={refresh}
          reviewRequestMutation={reviewRequestMutation}
          takenHomeIds={takenHomeIds}
        />
      )}

      {/* Alternative Suggestion Modal */}
      {suggestModal && (
        <AlternativeSuggestModal
          open={!!suggestModal}
          appId={Number(id)}
          partnerCourseId={suggestModal.partnerCourseId}
          existingIds={suggestModal.existingIds}
          existingReason={suggestModal.existingReason}
          onClose={() => setSuggestModal(null)}
          onSaved={refresh}
          takenHomeIds={takenHomeIds}
        />
      )}
      <Modal
        title={t('coordinatorReview.laModal.title')}
        className="la-overview-modal"
        open={laModalVisible}
        onCancel={() => setLaModalVisible(false)}
        footer={[
          <Button key="pdf" icon={<FilePdfOutlined />} onClick={handleExportPDF}>
            {t('coordinatorReview.laModal.exportPdf')}
          </Button>,
          <Button key="xlsx" icon={<FileExcelOutlined />} onClick={handleExportXLSX}>
            {t('coordinatorReview.laModal.exportExcel')}
          </Button>,
          <Button key="close" type="primary" onClick={() => setLaModalVisible(false)}>
            {t('coordinatorReview.laModal.close')}
          </Button>
        ]}
        width={800}
      >
        <Table
          dataSource={selections.filter((s: any) => s.status === 'approved')}
          rowKey="id"
          pagination={false}
          columns={[
            {
              title: t('coordinatorReview.laModal.partnerCol'),
              key: 'partner',
              render: (_row: any, record: any) => (
                <div style={{ padding: '8px 0' }}>
                  <Text strong>{record.partner_course?.course_code || '—'}</Text>
                  <br />
                  <Text>{record.partner_course?.course_name}</Text>
                  <br />
                  <Tag color="blue" style={{ marginTop: 4 }}>{record.partner_course?.ects} ECTS</Tag>
                </div>
              ),
            },
            {
              title: t('coordinatorReview.laModal.homeCol'),
              key: 'home',
              render: (_row: any, record: any) => {
                const isOverridden = (record.coordinator_override_courses?.length || 0) > 0;
                const homeCourses = isOverridden 
                  ? record.coordinator_override_courses 
                  : (record.selected_home_courses || (record.selected_home_course ? [record.selected_home_course] : []));
                
                if (!homeCourses || homeCourses.length === 0) return <Text type="secondary">{t('applicationDetail.labels.noMatchCandidates')}</Text>;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {homeCourses.map((hc: any) => (
                      <div key={hc.id} style={{ padding: '8px', background: '#f5f5f5', borderRadius: 6 }}>
                        <Text strong>{hc.course_code || '—'}</Text>
                        <br />
                        <Text>{hc.course_name}</Text>
                        <br />
                        <Tag color="green" style={{ marginTop: 4 }}>{hc.ects} ECTS</Tag>
                      </div>
                    ))}
                  </div>
                );
              },
            },
          ]}
        />
      </Modal>

    </div>
  );
}
