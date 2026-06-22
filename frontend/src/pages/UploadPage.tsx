import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Select, Button, message, Progress, Alert, Row, Col, Typography,
  Tag, Tooltip, Dropdown, Modal, Space,
} from 'antd';
import {
  UploadOutlined, PauseCircleOutlined, PlayCircleOutlined,
  CloseCircleOutlined, DeleteOutlined, SyncOutlined, CheckCircleOutlined,
  WarningOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import type { RcFile } from 'antd/es/upload';
import ParsingStatusBadge from '../components/ParsingStatusBadge';
import type { UploadJob, University, IngestionStatus } from '../types';
import {
  getUniversities, createUploadJob, getUploadJobs,
  pauseUploadJob, pauseAllUploadJobs, resumeUploadJob, cancelUploadJob,
} from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import FileUploader from '../components/FileUploader';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  queued:    { color: '#1677ff', icon: <ClockCircleOutlined />,   label: 'Queued' },
  uploading: { color: '#fa8c16', icon: <SyncOutlined spin />,      label: 'Uploading' },
  parsing:   { color: '#c0392b', icon: <SyncOutlined spin />,      label: 'Parsing' },
  embedding: { color: '#2f54eb', icon: <SyncOutlined spin />,      label: 'Embedding' },
  paused:    { color: '#595959', icon: <PauseCircleOutlined />,    label: 'Paused' },
  completed: { color: '#52c41a', icon: <CheckCircleOutlined />,    label: 'Completed' },
  cancelled: { color: '#8c8c8c', icon: <CloseCircleOutlined />,   label: 'Cancelled' },
  failed:    { color: '#ff4d4f', icon: <WarningOutlined />,        label: 'Failed' },
};

const ACTIVE_STATUSES = ['queued', 'uploading', 'parsing', 'embedding', 'paused'];

function JobStatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    queued:    { color: '#1677ff', icon: <ClockCircleOutlined />,   label: t('upload.status.queued') },
    uploading: { color: '#fa8c16', icon: <SyncOutlined spin />,      label: t('upload.status.uploading') },
    parsing:   { color: '#c0392b', icon: <SyncOutlined spin />,      label: t('upload.status.parsing') },
    embedding: { color: '#2f54eb', icon: <SyncOutlined spin />,      label: t('upload.status.embedding') },
    paused:    { color: '#595959', icon: <PauseCircleOutlined />,    label: t('upload.status.paused') },
    completed: { color: '#52c41a', icon: <CheckCircleOutlined />,    label: t('upload.status.completed') },
    cancelled: { color: '#8c8c8c', icon: <CloseCircleOutlined />,   label: t('upload.status.cancelled') },
    failed:    { color: '#ff4d4f', icon: <WarningOutlined />,        label: t('upload.status.failed') },
  };

  const cfg = STATUS_CONFIG[status] || { color: '#999', icon: null, label: status };
  return (
    <Tag
      icon={cfg.icon}
      color={cfg.color}
      style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}
    >
      {cfg.label.toUpperCase()}
    </Tag>
  );
}

function UploadJobCard({
  job,
  onPause,
  onResume,
  onCancel,
}: {
  job: UploadJob;
  onPause: () => void;
  onResume: () => void;
  onCancel: (deleteUni: boolean) => void;
}) {
  const { t } = useTranslation();
  const isActive = ACTIVE_STATUSES.includes(job.status);
  const isRunning = job.status === 'parsing' || job.status === 'uploading' || job.status === 'embedding';
  const isPaused = job.status === 'paused';
  const isQueued = job.status === 'queued';
  const canPause = isRunning || isQueued;
  const isDone = job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed';

  const cancelMenuItems = [
    {
      key: 'pause-leave',
      label: t('upload.menu.stopLeave'),
      icon: <PauseCircleOutlined />,
      disabled: !canPause,
    },
    {
      key: 'cancel',
      label: t('upload.menu.cancelKeep'),
      icon: <CloseCircleOutlined />,
      disabled: isDone,
    },
    {
      key: 'cancel-delete',
      label: t('upload.menu.cancelDelete'),
      icon: <DeleteOutlined />,
      danger: true,
      disabled: isDone,
    },
  ];

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'pause-leave') {
      onPause();
    } else if (key === 'cancel') {
      Modal.confirm({
        title: t('upload.modals.cancelJob.title'),
        content: t('upload.modals.cancelJob.content'),
        icon: <ExclamationCircleOutlined />,
        okButtonProps: { danger: true },
        okText: t('upload.actions.stop'),
        onOk: () => onCancel(false),
      });
    } else if (key === 'cancel-delete') {
      Modal.confirm({
        title: t('upload.modals.cancelDelete.title'),
        content: (
          <div>
            <p>{t('upload.modals.cancelDelete.content.thisWill')}</p>
            <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
              <li>{t('upload.modals.cancelDelete.content.item1')}</li>
              <li>{t('upload.modals.cancelDelete.content.item2')} <strong>{job.university_name}</strong></li>
              <li>{t('upload.modals.cancelDelete.content.item3')}</li>
            </ul>
            <p>{t('upload.modals.cancelDelete.content.warning')}</p>
          </div>
        ),
        icon: <ExclamationCircleOutlined />,
        okButtonProps: { danger: true },
        okText: t('upload.menu.cancelDelete'),
        onOk: () => onCancel(true),
      });
    }
  };

  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        border: isActive ? '1px solid #c0392b22' : '1px solid #ededed',
        background: isActive ? '#fffafa' : '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        {/* Job info */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <JobStatusTag status={job.status} />
            <Text style={{ fontSize: 13, fontWeight: 600 }}>
              {job.university_name || `${t('courseList.filters.university')} #${job.university_id}`}
            </Text>
            <Tag style={{ fontSize: 11, textTransform: 'uppercase' }}>
              {t(`upload.semesters.${job.semester}`)}
            </Tag>
            {job.category && (
              <Tag color="blue" style={{ fontSize: 11 }}>
                {job.category}
              </Tag>
            )}
          </div>

          <Progress
            percent={job.progress_percent || 0}
            size="small"
            strokeColor={
              job.status === 'failed' ? '#ff4d4f' :
              job.status === 'completed' ? '#52c41a' : 
              job.status === 'embedding' ? '#2f54eb' : '#c0392b'
            }
            status={
              job.status === 'failed' ? 'exception' :
              job.status === 'completed' ? 'success' : 'active'
            }
            style={{ marginBottom: 4 }}
          />

          <div style={{ fontSize: 11, color: '#999', display: 'flex', gap: 16 }}>
            <span>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#333', fontWeight: 600 }}>
                {job.processed_files}
              </span>
              <span> / {job.total_files} {t('upload.status.files')}</span>
            </span>
            {job.failed_files > 0 && (
              <span style={{ color: '#ff4d4f' }}>{job.failed_files} {t('upload.status.failedCount')}</span>
            )}
            {job.current_file && isActive && (
              <Tooltip title={job.current_file}>
                <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.current_file}
                </span>
              </Tooltip>
            )}
          </div>

          {job.status === 'failed' && job.error_log && (
            <Alert
              message={job.error_log}
              type="error"
              style={{ marginTop: 8, fontSize: 11 }}
              showIcon
            />
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          {isDone && (
            <Text style={{ fontSize: 11, color: '#bfbfbf' }}>
              {job.completed_at
                ? new Date(job.completed_at).toLocaleString()
                : ''}
            </Text>
          )}

          <Space size={4}>
            {isPaused && (
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={onResume}
                style={{ fontSize: 12 }}
              >
                {t('upload.actions.resume')}
              </Button>
            )}

            {job.status === 'failed' && (
              <Button
                size="small"
                type="primary"
                icon={<SyncOutlined />}
                onClick={onResume}
                style={{ fontSize: 12 }}
                danger
              >
                {t('upload.actions.recover')}
              </Button>
            )}

            {canPause && (
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                onClick={onPause}
                style={{ fontSize: 12 }}
              >
                {t('upload.actions.pause')}
              </Button>
            )}

            {(isActive) && (
              <Dropdown
                menu={{ items: cancelMenuItems, onClick: handleMenuClick }}
                trigger={['click']}
              >
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  style={{ fontSize: 12 }}
                >
                  {t('upload.actions.stop')}
                </Button>
              </Dropdown>
            )}
          </Space>
        </div>
      </div>
    </Card>
  );
}

export default function UploadPage() {
  const { t } = useTranslation();
  const [universityId, setUniversityId] = useState<number | null>(null);
  const [semester, setSemester] = useState<string>('');
  const [pdfStructure, setPdfStructure] = useState<string>('');
  const [category, setCategory] = useState('');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { activeDepartment } = useAuth();
  const queryClient = useQueryClient();

  const { data: universities = [] } = useQuery({
    queryKey: ['universities', activeDepartment, 'activeOnly'],
    queryFn: () => getUniversities(activeDepartment, true),
  });

  const { data: uploadJobs = [] } = useQuery({
    queryKey: ['upload-jobs', activeDepartment],
    queryFn: () => getUploadJobs(undefined, activeDepartment),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs || jobs.length === 0) return 5000; // initial/empty: poll slowly
      return jobs.some(j => ACTIVE_STATUSES.includes(j.status)) ? 3000 : false;
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseUploadJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
      message.info(t('upload.messages.paused'));
    },
    onError: () => message.error(t('upload.messages.failedPause')),
  });

  const pauseAllMutation = useMutation({
    mutationFn: pauseAllUploadJobs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
      message.info(t('upload.messages.pausedAll'));
    },
    onError: () => message.error(t('upload.messages.failedPauseAll')),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeUploadJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
      message.success(t('upload.messages.resumed'));
    },
    onError: () => message.error(t('upload.messages.failedResume')),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, deleteUni }: { id: number; deleteUni: boolean }) =>
      cancelUploadJob(id, deleteUni),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['universities'] });
      queryClient.invalidateQueries({ queryKey: ['all-courses'] });
      if (vars.deleteUni) {
        message.success(t('upload.messages.cancelledDeleted'));
      } else {
        message.success(t('upload.messages.cancelled'));
      }
    },
    onError: () => message.error(t('upload.messages.failedCancel')),
  });

  const handleSubmit = async () => {
    if (!universityId || !semester || fileList.length === 0) {
      message.warning(t('upload.messages.selectWarning'));
      return;
    }
    setSubmitting(true);
    try {
      const files = fileList.map(f => f.originFileObj).filter((f): f is RcFile => f != null);
      await createUploadJob(universityId, semester, files, category || undefined, pdfStructure || undefined);
      message.success(t('upload.messages.queuedSuccess'));
      setFileList([]);
      setUniversityId(null);
      setSemester('');
      setPdfStructure('');
      setCategory('');
      queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['universities'] });
    } catch (err: unknown) {
      const errMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(errMsg || t('upload.messages.failedQueue'));
    } finally {
      setSubmitting(false);
    }
  };

  const isCategoryBased = pdfStructure === 'category_based';

  const activeJobs = uploadJobs.filter(j => ACTIVE_STATUSES.includes(j.status));
  const recentJobs = uploadJobs.filter(j => !ACTIVE_STATUSES.includes(j.status)).slice(0, 10);

  return (
    <div>
      {/* Upload Form */}
      <Card style={{ marginBottom: 24 }}>
        <Text style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#999',
          display: 'block',
          marginBottom: 14,
        }}>
          {t('upload.newUpload')}
        </Text>

        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={14}>
            <Select
              placeholder={t('upload.selectUni')}
              style={{ width: '100%' }}
              onChange={(id: number) => {
                setUniversityId(id);
                const uni = universities.find(u => u.id === id);
                if (uni) {
                  setPdfStructure(uni.pdf_structure);
                  setSemester(uni.is_home ? 'none' : '');
                }
              }}
              value={universityId}
              showSearch
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={universities.map(u => ({
                value: u.id,
                label: u.name,
                labelElement: (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span>{u.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: '#999' }}>
                        {t(`universities.form.structures.${u.pdf_structure}`)}
                      </span>
                      {u.ingestion_status && u.ingestion_status !== 'ready' && u.ingestion_status !== 'pending' && (
                        <ParsingStatusBadge status={u.ingestion_status as IngestionStatus} />
                      )}
                    </div>
                  </div>
                ),
              }))}
              optionRender={(option) => option.data.labelElement}
              size="large"
            />
          </Col>
          <Col xs={24} sm={5}>
            <Select
              placeholder={t('upload.semesters.placeholder') || t('courseList.filters.semester')}
              value={semester || undefined}
              onChange={setSemester}
              style={{ width: '100%' }}
              options={[
                { value: 'fall', label: t('upload.semesters.fall') },
                { value: 'spring', label: t('upload.semesters.spring') },
                { value: 'both', label: t('upload.semesters.both') },
                { value: 'unknown', label: t('upload.semesters.unknown') },
                { value: 'none', label: t('upload.semesters.none') },
              ]}
              size="large"
            />
          </Col>
          <Col xs={24} sm={5}>
            <Select
              value={pdfStructure || undefined}
              onChange={(val) => setPdfStructure(val)}
              placeholder={t('upload.selectStructure')}
              style={{ width: '100%' }}
              options={[
                { value: 'individual', label: t('universities.form.structures.individual') },
                { value: 'consolidated', label: t('universities.form.structures.consolidated') },
                { value: 'category_based', label: t('universities.form.structures.categoryBased') },
              ]}
              size="large"
            />
          </Col>
        </Row>

        {isCategoryBased && (
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col xs={24}>
              <Select
                placeholder={t('upload.selectCategory')}
                size="large"
                style={{ width: '100%' }}
                value={category || undefined}
                onChange={(val) => { setCategory(val); setCategoryDropdownOpen(false); }}
                showSearch
                allowClear
                open={categoryDropdownOpen}
                onDropdownVisibleChange={setCategoryDropdownOpen}
                options={[
                  { value: 'Core Courses', label: t('universities.form.categories.core') },
                  { value: 'Departmental Elective Courses', label: t('universities.form.categories.deptElective') },
                  { value: 'Elective Courses', label: t('universities.form.categories.elective') },
                ]}
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                notFoundContent={
                  category ? (
                    <div
                      style={{ padding: '4px 8px', cursor: 'pointer', color: '#1677ff' }}
                      onMouseDown={e => { e.preventDefault(); setCategoryDropdownOpen(false); }}
                    >
                      {t('common.use')} &ldquo;{category}&rdquo;
                    </div>
                  ) : null
                }
                onSearch={setCategory}
              />
            </Col>
          </Row>
        )}

        <FileUploader fileList={fileList} onChange={setFileList} />

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            size="large"
            icon={<UploadOutlined />}
            onClick={handleSubmit}
            loading={submitting}
            disabled={!universityId || fileList.length === 0}
            style={{ fontWeight: 500, height: 44, paddingInline: 28 }}
          >
            {t('upload.uploadButton')}{fileList.length > 0 ? ` (${fileList.length})` : ''}
          </Button>
        </div>
      </Card>

      {/* Active Jobs */}
      {activeJobs.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Title level={5} style={{ margin: 0, fontSize: 13, color: '#c0392b' }}>
              {t('upload.activeJobs')} ({activeJobs.length})
            </Title>
            {activeJobs.length > 1 && (
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                onClick={() => pauseAllMutation.mutate()}
                style={{ fontSize: 12 }}
              >
                {t('upload.actions.pauseAll')}
              </Button>
            )}
          </div>
          {activeJobs.map(job => (
            <UploadJobCard
              key={job.id}
              job={job}
              onPause={() => pauseMutation.mutate(job.id)}
              onResume={() => resumeMutation.mutate(job.id)}
              onCancel={(deleteUni) => cancelMutation.mutate({ id: job.id, deleteUni })}
            />
          ))}
        </Card>
      )}

      {/* Recent Jobs */}
      {recentJobs.length > 0 && (
        <Card>
          <Title level={5} style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
            {t('upload.recentJobs')}
          </Title>
          {recentJobs.map(job => (
            <UploadJobCard
              key={job.id}
              job={job}
              onPause={() => pauseMutation.mutate(job.id)}
              onResume={() => resumeMutation.mutate(job.id)}
              onCancel={(deleteUni) => cancelMutation.mutate({ id: job.id, deleteUni })}
            />
          ))}
        </Card>
      )}

      {uploadJobs.length === 0 && (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#bfbfbf' }}>
            <UploadOutlined style={{ fontSize: 32, marginBottom: 12 }} />
            <div style={{ fontSize: 13 }}>{t('upload.noJobs')}</div>
          </div>
        </Card>
      )}
    </div>
  );
}
