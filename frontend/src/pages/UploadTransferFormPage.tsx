import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Card, Typography, Upload, Button, Table, Tag, message, Space, Alert, Descriptions, Select, Spin, Tooltip, Popconfirm, Input, Row, Col, Divider, Badge, Drawer, Modal,
} from 'antd';
import {
  UploadOutlined, InboxOutlined, ArrowLeftOutlined, EyeOutlined, DeleteOutlined, CopyOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined, DownloadOutlined, ReloadOutlined, UndoOutlined, CheckOutlined, CloseOutlined, ClockCircleOutlined, SaveOutlined, EditOutlined, FilePdfOutlined, ThunderboltOutlined, CloudUploadOutlined, HistoryOutlined
} from '@ant-design/icons';
import type { UploadFile, TableProps } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { getDepartments } from '../api/client';
import { useQuery } from '@tanstack/react-query';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface ParsedRow {
  key: string;
  partnerCode: string;
  partnerName: string;
  localGrade: string;
  ectsGrade: string;
  partnerEcts: string;
  homeCode: string;
  homeName: string;
  ikuGrade: string;
  homeEcts: string;
}

interface VerificationRow {
  rowIndex: number;
  partnerCourseName: string;
  partnerCourseCode: string;
  partnerGrade: string;
  partnerEcts: string;
  expectedEctsGrade: string;
  expectedIkuGrade: string;
  providedEctsGrade: string;
  providedIkuGrade: string;
  validationResult: 'valid' | 'partial' | 'invalid' | 'manual_check_required' | 'no_rule_found';
  gradeRuleUsed: string;
  explanation: string;
}

interface UploadedDocument {
  id: string;
  fileName: string;
  uploadedAt: string;
  studentName: string;
  studentNumber: string;
  partnerUniversity: string;
  partnerUniversityId?: number;
  departmentId?: number;
  homeUniversity: string;
  rows: ParsedRow[];
  warnings: string[];
  status: 'ready' | 'imported' | 'error';
  totalPartnerEcts: number;
  totalHomeEcts: number;
  parsingMethod?: string;
  verificationStatus?: string;
  reviewStatus?: string;
  reviewNotes?: string;
  reviewedAt?: string;
  totalRows?: number;
  validRows?: number;
  partialRows?: number;
  invalidRows?: number;
  manualCheckRows?: number;
  verificationResults?: VerificationRow[];
}

function mapBackendDoc(d: any): UploadedDocument {
  const parseEctsSum = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (!str) return 0;
    return str.split(/[\s,/_+\-]+/).reduce((sum, part) => {
      const num = parseFloat(part.trim());
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  };

  const rows = (d.parsedRows || []).map((r: any, i: number) => ({ ...r, key: `${d.id}-${i}` }));
  return {
    id: String(d.id),
    fileName: d.originalFilename || d.fileName || '',
    uploadedAt: d.createdAt?.replace('T', ' ').slice(0, 16) || d.uploadedAt || '',
    studentName: d.studentName || '',
    studentNumber: d.studentNumber || '',
    partnerUniversity: d.partnerUniversityName || d.partnerUniversity || '',
    partnerUniversityId: d.partnerUniversityId,
    departmentId: d.departmentId,
    homeUniversity: 'İstanbul Kültür Üniversitesi',
    rows,
    warnings: d.warnings || [],
    status: (d.status || 'ready') as 'ready' | 'imported' | 'error',
    totalPartnerEcts: rows.reduce((s: number, r: any) => s + parseEctsSum(r.partnerEcts), 0),
    totalHomeEcts: rows.reduce((s: number, r: any) => s + parseEctsSum(r.homeEcts), 0),
    parsingMethod: d.parsingMethod,
    verificationStatus: d.verificationStatus,
    reviewStatus: d.reviewStatus,
    reviewNotes: d.reviewNotes,
    reviewedAt: d.reviewedAt ? d.reviewedAt.replace('T', ' ').slice(0, 16) : undefined,
    totalRows: d.totalRows,
    validRows: d.validRows,
    partialRows: d.partialRows,
    invalidRows: d.invalidRows,
    manualCheckRows: d.manualCheckRows,
    verificationResults: d.verificationResults || [],
  };
}

function getVerificationTag(result: string, t: any) {
  if (result === 'valid') return <Tag color="green" icon={<CheckCircleOutlined />}>{t('uploadTransferForm.valid', 'Valid')}</Tag>;
  if (result === 'partial') return <Tag color="gold" icon={<ExclamationCircleOutlined />}>{t('uploadTransferForm.partial', 'Partial')}</Tag>;
  if (result === 'invalid') return <Tag color="red" icon={<CloseCircleOutlined />}>{t('uploadTransferForm.invalid', 'Invalid')}</Tag>;
  if (result === 'manual_check_required') return <Tag color="orange" icon={<ExclamationCircleOutlined />}>{t('uploadTransferForm.manualCheckRequired', 'Manual Check')}</Tag>;
  return <Tag color="default" icon={<QuestionCircleOutlined />}>{t('uploadTransferForm.noRuleFound', 'No Rule')}</Tag>;
}

function DocumentDetail({ doc, onBack, t, onRefreshDoc }: { doc: UploadedDocument; onBack: () => void; t: any; onRefreshDoc: (d: any) => void }) {
  const getInitialNote = (notes?: string) => (notes && !notes.startsWith('Warnings:')) ? notes : '';
  const [reviewNote, setReviewNote] = useState(getInitialNote(doc.reviewNotes));
  const [redoing, setRedoing] = useState(false);
  const [reuploadFile, setReuploadFile] = useState<File | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsVisible, setVersionsVisible] = useState(false);
  const [versionDetailVisible, setVersionDetailVisible] = useState(false);
  const [selectedVersionData, setSelectedVersionData] = useState<any>(null);

  const fetchVersionsSilently = useCallback(async () => {
    try {
      const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch { }
  }, [doc.id]);

  useEffect(() => {
    fetchVersionsSilently();
  }, [fetchVersionsSilently]);

  const loadVersions = async () => {
    if (versions.length === 0) {
      setVersionsLoading(true);
      await fetchVersionsSilently();
      setVersionsLoading(false);
    }
    setVersionsVisible(true);
  };

  useEffect(() => {
    setReviewNote(getInitialNote(doc.reviewNotes));
  }, [doc.reviewNotes]);

  const verificationMap = new Map<number, VerificationRow>();
  doc.verificationResults?.forEach(vr => verificationMap.set(vr.rowIndex, vr));

  const labels = {
    valid: t('uploadTransferForm.valid', 'Valid'),
    invalid: t('uploadTransferForm.invalid', 'Invalid'),
    manualCheck: t('uploadTransferForm.manualCheckRequired', 'Manual Check'),
    partial: t('uploadTransferForm.partial', 'Partial'),
    noRule: t('uploadTransferForm.noRuleFound', 'No Rule'),
    backToList: t('uploadTransferForm.backToList', 'Back to List'),
    studentName: t('uploadTransferForm.studentName', 'Student Name'),
    studentNumber: t('uploadTransferForm.studentNumber', 'Student Number'),
    partnerUni: t('uploadTransferForm.partnerUni', 'Partner University'),
    homeUni: t('uploadTransferForm.homeUni', 'Host University'),
    parsingMethod: t('uploadTransferForm.parsingMethod', 'Parse Method'),
    parsedData: t('uploadTransferForm.parsedData', 'Transfer Course Data'),
    courses: t('uploadTransferForm.courses', 'courses'),
    totalPartnerEcts: t('uploadTransferForm.totalPartnerEcts', 'Total Partner ECTS'),
    totalHomeEcts: t('uploadTransferForm.totalHomeEcts', 'Total IKU ECTS'),
    total: t('uploadTransferForm.total', 'Total'),
    explanationTitle: t('uploadTransferForm.explanationTitle', 'Grade Conversion Explanations'),
    copyExplanation: t('uploadTransferForm.copyExplanation', 'Copy Explanation'),
    copied: t('uploadTransferForm.copied', 'Copied'),
    downloadFile: t('uploadTransferForm.downloadFile', 'Belgeyi İndir'),
  };

  const detailColumns: TableProps<ParsedRow>['columns'] = [
    { title: t('uploadTransferForm.table.partnerCode', 'Partner Kodu'), dataIndex: 'partnerCode', key: 'pc', width: 100 },
    { title: t('uploadTransferForm.table.partnerName', 'Partner Ders'), dataIndex: 'partnerName', key: 'pn', ellipsis: true },
    { title: t('uploadTransferForm.table.localGrade', 'Yerel Not'), dataIndex: 'localGrade', key: 'lg', width: 80, align: 'center' as const },
    { title: t('uploadTransferForm.table.ectsGrade', 'AKTS Notu'), dataIndex: 'ectsGrade', key: 'eg', width: 80, align: 'center' as const },
    { title: t('uploadTransferForm.table.partnerEcts', 'AKTS'), dataIndex: 'partnerEcts', key: 'pe', width: 60, align: 'center' as const },
    { title: t('uploadTransferForm.table.homeCode', 'İKÜ Kodu'), dataIndex: 'homeCode', key: 'hc', width: 100 },
    { title: t('uploadTransferForm.table.homeName', 'İKÜ Ders'), dataIndex: 'homeName', key: 'hn', ellipsis: true },
    {
      title: t('uploadTransferForm.table.expectedIku', 'Beklenen İKÜ'),
      key: 'expectedIku',
      width: 90,
      align: 'center' as const,
      render: (_: unknown, _record: ParsedRow, idx: number) => {
        const vr = verificationMap.get(idx);
        return vr ? <Text style={{ fontSize: 12 }}>{vr.expectedIkuGrade || '-'}</Text> : <Text type="secondary">-</Text>;
      },
    },
    { title: t('uploadTransferForm.table.ikuGrade', 'İKÜ Notu'), dataIndex: 'ikuGrade', key: 'ig', width: 80, align: 'center' as const },
    { title: t('uploadTransferForm.table.homeEcts', 'AKTS'), dataIndex: 'homeEcts', key: 'he', width: 60, align: 'center' as const },
    {
      title: t('uploadTransferForm.table.verificationLabel', 'Verification'),
      key: 'verification',
      width: 110,
      render: (_: unknown, _record: ParsedRow, idx: number) => {
        const vr = verificationMap.get(idx);
        if (!vr) return <Text type="secondary">-</Text>;
        let color: string; let text: string;
        if (vr.validationResult === 'valid') { color = '#52c41a'; text = labels.valid; }
        else if (vr.validationResult === 'partial') { color = '#faad14'; text = labels.partial; }
        else if (vr.validationResult === 'invalid') { color = '#ff4d4f'; text = labels.invalid; }
        else if (vr.validationResult === 'manual_check_required') { color = '#fa8c16'; text = labels.manualCheck; }
        else { color = '#999'; text = labels.noRule; }
        return <Tag color={color} style={{ margin: 0 }}>{text}</Tag>;
      },
    },
  ];

  // Rows with explanations — show below the table
  const explanationRows = doc.verificationResults?.filter(vr => vr.explanation && vr.validationResult !== 'valid') || [];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <Button type="default" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ borderRadius: 8 }}>
          {labels.backToList}
        </Button>
        <Title level={4} style={{ margin: 0, fontWeight: 600, color: '#1f1f1f', wordBreak: 'break-all' }}>
          {doc.fileName}
        </Title>
        <div style={{ flex: 1, minWidth: 16 }} />
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => window.open(`/api/registrar/transfer-documents/${doc.id}/file`, '_blank')}
          style={{ borderRadius: 8, backgroundColor: '#cf1322' }}
        >
          {labels.downloadFile}
        </Button>
      </div>

      {doc.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('uploadTransferForm.warnings', 'Uyarılar')}
          description={doc.warnings.join(' • ')}
          closable
          style={{ marginBottom: 16, borderRadius: 8 }}
        />
      )}

      <Card style={{ borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)', marginBottom: 16 }}>
        <Descriptions size="small" column={4} layout="vertical">
          <Descriptions.Item label={labels.studentName}>
            <Text strong style={{ fontSize: 15 }}>{doc.studentName || '-'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={labels.studentNumber}>
            <Text strong style={{ fontSize: 15 }}>{doc.studentNumber || '-'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={labels.partnerUni}>
            <Text strong style={{ fontSize: 15 }}>{doc.partnerUniversity}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={labels.homeUni}>
            <Text strong style={{ fontSize: 15 }}>{doc.homeUniversity}</Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {doc.verificationResults && doc.verificationResults.length > 0 && (
        <Card size="small" style={{ borderRadius: 12, marginBottom: 16, border: '1px solid #f0f0f0' }}>
          <Space size={24} wrap>
            <span><CheckCircleOutlined style={{ color: '#52c41a' }} /> {labels.valid}: <Text strong>{doc.validRows ?? 0}</Text></span>
            <span><ExclamationCircleOutlined style={{ color: '#faad14' }} /> {labels.partial}: <Text strong>{doc.partialRows ?? 0}</Text></span>
            <span><CloseCircleOutlined style={{ color: '#ff4d4f' }} /> {labels.invalid}: <Text strong>{doc.invalidRows ?? 0}</Text></span>
            <span><ExclamationCircleOutlined style={{ color: '#fa8c16' }} /> {labels.manualCheck}: <Text strong>{doc.manualCheckRows ?? 0}</Text></span>
            <span style={{ marginLeft: 'auto' }}>
              <Text type="secondary">{labels.parsingMethod}: <Tag>{doc.parsingMethod || 'rule_based'}</Tag></Text>
            </span>
          </Space>
        </Card>
      )}

      <Card
        title={<Text strong style={{ fontSize: 16 }}>{labels.parsedData}</Text>}
        extra={
          <Space size={12}>
            <Tag color="blue" style={{ padding: '4px 8px', borderRadius: 6 }}>{doc.rows.length} {labels.courses}</Tag>
            <Tag style={{ padding: '4px 8px', borderRadius: 6 }}>{labels.totalPartnerEcts}: {doc.totalPartnerEcts}</Tag>
            <Tag style={{ padding: '4px 8px', borderRadius: 6 }}>{labels.totalHomeEcts}: {doc.totalHomeEcts}</Tag>
          </Space>
        }
        style={{ borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)', marginBottom: 20 }}
      >
        <Table
          columns={detailColumns}
          dataSource={doc.rows}
          pagination={false}
          size="middle"
          scroll={{ x: 1100 }}
          summary={() => (
            <Table.Summary.Row style={{ backgroundColor: '#fafafa', fontWeight: 600 }}>
              <Table.Summary.Cell index={0} colSpan={4}>
                <Text strong>{labels.total}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="center"><Text strong>{doc.totalPartnerEcts}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={4}>
                <Text strong>{labels.total}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="center"><Text strong>{doc.totalHomeEcts}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={10} />
            </Table.Summary.Row>
          )}
        />
      </Card>

      {explanationRows.length > 0 && (
        <Card
          title={<Text strong style={{ fontSize: 15 }}>{labels.explanationTitle}</Text>}
          style={{ borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}
        >
          {explanationRows.map((vr, i) => (
            <div key={i} style={{
              padding: '12px 16px',
              marginBottom: i < explanationRows.length - 1 ? 8 : 0,
              background: '#fafafa',
              borderRadius: 8,
              border: '1px solid #f0f0f0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Text strong style={{ fontSize: 14 }}>{vr.partnerCourseName}</Text>
                {vr.partnerCourseCode ? <Tag>{vr.partnerCourseCode}</Tag> : null}
                {getVerificationTag(vr.validationResult, t)}
                <div style={{ flex: 1 }} />
                <Tooltip title={labels.copyExplanation}>
                  <Button size="small" type="text" icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(vr.explanation); message.success(labels.copied); }} />
                </Tooltip>
              </div>
              <Text style={{ fontSize: 13, color: '#555', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {vr.explanation}
              </Text>
              {vr.gradeRuleUsed && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{vr.gradeRuleUsed}</Text>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Enterprise Review & Document Management Panel */}
      <div style={{ marginTop: 36, marginBottom: 48 }}>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0, fontWeight: 600, color: '#1e293b' }}>
            {t('uploadTransferForm.reviewSectionTitle', 'Belge İnceleme ve Yönetim Paneli')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('uploadTransferForm.reviewSectionDesc', 'Ders transfer formunun uygunluğunu kontrol edin, not ekleyin veya güncel dosya ile yeniden değerlendirin.')}
          </Text>
        </div>

        <Card
          style={{
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
            background: '#ffffff',
          }}
          bodyStyle={{ padding: 0 }}
        >
          {/* Header Bar: Status & Direct Decisions */}
          <div style={{
            padding: '16px 24px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, flex: '1 1 280px' }}>
              {doc.reviewStatus === 'approved' ? (
                <Badge status="success" text={<Text strong style={{ color: '#15803d', fontSize: 14 }}>{t('uploadTransferForm.approved', 'Onaylandı')}</Text>} />
              ) : doc.reviewStatus === 'flagged' ? (
                <Badge status="error" text={<Text strong style={{ color: '#b91c1c', fontSize: 14 }}>{t('uploadTransferForm.flagged', 'Sorunlu')}</Text>} />
              ) : (
                <Badge status="processing" text={<Text strong style={{ color: '#2563eb', fontSize: 14 }}>{t('uploadTransferForm.pending', 'Beklemede')}</Text>} />
              )}
              <Divider type="vertical" style={{ background: '#cbd5e1' }} />
              <Text type="secondary" style={{ fontSize: 13, wordBreak: 'break-word' }}>
                {doc.reviewedAt ? `${t('uploadTransferForm.reviewedAt', 'Değerlendirme Tarihi:')} ${doc.reviewedAt}` : t('uploadTransferForm.pendingSubtext', 'Lütfen ders denklik kontrollerini yapıp kararınızı belirtin.')}
              </Text>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <Button
                type={doc.reviewStatus === 'approved' ? 'primary' : 'default'}
                icon={<CheckOutlined />}
                style={{
                  borderColor: doc.reviewStatus === 'approved' ? '#16a34a' : '#cbd5e1',
                  background: doc.reviewStatus === 'approved' ? '#16a34a' : '#ffffff',
                  color: doc.reviewStatus === 'approved' ? '#ffffff' : '#334155',
                  borderRadius: 6,
                  fontWeight: 500,
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                }}
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/review`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'approved', notes: reviewNote }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      onRefreshDoc(data);
                      message.success(t('uploadTransferForm.reviewApproved', 'Belge onaylandı'));
                    }
                  } catch { message.error(t('uploadTransferForm.reviewFailed', 'Onaylama başarısız')); }
                }}
              >
                {t('uploadTransferForm.approveBtn', 'Uygundur')}
              </Button>
              <Button
                type={doc.reviewStatus === 'flagged' ? 'primary' : 'default'}
                danger={doc.reviewStatus === 'flagged'}
                icon={<CloseOutlined />}
                style={{
                  borderRadius: 6,
                  fontWeight: 500,
                  borderColor: doc.reviewStatus === 'flagged' ? '#dc2626' : '#cbd5e1',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                }}
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/review`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'flagged', notes: reviewNote }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      onRefreshDoc(data);
                      message.success(t('uploadTransferForm.reviewFlagged', 'Belge sorunlu işaretlendi'));
                    }
                  } catch { message.error(t('uploadTransferForm.reviewFailed', 'İşaretleme başarısız')); }
                }}
              >
                {t('uploadTransferForm.flagBtn', 'Sorunlu')}
              </Button>
            </div>
          </div>

          {/* Body Content: Review Notes & Document Operations */}
          <div style={{ padding: 28 }}>
            <Row gutter={[36, 28]}>
              {/* Left Column: Notes */}
              <Col xs={24} lg={13}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <Text strong style={{ fontSize: 14, color: '#334155' }}>
                      {t('uploadTransferForm.reviewNotes', 'İnceleme Notu')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('uploadTransferForm.optional', 'Opsiyonel')}</Text>
                  </div>
                  <Input.TextArea
                    placeholder={t('uploadTransferForm.reviewNotesPlaceholder', 'İnceleme notu (opsiyonel)')}
                    rows={5}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    style={{
                      borderRadius: 6,
                      borderColor: '#cbd5e1',
                      fontSize: 14,
                      flex: 1,
                      padding: '12px 16px',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <Button
                      type="default"
                      icon={<SaveOutlined />}
                      style={{ borderRadius: 6, fontWeight: 500, borderColor: '#cbd5e1' }}
                      onClick={async () => {
                        try {
                          const currentStatus = doc.reviewStatus && doc.reviewStatus !== 'pending' ? doc.reviewStatus : 'pending';
                          if (currentStatus === 'pending') {
                            message.warning(t('uploadTransferForm.selectStatusFirst', 'Lütfen önce Uygundur veya Sorunlu kararı verin'));
                            return;
                          }
                          const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/review`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: currentStatus, notes: reviewNote }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            onRefreshDoc(data);
                            message.success(t('uploadTransferForm.noteSaved', 'İnceleme notu kaydedildi'));
                          }
                        } catch { message.error(t('uploadTransferForm.saveFailed', 'Kaydetme başarısız')); }
                      }}
                    >
                      {t('uploadTransferForm.saveNoteBtn', 'Notu Kaydet')}
                    </Button>
                  </div>
                </div>
              </Col>

              {/* Right Column: Operations */}
              <Col xs={24} lg={11}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Text strong style={{ fontSize: 14, color: '#334155', display: 'block' }}>
                    {t('uploadTransferForm.docManagementTitle', 'Belge İşlemleri ve Güncelleme')}
                  </Text>

                  {/* 1. Original Document Download */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
                    padding: '12px 16px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 180px' }}>
                      <FilePdfOutlined style={{ color: '#64748b', fontSize: 18, flexShrink: 0 }} />
                      <Text style={{ fontSize: 14, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.fileName}>
                        {doc.fileName}
                      </Text>
                    </div>
                    <Button
                      size="middle"
                      type="primary"
                      icon={<DownloadOutlined />}
                      style={{ borderRadius: 6, fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', flexShrink: 0 }}
                      onClick={() => window.open(`/api/registrar/transfer-documents/${doc.id}/file`, '_blank')}
                    >
                      {t('uploadTransferForm.downloadBtn', 'İndir')}
                    </Button>
                  </div>

                  {/* 2. Re-verify with New File */}
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <Text strong style={{ fontSize: 13, color: '#334155', display: 'block', marginBottom: 4 }}>
                      {t('uploadTransferForm.reverifyTitle', 'Yeniden Değerlendirme')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                      {t('uploadTransferForm.reverifyHint', 'Yeni bir PDF/DOCX yükleyerek belgeyi yeniden değerlendirin')}
                    </Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch' }}>
                      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                        <Upload
                          accept=".pdf,.doc,.docx"
                          maxCount={1}
                          showUploadList={false}
                          beforeUpload={(f) => { setReuploadFile(f); return false; }}
                        >
                          <Button block size="middle" type="dashed" icon={<UploadOutlined />} style={{ borderRadius: 6, borderColor: reuploadFile ? '#16a34a' : '#cbd5e1', color: reuploadFile ? '#16a34a' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {reuploadFile ? reuploadFile.name : t('uploadTransferForm.selectNewFile', 'Yeni Dosya Seç')}
                          </Button>
                        </Upload>
                      </div>
                      <Button
                        size="middle"
                        type="primary"
                        icon={<ReloadOutlined />}
                        loading={redoing}
                        disabled={!reuploadFile}
                        style={{ borderRadius: 6, fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', flexShrink: 0 }}
                        onClick={async () => {
                          if (!reuploadFile) return;
                          setRedoing(true);
                          try {
                            const fd = new FormData();
                            fd.append('file', reuploadFile);
                            const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/reupload`, { method: 'POST', body: fd });
                            if (res.ok) {
                              message.success(t('uploadTransferForm.reverifySuccess', 'Dosya güncellendi, yeniden işleniyor...'));
                              setReuploadFile(null);
                              onBack(); // Dashboard auto-refreshes while processing
                            }
                          } catch { message.error(t('uploadTransferForm.reverifyFailed', 'Yükleme başarısız')); }
                          setRedoing(false);
                        }}
                      >
                        {t('uploadTransferForm.reverifyBtn', 'Yeniden Değerlendir')}
                      </Button>
                    </div>
                  </div>

                  {/* 3. AI Explanation Regeneration */}
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <Text strong style={{ fontSize: 13, color: '#334155', display: 'block', marginBottom: 4 }}>
                      {t('uploadTransferForm.aiExplanations', 'Yapay Zeka Açıklamaları')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                      {t('uploadTransferForm.aiExplanationsDesc', 'Denklik açıklamalarını LLM ile yeniden üretin')}
                    </Text>
                    <Button
                      size="middle"
                      icon={<UndoOutlined />}
                      type="default"
                      block
                      loading={redoing && !reuploadFile}
                      style={{ borderRadius: 6, fontWeight: 500, color: '#1677ff', borderColor: '#91caff', background: '#e6f4ff', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
                      onClick={async () => {
                        setRedoing(true);
                        try {
                          const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/regenerate-explanations`, { method: 'POST' });
                          if (res.ok) {
                            message.success(t('uploadTransferForm.explanationsRegenerated', 'Açıklamalar kuyruğa alındı, işleniyor...'));
                            onBack(); // Dashboard auto-refreshes every 3s while processing docs exist
                          }
                        } catch { message.error(t('uploadTransferForm.regenerateFailed', 'Açıklama üretme başarısız')); }
                        setRedoing(false);
                      }}
                    >
                      {t('uploadTransferForm.regenerateExplanations', 'Açıklamaları Yeniden Üret')}
                    </Button>
                  </div>

                  {/* Version History */}
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <Text strong style={{ fontSize: 13, color: '#334155', display: 'block', marginBottom: 4 }}>
                      {t('uploadTransferForm.versionHistoryTitle', 'Geçmiş Versiyonlar')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                      {t('uploadTransferForm.versionHistoryHint', 'Önceki doğrulama sonuçlarını görüntüleyin ve eski versiyonlara dönün')}
                    </Text>
                    <Button
                      size="middle"
                      icon={<HistoryOutlined />}
                      type="default"
                      block
                      loading={versionsLoading}
                      style={{ borderRadius: 6, fontWeight: 500, color: '#475569', borderColor: '#cbd5e1', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
                      onClick={loadVersions}
                    >
                      {t('uploadTransferForm.versionHistoryBtn', 'Versiyon Geçmişi')} ({versionsLoading ? '...' : versions.length})
                    </Button>
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        </Card>
      </div>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8, background: '#e0f2fe',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7'
            }}>
              <HistoryOutlined style={{ fontSize: 20 }} />
            </div>
            <div>
              <Text strong style={{ fontSize: 16, color: '#1e293b', display: 'block', lineHeight: 1.2 }}>
                {t('uploadTransferForm.versionHistoryDrawerTitle', 'Doğrulama Versiyon Geçmişi')}
              </Text>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {t('uploadTransferForm.versionHistoryDrawerSub', 'Bu belge üzerinde yapılan geçmiş değerlendirmeler ve denklik analizleri')}
              </Text>
            </div>
          </div>
        }
        open={versionsVisible}
        onClose={() => setVersionsVisible(false)}
        width={750}
        bodyStyle={{ background: '#f8fafc', padding: '24px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {versions.map((v: any, vi: number) => {
            const validCount = v.rows?.filter((r: any) => r.validationResult === 'valid').length || 0;
            const partialCount = v.rows?.filter((r: any) => r.validationResult === 'partial').length || 0;
            const invalidCount = v.rows?.filter((r: any) => r.validationResult === 'invalid').length || 0;
            const manualCount = v.rows?.filter((r: any) => r.validationResult === 'manual_check_required' || r.validationResult === 'no_rule_found').length || 0;

            return (
              <div
                key={vi}
                style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  border: v.isActive ? '2px solid #1677ff' : '1px solid #e2e8f0',
                  boxShadow: v.isActive ? '0 4px 12px rgba(22, 119, 255, 0.15)' : '0 2px 4px rgba(0,0,0,0.04)',
                  overflow: 'hidden',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Header */}
                <div style={{
                  padding: '16px 20px',
                  background: v.isActive ? '#f0f7ff' : '#ffffff',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}>
                  <Space size={12} align="center">
                    <Tag color={v.isActive ? 'blue' : 'default'} style={{ margin: 0, padding: '2px 8px', fontSize: 13, fontWeight: 600, borderRadius: 6 }}>
                      v{v.versionNumber}
                    </Tag>
                    {v.isActive ? (
                      <Tag color="success" style={{ margin: 0, padding: '2px 8px', fontSize: 12, fontWeight: 600, borderRadius: 6 }}>
                        {t('uploadTransferForm.activeVersion', 'Aktif Sürüm')}
                      </Tag>
                    ) : null}
                    <Space size={6} style={{ color: '#64748b', fontSize: 13 }}>
                      <ClockCircleOutlined />
                      <span>{v.createdAt?.replace('T', ' ').slice(0, 16)}</span>
                    </Space>
                  </Space>

                  <Space>
                    <Button
                      size="small"
                      type="default"
                      icon={<DownloadOutlined />}
                      style={{ borderRadius: 6, fontWeight: 500 }}
                      onClick={() => window.open(`/api/registrar/transfer-documents/${doc.id}/file?version=${v.versionNumber}`, '_blank')}
                      title={t('uploadTransferForm.downloadBtn', 'İndir')}
                    />
                    {!v.isActive && (
                      <>
                        <Button
                          size="small"
                          type="default"
                          style={{ borderRadius: 6, fontWeight: 500 }}
                          onClick={() => { setSelectedVersionData(v); setVersionDetailVisible(true); }}
                        >
                          {t('uploadTransferForm.openVersion', 'Bu Versiyonu Aç')}
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          ghost
                          style={{ borderRadius: 6, fontWeight: 500 }}
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/registrar/transfer-documents/${doc.id}/versions/${v.versionNumber}/activate`, { method: 'POST' });
                              if (res.ok) {
                                const data = await res.json();
                                onRefreshDoc(data);
                                message.success(`v${v.versionNumber} ${t('uploadTransferForm.activateSuccess', 'sürümü başarıyla aktifleştirildi')}`);
                                fetchVersionsSilently();
                              }
                            } catch { message.error(t('uploadTransferForm.activateFailed', 'Aktifleştirme başarısız')); }
                          }}
                        >
                          {t('uploadTransferForm.activateThisVersion', 'Bu Sürümü Aktifleştir')}
                        </Button>
                      </>
                    )}
                  </Space>
                </div>

                {/* Summary Badges */}
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>{t('uploadTransferForm.summaryAnalysis', 'Özet Analiz:')}</Text>
                  <Space size={12}>
                    <Tag color="green" style={{ borderRadius: 4, margin: 0 }}>{t('uploadTransferForm.summaryValid', 'Uyumlu:')} {validCount}</Tag>
                    <Tag color="gold" style={{ borderRadius: 4, margin: 0 }}>{t('uploadTransferForm.summaryPartial', 'Kısmi:')} {partialCount}</Tag>
                    <Tag color="red" style={{ borderRadius: 4, margin: 0 }}>{t('uploadTransferForm.summaryInvalid', 'Uyumsuz:')} {invalidCount}</Tag>
                    <Tag color="orange" style={{ borderRadius: 4, margin: 0 }}>{t('uploadTransferForm.summaryManual', 'Manuel Kontrol:')} {manualCount}</Tag>
                  </Space>
                </div>

                {/* Table */}
                <Table
                  size="small"
                  dataSource={v.rows}
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 500 }}
                  columns={[
                    { title: t('uploadTransferForm.colCourseName', 'Ders Adı'), dataIndex: 'partnerCourseName', key: 'name', ellipsis: true },
                    { title: t('uploadTransferForm.colValidationStatus', 'Doğrulama Durumu'), dataIndex: 'validationResult', key: 'result', width: 140, render: (r: string) => getVerificationTag(r, t) },
                    { title: t('uploadTransferForm.colExpectedGrade', 'Beklenen Not'), dataIndex: 'expectedIkuGrade', key: 'exp', width: 110, align: 'center' as const },
                    { title: t('uploadTransferForm.colProvidedGrade', 'Sağlanan Not'), dataIndex: 'providedIkuGrade', key: 'prov', width: 110, align: 'center' as const },
                  ]}
                />
              </div>
            );
          })}
          {versions.length === 0 && !versionsLoading && (
            <div style={{ padding: 48, textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
              <HistoryOutlined style={{ fontSize: 32, color: '#cbd5e1', marginBottom: 12 }} />
              <Text type="secondary" style={{ display: 'block', fontSize: 14 }}>
                {t('uploadTransferForm.noVersionHistory', 'Henüz kayıtlı bir geçmiş sürüm bulunmuyor.')}
              </Text>
            </div>
          )}
        </div>
      </Drawer>

      <Modal
        title={`v${selectedVersionData?.versionNumber || ''} — ${t('uploadTransferForm.verificationResults', 'Doğrulama Sonuçları')}`}
        open={versionDetailVisible}
        onCancel={() => setVersionDetailVisible(false)}
        footer={null}
        width={900}
      >
        {selectedVersionData && (
          <>
            <Space style={{ marginBottom: 16 }}>
              <Tag color={selectedVersionData.isActive ? 'green' : 'default'}>
                {selectedVersionData.isActive ? t('uploadTransferForm.activeVersion', 'Aktif Sürüm') : t('uploadTransferForm.inactiveVersion', 'Pasif Sürüm')}
              </Tag>
              <Text type="secondary">{selectedVersionData.createdAt?.replace('T', ' ').slice(0, 16)}</Text>
            </Space>
            <Table
              size="small"
              dataSource={selectedVersionData.rows}
              rowKey="id"
              pagination={false}
              columns={[
                { title: t('uploadTransferForm.table.partnerName', 'Ders Adı'), dataIndex: 'partnerCourseName', key: 'name', ellipsis: true },
                { title: t('uploadTransferForm.table.partnerCode', 'Kod'), dataIndex: 'partnerCourseCode', key: 'code', width: 90 },
                { title: t('uploadTransferForm.verificationResultShort', 'Sonuç'), dataIndex: 'validationResult', key: 'result', width: 110, render: (r: string) => getVerificationTag(r, t) },
                { title: t('uploadTransferForm.expectedGrade', 'Beklenen Not'), dataIndex: 'expectedIkuGrade', key: 'exp', width: 110, align: 'center' as const },
                { title: t('uploadTransferForm.providedGrade', 'Sağlanan Not'), dataIndex: 'providedIkuGrade', key: 'prov', width: 110, align: 'center' as const },
                { title: t('uploadTransferForm.explanation', 'Açıklama'), dataIndex: 'explanation', key: 'expDetail', ellipsis: true, render: (e: string) => e ? <Tooltip title={e}><Text style={{ fontSize: 12, maxWidth: 200 }} ellipsis>{e}</Text></Tooltip> : '-' },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

interface PartnerUni {
  id: number;
  name: string;
}

export default function UploadTransferFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const { activeDepartment, user } = useAuth();

  const [file, setFile] = useState<UploadFile | null>(null);
  const [parsing, setParsing] = useState(false);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<UploadedDocument | null>(null);

  // Load detail from route param
  const [routeDoc, setRouteDoc] = useState<UploadedDocument | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  useEffect(() => {
    if (!routeId) { setRouteDoc(null); return; }
    setRouteLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/registrar/transfer-documents/${routeId}`);
        if (!res.ok) { setRouteDoc(null); setRouteLoading(false); return; }
        const d = await res.json();
        setRouteDoc(mapBackendDoc(d));
      } catch { setRouteDoc(null); }
      setRouteLoading(false);
    })();
  }, [routeId]);

  const activeDetail = selectedDoc || routeDoc;
  const [partnerUnis, setPartnerUnis] = useState<PartnerUni[]>([]);
  const [selDepartmentCode, setSelDepartmentCode] = useState<string | null>(activeDepartment);
  const [selDepartmentId, setSelDepartmentId] = useState<number | null>(null);
  const [selPartnerUniId, setSelPartnerUniId] = useState<number | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Load documents and auto-refresh every 3 seconds while there are processing docs
  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/registrar/transfer-documents');
      if (res.ok) {
        const data = await res.json();
        const docs: UploadedDocument[] = (data.items || []).map(mapBackendDoc);
        setDocuments(docs);
        setProcessingIds(new Set(docs.filter(d => !d.parsingMethod).map(d => d.id)));
      }
    } catch { /* ignore */ }
    setLoadingDocs(false);
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Auto-refresh every 3 seconds while there are processing documents
  useEffect(() => {
    if (processingIds.size === 0) return;
    const interval = setInterval(() => {
      loadDocuments();
    }, 3000);
    return () => clearInterval(interval);
  }, [processingIds.size, loadDocuments]);

  // If we just loaded and found no processing docs, clear stale loading state
  useEffect(() => {
    if (processingIds.size === 0) setLoadingDocs(false);
  }, [processingIds.size]);

  // Parse button spinner only while uploading (not while queue processes)

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Load partner universities for selected department
  useEffect(() => {
    if (!selDepartmentCode) { setPartnerUnis([]); return; }
    fetch(`/api/universities?department=${selDepartmentCode}&active_only=true`)
      .then(r => r.json())
      .then((unis: any[]) => {
        setPartnerUnis(unis.filter((u: any) => !u.is_home).map((u: any) => ({ id: u.id, name: u.name })));
      })
      .catch(() => setPartnerUnis([]));
  }, [selDepartmentCode]);

  // Fetch all departments for faculty-scoped filtering
  const { data: allDepartments } = useQuery({
    queryKey: ['upload-depts'],
    queryFn: getDepartments,
  });

  const isFacultyScoped = user?.roles?.some((r: any) => ['registrar', 'faculty_affairs_admin'].includes(r.role))
    && !user?.roles?.some((r: any) => ['super_admin'].includes(r.role));

  // Resolve available departments: faculty-scoped users see all departments in their faculty,
  // others see departments from their role assignments, super_admin sees all
  const departments = useMemo(() => {
    if (!allDepartments?.length) return [];
    const isSuperAdmin = user?.roles?.some((r: any) => r.role === 'super_admin');

    if (isSuperAdmin) {
      return allDepartments.map(d => ({ code: d.code, name: d.name }));
    }

    if (isFacultyScoped) {
      const userFacIds = user?.roles
        ?.filter((r: any) => r.faculty_id)
        .map((r: any) => r.faculty_id) || [];
      if (userFacIds.length) {
        return allDepartments
          .filter(d => userFacIds.includes(d.faculty_id))
          .map(d => ({ code: d.code, name: d.name }));
      }
    }

    // Default: use departments from role assignments
    const deptSet = new Map<string, string>();
    user?.roles.forEach(r => {
      if (r.department_code && r.department_name) {
        deptSet.set(r.department_code, r.department_name);
      }
    });
    // If role assignments have no departments but user has faculty_id, fall back to faculty filter
    if (deptSet.size === 0 && isFacultyScoped) {
      const userFacIds = user?.roles?.filter((r: any) => r.faculty_id).map((r: any) => r.faculty_id) || [];
      if (userFacIds.length) {
        allDepartments
          .filter(d => userFacIds.includes(d.faculty_id))
          .forEach(d => deptSet.set(d.code, d.name));
      }
    }
    return Array.from(deptSet.entries()).map(([code, name]) => ({ code, name }));
  }, [allDepartments, user, isFacultyScoped]);

  // Auto-select department if only one available — resolve ID and code
  // Also resolve ID when activeDepartment comes from Layout (no onChange fire)
  useEffect(() => {
    if (departments.length === 1 && !selDepartmentCode) {
      setSelDepartmentCode(departments[0].code);
    }
    // Resolve department ID from current code (covers Layout auto-select and dropdown onChange)
    if (selDepartmentCode && !selDepartmentId && allDepartments?.length) {
      const dept = allDepartments.find(d => d.code === selDepartmentCode);
      if (dept) setSelDepartmentId(dept.id);
    }
  }, [departments, selDepartmentCode, selDepartmentId, allDepartments]);

  const canUpload = !!file && !!selDepartmentId && !!selPartnerUniId;

  const handleUpload = useCallback(async () => {
    if (!file || !selDepartmentId || !selPartnerUniId) return;
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file as any);
      formData.append('partner_university_id', String(selPartnerUniId));
      formData.append('department_id', String(selDepartmentId));
      const res = await fetch('/api/registrar/upload-transfer-document', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        let msg = 'Upload failed';
        try {
          const err = await res.json();
          if (Array.isArray(err.detail)) {
            msg = err.detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
          } else if (typeof err.detail === 'string') {
            msg = err.detail;
          } else if (err.detail) {
            msg = JSON.stringify(err.detail);
          }
        } catch {
          msg = `Server error (${res.status})`;
        }
        throw new Error(msg);
      }
      const data = await res.json();
      setFile(null);
      // Add placeholder immediately — auto-refresh will update it
      const docId = String(data.id);
      const placeholder: UploadedDocument = {
        id: docId,
        fileName: file.name,
        uploadedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
        studentName: '',
        studentNumber: '',
        partnerUniversity: data.partnerUniversity || '',
        homeUniversity: 'İstanbul Kültür Üniversitesi',
        rows: [],
        warnings: [],
        status: 'ready',
        totalPartnerEcts: 0,
        totalHomeEcts: 0,
        parsingMethod: undefined,
        verificationStatus: 'not_verified',
      };
      setDocuments(prev => [placeholder, ...prev]);
      setProcessingIds(prev => new Set(prev).add(docId));
      message.success(t('uploadTransferForm.parseSuccess', 'Belge kuyruğa alındı'));
    } catch (err: any) {
      message.error(err.message || t('uploadTransferForm.uploadError', 'Yükleme başarısız'));
    } finally {
      setParsing(false);
    }
  }, [file, selDepartmentId, selPartnerUniId, t]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/registrar/transfer-documents/${id}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    setDocuments(prev => prev.filter(d => d.id !== id));
  }, []);

  if (activeDetail) {
    if (routeLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
    return (
      <DocumentDetail
        doc={activeDetail}
        onBack={() => { setSelectedDoc(null); setRouteDoc(null); loadDocuments(); navigate('/upload-transfer-form'); }}
        t={t}
        onRefreshDoc={(updated) => {
          const mapped = mapBackendDoc(updated);
          if (selectedDoc && selectedDoc.id === mapped.id) setSelectedDoc(mapped);
          if (routeDoc && routeDoc.id === mapped.id) setRouteDoc(mapped);
          setDocuments(prev => prev.map(d => d.id === mapped.id ? mapped : d));
        }}
      />
    );
  }

  const mainColumns: TableProps<UploadedDocument>['columns'] = [
    {
      title: t('uploadTransferForm.table.filename', 'Dosya'),
      dataIndex: 'fileName',
      key: 'fileName',
      width: 260,
      ellipsis: true,
      render: (name: string) => <Text strong style={{ color: '#1f1f1f' }}>{name}</Text>,
    },
    {
      title: t('uploadTransferForm.table.uploadDate', 'Yüklenme'),
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      width: 135,
    },
    {
      title: t('uploadTransferForm.table.student', 'Öğrenci'),
      dataIndex: 'studentName',
      key: 'studentName',
      width: 150,
      ellipsis: true,
    },
    {
      title: t('uploadTransferForm.table.partnerUni', 'Partner Üni.'),
      dataIndex: 'partnerUniversity',
      key: 'partnerUniversity',
      width: 180,
      ellipsis: true,
    },
    {
      title: t('uploadTransferForm.table.courseCount', 'Ders'),
      key: 'courseCount',
      width: 70,
      align: 'center' as const,
      render: (_: unknown, record: UploadedDocument) => record.rows.length,
    },
    {
      title: t('uploadTransferForm.table.totalEcts', 'Toplam AKTS'),
      key: 'totalEcts',
      width: 110,
      align: 'center' as const,
      render: (_: unknown, record: UploadedDocument) => (
        <Text>{record.totalPartnerEcts} / {record.totalHomeEcts}</Text>
      ),
    },
    {
      title: t('uploadTransferForm.table.verification', 'Doğrulama'),
      key: 'verification',
      width: 110,
      align: 'center' as const,
      render: (_: unknown, record: UploadedDocument) => {
        if (!record.verificationStatus || record.verificationStatus === 'not_verified') return <Text type="secondary">-</Text>;
        if (record.verificationStatus === 'verified') return <Tag color="green">{t('uploadTransferForm.verified', 'Verified')}</Tag>;
        return <Tag color="orange">{t('uploadTransferForm.hasIssues', 'Has Issues')}</Tag>;
      },
    },
    {
      title: t('uploadTransferForm.table.status', 'Durum'),
      key: 'status',
      width: 110,
      align: 'center' as const,
      render: (_: unknown, record: UploadedDocument) => {
        if (!record.parsingMethod) return <Tag color="processing">{t('uploadTransferForm.processing', 'Processing')}</Tag>;
        if (record.reviewStatus === 'approved') return <Tag color="success" style={{ fontWeight: 500 }}>{t('uploadTransferForm.approved', 'Approved')}</Tag>;
        if (record.reviewStatus === 'flagged') return <Tag color="error" style={{ fontWeight: 500 }}>{t('uploadTransferForm.flagged', 'Flagged')}</Tag>;
        return <Tag color="blue" style={{ fontWeight: 500 }}>{t('uploadTransferForm.status.ready', 'Hazır')}</Tag>;
      },
    },
    {
      title: t('uploadTransferForm.table.actions', 'İşlem'),
      key: 'actions',
      width: 130,
      align: 'center' as const,
      render: (_: unknown, record: UploadedDocument) => (
        <Space size={8} style={{ display: 'flex', justifyContent: 'center', whiteSpace: 'nowrap' }}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            disabled={!record.parsingMethod}
            onClick={() => navigate(`/upload-transfer-form/${record.id}`)}
          >
            {record.parsingMethod ? t('uploadTransferForm.detail', 'Details') : t('uploadTransferForm.processing', 'Processing...')}
          </Button>
          {record.parsingMethod && (
            <Popconfirm
              title={t('uploadTransferForm.deleteConfirm', 'Are you sure you want to delete this document?')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('common.delete', 'Delete')}
              cancelText={t('common.cancel', 'Cancel')}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto', padding: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <Button type="default" icon={<ArrowLeftOutlined />} onClick={() => navigate('/transcripts')} style={{ borderRadius: 8 }}>
          {t('uploadTransferForm.back', 'Transkriptlere Dön')}
        </Button>
        <Title level={4} style={{ margin: 0, fontWeight: 600, color: '#1f1f1f' }}>
          {t('uploadTransferForm.title', 'Transfer Formu Yükle')}
        </Title>
      </div>

      <Card style={{ borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
              {t('uploadTransferForm.departmentLabel', 'Bölüm')}
            </Text>
            <Select
              placeholder={t('uploadTransferForm.selectFirst', 'Önce bölüm seçin')}
              style={{ width: '100%' }}
              value={selDepartmentCode}
              onChange={(code) => {
                setSelDepartmentCode(code);
                setSelPartnerUniId(null);
                const dept = allDepartments?.find(d => d.code === code);
                setSelDepartmentId(dept ? dept.id : null);
              }}
              options={departments.map(d => ({ value: d.code, label: `${d.name} (${d.code})` }))}
            />
          </div>
          <div style={{ minWidth: 280, flex: 2 }}>
            <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
              {t('uploadTransferForm.partnerUniLabel', 'Partner Üniversite')}
            </Text>
            <Select
              placeholder={t('uploadTransferForm.selectFirst', 'Önce üniversite seçin')}
              style={{ width: '100%' }}
              value={selPartnerUniId}
              onChange={setSelPartnerUniId}
              options={partnerUnis.map(u => ({ value: u.id, label: u.name }))}
              showSearch
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false}
              disabled={!selDepartmentCode}
            />
          </div>
        </div>

        <Dragger
          accept=".pdf,.doc,.docx"
          maxCount={1}
          beforeUpload={(f) => {
            const isLt15M = f.size / 1024 / 1024 <= 15;
            if (!isLt15M) {
              message.error(t('upload.fileLimitError', 'Dosya boyutu en fazla 15 MB olmalıdır!'));
              return Upload.LIST_IGNORE;
            }
            setFile(f as any);
            return false;
          }}
          onRemove={() => setFile(null)}
          fileList={file ? [file] : []}
          style={{ borderRadius: 8, padding: '16px 0' }}
        >
          <p className="ant-upload-drag-icon" style={{ color: '#cf1322' }}><InboxOutlined /></p>
          <p className="ant-upload-text" style={{ fontSize: 15, fontWeight: 500 }}>{t('uploadTransferForm.dragText', 'PDF veya DOCX dosyasını buraya sürükleyin')}</p>
          <p className="ant-upload-hint" style={{ color: '#888' }}>{t('uploadTransferForm.dragHint', 'Sistem tarafından üretilen Ders Transfer Formu')}</p>
        </Dragger>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={handleUpload}
          loading={parsing}
          disabled={!canUpload}
          block
          style={{ marginTop: 20, borderRadius: 8, height: 42, backgroundColor: canUpload ? '#cf1322' : undefined }}
        >
          {t('uploadTransferForm.parseButton', 'Yükle ve Parse Et')}
        </Button>
      </Card>

      <Card
        title={<Text strong style={{ fontSize: 16 }}>{t('uploadTransferForm.uploadedDocs', 'Yüklenen Belgeler')}</Text>}
        style={{ borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}
      >
        <Table
          columns={mainColumns}
          dataSource={documents}
          rowKey="id"
          loading={loadingDocs}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `${total} ${t('uploadTransferForm.totalDocs', 'documents')}` }}
          size="middle"
          scroll={{ x: 1150 }}
          locale={{ emptyText: t('uploadTransferForm.noDocs', 'No documents uploaded yet') }}
        />
      </Card>
    </div>
  );
}
