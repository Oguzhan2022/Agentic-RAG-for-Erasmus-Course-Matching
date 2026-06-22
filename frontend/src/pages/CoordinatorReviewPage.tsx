import React, { useState, useEffect, useMemo } from 'react';
import {
  Card, Row, Col, Table, Descriptions, Button, Modal, Form, Input, Select, Tag,
  Typography, Spin, Empty, message, Alert, Space, Divider, Timeline, Collapse,
  Progress, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseCircleFilled,
  SwapOutlined, ToolOutlined, SendOutlined, MessageOutlined,
  CheckSquareOutlined, SafetyCertificateOutlined, ExclamationCircleOutlined,
  FileTextOutlined, HomeOutlined, WarningOutlined, ExperimentOutlined,
  BookOutlined, ThunderboltOutlined, DeleteOutlined, BulbOutlined, EditOutlined,
  UndoOutlined, FilePdfOutlined, FileExcelOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// xlsx is lazy-loaded in export function
import {
  getCoordinatorApplication, reviewSelection, sendBackApplication,
  bulkApproveSubmitted, finalizeApplication, sendNote, getWorkflowHistory,
  getCourse, deleteCoordinatorApplication, setCoordinatorEditingState,
  revertFinalization, getHomeCourses,
} from '../api/client';
import ApplicationStatusBadge from '../components/ApplicationStatusBadge';
import EctsProgressBar from '../components/EctsProgressBar';
import VerificationBadge from '../components/VerificationBadge';
import CourseDetailsPanel from '../components/CourseDetailsPanel';

const { Title, Text, Paragraph } = Typography;

const fmt = (val: unknown) => {
  if (val === null || val === undefined || val === '') return <Text type="secondary">—</Text>;
  if (typeof val === 'boolean') return val ? <Tag color="green">Yes</Tag> : <Tag color="default">No</Tag>;
  if (val === 'unknown') return <Tag color="orange">Unknown</Tag>;
  if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : <Text type="secondary">—</Text>;
  return String(val);
};


export default function CoordinatorReviewPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reviewModal, setReviewModal] = useState(false);
  const [noteModal, setNoteModal] = useState(false);
  const [historyModal, setHistoryModal] = useState(false);
  const [laModalVisible, setLaModalVisible] = useState(false);
  const [overrideSearch, setOverrideSearch] = useState('');
  const [debouncedOverrideSearch, setDebouncedOverrideSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedOverrideSearch(overrideSearch);
    }, 400);
    return () => clearTimeout(timer);
  }, [overrideSearch]);
  const [reviewAction, setReviewAction] = useState<string>('');
  const [editMode, setEditMode] = useState(false);
  const [form] = Form.useForm();
  const [noteForm] = Form.useForm();

  const { data: appData, isLoading, refetch } = useQuery({
    queryKey: ['coordinator-app', id],
    queryFn: () => getCoordinatorApplication(Number(id)),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const student: any = appData?.application?.student;

  // Sync editMode from DB on first load
  // Auto-enable edit mode when the app is in coordinator's court (submitted)
  const editModeSynced = React.useRef(false);
  React.useEffect(() => {
    if (appData && !editModeSynced.current) {
      const status = appData.application?.status;
      const autoEdit = status === 'submitted';
      setEditMode(appData.application?.coordinator_editing ?? autoEdit);
      if (autoEdit && !appData.application?.coordinator_editing) {
        setCoordinatorEditingState(Number(id), true);
      }
      editModeSynced.current = true;
    }
  }, [appData]);

  const toggleEdit = (val: boolean) => {
    setEditMode(val);
    setCoordinatorEditingState(Number(id), val);
  };

  React.useEffect(() => {
    const bc = new BroadcastChannel('app-updates');
    bc.onmessage = (e) => {
      if (e.data.type === 'REFRESH_APP' && e.data.appId === Number(id)) {
        queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      }
    };
    return () => bc.close();
  }, [id, queryClient]);

  const invalidateDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ['coordinator-applications'] });
    queryClient.invalidateQueries({ queryKey: ['coordinator-dashboard'] });
  };

  const reviewMutation = useMutation({
    mutationFn: (data: any) => reviewSelection(Number(id), data),
    onSuccess: async (data, variables) => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      invalidateDashboard();
      
      const action = variables?.action;
      if (action === 'reject') {
        message.success(t('manualReview.rejectedSuccess', 'Proposal rejected successfully'));
      } else if (action === 'override') {
        message.success(t('manualReview.approvedSuccess', 'Override applied successfully'));
      } else if (action === 'manual_review_required') {
        message.success(t('manualReview.analysisComplete', 'Sent to manual review workspace'));
      } else {
        message.success(t('manualReview.approvedSuccess', 'Selection approved successfully'));
      }
      
      setReviewModal(false);
    },
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed'),
  });

  const sendBackMutation = useMutation({
    mutationFn: ({ notes, mode }: { notes?: string; mode?: string }) =>
      sendBackApplication(Number(id), notes, mode),
    onSuccess: async (_data, vars) => {
      setSelectedId(null);
      toggleEdit(false);
      // Force immediate refetch — don't use stale cache
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      invalidateDashboard();
      message.success(t('coordinatorReview.actions.sendBack'));
    },
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => bulkApproveSubmitted(Number(id)),
    onSuccess: async (data: any) => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      invalidateDashboard();
      message.success(t('coordinatorReview.bulkApproveSuccess', { count: data?.approved_count || 0 }));
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('common.error')),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeApplication(Number(id)),
    onSuccess: async (data: any) => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      invalidateDashboard();
      toggleEdit(false);
      if (data.learning_agreement_ready) {
        message.success(t('coordinatorReview.learningAgreementReady'));
      } else {
        message.success(t('coordinatorDashboard.table.approved'));
      }
    },
  });

  const revertMutation = useMutation({
    mutationFn: () => revertFinalization(Number(id)),
    onSuccess: async () => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      invalidateDashboard();
      message.success('Application reverted to submitted state');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to submit'),
  });

  const rawSelections = appData?.selections || [];
  const rawApp = appData?.application || {};

  const getExportData = () => {
    return rawSelections
      .filter((s: any) => s.status !== 'not_selected' && (s.status === 'approved' || (s.coordinator_override_courses?.length || 0) > 0))
      .map((s: any) => {
        const isOverridden = (s.coordinator_override_courses?.length || 0) > 0;
        const homeCourses = isOverridden ? s.coordinator_override_courses : s.selected_home_courses;
        const homeCourseText = homeCourses?.map((hc: any) => `${hc.course_code || ''} ${hc.course_name}`).join(', ') || 'N/A';
        const homeEcts = homeCourses?.reduce((sum: number, hc: any) => sum + (hc.ects || 0), 0) || 0;
        
        return {
          partnerCode: s.partner_course?.course_code || '-',
          partnerName: s.partner_course?.course_name || 'Unknown',
          partnerEcts: s.partner_course?.ects || 0,
          homeCourseText,
          homeEcts,
          status: s.status.toUpperCase(),
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
    doc.text(sanitizeForPDF(`Learning Agreement - ${appData?.application?.student?.name || 'Student'}`), 14, 15);
    doc.setFontSize(12);
    doc.text(sanitizeForPDF(`Partner University: ${appData?.application?.partner_university?.name || '-'}`), 14, 22);
    
    const tableData = getExportData().map((r: any) => [
      sanitizeForPDF(r.partnerCode), sanitizeForPDF(r.partnerName), sanitizeForPDF(r.partnerEcts),
      sanitizeForPDF(r.homeCourseText), sanitizeForPDF(r.homeEcts), sanitizeForPDF(r.status)
    ]);

    autoTable(doc, {
      startY: 30,
      head: [['Partner Code', 'Partner Course', 'Partner ECTS', 'Home Course(s)', 'Home ECTS', 'Status']],
      body: tableData,
    });

    doc.save(`${appData?.application?.student?.eid || 'student'}_learning_agreement.pdf`);
  };

  const handleExportXLSX = async () => {
    const XLSX = await import('xlsx');
    const data = getExportData().map((r: any) => ({
      'Partner Code': r.partnerCode,
      'Partner Course': r.partnerName,
      'Partner ECTS': r.partnerEcts,
      'Home Course(s)': r.homeCourseText,
      'Home ECTS': r.homeEcts,
      'Status': r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Learning Agreement");
    XLSX.writeFile(wb, `${appData?.application?.student?.eid || 'student'}_learning_agreement.xlsx`);
  };

  const sendNoteMutation = useMutation({
    mutationFn: (notes: string) => sendNote(Number(id), notes),
    onSuccess: async () => {
      message.success('Note sent to student');
      setNoteModal(false);
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['coordinator-app', id] });
      invalidateDashboard();
    },
  });

  // Pre-fill note modal with existing coordinator_notes when opened
  useEffect(() => {
    if (noteModal) {
      noteForm.setFieldsValue({ notes: appData?.application?.coordinator_notes || '' });
    }
  }, [noteModal]);

  // Workflow history
  const { data: historyData } = useQuery({
    queryKey: ['workflow-history', id],
    queryFn: () => getWorkflowHistory('student_application', Number(id)),
    enabled: historyModal && !!id,
  });



  const getSelectionPriority = (row: any): number => {
    const s = row.status;
    const hasAlt = (row.alternative_home_course_ids?.length || 0) > 0;
    const noMatch = !!row.no_match_requested;
    if (s === 'manual_review_required') return 1;
    if (noMatch && hasAlt) return 2;
    if (noMatch) return 3;
    if (hasAlt) return 4;
    if (s === 'submitted_for_review') return 5;
    if (s === 'draft_selected') return 6;
    if (s === 'approved' || s === 'rejected') return 7;
    return 8;
  };

  const selections = [...(appData?.selections || [])].sort(
    (a: any, b: any) => getSelectionPriority(a) - getSelectionPriority(b)
  );

  const ectsData = useMemo(() => {
    // 1. Filter out not_selected and rejected
    const activeSelections = selections.filter((s: any) => !['not_selected', 'rejected'].includes(s.status));
    
    // 2. Define countsAsApproved (Decision exists and student hasn't removed it)
    const countsAsApproved = (s: any) => s.status !== 'not_selected' && (s.status === 'approved' || (s.coordinator_override_courses?.length || 0) > 0);

    // 3. Approved total calculation
    const localApprovedEcts = activeSelections.reduce((sum: number, s: any) => {
      if (countsAsApproved(s)) return sum + (s.partner_course?.ects || 0);
      return sum;
    }, 0);

    // 4. Selected total calculation
    const localSelectedEcts = activeSelections.reduce((sum: number, s: any) => {
      return sum + (s.partner_course?.ects || 0);
    }, 0);

    // 5. Dynamic Home ECTS calculation
    const localHomeActive = new Map<number, number>();
    const localHomeApproved = new Map<number, number>();
    
    selections.forEach((s: any) => {
      if (s.status === 'not_selected' || s.no_match_requested) return;
      
      const hmap = new Map<number, number>();
      const hasOverride = (s.coordinator_override_courses?.length || 0) > 0;
      if (hasOverride) {
        s.coordinator_override_courses.forEach((c: any) => hmap.set(c.id, c.ects || 0));
      } else {
        const homeCourses = s.selected_home_courses && s.selected_home_courses.length > 0
          ? s.selected_home_courses
          : (s.selected_home_course ? [s.selected_home_course] : []);
        if (homeCourses.length > 0) {
          homeCourses.forEach((c: any) => hmap.set(c.id, c.ects || 0));
        }
      }
      if (s.alternative_home_courses_detail) {
        s.alternative_home_courses_detail.forEach((c: any) => hmap.set(c.id, c.ects || 0));
      }
      
      const isActive = ['draft_selected', 'submitted_for_review', 'approved', 'manual_review_required', 'reviewed', 'rejected'].includes(s.status) || (s.alternative_home_course_ids?.length || 0) > 0 || hasOverride;
      if (isActive) hmap.forEach((ects, id) => localHomeActive.set(id, ects));
      
      const isApproved = ['approved'].includes(s.status) || hasOverride;
      if (isApproved) hmap.forEach((ects, id) => localHomeApproved.set(id, ects));
    });

    const homeSelected = Array.from(localHomeActive.values()).reduce((sum, ects) => sum + ects, 0);
    const homeApproved = Array.from(localHomeApproved.values()).reduce((sum, ects) => sum + ects, 0);

    return { localSelectedEcts, localApprovedEcts, homeSelected, homeApproved };
  }, [selections]);

  const selected = selections.length > 0
    ? (selectedId != null
      ? selections.find((s) => s.id === selectedId) ?? selections[0]
      : selections[0])
    : null;

  // Global Course Search for Override
  const { data: homeData, isLoading: homeLoading } = useQuery({
    queryKey: ['home-courses-global', id, selected?.partner_course_id, debouncedOverrideSearch],
    queryFn: () => getHomeCourses(Number(id), selected?.partner_course_id || 0, debouncedOverrideSearch || undefined),
    enabled: !!id && !!selected?.partner_course_id && reviewModal && reviewAction === 'override',
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#888' }}>Loading application...</div>
      </div>
    );
  }

  if (!appData) return <Empty description="Application not found" />;

  const app = appData.application;

  const handleReview = (action: string) => {
    // Approve and Manual Review don't need a modal — fire directly
    if (action === 'approve' || action === 'manual_review_required') {
      if (selected) reviewMutation.mutate({ selection_id: selected.id, action });
      return;
    }
    setReviewAction(action);
    form.resetFields();
    // Pre-populate override modal: existing overrides OR student's current selections
    if (action === 'override' && selected) {
      const existingOverrideIds = (selected.coordinator_override_courses || []).map((c: any) => c.id);
      const studentSelectedIds = selected.selected_home_course_ids || (selected.selected_home_course_id ? [selected.selected_home_course_id] : []);
      const preselect = existingOverrideIds.length ? existingOverrideIds : studentSelectedIds;
      form.setFieldsValue({
        action,
        override_home_course_ids: preselect.length ? preselect : undefined,
        notes: selected.coordinator_note || undefined,
      });
    } else {
      form.setFieldsValue({ action });
    }
    setReviewModal(true);
  };

  const handleSubmitReview = () => {
    if (!selected) return;
    form.validateFields().then(values => {
      const payload: any = { selection_id: selected.id, ...values };
      // For override, send array; also set single for backward compat
      if (values.override_home_course_ids?.length) {
        payload.override_home_course_id = values.override_home_course_ids[values.override_home_course_ids.length - 1];
      }
      reviewMutation.mutate(payload);
    });
  };

  const handleSendBack = () => {
    let sendBackNotes = '';
    Modal.confirm({
      title: t('coordinatorReview.sendBackTitle'),
      content: (
        <div>
          <p>{t('coordinatorReview.sendBackContent')}</p>
          <div style={{ marginTop: 12 }}>
            <Text strong>{t('coordinatorReview.sendBackNoteLabel')}</Text>
            <Input.TextArea
              rows={3}
              placeholder={t('coordinatorReview.sendBackPlaceholder')}
              style={{ marginTop: 8 }}
              onChange={(e) => { sendBackNotes = e.target.value; }}
            />
          </div>
        </div>
      ),
      onOk: () => sendBackMutation.mutate({ notes: sendBackNotes || t('coordinatorReview.sendBackDefaultNote'), mode: 'draft' }),
      okText: t('coordinatorReview.sendBackTitle'),
    });
  };

  // Coordinator is locked out when student has opened the sent-back draft
  const studentHasOpened = !!app?.student_draft_viewed_at;
  const isAwaitingStudent = app?.status === 'revision_requested';
  // Coordinator can edit unless student has already opened the draft
  const coordinatorLocked = (app?.status === 'draft' || app?.status === 'revision_requested') && studentHasOpened;
  // draft/revision + submitted_at set + student hasn't opened → coordinator can still edit
  const isSentBackEditable = (app?.status === 'draft' || app?.status === 'revision_requested') && !!app?.submitted_at && !studentHasOpened;
  // draft + never submitted → coordinator has no actions
  const neverSubmitted = app?.status === 'draft' && !app?.submitted_at;
  // full action buttons only when app is in coordinator's court
  const isActionable = app?.status === 'submitted';
  const hasApprovedOverrides = (appData?.selections || []).some(
    (s: any) => s.coordinator_override_courses?.length > 0 && ['approved', 'submitted_for_review', 'rejected'].includes(s.status)
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/coordinator')} style={{ marginBottom: 12 }}>
        {t('coordinatorReview.backToDashboard')}
      </Button>
      <Card size="small" style={{ marginBottom: 16, borderRadius: 10, border: '1px solid #e8e8e8' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space size={8} align="center">
              <SwapOutlined style={{ color: '#1677ff', fontSize: 16 }} />
              <Title level={4} style={{ margin: 0 }}>
                {app.student?.name || app.student?.eid}
              </Title>
            </Space>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary">{app.partner_university?.name}</Text>
              {app.semester && (
                <Tag color="purple" style={{ marginLeft: 8, fontSize: 10 }}>
                  {app.semester === 'fall' ? t('courseTable.options.fall') : t('courseTable.options.spring')}
                </Tag>
              )}
            </div>
          </Col>
          <Col>
            <Space>
              <ApplicationStatusBadge status={app.status} />
              {app.status === 'learning_agreement_ready' && (
                <Button 
                  size="small" 
                  danger 
                  icon={<UndoOutlined />} 
                  loading={revertMutation.isPending}
                  onClick={() => {
                    Modal.confirm({
                      title: t('coordinatorReview.revertReadyTitle'),
                      content: t('coordinatorReview.revertReadyContent'),
                      okType: 'danger',
                      onOk: () => revertMutation.mutate()
                    });
                  }}
                >
                  {t('coordinatorReview.revert')}
                </Button>
              )}
              <Button size="small" onClick={() => setHistoryModal(true)}>
                {t('coordinatorReview.history')}
              </Button>
            </Space>
          </Col>
        </Row>
        {app.student_notes && (
          <Alert
            message={t('coordinatorReview.studentNotes')}
            description={app.student_notes}
            type="info"
            showIcon
            style={{ marginTop: 12, borderRadius: 8 }}
          />
        )}
      </Card>

      {/* Awaiting student — read-only banner */}
      {isAwaitingStudent && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, borderRadius: 8 }}
          message={
            app.status === 'revision_requested'
              ? t('coordinatorReview.revisionBanner')
              : t('coordinatorReview.revisionBanner')
          }
        />
      )}

      {/* ECTS */}
      <EctsProgressBar
        selected={ectsData.localSelectedEcts}
        approved={ectsData.localApprovedEcts}
        target={30}
        threshold={28}
        homeSelected={ectsData.homeSelected}
        homeApproved={ectsData.homeApproved}
        homeTarget={30}
        isCoordinator={true}
      />

      {/* Threshold and Readiness Alert */}
      {app.status === 'learning_agreement_ready' && (() => {
        const pendingReviews = selections.filter((s: any) =>
          ['submitted_for_review', 'manual_review_required'].includes(s.status) &&
          !((s.coordinator_override_courses?.length || 0) > 0)
        );
        const hasPending = pendingReviews.length > 0;
        
        // Use the same local calculation for consistent messaging
        const activeSelections = selections.filter((s: any) => !['not_selected', 'rejected'].includes(s.status));
        const countsAsApproved = (s: any) => s.status !== 'not_selected' && (s.status === 'approved' || (s.coordinator_override_courses?.length || 0) > 0);
        const localApprovedEcts = activeSelections.reduce((sum: number, s: any) => {
          if (countsAsApproved(s)) return sum + (s.partner_course?.ects || 0);
          return sum;
        }, 0);

        return (
          <Alert
            message={hasPending ? t('applicationStatus.submitted.label') : t('coordinatorReview.learningAgreementReady')}
            description={
              hasPending ? (
                <span>
                  {t('coordinatorReview.approvedSummary', { name: app.student?.name || 'Student', ects: localApprovedEcts })}
                  {' '}
                  <Text strong style={{ color: '#d46b08' }}>
                    {t('coordinatorReview.pendingDecisions', { count: pendingReviews.length })}
                  </Text>
                </span>
              ) : (
                <>
                  {t('coordinatorReview.approvedSummary', { name: app.student?.name || 'Student', ects: localApprovedEcts })}
                  {' '}
                  {t('coordinatorReview.allRequirementsMet')}
                </>
              )
            }
            type={hasPending ? 'warning' : 'success'}
            showIcon
            icon={<SafetyCertificateOutlined />}
            action={
              <Space>
                <Button 
                  size="small" 
                  type="text" 
                  icon={<UndoOutlined />} 
                  loading={revertMutation.isPending}
                  onClick={() => {
                    Modal.confirm({
                      title: t('coordinatorReview.revertReadyTitle'),
                      content: t('coordinatorReview.revertReadyContent'),
                      okType: 'danger',
                      onOk: () => revertMutation.mutate()
                    });
                  }}
                >
                  {t('coordinatorReview.revertFinalization')}
                </Button>
                {!hasPending && (
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
                  {t('coordinatorReview.viewLearningAgreement')}
                </Button>
                )}
              </Space>
            }
            style={{ marginBottom: 16, borderRadius: 8 }}
          />
        );
      })()}

      {/* Dual-table Layout */}
      <Row gutter={16} style={{ alignItems: 'stretch' }}>
        {/* Left: Partner Courses */}
        <Col span={8} style={{ display: 'flex', flexDirection: 'column' }}>
          <Card
              style={{ borderRadius: 10, flex: 1 }}
          >
            <Table
              dataSource={[...selections].sort((a: any, b: any) => {
                const getOrder = (row: any) => {
                  const s = row.status;
                  const hasOverride = (row.coordinator_override_courses?.length || 0) > 0;
                  const hasAlternative = (row.alternative_home_course_ids?.length || 0) > 0;
                  const noMatch = !!row.no_match_requested;

                  // Priority 1: Decisions made (Overrides & Real Approvals)
                  if (hasOverride) return 1;
                  if (s === 'approved' && !hasAlternative && !noMatch) return 2;
                  
                  // Priority 2: Direct Matches (Submitted without any manual flags)
                  if (s === 'submitted_for_review' && !hasAlternative && !noMatch) return 3;

                  // Priority 3: Coordinator Attention Required (In student's order of preference)
                  if (hasAlternative) return 4;
                  if (noMatch) return 5;

                  // Priority 4: Other intermediate states
                  if (s === 'submitted_for_review') return 6;
                  if (s === 'manual_review_required') return 7;
                  if (s === 'draft_selected') return 8;
                  
                  // Priority 5: Negative states (Bottom)
                  if (s === 'rejected') return 9;
                  if (s === 'not_selected') return 10;
                  return 11;
                };
                return getOrder(a) - getOrder(b);
              })}
               columns={[
                {
                  title: t('courseTable.columns.courseCode'),
                  dataIndex: ['partner_course', 'course_code'],
                  width: 65,
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                },
                {
                  title: t('courseTable.columns.courseName'),
                  dataIndex: ['partner_course', 'course_name'],
                  ellipsis: true,
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                },
                {
                  title: t('courseTable.columns.ects'),
                  dataIndex: ['partner_course', 'ects'],
                  width: 50,
                  render: (v: number) => <Tag style={{ fontSize: 10 }}>{v}</Tag>,
                },
                {
                  title: t('coordinatorDashboard.columns.status'),
                  width: 130,
                  render: (_: any, row: any) => {
                    const s = row.status;
                    const hasAlternative = (row.alternative_home_course_ids?.length || 0) > 0;
                    const isOverridden = (row.coordinator_override_courses?.length || 0) > 0;
                    const isManualReview = (row.alternative_home_course_ids?.length || 0) > 0 || !!row.no_match_requested;
                    const altIds: number[] = row.alternative_home_course_ids || [];
                    const overrideIsStudentSuggestion = isOverridden && (row.coordinator_override_courses || []).some((o: any) => altIds.includes(o.id));

                    if (isOverridden) {
                        if (s === 'not_selected') {
                            return <Tag color="#8c8c8c" style={{ fontSize: 10, fontWeight: 600 }}>{t('coordinatorReview.actions.deleteApp').toUpperCase()}</Tag>;
                        }
                        const label = overrideIsStudentSuggestion ? `${t('coordinatorDashboard.table.approved')} (${t('coordinatorDashboard.statusOptions.revision')})` : t('coordinatorReview.actions.override').toUpperCase();
                        return <Tag color="#52c41a" style={{ fontSize: 10, fontWeight: 600 }}>{label}</Tag>;
                    }

                    // 1. Decisions that definitely end the review cycle
                    if (s === 'rejected') return <Tag color="#ff4d4f" style={{ fontSize: 10, fontWeight: 600 }}>{t('coordinatorDashboard.statusOptions.rejected').toUpperCase()}</Tag>;
                    if (s === 'draft_selected') return <Tag color="#1677ff" style={{ fontSize: 10, fontWeight: 600 }}>{t('coordinatorDashboard.statusOptions.draft').toUpperCase()}</Tag>;

                    // 2. Special Manual Review states (even if status is approved by default)
                    if (row.no_match_requested) return <Tag color="#eb2f96" style={{ fontSize: 10, fontWeight: 600 }}>{t('coordinatorReview.reviewReq').toUpperCase()}</Tag>;
                    if (hasAlternative) return <Tag color="#13c2c2" style={{ fontSize: 10, fontWeight: 600 }}>{t('coordinatorDashboard.statusOptions.revision').toUpperCase()} {row.alternative_home_course_ids.length}</Tag>;

                    // 3. Approved only if no special manual review states are active
                    if (s === 'approved') return <Tag color="#52c41a" style={{ fontSize: 10, fontWeight: 600 }}>{t('coordinatorDashboard.table.approved').toUpperCase()}</Tag>;

                    // 4. Fallback to generic status labels
                    const map: Record<string, { label: string; color: string }> = {
                        submitted_for_review:  { label: t('applicationStatus.submitted.label'),  color: '#fa8c16' },
                        manual_review_required:{ label: t('applicationStatus.manual_review_required.label'),     color: '#eb2f96' },
                    };
                    const cfg = map[s];
                    if (cfg) {
                        return <Tag color={cfg.color} style={{ fontSize: 10, fontWeight: 600 }}>{cfg.label}</Tag>;
                    }

                    return <Tag color="#8c8c8c" style={{ fontSize: 10, fontWeight: 600 }}>{s?.replace(/_/g, ' ').toUpperCase() || '—'}</Tag>;
                  },
                },
              ]}
              rowKey="id"
              size="small"
              rowClassName={(row: any) =>
                row.id === (selected?.id) ? 'ant-table-row-selected' : ''
              }
              onRow={(row: any) => ({
                onClick: () => setSelectedId(row.id),
                style: { cursor: 'pointer' },
              })}
              pagination={false}
              scroll={{ y: 460 }}
            />
          </Card>
        </Col>

        {/* Right: Detail Panel */}
        <Col span={16} style={{ display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <Card
              size="small"
              title={
                <Space>
                  <Text strong style={{ fontSize: 14 }}>
                    {selected.partner_course?.course_code} — {selected.partner_course?.course_name}
                  </Text>
                  {(() => {
                    const isOverridden = (selected.coordinator_override_courses?.length || 0) > 0;
                    const isApproved = selected.status === 'approved' || isOverridden;
                    const color = isApproved ? '#52c41a' : selected.status === 'rejected' ? '#ff4d4f' : '#fa8c16';
                    const label = isOverridden 
                      ? `${t('coordinatorDashboard.table.approved')} (${t('coordinatorReview.actions.override').toUpperCase()})` 
                      : t(`applicationStatus.${selected.status}.label`, { defaultValue: selected.status.toUpperCase() });
                    return <Tag color={color}>{label}</Tag>;
                  })()}
                  {/* Strike/Appeal system removed */}
                </Space>
              }
              style={{ borderRadius: 10 }}
            >
              {/* Partner Course Details — always expanded, scrollable */}
              {selected.partner_course?.id && (
                <div style={{ marginBottom: 8, maxHeight: 340, overflowY: 'auto' }}>
                  <CourseDetailsPanel
                    courseId={selected.partner_course.id}
                    label={t('coordinatorReview.partnerCourseDetails')}
                    icon={<FileTextOutlined style={{ color: '#fa8c16' }} />}
                    columns={2}
                    alwaysOpen
                  />
                </div>
              )}

              <Divider style={{ margin: '8px 0' }} />

              {/* Student's Selected Home Courses — all selections */}
              {(() => {
                const overrideCourses: any[] = selected.coordinator_override_courses || [];
                const isManualReviewSel = (selected.alternative_home_course_ids?.length || 0) > 0 || !!selected.no_match_requested;
                const selAltIds: number[] = selected.alternative_home_course_ids || [];
                const overrideIsSelSuggestion = overrideCourses.some((o: any) => selAltIds.includes(o.id));
                return (
                  <>
                    {(() => {
                      const multiCourses = selected.selected_home_courses || [];
                      const homeCourses = multiCourses.length > 0 ? multiCourses : (selected.selected_home_course ? [selected.selected_home_course] : []);
                      if (homeCourses.length > 0) {
                        return (
                          <div style={{ marginBottom: 8 }}>
                            <Space size={6} style={{ marginBottom: 8 }}>
                              <HomeOutlined style={{ color: '#52c41a' }} />
                              <Text style={{ fontSize: 12, fontWeight: 600 }}>
                                {t('coordinatorReview.studentsSelection')}{homeCourses.length > 1 ? ` (${homeCourses.length})` : ''}
                              </Text>
                            </Space>
                            {homeCourses.map((hc: any) => {
                              const candidate = selected.candidates?.find((c: any) => c.home_course_id === hc.id);
                              const ver = candidate?.verification_status || hc.verification_status;
                              const tagColor = ver === 'approved' ? 'green' : ver === 'risk_flagged' ? 'gold' : ver === 'rejected' ? 'red' : 'blue';
                              const isSuperseded = overrideCourses.length > 0;
                              return (
                                <div key={hc.id} style={{ marginBottom: 6, opacity: isSuperseded ? 0.6 : 1 }}>
                                  <Space size={6} style={{ marginBottom: 4 }}>
                                    <Tag color={isSuperseded ? 'default' : tagColor} style={{ fontSize: 11 }}>{hc.course_code}</Tag>
                                    <Text style={{ fontSize: 12, textDecoration: isSuperseded ? 'line-through' : 'none' }}>{hc.course_name}</Text>
                                  </Space>
                                  <Descriptions size="small" column={2} bordered style={{ marginBottom: 4 }}>
                                    <Descriptions.Item label={t('courseTable.columns.ects')}>{hc.ects}</Descriptions.Item>
                                    <Descriptions.Item label={t('courseTable.columns.category')}>{hc.category ? t(`courseTable.categories.${hc.category}`, { defaultValue: hc.category }) : hc.department || '—'}</Descriptions.Item>
                                  </Descriptions>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Coordinator Override section */}
                    {overrideCourses.length > 0 && (() => {
                      const isApproveCase = isManualReviewSel && overrideIsSelSuggestion;
                      const accentColor = isApproveCase ? '#52c41a' : '#d46b08';
                      const bgColor = isApproveCase ? '#f6ffed' : '#fff7e6';
                      const borderColor = isApproveCase ? '#b7eb8f' : '#d46b08';
                      return (
                      <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 6, border: `1px solid ${borderColor}`, background: bgColor }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Space size={6}>
                            <SwapOutlined style={{ color: accentColor }} />
                            <Text style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>
                              {isApproveCase ? t('coordinatorReview.coordinatorsApprove') : t('coordinatorReview.coordinatorsOverride')}{overrideCourses.length > 1 ? ` (${overrideCourses.length})` : ''}
                            </Text>
                          </Space>
                          {editMode && (
                            <Button
                              size="small"
                              type="text"
                              danger
                              style={{ fontSize: 11 }}
                              loading={reviewMutation.isPending}
                              onClick={() => {
                                // clear_override is the only action that successfully removes the orange banner
                                // We rely on UI logic to show SUGGESTED/REVIEW REQ afterwards
                                reviewMutation.mutate({ 
                                  action: 'clear_override', 
                                  selection_id: selected.id
                                });
                              }}
                            >
                              {t('coordinatorReview.actions.remove')}
                            </Button>
                          )}
                        </div>
                        {overrideCourses.map((oc: any) => (
                          <div key={oc.id} style={{ marginBottom: 6 }}>
                            <Space size={6} style={{ marginBottom: 4 }}>
                              {oc.course_code && <Tag color="orange" style={{ fontSize: 11 }}>{oc.course_code}</Tag>}
                              <Text style={{ fontSize: 12 }}>{oc.course_name}</Text>
                            </Space>
                            <Descriptions size="small" column={2} bordered style={{ marginBottom: 2 }}>
                              <Descriptions.Item label={t('courseTable.columns.ects')}>{oc.ects}</Descriptions.Item>
                              <Descriptions.Item label={t('courseTable.columns.category')}>
                                {oc.category ? t(`courseTable.categories.${oc.category}`, { defaultValue: oc.category }) : oc.department || '—'}
                              </Descriptions.Item>
                            </Descriptions>
                          </div>
                        ))}
                        {selected.coordinator_note && (
                          <div style={{ marginTop: 6, padding: '5px 8px', background: '#ffefd5', borderRadius: 4, fontSize: 12 }}>
                            <Text style={{ fontSize: 11, fontWeight: 600, color: accentColor, display: 'block', marginBottom: 2 }}>{t('coordinatorReview.actions.note')}</Text>
                            "{selected.coordinator_note}"
                          </div>
                        )}
                      </div>
                      );
                    })()}

                    {/* Coordinator Rejection section */}
                    {selected.status === 'rejected' && overrideCourses.length === 0 && (
                      <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 8, border: '1px solid #ff4d4f', background: '#fff2f0' }}>
                        <Space size={8} style={{ marginBottom: 8 }}>
                          <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 16 }} />
                          <Text style={{ fontSize: 13, fontWeight: 700, color: '#cf1322' }}>{t('coordinatorReview.partnerNotApproved')}</Text>
                        </Space>
                        <div style={{ marginBottom: 10 }}>
                          <Text style={{ fontSize: 12, color: '#555', lineHeight: 1.5, display: 'block' }}>
                            {t('coordinatorReview.partnerNotApprovedDesc')}
                          </Text>
                        </div>
                        {selected.coordinator_note ? (
                          <div style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #ffa39e' }}>
                            <Text style={{ fontSize: 11, fontWeight: 600, color: '#cf1322', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{t('coordinatorReview.actions.note')}</Text>
                            <Text style={{ fontSize: 12, color: '#333', fontStyle: 'italic' }}>"{selected.coordinator_note}"</Text>
                          </div>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 11 }}>{t('coordinatorReview.noReasonProvided')}</Text>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}

              {!selected.selected_home_course && !selected.no_match_requested && !(selected.alternative_home_course_ids?.length) && (
                <Alert
                  message={t('coordinatorReview.noSelection')}
                  description={t('coordinatorReview.noSelectionDesc')}
                  type="info"
                  style={{ borderRadius: 6 }}
                />
              )}

              {/* Student's Alternative Suggestion — Always visible if data exists */}
              {(selected.alternative_home_course_ids?.length || 0) > 0 && (
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #5cdbd3', background: '#f0fafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <Space size={6}>
                      <BulbOutlined style={{ color: '#08979c', fontSize: 16 }} />
                      <Text style={{ fontSize: 13, fontWeight: 700, color: '#08979c' }}>
                        {t('coordinatorReview.studentAlternativeSuggestion')}
                      </Text>
                    </Space>
                    <Tag color="cyan">{(selected.alternative_home_course_ids?.length || 0)} {t('coordinatorReview.suggestion').toUpperCase()}</Tag>
                  </div>

                  {(selected.alternative_home_courses_detail?.length 
                    ? selected.alternative_home_courses_detail 
                    : (selected.alternative_home_course_ids || []).map((id: number) => ({ 
                        id, 
                        course_code: null, 
                        course_name: selected.alternative_home_course_names?.[id] ?? `#${id}`, 
                        ects: null 
                      }))
                  ).map((oc: any) => (
                    <div key={oc.id} style={{ marginBottom: 8, padding: '8px', background: '#fff', borderRadius: 6, border: '1px solid #e6f7f7' }}>
                      <Space size={6} style={{ marginBottom: 4 }}>
                        {oc.course_code && <Tag color="cyan" style={{ fontSize: 11 }}>{oc.course_code}</Tag>}
                        <Text strong style={{ fontSize: 12, color: '#08979c' }}>{oc.course_name}</Text>
                      </Space>
                      {(oc.ects != null || oc.category || oc.department) && (
                        <Descriptions size="small" column={2} style={{ marginTop: 4 }}>
                          <Descriptions.Item label={t('courseTable.columns.ects')}>{oc.ects ?? '—'}</Descriptions.Item>
                          <Descriptions.Item label={t('courseTable.columns.category')}>
                            {oc.category ? t(`courseTable.categories.${oc.category}`, { defaultValue: oc.category }) : oc.department || '—'}
                          </Descriptions.Item>
                        </Descriptions>
                      )}
                    </div>
                  ))}

                  {selected.alternative_reason && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: '#ffffff', borderRadius: 6, border: '1px dashed #5cdbd3' }}>
                      <Text style={{ fontSize: 11, fontWeight: 600, color: '#08979c', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{t('coordinatorReview.studentReason')}</Text>
                      <Text style={{ fontSize: 12, color: '#333', fontStyle: 'italic' }}>"{selected.alternative_reason}"</Text>
                    </div>
                  )}
                  
                  {selected.no_match_requested && selected.student_notes && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: '#fff1f0', borderRadius: 6, border: '1px solid #ffa39e' }}>
                       <Space size={4}>
                         <ExclamationCircleOutlined style={{ color: '#cf1322', fontSize: 12 }} />
                         <Text style={{ fontSize: 11, fontWeight: 600, color: '#cf1322' }}>{t('coordinatorReview.additionalReviewNote')}</Text>
                       </Space>
                       <Text style={{ fontSize: 12, color: '#555', display: 'block', marginTop: 2 }}>"{selected.student_notes}"</Text>
                    </div>
                  )}
                </div>
              )}

              {/* Review request without alternative suggest — Improved Design */}
              {selected.no_match_requested && (selected.alternative_home_course_ids?.length || 0) === 0 && (
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #ffa39e', background: '#fff1f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <Space size={6}>
                      <ExclamationCircleOutlined style={{ color: '#cf1322', fontSize: 16 }} />
                      <Text style={{ fontSize: 13, fontWeight: 700, color: '#cf1322' }}>
                        {t('coordinatorReview.studentReviewRequest')}
                      </Text>
                    </Space>
                    <Tag color="error">{t('coordinatorReview.noMatchFound')}</Tag>
                  </div>
                  
                  <div style={{ padding: '10px', background: '#fff', borderRadius: 6, border: '1px dashed #ffa39e' }}>
                    <Text style={{ fontSize: 11, fontWeight: 600, color: '#cf1322', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>
                      {t('coordinatorReview.studentNotes')}
                    </Text>
                    {selected.student_notes ? (
                      <Text style={{ fontSize: 12, color: '#333', fontStyle: 'italic' }}>
                        "{selected.student_notes}"
                      </Text>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
                        {t('coordinatorReview.noReasonProvided')}
                      </Text>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              {(() => {
                const s = selected.status;
                const hasSelection = !!selected.selected_home_course;
                const hasAlternative = (selected.alternative_home_course_ids?.length || 0) > 0;
                const studentHasActed = hasSelection || selected.no_match_requested || hasAlternative;
                const isOverridden = (selected.coordinator_override_courses?.length || 0) > 0;

                const showApprove = hasSelection && (s !== 'approved' || isOverridden);
                const showReject = studentHasActed && (s !== 'rejected' || isOverridden);
                const showOverride = studentHasActed;
                const showManualReview = studentHasActed;

                if (coordinatorLocked || isAwaitingStudent) return null;
                if (!showApprove && !showReject && !showOverride && !showManualReview) return null;
                if (!editMode) return null;
                return (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {showApprove && (
                      <Button type="primary" icon={<CheckCircleOutlined />} loading={reviewMutation.isPending}
                        onClick={() => handleReview('approve')} style={{ borderRadius: 6 }}>
                        {t('coordinatorReview.actions.approve')}
                      </Button>
                    )}
                    {showReject && (
                      <Button danger icon={<CloseCircleOutlined />}
                        onClick={() => handleReview('reject')} style={{ borderRadius: 6 }}>
                        {t('coordinatorReview.actions.reject')}
                      </Button>
                    )}
                    {showOverride && (
                      <Button icon={<SwapOutlined />}
                        onClick={() => handleReview('override')}
                        style={{ borderRadius: 6, ...(isOverridden ? { borderColor: '#d46b08', color: '#d46b08' } : {}) }}>
                        {isOverridden ? t('coordinatorReview.actions.reOverride') : t('coordinatorReview.actions.override')}
                      </Button>
                    )}
                    {showManualReview && (
                      <Button icon={<ToolOutlined />}
                        onClick={() => window.open(`/coordinator/manual-review/${selected.id}?appId=${id}`, '_blank')} style={{ borderRadius: 6 }}>
                        {t('coordinatorReview.actions.manualReview')}
                      </Button>
                    )}
                  </div>
                );
              })()}
            </Card>
          ) : (
            <Card style={{ borderRadius: 10 }}>
              <Empty description={t('coordinatorReview.matchCandidatesHeader')} />
            </Card>
          )}
        </Col>
      </Row>

      {/* Match Candidates — full width below dual tables */}
      {selected?.candidates && selected.candidates.length > 0 && (
        <Card
          title={
            <Space>
              <Text strong style={{ fontSize: 13 }}>{t('coordinatorReview.matchCandidatesHeader')}</Text>
              <Tag>{selected.candidates.length} {t('coordinatorReview.selected').toLowerCase()}</Tag>
            </Space>
          }
          style={{ marginTop: 16, borderRadius: 10 }}
          styles={{ header: { background: '#fafafa', borderRadius: '10px 10px 0 0' } }}
        >
          <Row gutter={[16, 16]}>
            {(() => {
              const selectedHomeIds = new Set<number>(
                (selected.selected_home_courses || []).length > 0
                  ? selected.selected_home_courses!.map((hc: any) => hc.id)
                  : (selected.selected_home_course ? [selected.selected_home_course.id] : [])
              );
              const overrideIds = new Set<number>((selected.coordinator_override_courses || []).map((o: any) => o.id));
              const isManualReviewCase = (selected.alternative_home_course_ids?.length || 0) > 0 || !!selected.no_match_requested;
              const caseAltIds: number[] = selected.alternative_home_course_ids || [];
              return selected.candidates.map((c: any) => {
              const isStudentSelected = selectedHomeIds.has(c.home_course_id);
              const isCoordinatorOverride = overrideIds.has(c.home_course_id);
              const isNotRec = c.is_not_recommended;
              const pct = Math.round(c.overall_score * 100);
              const color = pct >= 70 ? '#52c41a' : pct >= 40 ? '#faad14' : '#ff4d4f';
              const rankBg = c.rank === 1 ? '#52c41a' : c.rank === 2 ? '#faad14' : '#d9d9d9';
              const catCfg: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
                technical: { label: t('coordinatorReview.categories.technical'), color: '#1890ff', icon: <ExperimentOutlined /> },
                social: { label: t('coordinatorReview.categories.social'), color: '#722ed1', icon: <BookOutlined /> },
                studio_based: { label: t('coordinatorReview.categories.studio'), color: '#fa8c16', icon: <ThunderboltOutlined /> },
              };
              const verCfg: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
                approved: { color: '#52c41a', icon: <CheckCircleOutlined />, label: t('coordinatorDashboard.table.approved') },
                rejected: { color: '#ff4d4f', icon: <CloseCircleOutlined />, label: t('coordinatorDashboard.statusOptions.rejected') },
                risk_flagged: { color: '#faad14', icon: <WarningOutlined />, label: 'Risk Flagged' },
              };

              return (
                <Col xs={24} lg={8} key={c.id}>
                  <Card
                    size="small"
                    style={{
                      borderRadius: 8,
                      border: `2px solid ${isCoordinatorOverride ? '#d46b08' : isStudentSelected ? '#1677ff' : c.rank === 1 ? '#52c41a33' : isNotRec ? '#ffccc7' : '#f0f0f0'}`,
                      background: isCoordinatorOverride ? '#fff7e6' : isStudentSelected ? '#f0f5ff' : isNotRec ? '#fff2f0' : '#fff',
                      height: '100%',
                    }}
                    styles={{ body: { padding: 16 } }}
                  >
                    {/* Banners */}
                    {isCoordinatorOverride && (() => {
                      const isApproveBanner = isManualReviewCase && caseAltIds.includes(c.home_course_id);
                      return (
                        <div style={{
                          background: isApproveBanner ? '#52c41a' : '#d46b08', color: '#fff', fontSize: 10, fontWeight: 700,
                          textAlign: 'center', padding: '3px 0',
                          margin: '-16px -16px 12px -16px',
                          borderRadius: '6px 6px 0 0', letterSpacing: 1,
                        }}>
                          {isApproveBanner ? t('coordinatorReview.coordinatorsApprove').toUpperCase() : t('coordinatorReview.coordinatorsOverride').toUpperCase()}
                        </div>
                      );
                    })()}
                    {!isCoordinatorOverride && isStudentSelected && (
                      <div style={{
                        background: '#1677ff', color: '#fff', fontSize: 10, fontWeight: 700,
                        textAlign: 'center', padding: '3px 0',
                        margin: '-16px -16px 12px -16px',
                        borderRadius: '6px 6px 0 0', letterSpacing: 1,
                      }}>
                        {t('coordinatorReview.studentsSelection').toUpperCase()}
                      </div>
                    )}
                    {/* Rank + Score */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: rankBg, color: c.rank >= 3 ? '#666' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, marginBottom: 8,
                        }}>#{c.rank || '?'}</div>
                        <Progress
                          type="circle" percent={pct} size={68} strokeColor={color}
                          format={() => <span style={{ fontSize: 14, fontWeight: 700, color }}>{pct}%</span>}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.3 }}>
                          {c.home_course_code ? `${c.home_course_code} — ${c.home_course_name}` : c.home_course_name}
                        </Text>
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          <Tag color="blue" style={{ fontSize: 10 }}>{c.home_course_ects} {t('courseTable.columns.ects')}</Tag>
                          {c.category && (
                            <Tag icon={catCfg[c.category]?.icon} color={catCfg[c.category]?.color} style={{ fontSize: 10 }}>
                              {catCfg[c.category]?.label?.toUpperCase()}
                            </Tag>
                          )}
                          {c.home_course_category && (
                            <Tag style={{ fontSize: 10, color: '#595959', borderColor: '#bfbfbf', background: '#fafafa' }}>
                              {t(`courseTable.categories.${c.home_course_category}`, { defaultValue: c.home_course_category.toUpperCase() })}
                            </Tag>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Home Course Details */}
                    <div style={{ marginBottom: 12 }}>
                      <CourseDetailsPanel
                        courseId={c.home_course_id}
                        label={t('coordinatorReview.homeCourseDetails')}
                        icon={<HomeOutlined style={{ color: '#1890ff' }} />}
                        columns={1}
                      />
                    </div>

                    {/* Verification */}
                    {c.verification_status && (
                      <div style={{
                        marginBottom: 12, padding: '8px 12px', borderRadius: 6,
                        background: c.verification_status === 'approved' ? '#f6ffed' : c.verification_status === 'rejected' ? '#fff1f0' : '#fffbe6',
                        border: `1px solid ${c.verification_status === 'approved' ? '#b7eb8f' : c.verification_status === 'rejected' ? '#ffa39e' : '#ffe58f'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <Space size={4}>
                            {verCfg[c.verification_status]?.icon}
                            <Text strong style={{ fontSize: 11, color: verCfg[c.verification_status]?.color }}>
                              {verCfg[c.verification_status]?.label.toUpperCase()}
                            </Text>
                          </Space>
                          <Space size={4}>
                            {c.content_overlap_assessment && (
                              <Tag color="blue" style={{ fontSize: 9, margin: 0 }}>{t(`coordinatorReview.${c.content_overlap_assessment.toLowerCase()}`, { defaultValue: c.content_overlap_assessment.toUpperCase() })}</Tag>
                            )}
                            {c.core_topic_coverage && (
                              <Tag style={{ fontSize: 9, margin: 0 }}>{t(`coordinatorReview.${c.core_topic_coverage.toLowerCase()}Coverage`, { defaultValue: `${c.core_topic_coverage.toUpperCase()} COVERAGE` })}</Tag>
                            )}
                          </Space>
                        </div>
                        {c.verification_reason && (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.4 }}>{c.verification_reason}</Text>
                        )}
                        {c.is_recommended && (
                          <Tag color="gold" style={{ marginTop: 6, fontSize: 10, fontWeight: 'bold' }}>{t('coordinatorReview.aiRecommendation').toUpperCase()}</Tag>
                        )}
                      </div>
                    )}

                    <Divider style={{ margin: '8px 0' }} />

                    {c.core_home_topics?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>{t('coordinatorReview.coreTopics')}</Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {c.core_home_topics.map((t: string, i: number) => (
                            <Tag key={i} color="orange" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Matched Topics */}
                    {c.matched_topics?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                          {t('coordinatorReview.syllabusMatches')} ({c.matched_topics.length})
                        </Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {c.matched_topics.map((t: string, i: number) => (
                            <Tag key={i} color="green" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Missing Topics */}
                    {c.missing_topics?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                          {t('coordinatorReview.missingFromPartner')} ({c.missing_topics.length})
                        </Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {c.missing_topics.map((t: string, i: number) => (
                            <Tag key={i} color="red" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Extra Partner Topics */}
                    {c.extra_partner_topics?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
                          {t('coordinatorReview.enrichment')} ({c.extra_partner_topics.length})
                        </Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {c.extra_partner_topics.map((t: string, i: number) => (
                            <Tag key={i} color="cyan" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{t}</Tag>
                          ))}
                        </div>
                      </div>
                    )}


                    {/* Match Details — warnings + score breakdown */}
                    <Collapse
                      size="small"
                      ghost
                      style={{ background: 'transparent' }}
                      items={[{
                        key: 'match-details',
                        label: (
                          <Space size={6}>
                            <SwapOutlined style={{ color: '#722ed1' }} />
                            <Text style={{ fontSize: 12, fontWeight: 500 }}>{t('coordinatorReview.matchDetails')}</Text>
                          </Space>
                        ),
                        children: (
                          <div>
                            {c.structural_notes?.filter((n: string) => !/(partner|both courses|one or both)/i.test(n))
                              .map((n: string, i: number) => (
                              <Alert key={`sn-${i}`} message={n} type="info" banner showIcon
                                icon={<ThunderboltOutlined style={{ fontSize: 10 }} />}
                                style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3, background: '#f0f5ff', border: 'none' }}
                              />
                            ))}
                            {c.warnings?.filter((w: string) => !/(partner|both courses|one or both)/i.test(w))
                              .map((w: string, i: number) => (
                              <Alert key={`w-${i}`} message={w} type="warning" banner showIcon
                                icon={<WarningOutlined style={{ fontSize: 10 }} />}
                                style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3 }}
                              />
                            ))}
                            {c.score_breakdown && Object.keys(c.score_breakdown).length > 0 && (
                              <div style={{ marginTop: 6 }}>
                                <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 6 }}>{t('matching.results.scoreBreakdown').toUpperCase()}</Text>
                                {Object.entries(c.score_breakdown).map(([key, comp]: [string, any]) => {
                                  const bPct = Math.round(comp.score * 100);
                                  const bColor = bPct >= 70 ? '#52c41a' : bPct >= 40 ? '#faad14' : '#ff4d4f';
                                  return (
                                    <div key={key} style={{ marginBottom: 8 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                        <Text style={{ fontSize: 11, fontWeight: 500, textTransform: 'capitalize' }}>
                                          {t(`matching.results.breakdown.${key.toLowerCase()}`, { defaultValue: key })}
                                        </Text>
                                        <Space size={4}>
                                          <Tag style={{ fontSize: 9, margin: 0 }}>{Math.round(comp.weight * 100)}%w</Tag>
                                          <Text strong style={{ fontSize: 11, color: bColor }}>{bPct}%</Text>
                                        </Space>
                                      </div>
                                      <Progress percent={bPct} showInfo={false} strokeColor={bColor} size="small" />
                                      {comp.evidence && (
                                        <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>{comp.evidence}</Text>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ),
                      }]}
                    />
                  </Card>
                </Col>
              );
            });
            })()}
          </Row>
        </Card>
      )}

      {/* Global Actions */}
      {appData?.application?.coordinator_notes && (
        <Card size="small" style={{ marginTop: 8, borderRadius: 8, background: '#fffbe6', borderColor: '#ffe58f' }}>
          <Space size={6}>
            <MessageOutlined style={{ color: '#d46b08' }} />
            <Text style={{ fontSize: 12, color: '#666' }}>{t('coordinatorReview.actions.note')}:</Text>
            <Text style={{ fontSize: 12 }}>{appData.application.coordinator_notes}</Text>
          </Space>
        </Card>
      )}
      <Card size="small" style={{ marginTop: 8, borderRadius: 10, border: editMode ? '1px solid #1677ff' : '1px solid #e8e8e8' }}>
        <Space wrap>
          {coordinatorLocked ? (
            // draft + student opened → locked
            <Tag color="orange" style={{ fontSize: 12, padding: '4px 8px' }}>
              {t('coordinatorReview.revisionBanner')}
            </Tag>
          ) : neverSubmitted ? (
            // draft + never submitted → no coordinator actions
            <Tag color="default" style={{ fontSize: 12, padding: '4px 8px' }}>
              {t('coordinatorDashboard.columns.submitted')}: {t('coordinatorDashboard.statusOptions.draft')}
            </Tag>
          ) : (isSentBackEditable || isActionable) ? (
            // submitted / sent-back-editable → full action buttons
            !editMode ? (
              <Button type="default" icon={<EditOutlined />} onClick={() => toggleEdit(true)}>
                {t('coordinatorReview.actions.approve').toLowerCase() === 'approve' ? 'Edit' : t('common.edit') || 'Düzenle'}
              </Button>
            ) : (
              <>
                {(() => {
                  // Active selections for ECTS counting = everything except not_selected and rejected
                  const activeSelections = selections.filter((s: any) => !['not_selected', 'rejected'].includes(s.status));
                  // Pending = courses the coordinator hasn't decided on yet
                  const pendingReview = selections.filter((s: any) => s.status !== 'not_selected').filter((s: any) =>
                    ['submitted_for_review', 'draft_selected', 'manual_review_required'].includes(s.status) &&
                    !(s.coordinator_override_courses?.length > 0)
                  );
                  const allDecided = pendingReview.length === 0 && selections.some((s: any) => s.status !== 'not_selected');
                  const countsAsApproved = (s: any) => s.status !== 'not_selected' && (s.status === 'approved' || (s.coordinator_override_courses?.length || 0) > 0);
                  const allApproved = activeSelections.length > 0 && activeSelections.every(countsAsApproved);
                  const hasRejects = selections.some((s: any) => s.status === 'rejected');
                  const hasOverrideSet = selections.some(
                    (s: any) => s.coordinator_override_courses?.length > 0 && ['approved', 'submitted_for_review'].includes(s.status)
                  );

                  const approvedEctsTotal = activeSelections.reduce((sum: number, s: any) => {
                    if (countsAsApproved(s)) return sum + (s.partner_course?.ects || 0);
                    return sum;
                  }, 0);

                  const hasPending = activeSelections.some((s: any) => 
                    ['submitted_for_review', 'manual_review_required', 'draft_selected'].includes(s.status) &&
                    !(s.coordinator_override_courses?.length > 0)
                  );

                  const hasReviewRequests = selections.some((s: any) => s.no_match_requested);
                  const approvedHomeEcts = (app as any)?.approved_home_ects ?? 0;
                  const homeOk = hasReviewRequests || approvedHomeEcts >= 30;
                  const canMarkReady = approvedEctsTotal >= 28 && homeOk && !hasPending;
                  const needsReviewReturn = hasRejects || hasOverrideSet;

                  const isActuallyDecided = activeSelections.every((s: any) => {
                    if (['approved', 'rejected'].includes(s.status)) return true;
                    if (s.coordinator_override_course_ids?.length > 0) return true;
                    // Draft and Review Request levels clearly block LA Ready
                    if (['submitted_for_review', 'manual_review_required', 'draft_selected'].includes(s.status)) return false;
                    // Anything else (like '-' which maps to unknown/not_selected) does not block
                    return true;
                  });

                  return (
                    <Space size={12}>
                      <Button
                        icon={<SendOutlined />}
                        style={{ height: 40, fontWeight: 600 }}
                        onClick={handleSendBack}
                      >
                        {t('coordinatorReview.actions.sendBack')}
                      </Button>

                      {canMarkReady && isActuallyDecided && (
                        <Button
                          type="primary"
                          icon={<SafetyCertificateOutlined />}
                          style={{ background: '#237804', borderColor: '#237804', height: 40, fontWeight: 700 }}
                          onClick={() => {
                            Modal.confirm({
                              title: t('coordinatorReview.markReadyTitle', { defaultValue: 'Finalize and Mark as LA Ready?' }),
                              content: t('coordinatorReview.markReadyContent', { 
                                defaultValue: `This will mark the application as complete with ${approvedEctsTotal} ECTS. The student will be notified.`,
                                ects: approvedEctsTotal 
                              }),
                              onOk: () => finalizeMutation.mutate()
                            });
                          }}
                          loading={finalizeMutation.isPending}
                        >
                          {t('coordinatorReview.learningAgreementReady').toUpperCase()} ({approvedEctsTotal} AKTS)
                        </Button>
                      )}
                      
                      {!isActuallyDecided && (
                        <Text type="secondary" style={{ fontSize: 11, alignSelf: 'center' }}>
                          ({t('coordinatorReview.decideAllMessage', { defaultValue: 'Decide all courses to enable LA Ready' })})
                        </Text>
                      )}
                    </Space>
                  );
                })()}
              </>
            )
          ) : null}
          <Button icon={<MessageOutlined />} onClick={() => setNoteModal(true)}>
            {appData?.application?.coordinator_notes ? t('coordinatorReview.actions.addNote').replace('Add', 'Edit') : t('coordinatorReview.actions.addNote')}
          </Button>
          {editMode && (() => {
            const plainSubmitted = selections.filter((s: any) => {
              if (s.status !== 'submitted_for_review') return false;
              if ((s.alternative_home_course_ids?.length || 0) > 0) return false;
              if (s.no_match_requested) return false;
              if ((s.coordinator_override_courses?.length || 0) > 0) return false;
              return true;
            });
            if (plainSubmitted.length === 0) return null;
            return (
              <Button
                icon={<CheckSquareOutlined />}
                loading={bulkApproveMutation.isPending}
                style={{ borderColor: '#52c41a', color: '#52c41a' }}
                onClick={() => {
                  Modal.confirm({
                    title: t('coordinatorReview.bulkApproveTitle'),
                    content: t('coordinatorReview.bulkApproveContent', { count: plainSubmitted.length }),
                    okText: t('coordinatorReview.actions.approve'),
                    onOk: () => bulkApproveMutation.mutate(),
                  });
                }}
              >
                {t('coordinatorReview.bulkApprove', { count: plainSubmitted.length })}
              </Button>
            );
          })()}
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: t('coordinatorReview.actions.deleteApp'),
                content: t('coordinatorReview.deleteAppContent', { defaultValue: 'This will permanently remove the student\'s application and all selections.' }),
                okText: t('coordinatorReview.actions.approve').toLowerCase() === 'approve' ? 'Delete' : 'Sil',
                okButtonProps: { danger: true },
                onOk: () => deleteCoordinatorApplication(Number(id)).then(() => {
                  invalidateDashboard();
                  navigate('/coordinator');
                }),
              });
            }}
          >
            {t('coordinatorReview.actions.deleteApp')}
          </Button>
        </Space>
      </Card>

      {/* Review Modal — only for Reject and Override */}
      <Modal
        title={reviewAction === 'reject' ? t('coordinatorReview.actions.reject') : t('coordinatorReview.actions.override')}
        open={reviewModal}
        onOk={handleSubmitReview}
        onCancel={() => setReviewModal(false)}
        okButtonProps={{ loading: reviewMutation.isPending, danger: reviewAction === 'reject' }}
        okText={reviewAction === 'reject' ? t('coordinatorReview.actions.reject') : t('coordinatorReview.actions.override')}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="action" hidden><Input /></Form.Item>
          {reviewAction === 'override' && (
            <>
              {( (selected?.selected_home_course_ids?.length || 0) > 0 || selected?.selected_home_course_id) && (
                <div style={{ marginBottom: 12, padding: '8px 10px', background: '#f0f7ff', borderRadius: 6, border: '1px solid #bae0ff' }}>
                  <Text style={{ fontSize: 11, color: '#096dd9', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    {t('coordinatorReview.studentsSelection')}:
                  </Text>
                  <Space size={4} wrap>
                    {(selected?.selected_home_course_ids?.length
                      ? selected.selected_home_course_ids
                      : [selected?.selected_home_course_id]
                    ).map((hcId: any) => {
                      const c = selected?.selected_home_courses?.find((x: any) => x.id === hcId);
                      const name = c ? (c.course_code ? `${c.course_code} — ${c.course_name}` : c.course_name) : `#${hcId}`;
                      return <Tag key={hcId} color="blue" style={{ fontSize: 11 }}>{name}</Tag>;
                    })}
                  </Space>
                </div>
              )}
              <Form.Item
                label={t('coordinatorReview.actions.override')}
                name="override_home_course_ids"
                rules={[{ required: true, message: t('coordinatorDashboard.selectUnit') }]}
              >
                <Select 
                  mode="multiple" 
                  placeholder={t('coordinatorReview.selectHomeCourse', 'Select home university course')} 
                  optionLabelProp="label"
                  onSearch={(val) => setOverrideSearch(val)}
                  filterOption={false}
                  showSearch
                  notFoundContent={homeLoading ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                >
                  {(() => {
                    const studentIds = new Set<number>(selected?.selected_home_course_ids || (selected?.selected_home_course_id ? [selected.selected_home_course_id] : []));
                    const optionsMap = new Map<number, any>();

                    // 0. Add student's alternative suggestions
                    const altIds = new Set<number>(selected?.alternative_home_course_ids || []);
                    (selected?.alternative_home_courses_detail || []).forEach((c: any) => {
                      optionsMap.set(c.id, {
                        id: c.id,
                        code: c.course_code,
                        name: c.course_name,
                        score: null,
                        ver: null,
                        isStudent: studentIds.has(c.id),
                        isSuggested: true
                      });
                    });
                    // Fallback for names if details not loaded
                    (selected?.alternative_home_course_ids || []).forEach((id: number) => {
                      if (!optionsMap.has(id)) {
                        optionsMap.set(id, {
                          id,
                          code: null,
                          name: selected?.alternative_home_course_names?.[id] ?? `#${id}`,
                          score: null,
                          ver: null,
                          isStudent: studentIds.has(id),
                          isSuggested: true
                        });
                      }
                    });

                    // 1. Add AI candidates
                    (selected?.candidates || []).forEach((c: any) => {
                      if (!optionsMap.has(c.home_course_id)) {
                        optionsMap.set(c.home_course_id, {
                          id: c.home_course_id,
                          code: c.home_course_code,
                          name: c.home_course_name,
                          score: c.overall_score,
                          ver: c.verification_status,
                          isStudent: studentIds.has(c.home_course_id),
                          isCandidate: true
                        });
                      } else {
                        // If already added as suggested, mark as candidate too
                        const existing = optionsMap.get(c.home_course_id);
                        existing.isCandidate = true;
                        existing.score = c.overall_score;
                        existing.ver = c.verification_status;
                      }
                    });

                    // 2. Add current coordinator overrides
                    (selected?.coordinator_override_courses || []).forEach((c: any) => {
                      if (!optionsMap.has(c.id)) {
                        optionsMap.set(c.id, {
                          id: c.id,
                          code: c.course_code,
                          name: c.course_name,
                          score: null,
                          ver: null,
                          isStudent: studentIds.has(c.id)
                        });
                      }
                    });

                    // 3. Add student selection
                    (selected?.selected_home_course ? [selected.selected_home_course] : []).forEach((c: any) => {
                      if (!optionsMap.has(c.id)) {
                        optionsMap.set(c.id, {
                          id: c.id,
                          code: c.course_code,
                          name: c.course_name,
                          score: null,
                          ver: null,
                          isStudent: true
                        });
                      }
                    });

                    // 4. Add search results
                    (homeData?.courses || []).forEach((c: any) => {
                      if (!optionsMap.has(c.id)) {
                        optionsMap.set(c.id, {
                          id: c.id,
                          code: c.course_code,
                          name: c.course_name,
                          score: null,
                          ver: null,
                          isStudent: studentIds.has(c.id),
                          isGlobal: true
                        });
                      }
                    });

                    return Array.from(optionsMap.values())
                      .sort((a, b) => {
                        // Student's Suggested first
                        if (a.isSuggested && !b.isSuggested) return -1;
                        if (!a.isSuggested && b.isSuggested) return 1;
                        // AI Candidates next
                        if (a.isCandidate && !b.isCandidate) return -1;
                        if (!a.isCandidate && b.isCandidate) return 1;
                        // Within candidates, sort by score
                        if (a.isCandidate && b.isCandidate) return (b.score || 0) - (a.score || 0);
                        // Then Student selections
                        if (a.isStudent && !b.isStudent) return -1;
                        if (!a.isStudent && b.isStudent) return 1;
                        return 0;
                      })
                      .map(o => {
                      const verColor = o.ver === 'approved' ? 'green' : o.ver === 'risk_flagged' ? 'orange' : o.ver === 'rejected' ? 'red' : 'default';
                      const verLabel = o.ver ? t(`coordinatorDashboard.statusOptions.${o.ver === 'risk_flagged' ? 'revision' : o.ver}`).toUpperCase() : '';
                      const courseName = o.code ? `${o.code} — ${o.name}` : o.name;
                      const label = `${o.isStudent ? '★ ' : ''}${courseName}`;
                      return (
                        <Select.Option key={o.id} value={o.id} label={label}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {o.isSuggested && <Tag color="cyan" style={{ fontSize: 10, margin: 0, fontWeight: 700 }}>{t('coordinatorReview.studentAlternativeSuggestion').toUpperCase()}</Tag>}
                            {o.isCandidate && <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>{t('coordinatorReview.matchCandidatesHeader').replace('Candidates', 'Candidate')}</Tag>}
                            {o.isStudent && !o.isCandidate && !o.isSuggested && <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>{t('coordinatorReview.studentsSelection')}</Tag>}
                            {o.isGlobal && !o.isStudent && !o.isCandidate && !o.isSuggested && <Tag color="default" style={{ fontSize: 10, margin: 0 }}>{t('coordinatorReview.additionalReviewNote')}</Tag>}
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {courseName}
                            </span>
                            {o.score != null && <span style={{ color: '#999', fontSize: 11, flexShrink: 0 }}>({Math.round(o.score * 100)}%)</span>}
                            {o.ver && <Tag color={verColor} style={{ marginLeft: 0, fontSize: 10, flexShrink: 0 }}>{verLabel}</Tag>}
                          </div>
                        </Select.Option>
                      );
                    });
                  })()}
                </Select>
              </Form.Item>
            </>
          )}
          <Form.Item label={t('coordinatorReview.actions.note')} name="notes">
            <Input.TextArea rows={3} placeholder={t('coordinatorReview.actions.addNoteToStudent')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Note Modal */}
      <Modal
        title={t('coordinatorReview.actions.addNote')}
        open={noteModal}
        onOk={() => {
          noteForm.validateFields().then(values => {
            sendNoteMutation.mutate(values.notes);
          });
        }}
        onCancel={() => setNoteModal(false)}
        okButtonProps={{ loading: sendNoteMutation.isPending }}
        okText={t('coordinatorReview.actions.addNote').split(' ')[0]}
      >
        <Form form={noteForm} layout="vertical">
          <Form.Item name="notes" rules={[{ required: true, message: t('coordinatorReview.actions.note') }]}>
            <Input.TextArea rows={4} placeholder={t('coordinatorReview.actions.addNoteToStudent')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* History Modal */}
      <Modal
        title={t('coordinatorReview.historyModal.title')}
        open={historyModal}
        onCancel={() => setHistoryModal(false)}
        footer={null}
        width={600}
      >
        {(historyData?.history?.length || 0) > 0 ? (
          <Timeline
            items={historyData?.history?.map((h: any) => ({
              color: h.to_state === 'approved' || h.to_state === 'learning_agreement_ready' ? 'green'
                : h.to_state === 'rejected' ? 'red' : 'blue',
              children: (
                <div>
                  <Space>
                    <Tag style={{ fontSize: 10 }}>{t(`applicationStatus.${h.from_state || 'draft'}.label`, { defaultValue: h.from_state || 'START' })}</Tag>
                    <span>&rarr;</span>
                    <Tag color={h.to_state === 'approved' ? 'green' : 'blue'} style={{ fontSize: 10 }}>
                      {t(`applicationStatus.${h.to_state}.label`, { defaultValue: h.to_state.replace(/_/g, ' ').toUpperCase() })}
                    </Tag>
                  </Space>
                  {h.actor_role && <div style={{ fontSize: 11, color: '#888' }}>{t('common.by')} {h.actor_role}</div>}
                  {h.reason && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{h.reason}</div>}
                  <div style={{ fontSize: 10, color: '#bbb' }}>
                    {h.created_at ? new Date(h.created_at).toLocaleString(i18n.language === 'tr' ? 'tr-TR' : 'en-GB') : ''}
                  </div>
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description={t('common.noResults') || 'No history records yet'} />
        )}
      </Modal>

      {/* Learning Agreement Modal */}
      <Modal
        title={t('coordinatorReview.laModal.title')}
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
          dataSource={selections.filter((s: any) => 
            s.status !== 'not_selected' && 
            (s.status === 'approved' || (s.coordinator_override_courses?.length || 0) > 0)
          )}
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
                  <Tag color="blue" style={{ marginTop: 4 }}>{record.partner_course?.ects} {t('courseTable.columns.ects')}</Tag>
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
                   : record.selected_home_courses;
                
                if (!homeCourses || homeCourses.length === 0) return <Text type="secondary">{t('common.noResults') || 'No matched courses'}</Text>;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {homeCourses.map((hc: any) => (
                      <div key={hc.id} style={{ padding: '8px', background: '#f5f5f5', borderRadius: 6 }}>
                        <Text strong>{hc.course_code || '—'}</Text>
                        <br />
                        <Text>{hc.course_name}</Text>
                        <br />
                        <Tag color="green" style={{ marginTop: 4 }}>{hc.ects} {t('courseTable.columns.ects')}</Tag>
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
