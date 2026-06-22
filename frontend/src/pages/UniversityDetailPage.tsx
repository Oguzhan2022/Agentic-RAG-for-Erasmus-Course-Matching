import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Progress, Tag, Space, Button, Typography, Row, Col, Statistic,
  Modal, Form, Input, Select, Switch, message,
} from 'antd';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftOutlined, BookOutlined, EditOutlined,
} from '@ant-design/icons';
import { getUniversity, getUniversityCourses, updateUniversity } from '../api/client';
import ParsingStatusBadge from '../components/ParsingStatusBadge';
import CourseTable from '../components/CourseTable';
import type { IngestionBatch, IngestionStatus } from '../types';

const { Title } = Typography;

export default function UniversityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const universityId = Number(id);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [coursePage, setCoursePage] = useState(1);
  const [coursePageSize, setCoursePageSize] = useState(50);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateUniversity(universityId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['university', universityId] });
      queryClient.invalidateQueries({ queryKey: ['universities'] });
      setEditModalOpen(false);
      message.success(t('universityDetail.messages.updated'));
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('universityDetail.messages.updateFailed')),
  });

  const { data: university, isLoading: uniLoading } = useQuery({
    queryKey: ['university', universityId],
    queryFn: () => getUniversity(universityId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      // Stop polling if ingestion is complete or failed
      if (['done', 'failed', 'no_pdf'].includes(data.ingestion_status)) {
        return false;
      }
      return 5000;
    },
  });

  const { data: coursesData, isLoading: coursesLoading } = useQuery({
    queryKey: ['university-courses', universityId, coursePage, coursePageSize],
    queryFn: () => getUniversityCourses(universityId, {
      skip: (coursePage - 1) * coursePageSize,
      limit: coursePageSize,
    }),
  });

  if (uniLoading) return <Card loading style={{ minHeight: 300 }} />;
  if (!university) return <Card>{t('universityDetail.messages.notFound')}</Card>;

  const batchColumns = [
    {
      title: t('universityDetail.batchTable.batch'),
      dataIndex: 'id',
      key: 'id',
      width: 60,
      render: (v: number) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#999' }}>#{v}</span>
      ),
    },
    {
      title: t('universityDetail.batchTable.semester'),
      dataIndex: 'semester',
      key: 'semester',
      width: 90,
      render: (v: string) => (
        <Tag style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          margin: 0,
        }}>
          {v?.toLowerCase() === 'fall' ? t('courseTable.options.fall') : 
           v?.toLowerCase() === 'spring' ? t('courseTable.options.spring') : 
           v?.toLowerCase() === 'unknown' ? t('courseTable.options.unknown') : v}
        </Tag>
      ),
    },
    {
      title: t('universityDetail.batchTable.status'),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: IngestionStatus) => <ParsingStatusBadge status={status} />,
    },
    {
      title: t('universityDetail.batchTable.progress'),
      key: 'progress',
      render: (_: unknown, record: IngestionBatch) => {
        const percent = record.total_courses > 0
          ? Math.round((record.parsed_courses / record.total_courses) * 100)
          : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Progress
              percent={percent}
              size="small"
              style={{ width: 140, margin: 0 }}
              strokeColor={record.status === 'failed' ? '#ff4d4f' : '#c0392b'}
              status={record.status === 'failed' ? 'exception' : undefined}
            />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#777',
              whiteSpace: 'nowrap',
            }}>
              {record.parsed_courses}/{record.total_courses}
            </span>
          </div>
        );
      },
    },
    {
      title: t('universityDetail.batchTable.failed'),
      dataIndex: 'failed_courses',
      key: 'failed_courses',
      width: 60,
      align: 'center' as const,
      render: (v: number) => v > 0
        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#ff4d4f', fontWeight: 600 }}>{v}</span>
        : <span style={{ color: '#bfbfbf' }}>0</span>,
    },
    {
      title: t('universityDetail.batchTable.started'),
      dataIndex: 'started_at',
      key: 'started_at',
      width: 150,
      render: (v: string | null) => (
        <span style={{ fontSize: 11, color: '#999' }}>
          {v ? new Date(v).toLocaleString() : '—'}
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* Back button + header */}
      <div style={{ marginBottom: 20 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ fontSize: 12, color: '#999', padding: '0 4px', marginBottom: 8 }}
        >
          {t('universityDetail.backToAll')}
        </Button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <Title level={3} style={{
              margin: 0,
              letterSpacing: '-0.02em',
              fontSize: 24,
              fontWeight: 700,
            }}>
              {university.name}
            </Title>
            <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>
              {[university.city, university.country].filter(Boolean).join(', ')}
              {university.is_home && (
                <span style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#c0392b',
                  background: '#fdf2f1',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}>
                  {t('universityDetail.homeUni')}
                </span>
              )}
            </div>
          </div>
          <Space>
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => {
                editForm.setFieldsValue({
                  name: university.name,
                  country: university.country,
                  city: university.city,
                  pdf_structure: university.pdf_structure,
                  is_active: university.is_active,
                });
                setEditModalOpen(true);
              }}
            >
              {t('universityDetail.edit')}
            </Button>
            <ParsingStatusBadge status={university.ingestion_status} />
          </Space>
        </div>
      </div>

      {/* Stats row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('universityDetail.stats.courses')}</span>}
              value={university.course_count || 0}
              prefix={<BookOutlined style={{ color: '#c0392b' }} />}
              styles={{ content: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('universityDetail.stats.pdfStructure')}</span>}
              value={t(`universities.form.structures.${university.pdf_structure === 'category_based' ? 'categoryBased' : university.pdf_structure}`).toLowerCase()}
              styles={{ content: { fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('universityDetail.stats.batches')}</span>}
              value={university.batches?.length || 0}
              styles={{ content: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
      </Row>

      {/* Batches */}
      {university.batches && university.batches.length > 0 && (
        <Card
          title={<span style={{ fontSize: 13 }}>{t('universityDetail.ingestionBatches')}</span>}
          style={{ marginBottom: 20 }}
        >
          <Table
            columns={batchColumns}
            dataSource={university.batches}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </Card>
      )}

      {/* Courses */}
      <Card
        title={
          <span style={{ fontSize: 13 }}>
            {t('universityDetail.stats.courses')}
            <span style={{
              marginLeft: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: '#999',
              fontWeight: 400,
            }}>
              {coursesData?.total || 0}
            </span>
          </span>
        }
      >
        <CourseTable
          courses={coursesData?.courses || []}
          loading={coursesLoading}
          total={coursesData?.total}
          page={coursePage}
          pageSize={coursePageSize}
          onPageChange={(p, ps) => {
            setCoursePage(p);
            setCoursePageSize(ps);
          }}
        />
      </Card>

      {/* Edit University Modal */}
      <Modal
        title={t('universityDetail.editTitle')}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={() => editForm.validateFields().then(values => updateMutation.mutate(values))}
        confirmLoading={updateMutation.isPending}
      >
        <Form 
          form={editForm} 
          layout="vertical" 
          style={{ marginTop: 16 }}
        >
          <Form.Item name="name" label={t('universityDetail.form.name')} rules={[{ required: true }]}>
            <Input disabled={university.is_home} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="country" label={t('universityDetail.form.country')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="city" label={t('universityDetail.form.city')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="pdf_structure" label={t('universityDetail.form.pdfStructure')}>
            <Select options={[
              { value: 'individual', label: t('universities.form.structures.individual') },
              { value: 'consolidated', label: t('universities.form.structures.consolidated') },
              { value: 'category_based', label: t('universities.form.structures.categoryBased') },
            ]} />
          </Form.Item>
          {!university.is_home && (
            <Form.Item name="is_active" label={t('universityDetail.form.activeStatus')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
