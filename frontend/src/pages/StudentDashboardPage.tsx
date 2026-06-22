import React, { useState } from 'react';
import {
  Card, Row, Col, Button, Modal, Select, Empty, Typography, Spin, Tag, Space, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, SwapOutlined, ClockCircleOutlined, BookOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getStudentApplications, createStudentApplication, deleteStudentApplication, getUniversities } from '../api/client';
import ApplicationStatusBadge from '../components/ApplicationStatusBadge';

const { Title, Text } = Typography;

export default function StudentDashboardPage() {
  const { t } = useTranslation();
  const { user, activeDepartment } = useAuth();
  const [createModal, setCreateModal] = useState(false);
  const [selectedUni, setSelectedUni] = useState<number | null>(null);
  const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: apps, isLoading } = useQuery({
    queryKey: ['student-applications'],
    queryFn: getStudentApplications,
  });

  const { data: universities } = useQuery({
    queryKey: ['universities', activeDepartment, 'activeOnly'],
    queryFn: () => getUniversities(activeDepartment || undefined, true),
  });

  const createMutation = useMutation({
    mutationFn: (uniId: number) => createStudentApplication(uniId, selectedSemester || undefined),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['student-applications'] });
      setCreateModal(false);
      setSelectedUni(null);
      setSelectedSemester(null);
      if (data?.id) navigate(`/applications/${data.id}`);
    },
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to create application'),
  });

  const deleteMutation = useMutation({
    mutationFn: (appId: number) => deleteStudentApplication(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-applications'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || 'Failed to delete application'),
  });

  const handleOpenCreateModal = () => {
    if (apps && apps.length === 1) {
      const firstApp = apps[0];
      setSelectedUni(firstApp.partner_university?.id || null);
      setSelectedSemester(firstApp.semester === 'fall' ? 'spring' : firstApp.semester === 'spring' ? 'fall' : null);
    } else {
      setSelectedUni(null);
      setSelectedSemester(null);
    }
    setCreateModal(true);
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#888' }}>{t('studentDashboard.messages.loading')}</div>
      </div>
    );
  }

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
        <div className="dashboard-welcome">
          <div className="welcome-text">
            <Text style={{ color: '#aaa', fontSize: 12, display: 'block', marginBottom: 4 }}>
              {t('studentDashboard.welcome')}
            </Text>
            <Title level={4} style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
              {user?.displayName || user?.eid || 'Student'}
            </Title>
            <Text style={{ color: '#888', fontSize: 12 }}>
              {t('studentDashboard.subtitle')}
            </Text>
          </div>
          <div className="welcome-action" style={{ marginTop: 12 }}>
            {apps && (apps.length >= 2 || (apps.length === 1 && apps[0].semester !== 'fall' && apps[0].semester !== 'spring')) ? (
              <Tooltip title={apps.length >= 2 ? (t('studentDashboard.maxAppsWarning') || 'Maksimum 2 başvuru limitine ulaştınız.') : t('studentDashboard.activeAppWarning')} placement="left">
                <Button
                  icon={<PlusOutlined />}
                  className="dashboard-welcome-btn"
                  style={{
                    fontWeight: 600, borderRadius: 8,
                    background: '#555', borderColor: '#555', color: '#999',
                    cursor: 'not-allowed',
                  }}
                >
                  {t('studentDashboard.newApplication')}
                </Button>
              </Tooltip>
            ) : (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                className="dashboard-welcome-btn"
                onClick={handleOpenCreateModal}
                style={{ fontWeight: 600, background: '#c0392b', borderColor: '#c0392b', borderRadius: 8 }}
              >
                {t('studentDashboard.newApplication')}
              </Button>
            )}
          </div>
        </div>
      </Card>


      {/* Section header */}
      <div style={{ marginBottom: 14 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}>{t('studentDashboard.myApplications')}</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('studentDashboard.myApplicationsDesc')}
        </Text>
      </div>

      {/* Empty state */}
      {apps && apps.length === 0 && (
        <Card style={{ borderRadius: 10, textAlign: 'center', padding: '60px 24px' }}>
          <Empty description={t('studentDashboard.noApplications')}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreateModal}>
              {t('studentDashboard.createApplication')}
            </Button>
          </Empty>
        </Card>
      )}

      {/* Application Cards */}
      <Row gutter={[16, 16]}>
        {apps?.map((app: any) => (
          <Col span={24} key={app.id}>
            <Card
              hoverable
              style={{ borderRadius: 10, border: '1px solid #e8e8e8' }}
              styles={{ body: { padding: '16px 20px' } }}
              actions={[
                <Button
                  type="link"
                  style={['draft', 'rejected'].includes(app.status) ? { color: '#d46b08', fontWeight: 600 } : undefined}
                  onClick={() => navigate(`/applications/${app.id}`)}
                >
                  {['draft', 'rejected'].includes(app.status) ? t('studentDashboard.reviseSubmit')
                    : t('studentDashboard.viewDetails')}
                </Button>,
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!['draft', 'rejected'].includes(app.status)}
                  onClick={(e) => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: t('studentDashboard.deleteTitle'),
                      content: t('studentDashboard.deleteContent'),
                      okText: t('studentDashboard.delete'),
                      okButtonProps: { danger: true },
                      cancelText: t('adminPanel.modals.manageRoles.remove'),
                      onOk: () => deleteMutation.mutate(app.id),
                    });
                  }}
                >
                  {t('studentDashboard.delete')}
                </Button>,
              ]}
            >
              <div className="app-card-row">
                <div className="app-card-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <SwapOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
                    </div>
                    <Text strong style={{ fontSize: 16, color: '#0f172a', letterSpacing: '-0.01em' }}>
                      {app.partner_university?.name || 'Unknown University'}
                    </Text>
                  </div>
                  
                  <div className="app-card-tags">
                    {app.semester && (
                      <Tag color={app.semester === 'fall' ? 'orange' : 'green'} style={{ border: 'none' }}>
                        {app.semester === 'fall' ? t('studentDashboard.fallSemester') : t('studentDashboard.springSemester')}
                      </Tag>
                    )}
                    {(app.partner_university?.city || app.partner_university?.country) && (
                      <Tag style={{ background: '#f1f5f9', color: '#475569' }}>
                        {[app.partner_university?.city, app.partner_university?.country].filter(Boolean).join(', ')}
                      </Tag>
                    )}
                    <Tooltip title={
                      app.selection_count
                        ? [
                            app.draft_count ? t('studentDashboard.counts.draft', { count: app.draft_count }) : null,
                            app.review_count ? t('studentDashboard.counts.review', { count: app.review_count }) : null,
                          ].filter(Boolean).join(' · ') || t('studentDashboard.coursesCount', { count: app.selection_count })
                        : t('studentDashboard.noCourses')
                    }>
                      <Tag icon={<BookOutlined />} style={{ background: '#f8fafc', border: '1px dashed #e2e8f0' }}>
                        {t('studentDashboard.coursesCount', { count: app.selection_count || 0 })}
                      </Tag>
                    </Tooltip>
                  </div>
                </div>

                <div className="app-card-status">
                  <ApplicationStatusBadge status={app.status} />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ClockCircleOutlined style={{ fontSize: 11, color: '#94a3b8' }} />
                    <Text style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                      {app.created_at ? new Date(app.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      }) : '—'}
                    </Text>
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Create Modal */}
      <Modal
        title={t('studentDashboard.createModal.title')}
        open={createModal}
        onCancel={() => { setCreateModal(false); setSelectedUni(null); setSelectedSemester(null); }}
        onOk={() => selectedUni && createMutation.mutate(selectedUni)}
        confirmLoading={createMutation.isPending}
        okButtonProps={{ disabled: !selectedUni || !selectedSemester }}
        okText={t('studentDashboard.createModal.create')}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>
          {t('studentDashboard.createModal.desc')}
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500 }}>{t('studentDashboard.createModal.semester')}</label>
          <Select
            style={{ width: '100%' }}
            placeholder={t('studentDashboard.createModal.semesterPlaceholder')}
            value={selectedSemester}
            onChange={setSelectedSemester}
            disabled={apps && apps.length === 1}
            options={[
              { label: t('studentDashboard.fallSemester'), value: 'fall' },
              { label: t('studentDashboard.springSemester'), value: 'spring' },
            ]}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500 }}>{t('studentDashboard.createModal.partnerUni')}</label>
          <Select
            style={{ width: '100%' }}
            placeholder={t('studentDashboard.createModal.uniPlaceholder')}
            value={selectedUni}
            onChange={setSelectedUni}
            loading={!universities}
            showSearch
            optionFilterProp="children"
            disabled={apps && apps.length === 1}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={universities
              ?.filter((u: any) => !u.is_home)
              .map((u: any) => ({
                value: u.id,
                label: `${u.name} (${u.city}, ${u.country})`,
              }))}
          />
        </div>
      </Modal>
    </div>
  );
}
