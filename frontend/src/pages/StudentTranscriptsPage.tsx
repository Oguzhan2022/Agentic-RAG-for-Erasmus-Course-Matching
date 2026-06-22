import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table, Button, Modal, Upload, Select, Input, Tag, Typography,
  message, Empty, Card, Space, List, Badge, Divider, Row, Col,
} from 'antd';
import { 
  UploadOutlined, FilePdfOutlined, InboxOutlined, EyeOutlined,
  FileExcelOutlined, BookOutlined, 
  SearchOutlined, DownloadOutlined, CheckCircleOutlined,
  ClockCircleOutlined, SwapOutlined, DeleteOutlined, EditOutlined
} from '@ant-design/icons';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// xlsx is lazy-loaded in export function
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { UploadFile } from 'antd/es/upload/interface';
import type { StudentTranscript, TranscriptGradeEntry, University } from '../types';
import { 
  getMyTranscripts, uploadTranscript, getUniversities, 
  getStudentApplications, getStudentApplication, getTranscript, getUniversityCourses,
  deleteTranscript
} from '../api/client';
import { TRANSCRIPT_STATUS_CONFIG } from '../constants/status';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface ExportRow {
  partnerCode: string;
  partnerName: string;
  partnerEcts: string | number;
  localGrade: string;
  ectsGrade: string;
  ikuGrade: string;
  homeCourseText: string;
  homeEcts: number;
}

export default function StudentTranscriptsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadUniId, setUploadUniId] = useState<number | null>(null);
  const [uploadAppId, setUploadAppId] = useState<number | null>(null);
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<number | null>(null);
  const [overviewVisible, setOverviewVisible] = useState(false);

  const { data: transcripts = [], isLoading } = useQuery({
    queryKey: ['my-transcripts'],
    queryFn: getMyTranscripts,
  });

  const { data: universities = [] } = useQuery({
    queryKey: ['universities-student-transcripts'],
    queryFn: () => getUniversities(null, true),
  });

  const { data: applications = [] } = useQuery({
    queryKey: ['student-applications'],
    queryFn: getStudentApplications,
  });

  const eligibleApps = applications.filter((app: any) => {
    if (app.status !== 'learning_agreement_ready') return false;
    const hasTranscript = transcripts.some((t: any) => t.application_id === app.id);
    return !hasTranscript;
  });

  // Only show universities that have courses (course_count > 0)
  const eligibleUniversities = universities.filter(
    (u: University) => !u.is_home && u.course_count && u.course_count > 0
  );

  // Auto-select from LA-ready application — use partner_university.id (nested)
  const laReadyApp = applications.find((app: any) => app.status === 'learning_agreement_ready');
  const autoUniId = laReadyApp?.partner_university?.id ?? laReadyApp?.partner_university_id ?? null;

  useEffect(() => {
    if (uploadOpen && eligibleApps.length > 0) {
      setUploadAppId(eligibleApps[0].id);
      setUploadUniId(eligibleApps[0].partner_university?.id ?? eligibleApps[0].partner_university_id ?? null);
    } else if (uploadOpen) {
      setUploadAppId(null);
      setUploadUniId(null);
    }
  }, [uploadOpen, eligibleApps]);

  const handleUpload = async () => {
    if (!uploadFile || !uploadUniId) {
      message.error(t('studentTranscripts.uploadModal.fileTooLarge'));
      return;
    }
    setUploading(true);
    try {
      const res = await uploadTranscript({
        partner_university_id: uploadUniId,
        application_id: uploadAppId,
        notes: uploadNotes || undefined,
        file: uploadFile,
      });
      message.success(t('studentTranscripts.uploadSuccess'));
      setUploadOpen(false);
      setUploadFile(null);
      setUploadAppId(null);
      setUploadNotes('');
      qc.invalidateQueries({ queryKey: ['my-transcripts'] });
      navigate(`/student-transcripts/${res.id}`);
    } catch (e: any) {
      message.error(e.response?.data?.detail || t('studentTranscripts.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTranscript(id);
      message.success(t('studentTranscripts.deleteSuccess'));
      qc.invalidateQueries({ queryKey: ['my-transcripts'] });
    } catch (e: any) {
      message.error(e.response?.data?.detail || t('studentTranscripts.deleteFailed'));
    }
  };

  const { data: transcriptDetail } = useQuery({
    queryKey: ['transcript-detail', selectedTranscriptId],
    queryFn: () => getTranscript(selectedTranscriptId!),
    enabled: !!selectedTranscriptId,
  });

  const { data: detailApplication } = useQuery({
    queryKey: ['transcript-app-detail', transcriptDetail?.application_id],
    queryFn: () => getStudentApplication(transcriptDetail!.application_id!),
    enabled: !!transcriptDetail?.application_id,
  });

  const homeUniversity = universities.find((u: University) => u.is_home);

  const { data: homeCoursesRes } = useQuery({
    queryKey: ['home-courses-detail', homeUniversity?.id],
    queryFn: () => getUniversityCourses(homeUniversity!.id, { limit: 1000 }),
    enabled: !!homeUniversity && !!transcriptDetail,
  });

  const handleShowGrades = (id: number) => {
    setSelectedTranscriptId(id);
    setOverviewVisible(true);
  };

  const getExportData = (detail: any = transcriptDetail, appDetail: any = detailApplication): ExportRow[] => {
    if (!detail?.grade_entries) return [];
    
    return detail.grade_entries.map((e: TranscriptGradeEntry) => {
      const matchingSelection = appDetail?.selections?.find((s: any) => 
        s.partner_course_id === e.partner_course_id || 
        (e.partner_course_code && s.partner_course?.course_code === e.partner_course_code) ||
        (s.partner_course?.course_name === e.partner_course_name)
      );

      const isOverridden = matchingSelection && (matchingSelection.coordinator_override_courses?.length || 0) > 0;
      
      const mappedCourses = (e.mapped_home_course_ids && e.mapped_home_course_ids.length > 0)
        ? homeCoursesRes?.courses?.filter((c: any) => e.mapped_home_course_ids!.includes(c.id))
        : null;

      const homeCourses = mappedCourses && mappedCourses.length > 0
        ? mappedCourses
        : (matchingSelection 
          ? (isOverridden ? matchingSelection.coordinator_override_courses : (matchingSelection.selected_home_course ? [matchingSelection.selected_home_course] : []))
          : null);

      const homeCourseText = homeCourses && homeCourses.length > 0
        ? homeCourses.map((c: any) => `${c.course_code || ''} ${c.course_name}`).join(', ')
        : 'N/A';

      const homeEcts = homeCourses && homeCourses.length > 0
        ? homeCourses.reduce((sum: number, c: any) => sum + (c.ects || 0), 0)
        : 0;

      return {
        partnerCode: e.partner_course_code || '-',
        partnerName: e.partner_course_name,
        partnerEcts: e.partner_ects || '-',
        localGrade: e.local_grade || '-',
        ectsGrade: e.ects_grade || '-',
        ikuGrade: e.iku_grade || '-',
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

  const handleExportPDF = (detail: any = transcriptDetail, appDetail: any = detailApplication) => {
    if (!detail) return;
    const doc = new jsPDF('landscape');
    doc.setFontSize(16);
    doc.text(sanitizeForPDF(`Transcript Overview - ${detail.student_name || detail.student_eid}`), 14, 15);
    doc.setFontSize(12);
    doc.text(sanitizeForPDF(`Partner University: ${detail.partner_university_name}`), 14, 22);
    
    const tableData = getExportData(detail, appDetail).map((r: ExportRow) => [
      sanitizeForPDF(r.partnerCode), sanitizeForPDF(r.partnerName), sanitizeForPDF(r.partnerEcts), sanitizeForPDF(r.localGrade), sanitizeForPDF(r.ectsGrade), 
      sanitizeForPDF(r.homeCourseText), sanitizeForPDF(r.homeEcts), sanitizeForPDF(r.ikuGrade)
    ]);

    autoTable(doc, {
      startY: 30,
      head: [['Partner Code', 'Partner Course', 'Partner ECTS', 'Local Grade', 'ECTS Grade', 'Home Course(s)', 'Home ECTS', 'IKU Grade']],
      body: tableData,
    });

    doc.save(`${detail.student_eid || 'student'}_transcript_overview.pdf`);
  };

  const handleExportXLSX = async (detail: any = transcriptDetail, appDetail: any = detailApplication) => {
    if (!detail) return;
    const XLSX = await import('xlsx');
    const data = getExportData(detail, appDetail).map((r: ExportRow) => ({
      'Partner Code': r.partnerCode,
      'Partner Course': r.partnerName,
      'Partner ECTS': r.partnerEcts,
      'Local Grade': r.localGrade,
      'ECTS Grade': r.ectsGrade,
      'Home Course(s)': r.homeCourseText,
      'Home ECTS': r.homeEcts,
      'IKU Grade': r.ikuGrade,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transcript Overview");
    XLSX.writeFile(wb, `${detail.student_eid || 'student'}_transcript_overview.xlsx`);
  };

  const columns = [
    {
      title: 'Partner University',
      dataIndex: 'partner_university_name',
      key: 'uni',
    },
    {
      title: 'File',
      dataIndex: 'original_filename',
      key: 'file',
      ellipsis: true,
      render: (name: string, t: StudentTranscript) => (
        t.file_path ? (
          <a href={t.file_path} target="_blank" rel="noopener noreferrer">
            <FilePdfOutlined /> {name}
          </a>
        ) : name
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const cfg = TRANSCRIPT_STATUS_CONFIG[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{t(cfg.label)}</Tag>;
      },
    },
    {
      title: 'Uploaded',
      dataIndex: 'created_at',
      key: 'date',
      render: (d: string) => d ? new Date(d).toLocaleDateString() : '-',
    },
    {
      title: '',
      key: 'action',
      width: 150,
      render: (_: any, t: StudentTranscript) => (
        <Space>
          {t.file_path && (
            <Button type="default" size="small" icon={<EyeOutlined />} href={t.file_path} target="_blank">
              PDF
            </Button>
          )}
          {t.status === 'finalized' && (
            <Button type="primary" size="small" icon={<FilePdfOutlined />} onClick={() => handleShowGrades(t.id)}>
              See Grades
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      
      {/* ── Welcome Banner ── */}
      <Card
        style={{
          marginBottom: 20,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 100%)',
          border: 'none',
        }}
        styles={{ body: { padding: '20px 24px' } }}
      >
        <div className="transcript-welcome" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text style={{ color: '#aaa', fontSize: 12, display: 'block', marginBottom: 4 }}>
              {t('studentTranscripts.headerLabel')}
            </Text>
            <Title level={4} style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
              {t('studentTranscripts.title')}
            </Title>
            <Text style={{ color: '#888', fontSize: 12 }}>
              {t('studentTranscripts.subtitle')}
            </Text>
          </div>
          <Button
            className="transcript-welcome-btn"
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setUploadOpen(true)}
            style={{ fontWeight: 600, background: '#c0392b', borderColor: '#c0392b', borderRadius: 8 }}
          >
            {t('studentTranscripts.uploadBtn')}
          </Button>
        </div>
      </Card>

      {/* Transcript Cards */}
      <Row gutter={[16, 16]}>
        {transcripts.length === 0 && !isLoading && (
          <Col span={24}>
            <Card style={{ borderRadius: 10, textAlign: 'center', padding: '60px 24px' }}>
              <Empty description={t('studentTranscripts.emptyState')}>
                <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
                  {t('studentTranscripts.uploadPdf')}
                </Button>
              </Empty>
            </Card>
          </Col>
        )}
        {transcripts.map((tr: StudentTranscript) => (
          <Col span={24} key={tr.id}>
            <Card
              hoverable
              style={{ borderRadius: 10, border: '1px solid #e8e8e8' }}
              styles={{ body: { padding: '16px 20px' } }}
              actions={[
                <Button 
                  type="link" 
                  icon={['uploaded', 'student_grading'].includes(tr.status) ? <EditOutlined /> : <EyeOutlined />} 
                  onClick={() => navigate(`/student-transcripts/${tr.id}`)}
                  style={{ color: '#595959', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}
                >
                  {['uploaded', 'student_grading'].includes(tr.status) ? t('studentTranscripts.enterGrades') : t('studentTranscripts.viewGrades')}
                </Button>,
                tr.file_path && (
                  <Button 
                    type="link" 
                    icon={<EyeOutlined />} 
                    onClick={() => window.open(tr.file_path!, '_blank')}
                    style={{ color: '#8c8c8c', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}
                  >
                    {t('studentTranscripts.originalPdf')}
                  </Button>
                ),
                tr.status === 'uploaded' && (
                  <Button 
                    type="link" 
                    danger
                    icon={<DeleteOutlined />} 
                    style={{ fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}
                    onClick={() => {
                      Modal.confirm({
                        title: t('studentTranscripts.deleteTitle'),
                        content: t('studentTranscripts.deleteContent'),
                        okText: t('studentTranscripts.deleteConfirm'),
                        okButtonProps: { danger: true },
                        onOk: () => handleDelete(tr.id),
                      });
                    }}
                  >
                    {t('studentTranscripts.delete')}
                  </Button>
                ),
              ].filter(Boolean) as any}
            >
              <Row justify="space-between" align="middle">
                <Col>
                  <Space size={8} align="center" style={{ marginBottom: 4 }}>
                    <FilePdfOutlined style={{ color: '#1677ff' }} />
                    <Text strong style={{ fontSize: 16 }}>{tr.partner_university_name}</Text>
                  </Space>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {tr.semester && (
                      <Tag color="purple">
                        {tr.semester === 'fall' ? t('studentDashboard.fallSemester') : t('studentDashboard.springSemester')}
                      </Tag>
                    )}
                    <Tag>{tr.original_filename}</Tag>
                    <Tag icon={<ClockCircleOutlined />}>
                      {tr.created_at ? new Date(tr.created_at).toLocaleDateString() : '-'}
                    </Tag>
                  </div>
                </Col>
                <Col style={{ textAlign: 'right' }}>
                  <Tag color={(TRANSCRIPT_STATUS_CONFIG[tr.status] || {}).color || 'default'} style={{ borderRadius: 4, padding: '0 8px' }}>
                    {t((TRANSCRIPT_STATUS_CONFIG[tr.status] || {}).label || tr.status)}
                  </Tag>
                </Col>
              </Row>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Overview Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOutlined style={{ color: '#722ed1' }} />
            <span>{t('studentTranscripts.overviewTitle')}</span>
          </div>
        }
        open={overviewVisible}
        onCancel={() => setOverviewVisible(false)}
        footer={[
          <Button key="pdf" icon={<FilePdfOutlined />} onClick={handleExportPDF}>
            {t('studentTranscripts.exportPdf')}
          </Button>,
          <Button key="xlsx" icon={<FileExcelOutlined />} onClick={handleExportXLSX}>
            {t('studentTranscripts.exportExcel')}
          </Button>,
          <Button key="close" type="primary" onClick={() => setOverviewVisible(false)} style={{ background: '#333', borderColor: '#333' }}>
            {t('studentTranscripts.close')}
          </Button>
        ]}
        width={900}
        style={{ top: 40 }}
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            {t('studentTranscripts.overviewDesc')}
          </Text>
        </div>
        <Table
          dataSource={getExportData()}
          pagination={false}
          size="middle"
          rowKey="partnerCode"
          bordered
          columns={[
            { title: 'Code', dataIndex: 'partnerCode', key: 'code', width: 100 },
            { title: 'Partner Course', dataIndex: 'partnerName', key: 'name' },
            { title: 'ECTS', dataIndex: 'partnerEcts', key: 'ects', width: 70, align: 'center' },
            { title: 'Local Grade', dataIndex: 'localGrade', key: 'local', width: 100, align: 'center' },
            { title: 'IKU Grade', dataIndex: 'ikuGrade', key: 'iku', width: 100, align: 'center', render: (g) => <Tag color="blue" style={{ fontWeight: 600 }}>{g}</Tag> },
            { 
              title: 'Matched Home Course(s)', 
              dataIndex: 'homeCourseText', 
              key: 'home',
              render: (text) => <Text style={{ fontSize: 13 }}>{text}</Text>
            },
          ]}
        />
      </Modal>

      <Modal
        title={t('studentTranscripts.uploadModal.title')}
        open={uploadOpen}
        onOk={handleUpload}
        onCancel={() => { setUploadOpen(false); setUploadFile(null); setUploadNotes(''); }}
        confirmLoading={uploading}
        okText={t('studentTranscripts.uploadModal.upload')}
        okButtonProps={{ disabled: !uploadFile || eligibleApps.length === 0 }}
      >
        {eligibleApps.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <Empty description={t('studentTranscripts.uploadModal.allUploaded', 'Tüm aktif başvurularınız için transkript yüklenmiştir.')} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Text strong>{t('studentTranscripts.uploadModal.partnerUni')}</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                placeholder={t('studentTranscripts.uploadModal.selectPartnerUni')}
                value={uploadAppId}
                onChange={(val) => {
                  setUploadAppId(val);
                  const selectedApp = applications.find((app: any) => app.id === val);
                  if (selectedApp) {
                    setUploadUniId(selectedApp.partner_university?.id ?? selectedApp.partner_university_id ?? null);
                  }
                }}
                options={eligibleApps.map((app: any) => ({
                  value: app.id,
                  label: `${app.partner_university?.name || 'University'} (${app.semester === 'fall' ? t('studentDashboard.fallSemester') : t('studentDashboard.springSemester')})`,
                }))}
              />
            </div>
            <div>
              <Text strong>{t('studentTranscripts.uploadModal.transcriptPdf')}</Text>
              <Dragger
                accept=".pdf"
                maxCount={1}
                style={{ marginTop: 4, borderRadius: 8 }}
                beforeUpload={(file) => {
                  const isLt15M = file.size / 1024 / 1024 <= 15;
                  if (!isLt15M) {
                    message.error(t('upload.fileLimitError', 'Dosya boyutu en fazla 15 MB olmalıdır!'));
                    return Upload.LIST_IGNORE;
                  }
                  setUploadFile(file);
                  return false;
                }}
                onRemove={() => setUploadFile(null)}
                fileList={uploadFile ? [{
                  uid: '-1',
                  name: uploadFile.name,
                  status: 'done',
                } as UploadFile] : []}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text" style={{ margin: 0 }}>
                {t('studentTranscripts.uploadModal.dragText')}
              </p>
            </Dragger>
          </div>
          <div>
            <Text strong>{t('studentTranscripts.uploadModal.notes')}</Text>
            <Input.TextArea
              value={uploadNotes}
              onChange={e => setUploadNotes(e.target.value)}
              rows={2}
              style={{ marginTop: 4 }}
              placeholder={t('studentTranscripts.uploadModal.notesPlaceholder')}
            />
          </div>
        </div>
      )}
    </Modal>
    </div>
  );
}
