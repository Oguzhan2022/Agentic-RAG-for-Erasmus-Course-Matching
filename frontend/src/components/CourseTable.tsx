import { useState } from 'react';
import {
  Table, Tag, Tooltip, Typography, Descriptions, Divider, Popconfirm,
  Button, Modal, Form, Input, InputNumber, Select, Switch, Tabs, Space, message, ConfigProvider,
} from 'antd';
import trTR from 'antd/locale/tr_TR';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import {
  ExperimentOutlined,
  WarningOutlined,
  BookOutlined,
  GlobalOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  LinkOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateCourse, deleteCourse } from '../api/client';
import type { Course } from '../types';

const { Paragraph, Text } = Typography;

const qualityColor: Record<string, string> = {
  high: '#52c41a',
  medium: '#fa8c16',
  low: '#ff4d4f',
};

const qualityBg: Record<string, string> = {
  high: '#f6ffed',
  medium: '#fff7e6',
  low: '#fff2f0',
};

interface CourseTableProps {
  courses: Course[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
}

function StatusDot({ value, label }: { value: boolean | 'unknown'; label: string }) {
  const color = value === true ? '#52c41a' : value === false ? '#ff4d4f' : '#bfbfbf';
  const text = value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
  const Icon = value === true ? CheckCircleOutlined : value === false ? CloseCircleOutlined : QuestionCircleOutlined;
  return (
    <Tooltip title={`${label}: ${text}`}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: color,
        padding: '2px 8px',
        background: value === true ? '#f6ffed' : value === false ? '#fff2f0' : '#fafafa',
        borderRadius: 4,
        border: `1px solid ${value === true ? '#b7eb8f' : value === false ? '#ffa39e' : '#e8e8e8'}`,
      }}>
        <Icon style={{ fontSize: 11 }} />
        <span style={{ color: '#555', fontSize: 11 }}>{label}</span>
      </span>
    </Tooltip>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: '#999',
      display: 'block',
      marginBottom: 6,
    }}>
      {children}
    </Text>
  );
}

function FieldValue({ value, fallback = 'Not available' }: { value: string | null | undefined; fallback?: string }) {
  const isEmpty = !value || value === 'unknown';
  return (
    <span style={{ color: isEmpty ? '#bfbfbf' : '#333', fontStyle: isEmpty ? 'italic' : 'normal' }}>
      {isEmpty ? fallback : value}
    </span>
  );
}

export default function CourseTable({
  courses,
  loading = false,
  total,
  page = 1,
  pageSize = 50,
  onPageChange,
}: CourseTableProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'tr' ? trTR : enUS;
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => updateCourse(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['university-courses'] });
      queryClient.invalidateQueries({ queryKey: ['all-courses'] });
      setEditingCourse(null);
      message.success(t('courseTable.messages.updated'));
    },
    onError: () => message.error(t('courseTable.messages.updateFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCourse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['university-courses'] });
      queryClient.invalidateQueries({ queryKey: ['all-courses'] });
      message.success(t('courseTable.messages.deleted'));
    },
    onError: () => message.error(t('courseTable.messages.deleteFailed')),
  });

  const openEditModal = (record: Course) => {
    const ac = record.academic_context || {};
    const mq = record.metadata_quality || {};
    const sm = record.source_metadata || {};
    editForm.setFieldsValue({
      course_code: record.course_code,
      course_name: record.course_name,
      department: record.department,
      ects: record.ects,
      level: record.level || 'unknown',
      semester: record.semester || 'unknown',
      language: record.language,
      content: record.content,
      learning_outcomes: record.learning_outcomes,
      primary_format: Array.isArray(ac.primary_format) ? ac.primary_format : (ac.primary_format ? [ac.primary_format] : []),
      assessment_mode: Array.isArray(ac.assessment_mode) ? ac.assessment_mode : (ac.assessment_mode ? [ac.assessment_mode] : []),
      lab_status: String(ac.lab_status ?? 'unknown'),
      project_status: String(ac.project_status ?? 'unknown'),
      seminar_status: String(ac.seminar_status ?? 'unknown'),
      special_tags: ac.special_tags || [],
      content_available: mq.content_available ?? false,
      outcomes_available: mq.outcomes_available ?? false,
      format_confidence: mq.format_confidence || 'medium',
      source_metadata_entries: Object.entries(sm).map(([key, value]) => ({ key, value: String(value ?? '') })),
      warnings: record.warnings || [],
      is_active: record.is_active ?? true,
    });
    setEditingCourse(record);
  };

  const handleEditSubmit = () => {
    editForm.validateFields().then(values => {
      const triState = (v: string) => v === 'true' ? true : v === 'false' ? false : 'unknown';
      const smObj: Record<string, string> = {};
      (values.source_metadata_entries || []).forEach((e: { key: string; value: string }) => {
        if (e?.key) smObj[e.key] = e.value;
      });

      const data: Record<string, unknown> = {
        course_code: values.course_code,
        course_name: values.course_name,
        department: values.department,
        ects: values.ects,
        level: values.level,
        semester: values.semester,
        language: values.language,
        content: values.content,
        learning_outcomes: values.learning_outcomes,
        academic_context: {
          primary_format: values.primary_format || [],
          assessment_mode: values.assessment_mode || [],
          lab_status: triState(values.lab_status),
          project_status: triState(values.project_status),
          seminar_status: triState(values.seminar_status),
          special_tags: values.special_tags || [],
        },
        metadata_quality: {
          content_available: values.content_available,
          outcomes_available: values.outcomes_available,
          format_confidence: values.format_confidence,
        },
        source_metadata: smObj,
        warnings: values.warnings || [],
        is_active: values.is_active,
      };
      updateMutation.mutate({ id: editingCourse!.id, data });
    });
  };

  const triStateOptions = [
    { value: 'true', label: t('courseTable.options.yes') },
    { value: 'false', label: t('courseTable.options.no') },
    { value: 'unknown', label: t('courseTable.options.unknown') },
  ];

  const columns = [
    {
      title: t('courseTable.columns.status'),
      dataIndex: 'is_active',
      key: 'status',
      width: 80,
      align: 'center' as const,
      render: (active: boolean) => (
        <Tag color={active ? 'success' : 'default'} style={{ fontSize: 10, fontWeight: 700 }}>
          {active ? t('courseTable.status.active') : t('courseTable.status.inactive')}
        </Tag>
      ),
    },
    {
      title: t('courseTable.columns.course'),
      dataIndex: 'course_name',
      key: 'course_name',
      width: 300,
      render: (name: string, record: Course) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13, color: '#1a1a1a', lineHeight: 1.3 }}>
            {name}
          </div>
          {record.course_code && record.course_code !== 'unknown' && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#999',
              marginTop: 1,
              display: 'inline-block',
            }}>
              {record.course_code}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('courseTable.columns.university'),
      dataIndex: 'university_name',
      key: 'university_name',
      width: 180,
      ellipsis: true,
      render: (v: string | null) => (
        <span style={{ fontSize: 12, color: '#555' }}>
          {v || '—'}
        </span>
      ),
    },
    {
      title: t('courseTable.columns.ects'),
      dataIndex: 'ects',
      key: 'ects',
      width: 60,
      align: 'center' as const,
      render: (v: number | null) => (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          fontSize: 13,
          color: v ? '#1a1a1a' : '#bfbfbf',
        }}>
          {v ?? '—'}
        </span>
      ),
    },
    {
      title: t('courseTable.columns.semester'),
      dataIndex: 'semester',
      key: 'semester',
      width: 85,
      render: (v: string | null) => {
        if (!v || v === 'unknown') return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <Tag style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: 0,
          }}>
            {v.toLowerCase() === 'fall' ? t('courseTable.options.fall') : 
             v.toLowerCase() === 'spring' ? t('courseTable.options.spring') : 
             v.toLowerCase() === 'unknown' ? t('courseTable.options.unknown') : v}
          </Tag>
        );
      },
    },
    {
      title: t('courseTable.columns.level'),
      dataIndex: 'level',
      key: 'level',
      width: 80,
      render: (v: string | null) => {
        if (!v || v === 'unknown') return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <span style={{ fontSize: 12, color: '#555', textTransform: 'capitalize' as const }}>
            {v}
          </span>
        );
      },
    },
    {
      title: t('courseTable.columns.language'),
      dataIndex: 'language',
      key: 'language',
      width: 80,
      render: (v: string | null) => {
        if (!v || v === 'unknown') return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <span style={{ fontSize: 12, color: '#555' }}>
            <GlobalOutlined style={{ marginRight: 4, fontSize: 11 }} />
            {v}
          </span>
        );
      },
    },
    {
      title: t('courseTable.columns.department'),
      dataIndex: 'department',
      key: 'department',
      width: 150,
      ellipsis: true,
      render: (v: string | null) => {
        if (!v || v === 'unknown') return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <Tooltip title={v}>
            <span style={{ fontSize: 12, color: '#555' }}>{v}</span>
          </Tooltip>
        );
      },
    },
    {
      title: t('courseTable.columns.quality'),
      key: 'quality',
      width: 75,
      align: 'center' as const,
      render: (_: unknown, record: Course) => {
        const confidence = record.metadata_quality?.format_confidence;
        if (!confidence) return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <span style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: qualityColor[confidence],
            background: qualityBg[confidence],
          }}>
            {t(`courseTable.options.${confidence}`)}
          </span>
        );
      },
    },
    {
      title: '',
      key: 'warnings',
      width: 45,
      align: 'center' as const,
      render: (_: unknown, record: Course) => {
        const count = record.warnings?.length || 0;
        if (count === 0) return null;
        return (
          <Tooltip title={record.warnings.join(' | ')}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              color: '#fa8c16',
              fontSize: 12,
            }}>
              <WarningOutlined />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{count}</span>
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <ConfigProvider locale={currentLocale}>
      <>
        <Table
        columns={columns}
        dataSource={courses}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 900 }}
        pagination={
          onPageChange
            ? {
                current: page,
                pageSize,
                total: total || courses.length,
                onChange: onPageChange,
                showSizeChanger: true,
                size: 'small',
                showTotal: (total) => (
                  <span style={{ fontSize: 12, color: '#999' }}>
                    {t('courseTable.pagination.total', { count: total, total })}
                  </span>
                ),
                locale: {
                  ...currentLocale.Pagination,
                  items_per_page: `/ ${i18n.language === 'tr' ? 'sayfa' : 'page'}`,
                  jump_to: i18n.language === 'tr' ? 'Git' : 'Go to',
                  page: '',
                },
              }
            : { 
                pageSize: 50, 
                showSizeChanger: true, 
                size: 'small',
                showTotal: (total) => (
                  <span style={{ fontSize: 12, color: '#999' }}>
                    {t('courseTable.pagination.total', { count: total, total })}
                  </span>
                ),
                locale: {
                  ...currentLocale.Pagination,
                  items_per_page: `/ ${i18n.language === 'tr' ? 'sayfa' : 'page'}`,
                  jump_to: i18n.language === 'tr' ? 'Git' : 'Go to',
                  page: '',
                },
              }
        }
        expandable={{
          expandedRowRender: (record: Course) => (
            <div style={{
              padding: '16px 8px',
              maxWidth: 1000,
            }}>
            {/* Edit & Delete Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 8 }}>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
                {t('courseTable.actions.edit')}
              </Button>
              <Popconfirm
                title={t('courseTable.actions.deleteConfirm')}
                description={t('courseTable.actions.deleteDesc')}
                onConfirm={() => deleteMutation.mutate(record.id)}
                okText={t('courseTable.actions.delete')}
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  {t('courseTable.actions.delete')}
                </Button>
              </Popconfirm>
            </div>

            {/* Basic Info Grid */}
            <SectionLabel>{t('courseTable.details.basicInfo')}</SectionLabel>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2, md: 3 }}
              bordered
              style={{ marginBottom: 16 }}
              labelStyle={{ fontSize: 12, fontWeight: 500, color: '#666', width: 140 }}
              contentStyle={{ fontSize: 12 }}
            >
              <Descriptions.Item label={t('courseTable.details.courseCode')}>
                <FieldValue value={record.course_code} fallback={t('courseTable.options.unknown')} />
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.courseName')}>
                <span style={{ fontWeight: 500 }}>{record.course_name}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.department')}>
                <FieldValue value={record.department} fallback={t('courseTable.options.unknown')} />
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.ects')}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {record.ects ?? <span style={{ color: '#bfbfbf' }}>—</span>}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.level')}>
                <FieldValue value={record.level} fallback={t('courseTable.options.unknown')} />
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.semester')}>
                <FieldValue value={record.semester} fallback={t('courseTable.options.unknown')} />
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.language')}>
                <FieldValue value={record.language} fallback={t('courseTable.options.unknown')} />
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.universityId')}>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#999' }}>
                  {record.university_id}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label={t('courseTable.details.batchId')}>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#999' }}>
                  {record.ingestion_batch_id ?? '—'}
                </span>
              </Descriptions.Item>
            </Descriptions>

            {/* Content */}
            <Divider style={{ margin: '12px 0' }} />
            <SectionLabel>
              <FileTextOutlined style={{ marginRight: 4 }} />
              {t('courseTable.details.content')}
            </SectionLabel>
            <div style={{
              padding: '10px 14px',
              background: record.content && record.content !== 'unknown' ? '#fafafa' : '#fff',
              borderRadius: 6,
              border: '1px solid #f0f0f0',
              marginBottom: 16,
            }}>
              <Paragraph style={{
                fontSize: 13,
                lineHeight: 1.7,
                color: record.content && record.content !== 'unknown' ? '#333' : '#bfbfbf',
                margin: 0,
                whiteSpace: 'pre-wrap',
              }}>
                {record.content && record.content !== 'unknown' ? record.content : 'Not available'}
              </Paragraph>
            </div>

            {/* Learning Outcomes */}
            <SectionLabel>
              <BookOutlined style={{ marginRight: 4 }} />
              {t('courseTable.details.outcomes')}
            </SectionLabel>
            <div style={{
              padding: '10px 14px',
              background: record.learning_outcomes && record.learning_outcomes !== 'unknown' ? '#fafafa' : '#fff',
              borderRadius: 6,
              border: '1px solid #f0f0f0',
              marginBottom: 16,
            }}>
              <Paragraph style={{
                fontSize: 13,
                lineHeight: 1.7,
                color: record.learning_outcomes && record.learning_outcomes !== 'unknown' ? '#333' : '#bfbfbf',
                margin: 0,
                whiteSpace: 'pre-wrap',
              }}>
                {record.learning_outcomes && record.learning_outcomes !== 'unknown' ? record.learning_outcomes : 'Not available'}
              </Paragraph>
            </div>

            {/* Academic Context */}
            <Divider style={{ margin: '12px 0' }} />
            <SectionLabel>
              <ExperimentOutlined style={{ marginRight: 4 }} />
              {t('courseTable.details.academicContext')}
            </SectionLabel>
            {record.academic_context ? (
              <div style={{ marginBottom: 16 }}>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2, md: 3 }}
                  bordered
                  style={{ marginBottom: 12 }}
                  labelStyle={{ fontSize: 12, fontWeight: 500, color: '#666', width: 140 }}
                  contentStyle={{ fontSize: 12 }}
                >
                  <Descriptions.Item label={t('courseTable.details.primaryFormat')}>
                    {(() => {
                      const fmt = record.academic_context.primary_format;
                      const items = Array.isArray(fmt) ? fmt : (fmt ? [fmt] : ['unknown']);
                      return items.map((f, i) => (
                        <Tag key={i} color="blue" style={{ margin: '0 4px 2px 0', fontSize: 11 }}>{f}</Tag>
                      ));
                    })()}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('courseTable.details.assessmentMode')}>
                    {(() => {
                      const am = record.academic_context.assessment_mode;
                      const items = Array.isArray(am) ? am : (am ? [am] : ['unknown']);
                      return items.map((m, i) => (
                        <Tag key={i} color="purple" style={{ margin: '0 4px 2px 0', fontSize: 11 }}>{m}</Tag>
                      ));
                    })()}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('courseTable.details.specialTags')}>
                    {record.academic_context.special_tags?.length > 0
                      ? record.academic_context.special_tags.map((tag, i) => (
                          <Tag key={i} style={{ margin: '0 4px 2px 0', fontSize: 11 }}>{tag}</Tag>
                        ))
                      : <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>{t('courseTable.details.none')}</span>
                    }
                  </Descriptions.Item>
                </Descriptions>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <StatusDot value={record.academic_context.lab_status} label={t('courseTable.details.lab')} />
                  <StatusDot value={record.academic_context.project_status} label={t('courseTable.details.project')} />
                  <StatusDot value={record.academic_context.seminar_status} label={t('courseTable.details.seminar')} />
                </div>
              </div>
            ) : (
              <div style={{ color: '#bfbfbf', fontStyle: 'italic', marginBottom: 16 }}>
                {t('courseTable.details.noAcademicData')}
              </div>
            )}

            {/* Metadata Quality */}
            <Divider style={{ margin: '12px 0' }} />
            <SectionLabel>{t('courseTable.details.metadataQuality')}</SectionLabel>
            {record.metadata_quality ? (
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 3 }}
                bordered
                style={{ marginBottom: 16 }}
                labelStyle={{ fontSize: 12, fontWeight: 500, color: '#666', width: 160 }}
                contentStyle={{ fontSize: 12 }}
              >
                <Descriptions.Item label={t('courseTable.details.contentAvailable')}>
                  {record.metadata_quality.content_available
                    ? <Tag color="green" style={{ margin: 0 }}>{t('courseTable.options.yes')}</Tag>
                    : <Tag color="red" style={{ margin: 0 }}>{t('courseTable.options.no')}</Tag>
                  }
                </Descriptions.Item>
                <Descriptions.Item label={t('courseTable.details.outcomesAvailable')}>
                  {record.metadata_quality.outcomes_available
                    ? <Tag color="green" style={{ margin: 0 }}>{t('courseTable.options.yes')}</Tag>
                    : <Tag color="red" style={{ margin: 0 }}>{t('courseTable.options.no')}</Tag>
                  }
                </Descriptions.Item>
                <Descriptions.Item label={t('courseTable.details.formatConfidence')}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: qualityColor[record.metadata_quality.format_confidence],
                    background: qualityBg[record.metadata_quality.format_confidence],
                  }}>
                    {record.metadata_quality.format_confidence}
                  </span>
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <div style={{ color: '#bfbfbf', fontStyle: 'italic', marginBottom: 16 }}>
                {t('courseTable.details.noQualityData')}
              </div>
            )}

            {/* Source Metadata */}
            {record.source_metadata && Object.keys(record.source_metadata).length > 0 && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <SectionLabel>{t('courseTable.details.sourceMetadata')}</SectionLabel>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  bordered
                  style={{ marginBottom: 16 }}
                  labelStyle={{ fontSize: 12, fontWeight: 500, color: '#666', width: 140 }}
                  contentStyle={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
                >
                  {Object.entries(record.source_metadata).map(([key, val]) => (
                    <Descriptions.Item key={key} label={key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}>
                      {key === 'pdf_filename' && val ? (
                        <a
                          href={`http://localhost:8000/uploads/${record.university_id}/${record.semester || 'unknown'}/${val}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#c0392b', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          {String(val)} <LinkOutlined style={{ fontSize: 11 }} />
                        </a>
                      ) : val === null || val === undefined
                        ? <span style={{ color: '#bfbfbf' }}>—</span>
                        : typeof val === 'object'
                          ? <span style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(val)}</span>
                          : String(val)
                      }
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </>
            )}

            {/* Warnings */}
            {record.warnings?.length > 0 && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <SectionLabel>
                  <WarningOutlined style={{ marginRight: 4, color: '#fa8c16' }} />
                  {t('courseTable.details.warnings')} ({record.warnings.length})
                </SectionLabel>
                <div style={{
                  padding: '10px 14px',
                  background: '#fffbe6',
                  borderRadius: 6,
                  border: '1px solid #ffe58f',
                }}>
                  {record.warnings.map((w, i) => (
                    <div key={i} style={{
                      fontSize: 12,
                      color: '#ad6800',
                      lineHeight: 1.8,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                    }}>
                      <span style={{ color: '#d48806', flexShrink: 0 }}>•</span>
                      {w}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Created At */}
            {record.created_at && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#bfbfbf', textAlign: 'right' }}>
                {t('courseTable.details.parsedAt', { date: new Date(record.created_at).toLocaleString() })}
              </div>
            )}
          </div>
        ),
      }}
    />

    {/* Course Edit Modal */}
    <Modal
      title={t('courseTable.editModal.title', { name: editingCourse?.course_name || '' })}
      open={!!editingCourse}
      onCancel={() => setEditingCourse(null)}
      onOk={handleEditSubmit}
      confirmLoading={updateMutation.isPending}
      width={700}
      styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
    >
      <Form form={editForm} layout="vertical" style={{ marginTop: 12 }}>
        <Tabs items={[
          {
            key: 'basic',
            label: t('courseTable.editModal.tabs.basic'),
            children: (
              <>
                <Form.Item name="course_name" label={t('courseTable.editModal.form.courseName')} rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="course_code" label={t('courseTable.editModal.form.courseCode')} style={{ width: '50%' }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="ects" label={t('courseTable.editModal.form.ects')} style={{ width: '50%' }}>
                    <InputNumber style={{ width: '100%' }} min={0} max={30} />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name="department" label={t('courseTable.editModal.form.department')}>
                  <Input />
                </Form.Item>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="level" label={t('courseTable.editModal.form.level')} style={{ width: '33%' }}>
                    <Select options={[
                      { value: 'bachelor', label: t('courseTable.options.bachelor') },
                      { value: 'master', label: t('courseTable.options.master') },
                      { value: 'unknown', label: t('courseTable.options.unknown') },
                    ]} />
                  </Form.Item>
                  <Form.Item name="semester" label={t('courseTable.editModal.form.semester')} style={{ width: '33%' }}>
                    <Select options={[
                      { value: 'fall', label: t('courseTable.options.fall') },
                      { value: 'spring', label: t('courseTable.options.spring') },
                      { value: 'both', label: t('courseTable.options.both') },
                      { value: 'unknown', label: t('courseTable.options.unknown') },
                    ]} />
                  </Form.Item>
                  <Form.Item name="language" label={t('courseTable.editModal.form.language')} style={{ width: '34%' }}>
                    <Input />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name="is_active" label={t('courseTable.editModal.form.activeStatus')} valuePropName="checked">
                  <Switch checkedChildren={t('courseTable.status.active')} unCheckedChildren={t('courseTable.status.inactive')} />
                </Form.Item>
              </>
            ),
          },
          {
            key: 'content',
            label: t('courseTable.editModal.tabs.content'),
            children: (
              <>
                <Form.Item name="content" label={t('courseTable.editModal.form.description')}>
                  <Input.TextArea rows={8} />
                </Form.Item>
                <Form.Item name="learning_outcomes" label={t('courseTable.editModal.form.outcomes')}>
                  <Input.TextArea rows={8} />
                </Form.Item>
              </>
            ),
          },
          {
            key: 'academic',
            label: t('courseTable.editModal.tabs.academic'),
            children: (
              <>
                <Form.Item name="primary_format" label={t('courseTable.editModal.form.primaryFormat')}>
                  <Select mode="tags" placeholder="e.g. lecture, tutorial, lab" />
                </Form.Item>
                <Form.Item name="assessment_mode" label={t('courseTable.editModal.form.assessmentMode')}>
                  <Select mode="tags" placeholder="e.g. exam, project, presentation" />
                </Form.Item>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="lab_status" label={t('courseTable.editModal.form.lab')} style={{ width: '33%' }}>
                    <Select options={triStateOptions} />
                  </Form.Item>
                  <Form.Item name="project_status" label={t('courseTable.editModal.form.project')} style={{ width: '33%' }}>
                    <Select options={triStateOptions} />
                  </Form.Item>
                  <Form.Item name="seminar_status" label={t('courseTable.editModal.form.seminar')} style={{ width: '34%' }}>
                    <Select options={triStateOptions} />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name="special_tags" label={t('courseTable.editModal.form.specialTags')}>
                  <Select mode="tags" placeholder="Add tags" />
                </Form.Item>
              </>
            ),
          },
          {
            key: 'quality',
            label: t('courseTable.columns.quality'),
            children: (
              <>
                <Form.Item name="content_available" label={t('courseTable.details.contentAvailable')} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name="outcomes_available" label={t('courseTable.details.outcomesAvailable')} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name="format_confidence" label={t('courseTable.details.formatConfidence')}>
                  <Select options={[
                    { value: 'high', label: 'High' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low', label: 'Low' },
                  ]} />
                </Form.Item>
              </>
            ),
          },
          {
            key: 'source',
            label: t('courseTable.details.sourceMetadata'),
            children: (
              <Form.List name="source_metadata_entries">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name }) => (
                      <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                        <Form.Item name={[name, 'key']} style={{ marginBottom: 0 }}>
                          <Input placeholder="Key" style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item name={[name, 'value']} style={{ marginBottom: 0 }}>
                          <Input placeholder="Value" style={{ width: 340 }} />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} style={{ width: '100%' }}>
                      {t('sidebar.navLabel') === 'NAVİGASYON' ? 'Alan Ekle' : 'Add Field'}
                    </Button>
                  </>
                )}
              </Form.List>
            ),
          },
          {
            key: 'warnings',
            label: t('courseTable.details.warnings'),
            children: (
              <Form.List name="warnings">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name }) => (
                      <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                        <Form.Item name={name} style={{ marginBottom: 0, flex: 1 }}>
                          <Input placeholder="Warning text" style={{ width: 500 }} />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} style={{ width: '100%' }}>
                      {t('sidebar.navLabel') === 'NAVİGASYON' ? 'Uyarı Ekle' : 'Add Warning'}
                    </Button>
                  </>
                )}
              </Form.List>
            ),
          },
        ]} />
      </Form>
    </Modal>
    </>
    </ConfigProvider>
  );
}
