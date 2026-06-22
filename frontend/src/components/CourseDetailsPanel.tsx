import { useState } from 'react';
import { Descriptions, Tag, Alert, Typography, Space, Spin, Modal, Button } from 'antd';
import { WarningOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCourse } from '../api/client';

const { Text, Title } = Typography;

interface Props {
  courseId: number;
  label: string;
  icon?: React.ReactNode;
  columns?: 1 | 2;
  variant?: 'tag' | 'button';
  alwaysOpen?: boolean;
}

export default function CourseDetailsPanel({ courseId, label, icon, columns = 1, variant = 'tag', alwaysOpen = false }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(alwaysOpen);

  const { data: course, isLoading } = useQuery({
    queryKey: ['course-detail', courseId],
    queryFn: () => getCourse(courseId),
    enabled: open || alwaysOpen,
    staleTime: Infinity,
  });

  const fmt = (val: unknown) => {
    if (val === null || val === undefined || val === '') return <Text type="secondary">—</Text>;
    if (typeof val === 'boolean') {
      return val 
        ? <Tag color="green">{t('courseDetails.options.yes')}</Tag> 
        : <Tag color="default">{t('courseDetails.options.no')}</Tag>;
    }
    if (val === 'unknown') return <Tag color="orange">{t('courseDetails.options.unknown')}</Tag>;
    if (Array.isArray(val)) {
      return val.length > 0 
        ? val.map(v => t(`courseDetails.values.${String(v).toLowerCase()}`, { defaultValue: String(v) })).join(', ') 
        : <Text type="secondary">—</Text>;
    }
    const str = String(val);
    return t(`courseDetails.values.${str.toLowerCase()}`, { defaultValue: str });
  };

  const renderSyllabus = () => {
    if (isLoading) return <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin tip={t('courseDetails.fetching')} /></div>;
    if (!course) return <Alert message={t('courseDetails.notFound')} type="error" />;

    return (
      <div style={{ maxHeight: alwaysOpen ? 'none' : '65vh', overflowY: 'auto', paddingRight: 8 }}>
        <Descriptions 
          bordered 
          size="small" 
          column={columns} 
          labelStyle={{ background: '#f8fafc', fontWeight: 600, color: '#475569', width: '120px' }}
          contentStyle={{ background: '#fff' }}
          style={{ marginBottom: 16 }}
        >
          <Descriptions.Item label={t('courseDetails.code')}>{course.course_code}</Descriptions.Item>
          <Descriptions.Item label={t('courseDetails.ects')}><Tag color="blue">{course.ects}</Tag></Descriptions.Item>
          <Descriptions.Item label={t('courseDetails.department')}>{course.department}</Descriptions.Item>
          <Descriptions.Item label={t('courseDetails.level')}>{course.level}</Descriptions.Item>
          <Descriptions.Item label={t('courseDetails.semester')}>{course.semester}</Descriptions.Item>
          <Descriptions.Item label={t('courseDetails.language')}>{course.language}</Descriptions.Item>
        </Descriptions>

        {course.academic_context && (
          <div style={{ marginBottom: 16 }}>
            <Title level={5} style={{ fontSize: 12, marginBottom: 8, color: '#1e293b' }}>{t('courseDetails.academicContext')}</Title>
            <Descriptions 
              bordered 
              size="small" 
              column={3}
              labelStyle={{ background: '#f8fafc', fontWeight: 600, color: '#475569' }}
            >
              <Descriptions.Item label={t('courseDetails.format')}>{fmt(course.academic_context.primary_format)}</Descriptions.Item>
              <Descriptions.Item label={t('courseDetails.assessment')}>{fmt(course.academic_context.assessment_mode)}</Descriptions.Item>
              <Descriptions.Item label={t('courseDetails.lab')}>{fmt(course.academic_context.lab_status)}</Descriptions.Item>
              <Descriptions.Item label={t('courseDetails.project')}>{fmt(course.academic_context.project_status)}</Descriptions.Item>
              <Descriptions.Item label={t('courseDetails.seminar')}>{fmt(course.academic_context.seminar_status)}</Descriptions.Item>
              {(course.academic_context.special_tags || []).length > 0 && (
                <Descriptions.Item label={t('courseDetails.tags')} span={3}>{(course.academic_context.special_tags as string[]).join(', ')}</Descriptions.Item>
              )}
            </Descriptions>
          </div>
        )}

        {course.content && (
          <div style={{ marginBottom: 16 }}>
            <Title level={5} style={{ fontSize: 12, marginBottom: 6, color: '#1e293b' }}>{t('courseDetails.content')}</Title>
            <div style={{ 
              padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
              fontSize: 12, lineHeight: 1.5, color: '#334155', whiteSpace: 'pre-wrap'
            }}>
              {course.content}
            </div>
          </div>
        )}

        {course.learning_outcomes && (
          <div style={{ marginBottom: 16 }}>
            <Title level={5} style={{ fontSize: 12, marginBottom: 6, color: '#1e293b' }}>{t('courseDetails.outcomes')}</Title>
            <div style={{ 
              padding: 12, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6,
              fontSize: 12, lineHeight: 1.5, color: '#0369a1', whiteSpace: 'pre-wrap'
            }}>
              {course.learning_outcomes}
            </div>
          </div>
        )}

        {course.warnings?.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {course.warnings.map((w: string, i: number) => (
              <Alert 
                key={i} 
                message={w} 
                type="warning" 
                showIcon
                icon={<WarningOutlined />}
                style={{ marginBottom: 6, borderRadius: 6, fontSize: 11 }} 
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (alwaysOpen) {
    return renderSyllabus();
  }

  const ModalHeader = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ padding: 8, background: '#e0f2fe', borderRadius: 8 }}>
        <FileTextOutlined style={{ color: '#0ea5e9' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, textTransform: 'uppercase' }}>{t('courseDetails.modalTitle')}</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{course?.course_name || (isLoading ? '...' : '')}</div>
      </div>
    </div>
  );

  if (variant === 'button') {
    return (
      <>
        <Button
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          icon={icon || <FileTextOutlined />}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            borderColor: '#d1d5db',
            color: '#4b5563',
            height: 'auto',
            padding: '4px 15px'
          }}
        >
          <span style={{ fontSize: 13 }}>{label}</span>
        </Button>
        <Modal
          title={<ModalHeader />}
          open={open}
          onCancel={() => setOpen(false)}
          footer={[
            <Button key="close" onClick={() => setOpen(false)} type="primary">{t('courseDetails.close')}</Button>
          ]}
          width={800}
          centered
          styles={{ body: { padding: '24px' } }}
        >
          {renderSyllabus()}
        </Modal>
      </>
    );
  }

  return (
    <>
      <div 
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: 6, 
          cursor: 'pointer',
          height: 28,
          width: 125,
          borderRadius: 6,
          transition: 'all 0.2s',
          background: '#f8fafc',
          border: '1px solid #e2e8f0'
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
        onMouseLeave={e => e.currentTarget.style.background = '#f8fafc'}
      >
        {icon || <FileTextOutlined style={{ fontSize: 10, color: '#64748b' }} />}
        <Text style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</Text>
      </div>

      <Modal
        title={<ModalHeader />}
        open={open}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="close" onClick={() => setOpen(false)} type="primary">{t('courseDetails.close')}</Button>
        ]}
        width={800}
        centered
        styles={{ body: { padding: '24px' } }}
      >
        {renderSyllabus()}
      </Modal>
    </>
  );
}
