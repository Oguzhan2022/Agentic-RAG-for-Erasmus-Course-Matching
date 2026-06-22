import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, Input, Select, Switch, Tag, Card, Space, message, Statistic, Row, Col, Tooltip, Progress, Alert } from 'antd';
import { PlusOutlined, BankOutlined, BookOutlined, GlobalOutlined, SyncOutlined, CloudDownloadOutlined, LinkOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { getUniversities, createUniversity, deleteUniversity, scrapeEcts, scrapeEctsStatus } from '../api/client';
import ParsingStatusBadge from '../components/ParsingStatusBadge';
import type { University, IngestionStatus } from '../types';

export default function UniversityListPage() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);
  const [scrapeUniId, setScrapeUniId] = useState<number | null>(() => {
    const stored = localStorage.getItem('ects_scrape_uni_id');
    return stored ? Number(stored) : null;
  });
  const [scrapeProgress, setScrapeProgress] = useState<{
    status: string;
    total_courses: number;
    scraped_courses: number;
    categories: Record<string, number>;
    jobs_created: number[];
    error?: string;
  } | null>(null);
  const scrapePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { user, activeDepartment } = useAuth();
  const queryClient = useQueryClient();

  const { data: universities = [], isLoading } = useQuery({
    queryKey: ['universities', activeDepartment],
    queryFn: () => getUniversities(activeDepartment),
  });

  // Persist scrapeUniId to localStorage
  useEffect(() => {
    if (scrapeUniId) {
      localStorage.setItem('ects_scrape_uni_id', String(scrapeUniId));
    } else {
      localStorage.removeItem('ects_scrape_uni_id');
    }
  }, [scrapeUniId]);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (scrapePollingRef.current) clearInterval(scrapePollingRef.current);
    };
  }, []);

  const clearScrapeState = useCallback(() => {
    setScrapeUniId(null);
    setScrapeProgress(null);
    localStorage.removeItem('ects_scrape_uni_id');
  }, []);

  const startScrapePolling = useCallback((universityId: number) => {
    if (scrapePollingRef.current) clearInterval(scrapePollingRef.current);
    scrapePollingRef.current = setInterval(async () => {
      try {
        const status = await scrapeEctsStatus(universityId);
        setScrapeProgress(status);
        if (status.status === 'completed' || status.status === 'failed') {
          if (scrapePollingRef.current) clearInterval(scrapePollingRef.current);
          scrapePollingRef.current = null;
          queryClient.invalidateQueries({ queryKey: ['universities'] });
          queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
          if (status.status === 'completed') {
            message.success(t('universities.messages.scrapingComplete', { count: status.scraped_courses, jobs: status.jobs_created.length }));
          }
          // Clear localStorage once done
          clearScrapeState();
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
  }, [queryClient, clearScrapeState]);

  // On mount: resume polling if there was an active scrape
  useEffect(() => {
    if (scrapeUniId && !scrapePollingRef.current) {
      // Check if scrape is still active
      scrapeEctsStatus(scrapeUniId).then((status) => {
        if (status.status === 'running' || status.status === 'starting') {
          setScrapeProgress(status);
          startScrapePolling(scrapeUniId);
        } else if (status.status === 'completed' || status.status === 'failed') {
          setScrapeProgress(status);
          // Show briefly then clear
          clearScrapeState();
        } else {
          // idle — no active scrape
          clearScrapeState();
        }
      }).catch(() => {
        clearScrapeState();
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: createUniversity,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['universities'] });
      setModalOpen(false);

      const ectsUrl = form.getFieldValue('ects_url');
      form.resetFields();

      if (variables.is_home && ectsUrl) {
        // Automatically start ECTS scraping
        setScrapeUniId(data.id);
        setScrapeProgress({ status: 'starting', total_courses: 0, scraped_courses: 0, categories: {}, jobs_created: [] });
        setScrapeModalOpen(true);

        scrapeEcts(data.id, ectsUrl).then(() => {
          startScrapePolling(data.id);
        }).catch((err) => {
          setScrapeProgress({ status: 'failed', total_courses: 0, scraped_courses: 0, categories: {}, jobs_created: [], error: err?.response?.data?.detail || t('universities.import.failed') });
          clearScrapeState();
        });
      } else {
        message.success(t('universities.messages.added'));
      }
    },
    onError: () => message.error(t('universities.messages.createFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUniversity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['universities'] });
      queryClient.invalidateQueries({ queryKey: ['all-courses'] });
      queryClient.invalidateQueries({ queryKey: ['upload-jobs'] });
      message.success(t('universities.messages.removed'));
    },
  });

  const totalCourses = universities.reduce((sum, u) => sum + (u.course_count || 0), 0);
  const readyCount = universities.filter(u => u.ingestion_status === 'ready' || u.ingestion_status === 'parsed').length;

  const columns = [
    {
      title: t('universities.table.university'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: University) => (
        <div>
          <a
            onClick={() => navigate(`/universities/${record.id}`)}
            style={{ fontWeight: 500, fontSize: 13 }}
          >
            {name}
          </a>
          <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>
            {[record.city, record.country].filter(Boolean).join(', ') || '—'}
          </div>
        </div>
      ),
    },
    {
      title: t('universities.table.type'),
      dataIndex: 'is_home',
      key: 'is_home',
      width: 80,
      render: (v: boolean) => (
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.06em',
          color: v ? '#c0392b' : '#777',
          background: v ? '#fdf2f1' : '#f5f5f5',
          padding: '2px 8px',
          borderRadius: 4,
        }}>
          {v ? t('universities.types.home') : t('universities.types.partner')}
        </span>
      ),
    },
    {
      title: t('universities.table.structure'),
      dataIndex: 'pdf_structure',
      key: 'structure',
      width: 110,
      render: (v: string) => {
        const key = v === 'category_based' ? 'categoryBased' : v;
        return (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'lowercase' }}>
            {t(`universities.form.structures.${key}`)}
          </span>
        );
      },
    },
    {
      title: t('universities.table.status'),
      dataIndex: 'ingestion_status',
      key: 'ingestion_status',
      width: 110,
      render: (status: IngestionStatus) => <ParsingStatusBadge status={status} />,
    },
    {
      title: t('universities.table.active'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'} style={{ fontSize: 10, fontWeight: 600 }}>
          {v ? t('universities.activeStatus.active') : t('universities.activeStatus.inactive')}
        </Tag>
      ),
    },
    {
      title: t('universities.table.courses'),
      dataIndex: 'course_count',
      key: 'course_count',
      width: 80,
      align: 'center' as const,
      render: (v: number) => (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 14,
          color: v ? '#1a1a1a' : '#bfbfbf',
        }}>
          {v || 0}
        </span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: University) => (
        <Space size={4}>
          <Button
            size="small"
            type="text"
            onClick={() => navigate(`/universities/${record.id}`)}
            style={{ fontSize: 12, color: '#c0392b' }}
          >
            {t('universities.table.actions.view')}
          </Button>
          <Tooltip
            title={record.has_active_upload
              ? t('universities.modals.cancelJob.title')
              : undefined
            }
          >
            <Button
              size="small"
              type="text"
              danger
              icon={record.has_active_upload ? <SyncOutlined spin /> : undefined}
              disabled={record.has_active_upload}
              onClick={() => {
                Modal.confirm({
                  title: t('universities.modals.removeTitle'),
                  content: t('universities.modals.removeContent', { name: record.name }),
                  okButtonProps: { danger: true },
                  onOk: () => deleteMutation.mutate(record.id),
                });
              }}
              style={{ fontSize: 12 }}
            >
              {t('universities.table.actions.remove')}
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Stats row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ background: '#fff' }}>
            <Statistic
              title={<span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('universities.stats.totalUnis')}</span>}
              value={universities.length}
              prefix={<BankOutlined style={{ color: '#c0392b', fontSize: 16 }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ background: '#fff' }}>
            <Statistic
              title={<span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('universities.stats.totalCourses')}</span>}
              value={totalCourses}
              prefix={<BookOutlined style={{ color: '#c0392b', fontSize: 16 }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ background: '#fff' }}>
            <Statistic
              title={<span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('universities.stats.processed')}</span>}
              value={readyCount}
              suffix={<span style={{ fontSize: 14, color: '#999' }}>/ {universities.length}</span>}
              prefix={<GlobalOutlined style={{ color: '#52c41a', fontSize: 16 }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
      </Row>

      {/* University table */}
      <Card
        title={null}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
            style={{ fontWeight: 500 }}
          >
            {t('universities.modals.addTitle')}
          </Button>
        }
        styles={{ header: { borderBottom: '1px solid #ededed' } }}
      >
        <Table
          columns={columns}
          dataSource={universities}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      {/* Add university modal */}
      <Modal
        title={t('universities.modals.addTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        okText={t('universities.modals.addBtn')}
        width={480}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            if (activeDepartment && !values.department) {
               values.department = activeDepartment;
            }
            createMutation.mutate(values);
          }}
          onValuesChange={(changedValues) => {
            if (changedValues.is_home !== undefined) {
              if (changedValues.is_home) {
                form.setFieldsValue({
                  name: "İstanbul Kültür Üniversitesi",
                  country: "Turkey",
                  city: "Istanbul",
                  pdf_structure: "category_based"
                });
              }
            }
          }}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.is_home !== curr.is_home}
          >
            {({ getFieldValue }) => (
              <Form.Item
                name="name"
                label={<span style={{ fontSize: 12, fontWeight: 500 }}>{t('universities.form.uniName')}</span>}
                rules={[{ required: true, message: t('universities.form.required') }]}
              >
                <Input 
                  placeholder={t('universities.form.namePlaceholder')} 
                  disabled={getFieldValue('is_home')}
                />
              </Form.Item>
            )}
          </Form.Item>
          {!activeDepartment && (
             <Form.Item
             name="department"
             label={<span style={{ fontSize: 12, fontWeight: 500 }}>{t('universities.form.deptLabel')}</span>}
             rules={[{ required: true, message: t('universities.form.deptRequired') }]}
           >
             <Select placeholder={t('universities.form.deptPlaceholder')}>
               <Select.Option value="COM">{t('departments.Computer Engineering')} (COM)</Select.Option>
               {/* Add dynamic fetching if needed, for now just COM or handle via API */}
             </Select>
           </Form.Item>
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="country"
                label={<span style={{ fontSize: 12, fontWeight: 500 }}>{t('universities.form.country')}</span>}
              >
                <Input placeholder={t('universities.form.countryPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="city"
                label={<span style={{ fontSize: 12, fontWeight: 500 }}>{t('universities.form.city')}</span>}
              >
                <Input placeholder={t('universities.form.cityPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="pdf_structure"
            label={<span style={{ fontSize: 12, fontWeight: 500 }}>{t('universities.form.pdfStructure')}</span>}
            initialValue="individual"
          >
            <Select
              options={[
                { value: 'individual', label: t('universities.form.structures.individual') },
                { value: 'consolidated', label: t('universities.form.structures.consolidated') },
                { value: 'category_based', label: t('universities.form.structures.categoryBased') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="is_home"
            label={<span style={{ fontSize: 12, fontWeight: 500 }}>{t('universities.form.isHome')}</span>}
            valuePropName="checked"
            initialValue={false}
            shouldUpdate={true}
          >
            <Switch 
              size="small" 
              disabled={universities.some(u => u.is_home)}
            />
          </Form.Item>
          {universities.some(u => u.is_home) && (
            <div style={{ fontSize: 11, color: '#999', marginTop: -12, marginBottom: 12 }}>
              {t('universities.form.homeExists')}
            </div>
          )}

          {/* IKU ECTS URL – only shown when is_home is toggled on */}
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.is_home !== curr.is_home}
          >
            {({ getFieldValue }) =>
              getFieldValue('is_home') ? (
                <Form.Item
                  name="ects_url"
                  label={
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      <LinkOutlined style={{ marginRight: 4 }} />
                      {t('universities.form.ectsUrl')}
                    </span>
                  }
                  help={
                    <span style={{ fontSize: 11, color: '#999' }}>
                      {t('universities.form.ectsHelp')}
                    </span>
                  }
                  rules={[{
                    pattern: /akademikpaket\.iku\.edu\.tr.*ects=ders/,
                    message: t('universities.form.ectsInvalid'),
                  }]}
                >
                  <Input
                    placeholder="https://akademikpaket.iku.edu.tr/EN/ects_bolum.php?m=1&p=13&f=4&r=0&ects=ders"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* Background scraping banner — shown when modal is closed but scrape is running */}
      {!scrapeModalOpen && scrapeProgress && (scrapeProgress.status === 'running' || scrapeProgress.status === 'starting') && (
        <div
          onClick={() => setScrapeModalOpen(true)}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            color: '#fff',
            borderRadius: 10,
            padding: '12px 20px',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            minWidth: 280,
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <SyncOutlined spin style={{ fontSize: 18, color: '#c0392b' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.03em' }}>
              {t('universities.import.running')}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
              {t('universities.import.downloaded', { scraped: scrapeProgress.scraped_courses, total: scrapeProgress.total_courses })}
            </div>
          </div>
          <div style={{
            marginLeft: 'auto',
            fontSize: 18,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: '#c0392b',
          }}>
            {scrapeProgress.total_courses > 0
              ? `${Math.round((scrapeProgress.scraped_courses / scrapeProgress.total_courses) * 100)}%`
              : '...'
            }
          </div>
        </div>
      )}

      {/* ECTS Scrape Progress Modal */}
      <Modal
        title={
          <span>
            <CloudDownloadOutlined style={{ marginRight: 8, color: '#c0392b' }} />
            {t('universities.import.modalTitle')}
          </span>
        }
        open={scrapeModalOpen}
        footer={
          scrapeProgress?.status === 'completed' || scrapeProgress?.status === 'failed'
            ? [
                <Button
                  key="close"
                  type="primary"
                  onClick={() => {
                    setScrapeModalOpen(false);
                    setScrapeProgress(null);
                    if (scrapeProgress?.status === 'completed') {
                      navigate('/upload');
                    }
                  }}
                >
                  {scrapeProgress?.status === 'completed' ? t('universities.modals.viewUploadJobs') : t('universities.modals.close')}
                </Button>,
              ]
            : [
                <Button
                  key="bg"
                  onClick={() => setScrapeModalOpen(false)}
                >
                  {t('universities.modals.runInBackground')}
                </Button>,
              ]
        }
        closable={true}
        onCancel={() => setScrapeModalOpen(false)}
        width={500}
      >
        {scrapeProgress && (
          <div style={{ padding: '8px 0' }}>
            {scrapeProgress.status === 'failed' && (
              <Alert
                type="error"
                message={t('universities.import.failed')}
                description={scrapeProgress.error || 'An unknown error occurred'}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {scrapeProgress.status === 'completed' && (
              <Alert
                type="success"
                message={t('universities.import.completed')}
                description={t('universities.messages.scrapingComplete', { count: scrapeProgress.scraped_courses, jobs: scrapeProgress.jobs_created.length })}
                showIcon
                icon={<CheckCircleOutlined />}
                style={{ marginBottom: 16 }}
              />
            )}

            {(scrapeProgress.status === 'running' || scrapeProgress.status === 'starting') && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <SyncOutlined spin style={{ fontSize: 24, color: '#c0392b', marginBottom: 8 }} />
                  <div style={{ fontSize: 13, color: '#666' }}>
                    {scrapeProgress.status === 'starting'
                      ? t('universities.import.initializing')
                      : t('universities.import.downloading', { scraped: scrapeProgress.scraped_courses, total: scrapeProgress.total_courses })
                    }
                  </div>
                </div>
                {scrapeProgress.total_courses > 0 && (
                  <Progress
                    percent={Math.round((scrapeProgress.scraped_courses / scrapeProgress.total_courses) * 100)}
                    status="active"
                    strokeColor="#c0392b"
                    style={{ marginBottom: 16 }}
                  />
                )}
                <div style={{ fontSize: 11, color: '#999', textAlign: 'center' }}>
                  {t('universities.form.ectsHelp').split('.')[0]}.
                </div>
              </>
            )}

            {Object.keys(scrapeProgress.categories).length > 0 && (
              <div style={{ background: '#fafafa', borderRadius: 6, padding: 12, marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999', marginBottom: 8 }}>
                  {t('universities.import.categoriesFound')}
                </div>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {Object.entries(scrapeProgress.categories).map(([cat, count]) => (
                    <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Tag color={cat === 'core' ? 'red' : cat === 'departmental_elective' ? 'blue' : 'green'}
                        style={{ fontSize: 11, fontWeight: 600 }}
                      >
                        {cat === 'core' ? t('universities.import.categories.core') : cat === 'departmental_elective' ? t('universities.import.categories.deptElective') : t('universities.import.categories.elective')}
                      </Tag>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13 }}>
                        {t('universities.import.categories.coursesCount', { count: count })}
                      </span>
                    </div>
                  ))}
                </Space>
              </div>
            )}

            {scrapeProgress.jobs_created.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#52c41a' }}>
                {t('universities.import.jobsEnqueued', { count: scrapeProgress.jobs_created.length })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
