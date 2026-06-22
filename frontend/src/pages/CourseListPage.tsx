import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Input, Select, Row, Col, Statistic, Modal, Tabs, Alert, Tag, Typography, Space, Table, Button, Tooltip } from 'antd';
import { BookOutlined, CheckCircleOutlined, WarningOutlined, BankOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { getUniversities, getAllCourses } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import CourseTable from '../components/CourseTable';
import { useTranslation } from 'react-i18next';

const { Search } = Input;
const { Text } = Typography;


// These will be translated inside the component using t()

function ParseInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const mono: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: 11.5,
    background: '#f6f8fa',
    border: '1px solid #e8e8e8',
    borderRadius: 6,
    padding: '12px 16px',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.6,
    display: 'block',
    overflowX: 'auto',
  };

  return (
    <Modal
      title={
        <Space>
          <InfoCircleOutlined style={{ color: '#1677ff' }} />
          <span>{t('courseList.infoModal.title')}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={780}
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '16px 24px' } }}
    >
      <Tabs
        size="small"
        items={[
          {
            key: 'pipeline',
            label: t('courseList.infoModal.tabs.pipeline'),
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message={t('courseList.infoModal.alerts.pipeline')}
                  style={{ marginBottom: 16 }}
                />

                {[
                  {
                    step: '1', color: '#1677ff',
                    title: t('courseList.infoModal.steps.step1.title'),
                    desc: t('courseList.infoModal.steps.step1.desc'),
                  },
                  {
                    step: '2', color: '#fa8c16',
                    title: t('courseList.infoModal.steps.step2.title'),
                    desc: t('courseList.infoModal.steps.step2.desc'),
                  },
                  {
                    step: '3', color: '#722ed1',
                    title: t('courseList.infoModal.steps.step3.title'),
                    desc: t('courseList.infoModal.steps.step3.desc'),
                  },
                  {
                    step: '4', color: '#52c41a',
                    title: t('courseList.infoModal.steps.step4.title'),
                    desc: t('courseList.infoModal.steps.step4.desc'),
                  },
                  {
                    step: '5', color: '#eb2f96',
                    title: t('courseList.infoModal.steps.step5.title'),
                    desc: t('courseList.infoModal.steps.step5.desc'),
                  },
                ].map(({ step, color, title, desc }) => (
                  <div key={step} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      minWidth: 28, height: 28, borderRadius: '50%',
                      background: color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13, flexShrink: 0,
                    }}>{step}</div>
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
            key: 'modes',
            label: t('courseList.infoModal.tabs.modes'),
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message={t('courseList.infoModal.alerts.modes')}
                  style={{ marginBottom: 16 }}
                />

                {[
                  {
                    mode: 'individual',
                    color: '#1677ff',
                    title: t('universities.form.structures.individual'),
                    unis: 'Karlsruhe, FHV, Kielce, Lodz, Bragança, Nysa, Ostrava, Milano, Pardubice, IKU',
                    desc: t('courseList.infoModal.modes.desc.individual'),
                  },
                  {
                    mode: 'consolidated',
                    color: '#52c41a',
                    title: t('universities.form.structures.consolidated'),
                    unis: 'Deggendorf, Brandenburg, Nürnberg',
                    desc: t('courseList.infoModal.modes.desc.consolidated'),
                  },
                  {
                    mode: 'category_based',
                    color: '#722ed1',
                    title: t('universities.form.structures.categoryBased'),
                    unis: 'İstanbul Kültür Üniversitesi',
                    desc: t('courseList.infoModal.modes.desc.category'),
                  },
                ].map(({ mode, color, title, unis, desc }) => (
                  <Card key={mode} size="small" style={{ marginBottom: 12, borderLeft: `3px solid ${color}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Tag color={color} style={{ fontFamily: 'monospace', fontSize: 11 }}>{mode}</Tag>
                      <Text strong style={{ fontSize: 13 }}>{title}</Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                      {t('courseList.infoModal.modes.unis')}: {unis}
                    </Text>
                    <Text style={{ fontSize: 12, lineHeight: 1.5 }}>{desc}</Text>
                  </Card>
                ))}
              </div>
            ),
          },
          {
            key: 'prompt',
            label: t('courseList.infoModal.tabs.prompt'),
            children: (
              <div>
                <Alert
                  type="warning"
                  showIcon
                  message={t('courseList.infoModal.alerts.prompt')}
                  style={{ marginBottom: 16 }}
                />

                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Key Extraction Fields</Text>
                <Table
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 16 }}
                  columns={[
                    { title: t('courseList.infoModal.promptTable.field'), dataIndex: 'field', key: 'field', width: 180 },
                    { title: t('courseList.infoModal.promptTable.type'), dataIndex: 'type', key: 'type', width: 100 },
                    { title: t('courseList.infoModal.promptTable.desc'), dataIndex: 'desc', key: 'desc' },
                  ]}
                  dataSource={[
                    { key: 1, field: 'course_name', type: 'string', desc: 'Full course name (English if multiple languages)' },
                    { key: 2, field: 'course_code', type: 'string', desc: 'Course identifier code' },
                    { key: 3, field: 'ects', type: 'number|null', desc: 'Credit value (1–30). Hours/workload values are filtered out.' },
                    { key: 4, field: 'level', type: 'enum', desc: '"bachelor" | "master" | "unknown"' },
                    { key: 5, field: 'language', type: 'string', desc: 'Teaching language' },
                    { key: 6, field: 'content', type: 'string', desc: 'Full course description + weekly plan if present' },
                    { key: 7, field: 'learning_outcomes', type: 'string', desc: 'Goals, objectives, competences — all mapped here' },
                    { key: 8, field: 'primary_format', type: 'list', desc: '["lecture", "lab", "seminar", ...] — never "mixed"' },
                    { key: 9, field: 'assessment_mode', type: 'list', desc: '["written_exam", "project", ...] — never "mixed"' },
                    { key: 10, field: 'lab/project/seminar_status', type: 'bool|"unknown"', desc: 'true/false/unknown based on explicit mention' },
                    { key: 11, field: 'detected_semester', type: 'enum', desc: '"fall" | "spring" | "both" | "unknown"' },
                    { key: 12, field: 'department', type: 'string', desc: 'Academic department or program' },
                  ]}
                />
                <Alert
                  type="info"
                  showIcon
                  message={
                    <span>
                      The full prompt template is in <code>parsing/prompts/course_extraction_prompt.txt</code>.
                      It instructs the LLM on how to handle ECTS extraction, broken PDF words, multi-language course names, and unknown values.
                    </span>
                  }
                />
              </div>
            ),
          },
          {
            key: 'quality',
            label: t('courseList.infoModal.tabs.quality'),
            children: (
              <div>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t('courseTable.expanded.qualityScore')}</Text>
                <Table
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 20 }}
                  columns={[
                    {
                      title: t('courseList.infoModal.qualityTable.level'), dataIndex: 'level', key: 'level', width: 80,
                      render: (v: string, r: any) => <Tag color={r.badge}>{v}</Tag>,
                    },
                    { title: t('courseList.infoModal.qualityTable.condition'), dataIndex: 'condition', key: 'condition' },
                    { title: t('courseList.infoModal.qualityTable.effect'), dataIndex: 'effect', key: 'effect' },
                  ]}
                  dataSource={[
                    { level: t('courseTable.options.high'), badge: 'green', condition: t('courseList.infoModal.qualityTable.conditions.high'), effect: t('courseList.infoModal.qualityTable.effects.high') },
                    { level: t('courseTable.options.medium'), badge: 'orange', condition: t('courseList.infoModal.qualityTable.conditions.medium'), effect: t('courseList.infoModal.qualityTable.effects.medium') },
                    { level: t('courseTable.options.low'), badge: 'red', condition: t('courseList.infoModal.qualityTable.conditions.low'), effect: t('courseList.infoModal.qualityTable.effects.low') },
                  ].map((r, i) => ({ ...r, key: i }))}
                />

                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                  {t('courseList.infoModal.warningTable.title')}
                </Text>
                <Alert
                  type="info"
                  showIcon
                  message={t('courseList.infoModal.alerts.warnings')}
                  style={{ marginBottom: 8 }}
                />
                <Table
                  size="small"
                  pagination={false}
                  columns={[
                    { title: t('courseList.infoModal.warningTable.trigger'), dataIndex: 'trigger', key: 'trigger' },
                    {
                      title: t('courseList.infoModal.warningTable.field'), dataIndex: 'field', key: 'field', width: 160,
                      render: (v: string) => <Tag style={{ fontFamily: 'monospace', fontSize: 10 }}>{v}</Tag>,
                    },
                  ]}
                  dataSource={[
                    { trigger: t('courseList.infoModal.warningTable.triggers.contentMissing'), field: 'content' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.contentShort'), field: 'content' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.outcomesMissing'), field: 'learning_outcomes' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.ectsIssue'), field: 'ects' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.codeMissing'), field: 'course_code' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.languageMissing'), field: 'language' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.deptMissing'), field: 'department' },
                    { trigger: t('courseList.infoModal.warningTable.triggers.academicMissing'), field: 'academic_context' },
                  ].map((r, i) => ({ ...r, key: i }))}
                />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}

export default function CourseListPage() {
  const { t } = useTranslation();
  const [infoOpen, setInfoOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [universityId, setUniversityId] = useState<number | undefined>();
  const [semester, setSemester] = useState<string | undefined>();
  const [quality, setQuality] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { activeDepartment } = useAuth();

  const { data: universities = [] } = useQuery({
    queryKey: ['universities', activeDepartment],
    queryFn: () => getUniversities(activeDepartment),
  });

  const { data: coursesData, isLoading } = useQuery({
    queryKey: ['all-courses', search, universityId, semester, quality, activeDepartment, page, pageSize],
    queryFn: () => getAllCourses({
      search: search || undefined,
      university_id: universityId,
      semester,
      quality,
      department: activeDepartment,
      skip: (page - 1) * pageSize,
      limit: pageSize,
    }),
  });

  const courses = coursesData?.courses || [];
  const stats = coursesData?.stats;
  const highQuality = stats?.high_quality ?? courses.filter(c => c.metadata_quality?.format_confidence === 'high').length;
  const withWarnings = stats?.with_warnings ?? courses.filter(c => c.warnings?.length > 0).length;
  const uniqueUniversities = stats?.universities ?? new Set(courses.map(c => c.university_id)).size;

  return (
    <div>
      {/* Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('courseList.stats.totalCourses')}</span>}
              value={coursesData?.total ?? 0}
              prefix={<BookOutlined style={{ color: '#c0392b' }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('courseList.stats.universities')}</span>}
              value={uniqueUniversities}
              prefix={<BankOutlined style={{ color: '#722ed1' }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('courseList.stats.highQuality')}</span>}
              value={highQuality}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={<span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#999' }}>{t('courseList.stats.withWarnings')}</span>}
              value={withWarnings}
              prefix={<WarningOutlined style={{ color: '#fa8c16' }} />}
              styles={{ content: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' } }}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters + Table */}
      <Card>
        <div className="filter-bar" style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: '1px solid #ededed',
          alignItems: 'center',
        }}>
          <Search
            placeholder={t('courseList.filters.searchPlaceholder')}
            onSearch={(val) => { setSearch(val); setPage(1); }}
            style={{ width: 240 }}
            allowClear
            size="middle"
          />
          <Select
            placeholder={t('courseList.filters.university')}
            style={{ width: 200 }}
            allowClear
            onChange={(val) => { setUniversityId(val); setPage(1); }}
            options={universities.map(u => ({ value: u.id, label: u.name }))}
            size="middle"
          />
          <Select
            placeholder={t('courseList.filters.semester')}
            style={{ width: 110 }}
            allowClear
            onChange={(val) => { setSemester(val); setPage(1); }}
            options={[
              { value: 'fall', label: t('courseTable.options.fall') },
              { value: 'spring', label: t('courseTable.options.spring') },
              { value: 'both', label: t('courseTable.options.both') },
              { value: 'unknown', label: t('courseTable.options.unknown') },
            ]}
            size="middle"
          />
          <Select
            placeholder={t('courseList.filters.quality')}
            style={{ width: 110 }}
            allowClear
            onChange={(val) => { setQuality(val); setPage(1); }}
            options={[
              { value: 'high', label: t('courseTable.options.high') },
              { value: 'medium', label: t('courseTable.options.medium') },
              { value: 'low', label: t('courseTable.options.low') },
            ]}
            size="middle"
          />
          <div style={{ marginLeft: 'auto' }}>
            <Tooltip title={t('courseList.filters.infoTooltip')}>
              <Button
                type="text"
                icon={<InfoCircleOutlined style={{ fontSize: 17, color: '#1677ff' }} />}
                onClick={() => setInfoOpen(true)}
              />
            </Tooltip>
          </div>
        </div>

        <CourseTable
          courses={courses}
          loading={isLoading}
          total={coursesData?.total}
          page={page}
          pageSize={pageSize}
          onPageChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
        />
      </Card>

      <ParseInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
