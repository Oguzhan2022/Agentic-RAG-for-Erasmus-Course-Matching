import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Select, Button, Row, Col, Tag, Progress,
  Typography, Space, Tooltip, Divider,
  Modal, message, Tabs, Table,
} from 'antd';
import {
  SwapOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  EyeOutlined,
  RocketOutlined,
  InfoCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import {
  getUniversities,
  createMatchJob, getMatchJobs, pauseMatchJob, pauseAllMatchJobs,
  resumeMatchJob, resumeAllMatchJobs, cancelMatchJob, deleteMatchJob,
} from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { MATCH_STATUS_CONFIG } from '../constants/status';
import type { MatchJob } from '../types';

const { Title, Text } = Typography;

// ── Status Config ──────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['queued', 'matching', 'paused', 'verifying'];

// ── Job Status Tag ─────────────────────────────────────────────────────────

function JobStatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  const cfg = (MATCH_STATUS_CONFIG as any)[status] || { color: '#999', icon: null, label: status };
  return (
    <Tag icon={cfg.icon} color={cfg.color} style={{ fontSize: 11, fontWeight: 600 }}>
      {t(`status.${status}`).toUpperCase()}
    </Tag>
  );
}

// ── Match Job Card ─────────────────────────────────────────────────────────

function MatchJobCard({
  job,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onViewResults,
}: {
  job: MatchJob;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onViewResults: () => void;
}) {
  const { t } = useTranslation();
  const isRunning = job.status === 'matching' || job.status === 'verifying';
  const isPaused = job.status === 'paused';
  const isQueued = job.status === 'queued';
  const canPause = isRunning || isQueued;
  const isDone = job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed';
  const hasResults = job.processed_courses > 0 || isRunning || isPaused;

  return (
    <Card
      size="small"
      style={{
        borderRadius: 10,
        border: isRunning ? '1px solid #fa8c16' : '1px solid #e8e8e8',
      }}
      styles={{ body: { padding: '16px 20px' } }}
    >
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <JobStatusTag status={job.status} />
            <Text strong style={{ fontSize: 14 }}>
              {job.partner_university_name || `${t('matching.partnerUni')} #${job.partner_university_id}`}
            </Text>
            <SwapOutlined style={{ color: '#bbb' }} />
            <Text style={{ fontSize: 13, color: '#666' }}>
              {job.home_university_name || `${t('matching.homeUni')} #${job.home_university_id}`}
            </Text>
          </div>

          {/* Progress bar */}
          {(() => {
            const isCompleted = job.status === 'completed';
            const displayPercent = isCompleted ? 100 : job.progress_percent;
            const displayCount = isCompleted ? job.total_courses : job.processed_courses;
            return (
              <Progress
                percent={displayPercent}
                size="small"
                strokeColor={isCompleted ? '#52c41a' : undefined}
                status={isRunning ? 'active' : isDone && !isCompleted ? 'exception' : undefined}
                format={() => `${displayCount}/${job.total_courses}`}
                style={{ marginBottom: 4, maxWidth: 400 }}
              />
            );
          })()}

          {/* Current course / info line */}
          <div style={{ fontSize: 11, color: '#999' }}>
            {job.status === 'matching' && job.current_course && (
              <span>{t('matching.matchingWith')} <Text style={{ fontSize: 11 }}>{job.current_course}</Text></span>
            )}
            {job.status === 'verifying' && (
              <span><Text style={{ fontSize: 11, color: '#13c2c2' }}>{t('matching.llmVerification')}</Text></span>
            )}
            {job.failed_courses > 0 && (
              <Tag color="red" style={{ fontSize: 10, marginLeft: 8 }}>
                {t('matching.failedCount', { count: job.failed_courses })}
              </Tag>
            )}
            {job.created_at && (
              <span style={{ marginLeft: 8 }}>
                {t('matching.created')} {new Date(job.created_at).toLocaleString()}
              </span>
            )}
          </div>
        </Col>

        {/* Actions */}
        <Col>
          <Space size={4}>
            {canPause && (
              <Tooltip title={t('matching.actions.pause')}>
                <Button
                  type="text"
                  icon={<PauseCircleOutlined />}
                  onClick={onPause}
                  style={{ color: '#595959' }}
                />
              </Tooltip>
            )}
            {isPaused && (
              <Tooltip title={t('matching.actions.resume')}>
                <Button
                  type="text"
                  icon={<PlayCircleOutlined />}
                  onClick={onResume}
                  style={{ color: '#52c41a' }}
                />
              </Tooltip>
            )}
            {!isDone && (
              <Tooltip title={t('matching.actions.cancel')}>
                <Button
                  type="text"
                  icon={<CloseCircleOutlined />}
                  onClick={onCancel}
                  danger
                />
              </Tooltip>
            )}
            {hasResults && (
              <Tooltip title={t('matching.actions.viewResults')}>
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  onClick={onViewResults}
                  style={{ color: '#1677ff' }}
                />
              </Tooltip>
            )}
            {isDone && (
              <Tooltip title={t('matching.actions.delete')}>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={onDelete}
                  danger
                />
              </Tooltip>
            )}
          </Space>
        </Col>
      </Row>
    </Card>
  );
}

// ── Algorithm Info Modal (V2) ────────────────────────────────────────────────

const weightRows = [
  { component: 'Content (LLM)', technical: '42%', social: '37%', studio: '40%' },
  { component: 'Learning Outcomes (LLM)', technical: '25%', social: '28%', studio: '22%' },
  { component: 'Domain (LLM)', technical: '15%', social: '20%', studio: '15%' },
  { component: 'ECTS (Deterministic)', technical: '7%', social: '7%', studio: '5%' },
  { component: 'Metadata (Deterministic)', technical: '6%', social: '3%', studio: '13%' },
  { component: 'Title (Deterministic)', technical: '5%', social: '5%', studio: '5%' },
];

export function AlgorithmInfoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const weightRows = [
    { component: t('matching.modals.info.engine.item2'), technical: '42%', social: '37%', studio: '40%' },
    { component: t('matching.modals.info.engine.table.outcomes'), technical: '25%', social: '28%', studio: '22%' },
    { component: t('matching.modals.info.engine.table.domain'), technical: '15%', social: '20%', studio: '15%' },
    { component: t('matching.modals.info.engine.table.ects'), technical: '7%', social: '7%', studio: '5%' },
    { component: t('matching.modals.info.engine.table.metadata'), technical: '6%', social: '3%', studio: '13%' },
    { component: t('matching.modals.info.engine.table.title'), technical: '5%', social: '5%', studio: '5%' },
  ];
  return (
    <Modal
      title={t('matching.modals.info.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '16px 24px' } }}
    >
      <Tabs
        size="small"
        items={[
          {
            key: 'pipeline',
            label: t('matching.modals.info.tabs.pipeline'),
            children: (
              <div>
                {[
                  { step: '1', title: t('matching.modals.info.pipeline.step1.title'), desc: t('matching.modals.info.pipeline.step1.desc'), color: '#1677ff' },
                  { step: '2', title: t('matching.modals.info.pipeline.step2.title'), desc: t('matching.modals.info.pipeline.step2.desc'), color: '#52c41a' },
                  { step: '3', title: t('matching.modals.info.pipeline.step3.title'), desc: t('matching.modals.info.pipeline.step3.desc'), color: '#fa8c16' },
                  { step: '4', title: t('matching.modals.info.pipeline.step4.title'), desc: t('matching.modals.info.pipeline.step4.desc'), color: '#c0392b' },
                  { step: '5', title: t('matching.modals.info.pipeline.step5.title'), desc: t('matching.modals.info.pipeline.step5.desc'), color: '#eb2f96' },
                  { step: '6', title: t('matching.modals.info.pipeline.step6.title'), desc: t('matching.modals.info.pipeline.step6.desc'), color: '#13c2c2' },
                ].map(({ step, title, desc, color }) => (
                  <div key={step} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      minWidth: 28, height: 28, borderRadius: '50%',
                      background: color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13, flexShrink: 0,
                    }}>
                      {step}
                    </div>
                    <div>
                      <Text strong style={{ fontSize: 13 }}>{title}</Text>
                      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                        {desc}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: 'matching',
            label: t('matching.modals.info.tabs.engine'),
            children: (
              <div>
                <Text style={{ fontSize: 12, lineHeight: 1.8, display: 'block', marginBottom: 12 }}>
                  {t('matching.modals.info.engine.intro')}
                </Text>
 
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t('matching.modals.info.engine.howItWorks')}</Text>
                <ul style={{ fontSize: 12, lineHeight: 2, paddingLeft: 20, marginBottom: 16 }}>
                  <li>{t('matching.modals.info.engine.item1')}</li>
                  <li>{t('matching.modals.info.engine.item2')}</li>
                  <li>{t('matching.modals.info.engine.item3')}</li>
                  <li>{t('matching.modals.info.engine.item4')}</li>
                  <li>{t('matching.modals.info.engine.item5')}</li>
                </ul>
 
                <Divider style={{ margin: '16px 0' }} />
 
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t('matching.modals.info.engine.weights')}</Text>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  {t('matching.modals.info.engine.weightsDesc')}
                </Text>
 
                <Table
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 16 }}
                  columns={[
                    { title: t('matching.modals.info.engine.table.component'), dataIndex: 'component', key: 'component', width: 200 },
                    { title: <span style={{ color: '#1677ff' }}>{t('matching.modals.info.engine.table.technical')}</span>, dataIndex: 'technical', key: 'techn', align: 'center', render: (v: string) => <Tag color="blue">{v}</Tag> },
                    { title: <span style={{ color: '#722ed1' }}>{t('matching.modals.info.engine.table.social')}</span>, dataIndex: 'social', key: 'soc', align: 'center', render: (v: string) => <Tag color="purple">{v}</Tag> },
                    { title: <span style={{ color: '#d46b08' }}>{t('matching.modals.info.engine.table.studio')}</span>, dataIndex: 'studio', key: 'studio', align: 'center', render: (v: string) => <Tag color="orange">{v}</Tag> },
                  ]}
                  dataSource={weightRows.map((r, i) => ({ ...r, key: i }))}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0}><Text strong>{t('matching.modals.info.engine.table.total')}</Text></Table.Summary.Cell>
                      {['100%', '100%', '100%'].map((v, i) => (
                        <Table.Summary.Cell key={i} index={i + 1} align="center">
                          <Text strong>{v}</Text>
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  )}
                />
 
                <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.6, display: 'block' }}>
                  {t('matching.modals.info.engine.note')}
                </Text>
              </div>
            ),
          },
          {
            key: 'verification',
            label: t('matching.modals.info.tabs.verification'),
            children: (
              <div>
                <Text style={{ fontSize: 12, lineHeight: 1.8, display: 'block', marginBottom: 12 }}>
                  {t('matching.modals.info.verification.intro')}
                </Text>
 
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t('matching.modals.info.verification.checks')}</Text>
                <ul style={{ fontSize: 12, lineHeight: 2, paddingLeft: 20, marginBottom: 16 }}>
                  <li>{t('matching.modals.info.verification.item1')}</li>
                  <li>{t('matching.modals.info.verification.item2')}</li>
                  <li>{t('matching.modals.info.verification.item3')}</li>
                  <li>{t('matching.modals.info.verification.item4')}</li>
                  <li>{t('matching.modals.info.verification.item5')}</li>
                </ul>
 
                <Divider style={{ margin: '16px 0' }} />
 
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t('matching.modals.info.verification.outcomes')}</Text>
                <div style={{ fontSize: 12, lineHeight: 2, marginBottom: 16 }}>
                  <div><Tag color="green">{t('matching.modals.info.verification.outcome1')}</Tag></div>
                  <div><Tag color="orange">{t('matching.modals.info.verification.outcome2')}</Tag></div>
                  <div><Tag color="red">{t('matching.modals.info.verification.outcome3')}</Tag></div>
                </div>
 
                <Divider style={{ margin: '16px 0' }} />
 
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t('matching.modals.info.verification.principles')}</Text>
                <ul style={{ fontSize: 12, lineHeight: 2, paddingLeft: 20 }}>
                  <li>{t('matching.modals.info.verification.p1')}</li>
                  <li>{t('matching.modals.info.verification.p2')}</li>
                  <li>{t('matching.modals.info.verification.p3')}</li>
                  <li>{t('matching.modals.info.verification.p4')}</li>
                  <li>{t('matching.modals.info.verification.p5')}</li>
                </ul>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}

// ── Matching Page ────────────────────────────────────────────────────────────

export default function MatchingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [partnerUniId, setPartnerUniId] = useState<number | null>(null);
  const [homeUniId, setHomeUniId] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const queryClient = useQueryClient();
  const { activeDepartment } = useAuth();

  // Fetch universities
  const { data: universities = [] } = useQuery({
    queryKey: ['universities', activeDepartment, 'activeOnly'],
    queryFn: () => getUniversities(activeDepartment, true),
  });

  const homeUniversities = useMemo(() => universities.filter(u => u.is_home), [universities]);
  const partnerUniversities = useMemo(() => universities.filter(u => !u.is_home && u.course_count && u.course_count > 0), [universities]);

  // Auto-select home university
  useEffect(() => {
    if (homeUniversities.length === 1 && !homeUniId) {
      setHomeUniId(homeUniversities[0].id);
    }
  }, [homeUniversities]);

  // Fetch match jobs (v2 only)
  const { data: matchJobs = [] } = useQuery({
    queryKey: ['match-jobs', activeDepartment],
    queryFn: () => getMatchJobs(undefined, activeDepartment),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs || !Array.isArray(jobs)) return false;
      return jobs.some((j: MatchJob) => ACTIVE_STATUSES.includes(j.status)) ? 2000 : false;
    },
  });

  // Create job mutation (v2)
  const createMut = useMutation({
    mutationFn: () => createMatchJob(partnerUniId!, homeUniId!, activeDepartment),
    onSuccess: (data) => {
      message.success(t('matching.messages.jobCreated', { count: data.total_courses }));
      queryClient.invalidateQueries({ queryKey: ['match-jobs'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || t('matching.messages.failedCreate'));
    },
  });

  // Action mutations (v2)
  const pauseMut = useMutation({
    mutationFn: pauseMatchJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['match-jobs'] }),
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to pause job'),
  });
  const resumeMut = useMutation({
    mutationFn: resumeMatchJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['match-jobs'] }),
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to resume job'),
  });
  const cancelMut = useMutation({
    mutationFn: cancelMatchJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['match-jobs'] }),
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to cancel job'),
  });
  const deleteJobMut = useMutation({
    mutationFn: deleteMatchJob,
    onSuccess: () => {
      message.success(t('matching.messages.jobDeleted'));
      queryClient.invalidateQueries({ queryKey: ['match-jobs'] });
    },
    onError: () => message.error(t('matching.messages.failedDelete')),
  });
  const pauseAllMut = useMutation({
    mutationFn: pauseAllMatchJobs,
    onSuccess: () => {
      message.info(t('matching.messages.allPaused'));
      queryClient.invalidateQueries({ queryKey: ['match-jobs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('matching.messages.failedPauseAll')),
  });
 
  const resumeAllMut = useMutation({
    mutationFn: resumeAllMatchJobs,
    onSuccess: (data: any) => {
      message.success(t('matching.messages.resumedCount', { count: data?.resumed_job_ids?.length || 0 }));
      queryClient.invalidateQueries({ queryKey: ['match-jobs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('matching.messages.failedResumeAll')),
  });

  const hasActiveJobs = matchJobs.some(j => ACTIVE_STATUSES.includes(j.status));
  const hasPausedJobs = matchJobs.some(j => j.status === 'paused');
  const canCreate = partnerUniId !== null && homeUniId !== null;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            {t('matching.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('matching.subtitle')}
          </Text>
        </div>
        <Tooltip title={t('matching.infoTooltip')}>
          <Button
            type="text"
            icon={<InfoCircleOutlined style={{ fontSize: 18, color: '#1677ff' }} />}
            onClick={() => setInfoOpen(true)}
            style={{ marginTop: 2 }}
          />
        </Tooltip>
      </div>

      <AlgorithmInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />

      {/* Create Job Panel */}
      <Card
        style={{ marginBottom: 24, borderRadius: 10 }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        {/* Desktop: single-row inline form */}
        <div className="create-form-desktop" style={{
          display: 'none',
          gap: 12,
          alignItems: 'flex-end',
        }}>
          <div style={{ flex: '2 1 0', minWidth: 0 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('matching.partnerUni')}
              </Text>
            </div>
            <Select
              placeholder={t('matching.selectPartner')}
              value={partnerUniId}
              onChange={(val) => setPartnerUniId(val)}
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              fieldNames={{ label: 'label', value: 'value' }}
              options={partnerUniversities.map(u => ({
                value: u.id,
                label: `${u.name} (${u.course_count} ${t('courseList.stats.totalCourses').toLowerCase()})`,
              }))}
              allowClear
            />
          </div>

          <div style={{
            width: 24, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            opacity: 0.35,
          }}>
            <SwapOutlined style={{ fontSize: 16 }} />
          </div>

          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('matching.homeUni')}
              </Text>
            </div>
            <Select
              placeholder={t('matching.selectHome')}
              value={homeUniId}
              onChange={setHomeUniId}
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              options={(homeUniversities.length > 0 ? homeUniversities : universities).map(u => ({
                value: u.id,
                label: u.name,
              }))}
              allowClear
            />
          </div>

          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', paddingBottom: 0 }}>
            <Button
              type="primary"
              icon={<SwapOutlined />}
              onClick={() => createMut.mutate()}
              loading={createMut.isPending}
              disabled={!canCreate}
            >
              {t('matching.startMatching')}
            </Button>
          </div>
        </div>

        {/* Mobile: stacked form */}
        <div className="create-form-mobile" style={{}}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('matching.partnerUni')}
              </Text>
            </div>
            <Select
              placeholder={t('matching.selectPartner')}
              value={partnerUniId}
              onChange={(val) => setPartnerUniId(val)}
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              fieldNames={{ label: 'label', value: 'value' }}
              options={partnerUniversities.map(u => ({
                value: u.id,
                label: `${u.name} (${u.course_count} ${t('courseList.stats.totalCourses').toLowerCase()})`,
              }))}
              allowClear
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('matching.homeUni')}
              </Text>
            </div>
            <Select
              placeholder={t('matching.selectHome')}
              value={homeUniId}
              onChange={setHomeUniId}
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              options={(homeUniversities.length > 0 ? homeUniversities : universities).map(u => ({
                value: u.id,
                label: u.name,
              }))}
              allowClear
            />
          </div>

          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={() => createMut.mutate()}
            loading={createMut.isPending}
            disabled={!canCreate}
            block
          >
            {t('matching.startMatching')}
          </Button>
        </div>

        <style>{`
          @media (min-width: 768px) {
            .create-form-desktop { display: flex !important; }
            .create-form-mobile { display: none !important; }
          }
        `}</style>

        <div style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('matching.onlyUnmatched')}
          </Text>
        </div>
      </Card>

      {/* Pause All / Resume All */}
      {(hasActiveJobs || hasPausedJobs) && (
        <div style={{ marginBottom: 12, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {hasPausedJobs && (
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => resumeAllMut.mutate()}
              loading={resumeAllMut.isPending}
              style={{ color: '#52c41a', borderColor: '#52c41a' }}
            >
              {t('matching.resumeAll')}
            </Button>
          )}
          {hasActiveJobs && (
            <Button
              icon={<PauseCircleOutlined />}
              onClick={() => pauseAllMut.mutate()}
              loading={pauseAllMut.isPending}
            >
              {t('matching.pauseAll')}
            </Button>
          )}
        </div>
      )}

      {/* Job List */}
      {matchJobs.length === 0 ? (
        <Card style={{ borderRadius: 10, textAlign: 'center', padding: '48px 24px' }}>
          <SwapOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
          <Title level={5} style={{ color: '#888', margin: '0 0 8px' }}>
            {t('matching.noJobs')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('matching.noJobsDesc')}
          </Text>
        </Card>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {matchJobs.map(job => (
            <MatchJobCard
              key={job.id}
              job={job}
              onPause={() => pauseMut.mutate(job.id)}
              onResume={() => resumeMut.mutate(job.id)}
              onCancel={() => {
                Modal.confirm({
                  title: t('matching.modals.cancel.title'),
                  content: t('matching.modals.cancel.content', { name: job.partner_university_name }),
                  onOk: () => cancelMut.mutate(job.id),
                });
              }}
              onDelete={() => {
                Modal.confirm({
                  title: t('matching.modals.delete.title'),
                  content: t('matching.modals.delete.content', { name: job.partner_university_name }),
                  okText: t('common.confirmDelete') || 'Yes, Delete',
                  okType: 'danger',
                  onOk: () => deleteJobMut.mutate(job.id),
                });
              }}
              onViewResults={() => navigate(`/matching/${job.id}/results`)}
            />
          ))}
        </Space>
      )}
    </div>
  );
}
