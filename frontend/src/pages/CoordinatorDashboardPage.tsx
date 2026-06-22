import React, { useState } from 'react';
import {
  Card, Table, Tag, Row, Col, Statistic, Button, Select, Typography, Space, Input,
} from 'antd';
import {
  ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SafetyCertificateOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import {
  getCoordinatorApplications, getCoordinatorDashboard, getUniversities, getDepartments,
} from '../api/client';
import ApplicationStatusBadge from '../components/ApplicationStatusBadge';

const { Title, Text } = Typography;

export default function CoordinatorDashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { activeDepartment } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [uniFilter, setUniFilter] = useState<number | undefined>(undefined);
  const [localDeptFilter, setLocalDeptFilter] = useState<number | undefined>(undefined);

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => getDepartments(),
  });

  // Sync global activeDepartment (code) to numeric deptFilter
  const resolvedDeptId = React.useMemo(() => {
    if (localDeptFilter) return localDeptFilter;
    if (!activeDepartment || !departments) return undefined;
    return departments.find((d: any) => d.code === activeDepartment)?.id;
  }, [activeDepartment, departments, localDeptFilter]);

  // Resolve department code for university filtering
  const resolvedDeptCode = React.useMemo(() => {
    if (localDeptFilter && departments) {
      return departments.find((d: any) => d.id === localDeptFilter)?.code || activeDepartment;
    }
    return activeDepartment;
  }, [activeDepartment, departments, localDeptFilter]);

  const { data: stats } = useQuery({
    queryKey: ['coordinator-dashboard', resolvedDeptId],
    queryFn: () => getCoordinatorDashboard({ department_id: resolvedDeptId }),
  });

  const { data: apps, isLoading } = useQuery({
    queryKey: ['coordinator-applications', statusFilter, uniFilter, resolvedDeptId],
    queryFn: () => getCoordinatorApplications({
      status: statusFilter,
      university_id: uniFilter,
      department_id: resolvedDeptId,
    }),
  });

  const { data: universities } = useQuery({
    queryKey: ['universities', resolvedDeptCode],
    queryFn: () => getUniversities(resolvedDeptCode),
  });

  const columns = [
    {
      title: t('coordinatorDashboard.columns.student'),
      dataIndex: ['student', 'name'],
      render: (text: string, record: any) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{text || record.student?.eid}</div>
          <div style={{ fontSize: 11, color: '#999' }}>{record.student?.eid}</div>
        </div>
      ),
    },
    {
      title: t('coordinatorDashboard.columns.partnerUniversity'),
      dataIndex: ['partner_university', 'name'],
      render: (text: string) => <Text style={{ fontSize: 13 }}>{text}</Text>,
      sorter: (a: any, b: any) => (a.partner_university?.name || '').localeCompare(b.partner_university?.name || ''),
    },
    {
      title: t('coordinatorDashboard.columns.courses'),
      dataIndex: 'total_selections',
      render: (val: number, record: any) => (
        <div>
          <Text style={{ fontSize: 12 }}>{val} {t('coordinatorDashboard.table.total')}</Text>
          <br />
          <Text style={{ fontSize: 11, color: '#52c41a' }}>{record.reviewed_selections} {t('coordinatorDashboard.table.approved')}</Text>
        </div>
      ),
    },
    {
      title: t('courseTable.columns.ects'),
      render: (_: any, record: any) => (
        <Text style={{ fontSize: 12 }}>
          <Text strong style={{ color: '#52c41a' }}>{record.approved_partner_ects}</Text> / {record.total_partner_ects}
        </Text>
      ),
    },
    {
      title: t('coordinatorDashboard.columns.status'),
      dataIndex: 'status',
      render: (status: string) => <ApplicationStatusBadge status={status} size="small" />,
    },
    {
      title: t('coordinatorDashboard.columns.submitted'),
      dataIndex: 'submitted_at',
      render: (text: string) => text
        ? new Date(text).toLocaleDateString(i18n.language === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : <Text type="secondary">—</Text>,
    },
    {
      title: '',
      render: (_: any, record: any) => (
        <Button size="small" type="primary" onClick={() => navigate(`/coordinator/applications/${record.id}`)} style={{ borderRadius: 6 }}>
          {t('coordinatorDashboard.table.review')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 700 }}>{t('coordinatorDashboard.title')}</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('coordinatorDashboard.subtitle')}
        </Text>
      </div>


      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
        <Space wrap size={12}>
          <Select
            style={{ width: 180 }}
            allowClear
            placeholder={t('coordinatorDashboard.filters.status')}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: t('coordinatorDashboard.statusOptions.draft'), value: 'draft' },
              { label: t('coordinatorDashboard.statusOptions.submitted'), value: 'submitted' },
              { label: t('coordinatorDashboard.statusOptions.revision'), value: 'revision_requested' },
              { label: t('coordinatorDashboard.statusOptions.rejected'), value: 'rejected' },
              { label: t('coordinatorDashboard.statusOptions.laReady'), value: 'learning_agreement_ready' },
            ]}
          />
          <Select
            style={{ width: 220 }}
            allowClear
            showSearch
            placeholder={t('coordinatorDashboard.filters.university')}
            value={uniFilter}
            onChange={setUniFilter}
            optionFilterProp="children"
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={universities
              ?.filter((u: any) => !u.is_home)
              .map((u: any) => ({ value: u.id, label: u.name }))}
          />
          <Select
            style={{ width: 180 }}
            allowClear
            placeholder={t('coordinatorDashboard.filters.department')}
            value={localDeptFilter}
            onChange={setLocalDeptFilter}
            options={departments?.map((d: any) => ({ value: d.id, label: d.name }))}
          />
          {(statusFilter || uniFilter || localDeptFilter) && (
            <Button
              type="link"
              onClick={() => { setStatusFilter(undefined); setUniFilter(undefined); setLocalDeptFilter(undefined); }}
            >
              {t('coordinatorDashboard.filters.clear')}
            </Button>
          )}
        </Space>
      </Card>

      {/* Table */}
      <Table
        dataSource={[...(apps ?? [])].sort((a: any, b: any) => {
          const p = (s: string) =>
            s === 'submitted'                ? 0 :
            s === 'revision_requested'       ? 1 :
            s === 'learning_agreement_ready' ? 2 :
            s === 'rejected'                 ? 3 :
            s === 'draft'                    ? 4 : 5;
          return p(a.status) - p(b.status);
        })}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        style={{ borderRadius: 8, overflow: 'hidden' }}
      />
    </div>
  );
}
