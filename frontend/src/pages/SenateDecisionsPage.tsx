import { useState } from 'react';
import {
  Table, Button, Space, Tag, Card, Typography, message, Modal, Form, Input,
  Select, Upload, DatePicker, Tooltip
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, FilePdfOutlined, DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import {
  getSenateDecisions, getDepartments, getDepartmentsByFaculty, getFaculties, uploadSenateDecision, deleteSenateDecision, getUniversities,
} from '../api/client';

const { Title, Text } = Typography;

const getDecisionFileUrl = (id: number) => `/api/senate-decisions/${id}/file`;

interface SenateDecision {
  id: number;
  title: string;
  decision_date: string;
  reference_no: string;
  decision_type: string;
  faculty_id?: number;
  faculty_name?: string;
  department_id?: number;
  department_name?: string;
  university_id?: number;
  university_name?: string;
  summary?: string;
  is_active: boolean;
  original_filename?: string;
  file_size?: number;
}

interface DeptRow {
  key: string;
  department_id: number | null;
  university_ids: number[];
}

let deptRowCounter = 0;
const nextDeptKey = () => `dept_${++deptRowCounter}`;

const SenateDecisionsPage: React.FC = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const decisionTypeOptions = [
    { label: t('senateDecisions.form.decisionType', 'Partner Not Dönüşümü'), value: 'grade_conversion' },
  ];
  const { hasRole, user, isSuperAdmin } = useAuth();
  const canManage = hasRole('super_admin') || hasRole('dept_admin') || hasRole('registrar') || hasRole('faculty_affairs_admin');

  const [uploadVisible, setUploadVisible] = useState(false);
  const [form] = Form.useForm();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [facFilter, setFacFilter] = useState<number | undefined>();
  const [deptFilter, setDeptFilter] = useState<number | undefined>();
  const [uniFilter, setUniFilter] = useState<number | undefined>();
  const [deptRows, setDeptRows] = useState<DeptRow[]>([]);
  const [uploadFacultyId, setUploadFacultyId] = useState<number | undefined>();

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['senate-decisions', typeFilter, facFilter, deptFilter, uniFilter],
    queryFn: () => getSenateDecisions({ decision_type: typeFilter, faculty_id: facFilter, department_id: deptFilter, university_id: uniFilter }),
  });

  const { data: faculties = [] } = useQuery({
    queryKey: ['faculties-layout'],
    queryFn: () => getFaculties(),
    staleTime: 10 * 60 * 1000,
  });

  const { data: uploadDepartments = [] } = useQuery({
    queryKey: ['departments-layout', uploadFacultyId],
    queryFn: () => uploadFacultyId !== undefined ? getDepartmentsByFaculty(uploadFacultyId) : getDepartments(),
    enabled: uploadVisible,
    staleTime: 5 * 60 * 1000,
  });

  const { data: allUniversities = [] } = useQuery({
    queryKey: ['universities-all'],
    queryFn: () => getUniversities(),
    staleTime: 10 * 60 * 1000,
  });

  // For the table filters (always show all departments)
  const { data: allDepartments = [] } = useQuery({
    queryKey: ['departments-layout-all'],
    queryFn: () => getDepartments(),
    staleTime: 10 * 60 * 1000,
  });

  const userAllowedDeptIds = user?.roles
    .map(r => r.department_id)
    .filter((id): id is number => id !== undefined && id !== null) || [];

  const isFacultyAdmin = hasRole('registrar') || hasRole('faculty_affairs_admin');
  const allowedDepartmentsForUser = isSuperAdmin || isFacultyAdmin
    ? allDepartments
    : allDepartments.filter((d: any) => userAllowedDeptIds.includes(d.id));

  const allowedFacultiesForUser = isSuperAdmin || isFacultyAdmin
    ? faculties
    : faculties.filter((f: any) => allowedDepartmentsForUser.some((d: any) => d.faculty_id === f.id));

  const allowedUploadDepartments = isSuperAdmin || isFacultyAdmin
    ? uploadDepartments
    : uploadDepartments.filter((d: any) => userAllowedDeptIds.includes(d.id));

  // Filter departments by selected faculty filter
  const filterDepartments = facFilter
    ? allowedDepartmentsForUser.filter((d: any) => d.faculty_id === facFilter)
    : allowedDepartmentsForUser;

  // Filter universities by selected department filter
  const filterUniversities = deptFilter
    ? allUniversities.filter((u: any) => u.department_id === deptFilter && !u.is_home)
    : [];

  // When dept filter changes to a value that doesn't include the current uni filter, clear uni filter
  const handleDeptFilterChange = (val: number | undefined) => {
    setDeptFilter(val);
    if (!val) {
      setUniFilter(undefined);
    } else if (val && uniFilter) {
      const uniBelongsToDept = allUniversities.some(
        (u: any) => u.id === uniFilter && u.department_id === val
      );
      if (!uniBelongsToDept) setUniFilter(undefined);
    }
  };

  const handleFacFilterChange = (val: number | undefined) => {
    setFacFilter(val);
    if (val && deptFilter) {
      const deptBelongsToFac = allDepartments.some((d: any) => d.id === deptFilter && d.faculty_id === val);
      if (!deptBelongsToFac) handleDeptFilterChange(undefined);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: uploadSenateDecision,
    onSuccess: () => {
      message.success(t('senateDecisions.messages.uploaded'));
      setUploadVisible(false);
      form.resetFields();
      setDeptRows([]);
      setUploadFacultyId(undefined);
      qc.invalidateQueries({ queryKey: ['senate-decisions'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('senateDecisions.messages.uploadFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSenateDecision,
    onSuccess: () => {
      message.success(t('senateDecisions.messages.deleted'));
      qc.invalidateQueries({ queryKey: ['senate-decisions'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('senateDecisions.messages.deleteFailed')),
  });

  const handleFacultyChange = (fid: number | undefined) => {
    setUploadFacultyId(fid);
    setDeptRows([]);
    form.setFieldsValue({ faculty_id: fid });
  };

  const addDeptRow = () => {
    setDeptRows(prev => [...prev, { key: nextDeptKey(), department_id: null, university_ids: [] }]);
  };

  const removeDeptRow = (key: string) => {
    setDeptRows(prev => prev.filter(r => r.key !== key));
  };

  const updateDeptRow = (key: string, field: 'department_id' | 'university_ids', value: any) => {
    setDeptRows(prev => prev.map(r => {
      if (r.key !== key) return r;
      if (field === 'department_id') {
        return { ...r, department_id: value, university_ids: [] };
      }
      return { ...r, [field]: value };
    }));
  };

  const handleUpload = () => {
    form.validateFields().then(values => {
      const fd = new FormData();
      fd.append('title', values.title);
      fd.append('decision_date', values.decision_date.format('YYYY-MM-DD'));
      fd.append('reference_no', values.reference_no);
      fd.append('decision_type', values.decision_type);
      if (uploadFacultyId) fd.append('faculty_id', String(uploadFacultyId));
      if (values.summary) fd.append('summary', values.summary);

      const scopes = deptRows
        .filter(r => r.department_id && r.university_ids.length > 0)
        .map(r => ({
          department_ids: [r.department_id],
          university_ids: r.university_ids,
        }));

      if (scopes.length > 0) {
        fd.append('scopes', JSON.stringify(scopes));
      }

      if (values.file?.fileList?.[0]?.originFileObj) {
        fd.append('file', values.file.fileList[0].originFileObj);
      }
      uploadMutation.mutate(fd);
    });
  };

  const columns = [
    {
      title: t('senateDecisions.table.reference'),
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 90,
      ellipsis: true,
      render: (ref: string) => <Text strong>{ref}</Text>,
    },
    {
      title: t('senateDecisions.table.title'),
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('senateDecisions.table.date'),
      dataIndex: 'decision_date',
      key: 'date',
      width: 95,
      render: (d: string) => d ? dayjs(d).format('DD.MM.YYYY') : '-',
    },
    {
      title: t('senateDecisions.table.type'),
      dataIndex: 'decision_type',
      key: 'type',
      width: 140,
      render: (t_val: string) => {
        const opt = decisionTypeOptions.find(o => o.value === t_val);
        const label = opt?.label || t_val;
        return <Tooltip title={label}><Tag style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Tag></Tooltip>;
      },
    },
    {
      title: t('senateDecisions.table.university') || 'Üniversite',
      dataIndex: 'university_name',
      key: 'university',
      width: 210,
      render: (name: string) => name
        ? <Tooltip title={name}><Tag color="purple" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Tag></Tooltip>
        : <Text type="secondary">-</Text>,
    },
    {
      title: t('adminPanel.faculty'),
      dataIndex: 'faculty_name',
      key: 'faculty',
      width: 150,
      render: (name: string) => name
        ? <Tooltip title={name}><Tag color="blue" style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Tag></Tooltip>
        : <Text type="secondary">-</Text>,
    },
    {
      title: t('senateDecisions.table.department'),
      dataIndex: 'department_name',
      key: 'department',
      width: 150,
      render: (name: string) => name
        ? <Tooltip title={name}><Tag style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Tag></Tooltip>
        : <Text type="secondary">-</Text>,
    },
    {
      title: t('senateDecisions.table.file'),
      key: 'file',
      width: 90,
      align: 'center' as const,
      render: (_: any, record: SenateDecision) =>
        record.original_filename ? (
          <Tooltip title={record.original_filename}>
            <a href={getDecisionFileUrl(record.id)} download={record.original_filename}>
              <Button type="link" size="small" icon={<DownloadOutlined />} />
            </a>
          </Tooltip>
        ) : <Text type="secondary">-</Text>,
    },
    ...(canManage ? [{
      title: t('senateDecisions.table.actions'),
      key: 'actions',
      width: 120,
      align: 'center' as const,
      render: (_: any, record: SenateDecision) => (
        <Button type="text" danger size="small" icon={<DeleteOutlined />}
          onClick={() => {
            Modal.confirm({
              title: t('senateDecisions.confirm.delete'),
              content: t('senateDecisions.confirm.deleteDesc', { title: record.title }),
              okType: 'danger',
              onOk: () => deleteMutation.mutate(record.id),
            });
          }}
        />
      ),
    }] : []),
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 600 }}>
          {t('senateDecisions.title')}
        </Title>
        {canManage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ backgroundColor: '#cf1322', borderRadius: 6, fontWeight: 500 }}
            onClick={() => {
              form.resetFields();
              setDeptRows([
                { key: nextDeptKey(), department_id: null, university_ids: [] },
              ]);
              setUploadVisible(true);
            }}
          >
            {t('senateDecisions.upload', 'Karar Yükle')}
          </Button>
        )}
      </div>

      <Card style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: '1px solid #f0f0f0' }}>
        <Space style={{ marginBottom: 20 }} wrap>
          <Select
            placeholder={t('senateDecisions.filterType')}
            value={typeFilter}
            onChange={setTypeFilter}
            allowClear
            style={{ width: 160 }}
            options={decisionTypeOptions.map(o => ({ label: o.label, value: o.value }))}
          />
          <Select
            placeholder={t('adminPanel.faculty')}
            value={facFilter}
            onChange={handleFacFilterChange}
            allowClear
            style={{ width: 180 }}
            options={allowedFacultiesForUser?.map((f: any) => ({ label: f.name, value: f.id }))}
          />
          <Select
            placeholder={t('senateDecisions.filterDept')}
            value={deptFilter}
            onChange={handleDeptFilterChange}
            allowClear
            style={{ width: 180 }}
            options={filterDepartments?.map((d: any) => ({ label: d.name, value: d.id }))}
          />
          <Select
            placeholder={deptFilter ? (t('senateDecisions.table.allUnis') || 'Tüm Üniversiteler') : (t('senateDecisions.selectDeptFirst') || 'Lütfen önce bölüm seçiniz')}
            value={uniFilter}
            onChange={setUniFilter}
            allowClear
            disabled={!deptFilter}
            style={{ width: 220 }}
            options={filterUniversities?.map((u: any) => ({ label: u.name, value: u.id }))}
          />
        </Space>
        <Table
          dataSource={decisions}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1050 }}
        />
      </Card>

      <Modal
        title={t('senateDecisions.uploadTitle')}
        open={uploadVisible}
        onCancel={() => setUploadVisible(false)}
        onOk={handleUpload}
        okText={t('common.upload')}
        cancelText={t('common.cancel')}
        confirmLoading={uploadMutation.isPending}
        width={700}
      >
        <Form form={form} layout="vertical" initialValues={{ decision_type: 'grade_conversion' }}>
          <Form.Item name="title" label={t('senateDecisions.form.title')} rules={[{ required: true }]}>
            <Input placeholder="Senate Decision on ECTS Grade Conversion Table" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="reference_no" label={t('senateDecisions.form.referenceNo')} rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="2025/123" />
            </Form.Item>
            <Form.Item name="decision_date" label={t('senateDecisions.form.date')} rules={[{ required: true }]} style={{ flex: 1 }}>
              <DatePicker placeholder={t('common.selectDate')} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="decision_type" label={t('senateDecisions.form.type')} rules={[{ required: true }]}>
            <Select placeholder={t('senateDecisions.filterType')} options={decisionTypeOptions} />
          </Form.Item>

          <Form.Item label={t('adminPanel.faculty')}>
            <Select
              placeholder={t('adminPanel.faculty')}
              value={uploadFacultyId}
              onChange={handleFacultyChange}
              allowClear
            >
              {allowedFacultiesForUser?.map((f: any) => (
                <Select.Option key={f.id} value={f.id}>{f.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          {deptRows.map((row) => {
            const selectedDept = allowedUploadDepartments.find((d: any) => d.id === row.department_id);
            const deptUniversities = allUniversities.filter(
              (u: any) => u.department_id === row.department_id && !u.is_home
            );

            return (
              <Card
                key={row.key}
                size="small"
                style={{ marginBottom: 12, borderRadius: 8, border: '1px solid #e8e8e8' }}
                styles={{ body: { padding: '12px 16px' } }}
                extra={
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeDeptRow(row.key)}
                  />
                }
              >
                <Space size={16} style={{ display: 'flex', width: '100%' }} direction="vertical">
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                      {t('senateDecisions.form.department')}
                    </Text>
                    <Select
                      placeholder={t('senateDecisions.filterDept')}
                      value={row.department_id}
                      onChange={(val) => updateDeptRow(row.key, 'department_id', val)}
                      allowClear
                      style={{ width: '100%' }}
                      options={allowedUploadDepartments?.map((d: any) => ({ label: d.name, value: d.id }))}
                    />
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                      {t('senateDecisions.table.university') || 'Partner Üniversite(ler)'}
                    </Text>
                    <Select
                      placeholder={row.department_id
                        ? (t('senateDecisions.table.allUnis') || 'Tüm Üniversiteler')
                        : (t('senateDecisions.selectDeptFirst') || 'Önce bölüm seçin')}
                      value={row.university_ids}
                      onChange={(val) => updateDeptRow(row.key, 'university_ids', val)}
                      mode="multiple"
                      allowClear
                      showSearch
                      filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                      }
                      disabled={!row.department_id}
                      style={{ width: '100%' }}
                      options={deptUniversities.map((u: any) => ({ label: u.name, value: u.id }))}
                    />
                  </div>
                </Space>
              </Card>
            );
          })}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addDeptRow}
            disabled={!uploadFacultyId}
            block
            style={{ marginBottom: 16 }}
          >
            {t('senateDecisions.form.addDepartment') || 'Bölüm Ekle'}
          </Button>

          <Form.Item name="summary" label={t('senateDecisions.form.summary')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="file" label={t('senateDecisions.form.file')}>
            <Upload maxCount={1} beforeUpload={(file) => {
              const isLt15M = file.size / 1024 / 1024 <= 15;
              if (!isLt15M) {
                message.error(t('upload.fileLimitError', 'Dosya boyutu en fazla 15 MB olmalıdır!'));
                return Upload.LIST_IGNORE;
              }
              return false;
            }} accept=".pdf,.doc,.docx">
              <Button icon={<FilePdfOutlined />}>{t('senateDecisions.form.selectFile')}</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SenateDecisionsPage;
