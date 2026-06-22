import React, { useState } from 'react';
import {
  Table, Button, Card, Tabs, Tag, Modal, Form, Input, Select,
  message, Space, Typography, Row, Col, Statistic, Switch, Tooltip
} from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  UserAddOutlined, ApartmentOutlined, TeamOutlined,
  SafetyCertificateOutlined, GlobalOutlined, SearchOutlined,
  DeleteOutlined, ExclamationCircleOutlined, AuditOutlined,
  CopyOutlined, EditOutlined, BookOutlined, IdcardOutlined
} from '@ant-design/icons';
import {
  adminGetUsers, adminGetDepartments, adminGetRoles,
  adminDeleteUser, adminCreateDepartment,
  adminDeleteDepartment, adminAssignRole, adminRemoveRole,
  adminToggleRole, adminGetAuditLogs, adminGenerateTempCredentials,
  adminUpdateDepartment, adminGetFaculties, adminCreateFaculty, adminDeleteFaculty,
  adminUpdateFaculty, adminUpdateDepartmentFull
} from '../api/client';
import type { AdminUser, Role, Department, Faculty, AuditLogEntry, TempCredentials } from '../types';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

const AdminPanel: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isSuperAdmin, user } = useAuth();
  const isFacultyAffairsAdmin = user?.roles?.some((r: any) => r.role === 'faculty_affairs_admin') && !isSuperAdmin;

  const userDeptIds = React.useMemo(() =>
    user?.roles?.filter(r => r.role === 'dept_admin').map(r => r.department_id).filter(id => id != null) || [],
    [user]
  );

  const userFacultyIds = React.useMemo(() =>
    user?.roles?.filter(r => r.role === 'faculty_affairs_admin').map(r => r.faculty_id).filter(id => id != null) || [],
    [user]
  );
  const [isDeptModalVisible, setIsDeptModalVisible] = useState(false);
  const [isFacultyModalVisible, setIsFacultyModalVisible] = useState(false);
  const [isTempCredModalVisible, setIsTempCredModalVisible] = useState(false);
  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editingFaculty, setEditingFaculty] = useState<Faculty | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [tempCredentials, setTempCredentials] = useState<TempCredentials | null>(null);
  const [deptForm] = Form.useForm();
  const [facultyForm] = Form.useForm();
  const [tempCredForm] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<number | null>(null);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(10);

  // --- Queries ---
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminGetUsers,
  });

  const { data: departments, isLoading: deptsLoading } = useQuery({
    queryKey: ['admin-depts'],
    queryFn: adminGetDepartments,
  });

  const { data: faculties = [] } = useQuery({
    queryKey: ['admin-faculties'],
    queryFn: adminGetFaculties,
  });

  const { data: roles } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: adminGetRoles,
  });

  const { data: auditLogsData, isLoading: logsLoading } = useQuery({
    queryKey: ['admin-audit-logs', logsPage, logsPageSize],
    queryFn: () => adminGetAuditLogs((logsPage - 1) * logsPageSize, logsPageSize),
  });

  // Keep selectedUser in sync with fresh query data
  const selectedUserFromQuery = users?.find(u => u.id === selectedUser?.id);
  const activeUser = selectedUserFromQuery || selectedUser;

  // --- Mutations ---
  const createDeptMutation = useMutation({
    mutationFn: adminCreateDepartment,
    onSuccess: () => {
      message.success(t('adminPanel.messages.deptCreated'));
      setIsDeptModalVisible(false);
      deptForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-depts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.deptCreateFailed')),
  });

  const deleteUserMutation = useMutation({
    mutationFn: adminDeleteUser,
    onSuccess: () => {
      message.success(t('adminPanel.messages.personnelRemoved'));
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.userDeleteFailed')),
  });

  const deleteDeptMutation = useMutation({
    mutationFn: adminDeleteDepartment,
    onSuccess: () => {
      message.success(t('adminPanel.messages.unitRemoved'));
      queryClient.invalidateQueries({ queryKey: ['admin-depts'] });
      queryClient.invalidateQueries({ queryKey: ['public-departments'] });
      queryClient.invalidateQueries({ queryKey: ['public-departments-layout'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.unitDeleteFailed')),
  });

  const updateDeptMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      adminUpdateDepartment(id, { is_active }),
    onSuccess: () => {
      message.success(t('adminPanel.messages.deptStatusUpdated'));
      queryClient.invalidateQueries({ queryKey: ['admin-depts'] });
      queryClient.invalidateQueries({ queryKey: ['public-departments'] });
      queryClient.invalidateQueries({ queryKey: ['public-departments-layout'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.deptUpdateFailed')),
  });

  const createFacultyMutation = useMutation({
    mutationFn: adminCreateFaculty,
    onSuccess: () => {
      message.success(t('adminPanel.messages.facultyCreated'));
      setIsFacultyModalVisible(false);
      facultyForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-faculties'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.facultyCreateFailed')),
  });

  const deleteFacultyMutation = useMutation({
    mutationFn: adminDeleteFaculty,
    onSuccess: () => {
      message.success(t('adminPanel.messages.facultyRemoved'));
      queryClient.invalidateQueries({ queryKey: ['admin-faculties'] });
      queryClient.invalidateQueries({ queryKey: ['admin-depts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.facultyDeleteFailed')),
  });

  const updateDeptMutation2 = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      adminUpdateDepartmentFull(id, data),
    onSuccess: () => {
      message.success(t('adminPanel.messages.deptUpdated'))
      setIsDeptModalVisible(false);
      setEditingDept(null);
      deptForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-depts'] });
      queryClient.invalidateQueries({ queryKey: ['public-departments'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.deptUpdateFailed')),
  });

  const updateFacultyMutation2 = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      adminUpdateFaculty(id, data),
    onSuccess: () => {
      message.success(t('adminPanel.messages.facultyUpdated'));
      setIsFacultyModalVisible(false);
      setEditingFaculty(null);
      facultyForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-faculties'] });
      queryClient.invalidateQueries({ queryKey: ['admin-depts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.facultyUpdateFailed')),
  });

  const generateTempMutation = useMutation({
    mutationFn: adminGenerateTempCredentials,
    onSuccess: (data: TempCredentials) => {
      setTempCredentials(data);
      setIsTempCredModalVisible(false);
      tempCredForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.credsFailed')),
  });

  const assignRoleMutation = useMutation({
    mutationFn: ({ userId, roleId, deptId, facultyId }: { userId: number; roleId: number; deptId?: number; facultyId?: number }) =>
      adminAssignRole(userId, roleId, deptId, facultyId),
    onSuccess: () => {
      message.success(t('adminPanel.messages.roleAssigned'));
      roleForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.roleAssignFailed')),
  });

  const removeRoleMutation = useMutation({
    mutationFn: ({ userId, assignmentId }: { userId: number; assignmentId: number }) =>
      adminRemoveRole(userId, assignmentId),
    onSuccess: () => {
      message.success(t('adminPanel.messages.roleRemoved'));
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.roleRemoveFailed')),
  });

  const toggleRoleMutation = useMutation({
    mutationFn: ({ assignmentId, isActive }: { assignmentId: number; isActive: boolean }) =>
      adminToggleRole(assignmentId, isActive),
    onSuccess: () => {
      message.success(t('adminPanel.messages.roleStatusUpdated'));
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || t('adminPanel.messages.roleStatusUpdated')),
  });

  // --- Helpers ---
  const handleDeleteUser = (user: AdminUser) => {
    Modal.confirm({
      title: t('adminPanel.confirm.removeUser'),
      icon: <ExclamationCircleOutlined />,
      content: t('adminPanel.confirm.removeUserDesc', { name: user.name || user.eid }),
      okText: t('adminPanel.confirm.yesRemove'),
      okType: 'danger',
      cancelText: t('adminPanel.modals.manageRoles.remove'),
      onOk: () => deleteUserMutation.mutate(user.id),
    });
  };

  const handleDeleteDept = (dept: Department) => {
    Modal.confirm({
      title: t('adminPanel.confirm.removeDept'),
      icon: <ExclamationCircleOutlined />,
      content: t('adminPanel.confirm.removeDeptDesc', { name: dept.name }),
      okText: t('adminPanel.confirm.yesRemove'),
      okType: 'danger',
      cancelText: t('adminPanel.modals.manageRoles.remove'),
      onOk: () => deleteDeptMutation.mutate(dept.id),
    });
  };

  const openRoleModal = (user: AdminUser) => {
    setSelectedUser(user);
    setIsRoleModalVisible(true);
  };

  const getRolePriority = (u: AdminUser) => {
    const roles = u.role_assignments.filter(a => a.is_active).map(a => a.role.name);
    if (roles.includes('super_admin')) return 1;
    if (roles.includes('dept_admin')) return 2;
    if (roles.includes('coordinator')) return 3;
    if (roles.includes('faculty_affairs_admin')) return 4;
    if (roles.includes('registrar')) return 5;
    if (roles.includes('student')) return 6;
    return 10;
  };

  const filteredUsers = React.useMemo(() => {
    if (!users) return [];
    return [...users]
      .filter((u: AdminUser) => {
        const matchesSearch = (u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
         u.eid?.toLowerCase().includes(searchQuery.toLowerCase()));

        // Role filter
        if (roleFilter) {
          const hasRole = u.role_assignments.some(a => a.role.name === roleFilter && a.is_active);
          if (!hasRole) return false;
        }

        // Department filter
        if (deptFilter) {
          const inDept = u.role_assignments.some(a => a.department?.id === deptFilter && a.is_active);
          if (!inDept) return false;
        }

        if (isSuperAdmin) return matchesSearch;

        const isSelf = Boolean(user?.eid && u.eid === user.eid);

        // Faculty Affairs Admin sees:
        // 1. Users with registrar role in their faculty
        if (isFacultyAffairsAdmin) {
          const inMyFaculty = u.role_assignments.some(a =>
            a.faculty && userFacultyIds.includes(a.faculty.id) &&
            a.role.name === 'registrar'
          );
          const isSA = u.role_assignments.some(a => a.role.name === 'super_admin');
          return matchesSearch && (inMyFaculty || isSA || isSelf);
        }

        // Dept Admin sees:
        // 1. Users with assignments in their department
        const inMyDept = u.role_assignments.some(a => a.department && userDeptIds.includes(a.department.id));
        // 2. Super admins (to see who is above them)
        const isSA = u.role_assignments.some(a => a.role.name === 'super_admin');

        return matchesSearch && (inMyDept || isSA || isSelf);
      })
      .sort((a, b) => {
        const pa = getRolePriority(a);
        const pb = getRolePriority(b);
        if (pa !== pb) return pa - pb;
        const nameA = a.name || a.eid || '';
        const nameB = b.name || b.eid || '';
        return nameA.localeCompare(nameB);
      });
  }, [users, searchQuery, roleFilter, deptFilter, isSuperAdmin, userDeptIds]);

  // --- Role color map ---
  const roleColor = (name: string) => {
    if (name === 'super_admin') return 'volcano';
    if (name === 'faculty_affairs_admin') return 'cyan';
    if (name === 'dept_admin') return 'purple';
    if (name === 'coordinator') return 'blue';
    if (name === 'registrar') return 'orange';
    return 'default';
  };

  // --- Action color map for audit logs ---
  const actionColor = (action: string) => {
    if (action.includes('CREATE') || action.includes('ASSIGN') || action.includes('GENERATE')) return 'green';
    if (action.includes('DELETE') || action.includes('REMOVE')) return 'red';
    if (action.includes('TOGGLE')) return 'orange';
    if (action.includes('UNAUTHORIZED')) return 'volcano';
    return 'default';
  };

  // --- Columns ---
  const userColumns = [
    {
      title: t('adminPanel.userTable.identity'),
      key: 'identity',
      render: (u: AdminUser) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 14 }}>{u.name || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{u.eid}</Text>
          {u.needs_cats_link && <Tag color="warning" style={{ fontSize: 10, marginTop: 2 }}>{t('adminPanel.userTable.pendingCats')}</Tag>}
        </Space>
      )
    },
    { title: t('adminPanel.userTable.email'), dataIndex: 'email', key: 'email', render: (email: string) => email || '-' },
    {
      title: t('adminPanel.userTable.privileges'),
      dataIndex: 'role_assignments',
      key: 'roles',
      render: (assignments: AdminUser['role_assignments']) => (
        <Space wrap>
          {assignments.map(a => (
            <Tag
              color={a.is_active ? roleColor(a.role.name) : 'default'}
              key={a.id}
              style={{
                borderRadius: 12, padding: '0 12px',
                opacity: a.is_active ? 1 : 0.5,
                textDecoration: a.is_active ? 'none' : 'line-through',
              }}
            >
              {a.role.name.toUpperCase()}{a.department ? ` • ${a.department.code}` : ''}{a.faculty ? ` • ${a.faculty.code}` : ''}
            </Tag>
          ))}
        </Space>
      )
    },
    {
      title: t('adminPanel.userTable.status'),
      key: 'role_status',
      width: 100,
      render: (u: AdminUser) => {
        const hasActiveRoles = u.role_assignments.some(a => a.is_active);
        return (
          <Tag color={hasActiveRoles ? 'success' : 'error'} style={{ border: 'none' }}>
            {hasActiveRoles ? t('adminPanel.userTable.active') : t('adminPanel.userTable.inactive')}
          </Tag>
        );
      }
    },
    {
      title: t('adminPanel.userTable.actions'),
      key: 'action',
      width: 100,
      render: (u: AdminUser) => (
        <Space>
          <Tooltip title={u.role_assignments.some(ra => ra.role.name === 'super_admin' && ra.is_active) ? 'Only super_admin can manage this user' : t('adminPanel.userTable.actions')}>
            <Button type="text" icon={<EditOutlined />} disabled={u.role_assignments.some(ra => ra.role.name === 'super_admin' && ra.is_active) && !isSuperAdmin} onClick={() => openRoleModal(u)} />
          </Tooltip>
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            disabled={u.role_assignments.some(ra => ra.role.name === 'super_admin' && ra.is_active) && !isSuperAdmin}
            onClick={() => handleDeleteUser(u)}
          />
        </Space>
      )
    }
  ];

  const deptColumns = [
    { title: t('adminPanel.deptTable.code'), dataIndex: 'code', key: 'code', render: (code: string) => <Text strong>{code}</Text> },
    { title: t('adminPanel.deptTable.name'), dataIndex: 'name', key: 'name' },
    {
      title: t('adminPanel.deptTable.faculty'),
      dataIndex: 'faculty',
      key: 'faculty',
      render: (f: Faculty | null) => f ? <Tag>{f.name}</Tag> : <Tag color="default">-</Tag>,
    },
    {
      title: t('adminPanel.deptTable.health'),
      key: 'status',
      render: (d: Department) => (
        <Space>
          <Switch
            size="small"
            checked={d.is_active}
            disabled={!isSuperAdmin}
            loading={updateDeptMutation.isPending && updateDeptMutation.variables?.id === d.id}
            onChange={(checked) => updateDeptMutation.mutate({ id: d.id, is_active: checked })}
          />
          <Tag color={d.is_active ? 'green' : 'red'}>{d.is_active ? t('adminPanel.deptTable.operational') : t('adminPanel.deptTable.offline')}</Tag>
        </Space>
      )
    },
    ...(isSuperAdmin ? [{
      title: t('adminPanel.deptTable.actions'),
      key: 'action',
      width: 80,
      render: (d: Department) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditingDept(d); deptForm.setFieldsValue({ name: d.name, code: d.code, faculty_id: d.faculty?.id }); setIsDeptModalVisible(true); }}
          />
          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteDept(d)} />
        </Space>
      )
    }] : [])
  ];

  const facultyColumns = [
    { title: t('adminPanel.facultyTable.code'), dataIndex: 'code', key: 'code', render: (c: string) => <Text strong>{c}</Text> },
    { title: t('adminPanel.facultyTable.name'), dataIndex: 'name', key: 'name' },
    {
      title: t('adminPanel.deptTable.health'),
      key: 'status',
      render: (f: Faculty) => (
        <Tag color={f.is_active ? 'green' : 'red'}>{f.is_active ? t('adminPanel.deptTable.operational') : t('adminPanel.deptTable.offline')}</Tag>
      ),
    },
    ...(isSuperAdmin ? [{
      title: t('adminPanel.deptTable.actions'),
      key: 'action',
      width: 100,
      render: (f: Faculty) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditingFaculty(f); facultyForm.setFieldsValue({ name: f.name, code: f.code }); setIsFacultyModalVisible(true); }}
          />
          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => {
            Modal.confirm({
              title: t('adminPanel.confirm.removeFaculty'),
              content: t('adminPanel.confirm.removeFacultyDesc', { name: f.name }),
              okText: t('adminPanel.confirm.yesRemove'),
              okType: 'danger',
              onOk: () => deleteFacultyMutation.mutate(f.id),
            });
          }} />
        </Space>
      )
    }] : [])
  ];

  const auditColumns = [
    {
      title: t('adminPanel.auditTable.time'),
      dataIndex: 'created_at',
      key: 'time',
      width: 160,
      render: (t: string) => new Date(t).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
    },
    {
      title: t('adminPanel.auditTable.actor'),
      key: 'actor',
      width: 140,
      render: (log: AuditLogEntry) => log.actor?.name || log.actor?.eid || '-',
    },
    {
      title: t('adminPanel.auditTable.action'),
      dataIndex: 'action',
      key: 'action',
      width: 200,
      render: (action: string) => <Tag color={actionColor(action)}>{action}</Tag>,
    },
    {
      title: t('adminPanel.auditTable.target'),
      key: 'target',
      width: 140,
      render: (log: AuditLogEntry) => log.target_user?.name || log.target_user?.eid || '-',
    },
    {
      title: t('adminPanel.auditTable.details'),
      dataIndex: 'details',
      key: 'details',
      render: (d: Record<string, unknown>) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {JSON.stringify(d)}
        </Text>
      ),
    },
  ];

  const stats = [
    { title: t('adminPanel.stats.personnel'), value: filteredUsers?.length || 0, icon: <TeamOutlined />, color: '#c0392b' },
    { title: t('adminPanel.stats.units'), value: departments?.length || 0, icon: <ApartmentOutlined />, color: '#2c3e50' },
    { title: t('adminPanel.stats.superAdmins'), value: filteredUsers?.filter(u => u.role_assignments.some(ra => ra.role.name === 'super_admin' && ra.is_active)).length || 0, icon: <SafetyCertificateOutlined />, color: '#f39c12' },
    { title: t('adminPanel.stats.deptAdmins'), value: filteredUsers?.filter(u => u.role_assignments.some(ra => ra.role.name === 'dept_admin' && ra.is_active)).length || 0, icon: <UserAddOutlined />, color: '#8e44ad' },
    { title: t('adminPanel.stats.coordinators'), value: filteredUsers?.filter(u => u.role_assignments.some(ra => ra.role.name === 'coordinator' && ra.is_active)).length || 0, icon: <GlobalOutlined />, color: '#27ae60' },
    { title: 'Faculty Affairs', value: filteredUsers?.filter(u => u.role_assignments.some(ra => ra.role.name === 'faculty_affairs_admin' && ra.is_active)).length || 0, icon: <IdcardOutlined />, color: '#16a085' },
    { title: 'Registrar', value: filteredUsers?.filter(u => u.role_assignments.some(ra => ra.role.name === 'registrar' && ra.is_active)).length || 0, icon: <BookOutlined />, color: '#d35400' },
    { title: t('adminPanel.stats.students'), value: filteredUsers?.filter(u => u.role_assignments.some(ra => ra.role.name === 'student' && ra.is_active)).length || 0, icon: <TeamOutlined />, color: '#2980b9' },
  ];

  return (
    <div className="admin-container page-enter" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Space direction="vertical" size={0}>
          <Text type="secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11, fontWeight: 700 }}>{t('adminPanel.subtitle')}</Text>
          <Title level={2} style={{ margin: 0, fontWeight: 800 }}>{t('adminPanel.title')}</Title>
        </Space>
        <Space size={12}>
          {isSuperAdmin && (
            <>
              <Button
                icon={<ApartmentOutlined />}
                onClick={() => { deptForm.resetFields(); setIsDeptModalVisible(true); }}
                size="large"
                className="admin-action-btn"
                style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff', fontWeight: 500, height: 44, paddingInline: 22, borderRadius: 10 }}
              >
                {t('adminPanel.newDept')}
              </Button>
              <Button
                icon={<ApartmentOutlined />}
                onClick={() => { facultyForm.resetFields(); setIsFacultyModalVisible(true); }}
                size="large"
                className="admin-action-btn"
                style={{ background: '#2c3e50', borderColor: '#2c3e50', color: '#fff', fontWeight: 500, height: 44, paddingInline: 22, borderRadius: 10 }}
              >
                {t('adminPanel.newFaculty')}
              </Button>
            </>
          )}
          <Button
            icon={<UserAddOutlined />}
            onClick={() => { tempCredForm.resetFields(); setIsTempCredModalVisible(true); }}
            size="large"
            className="admin-action-btn"
            style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff', fontWeight: 500, height: 44, paddingInline: 22, borderRadius: 10 }}
          >
            {t('adminPanel.addStaff')}
          </Button>
        </Space>
      </div>

      <div className="stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginBottom: 32 }}>
        {stats.map((s, idx) => (
          <div
            key={idx}
            className="stat-badge"
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
              border: '1px solid var(--gray-100)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              cursor: 'default',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.transform = '';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '';
            }}
          >
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: s.color + '14',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: s.color, fontSize: 18 }}>{s.icon}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2 }}>{s.title}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gray-900)', lineHeight: 1.3 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      <Card style={{ borderRadius: 16, border: 'none', overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
        <Tabs
          defaultActiveKey="1"
          className="admin-tabs"
          tabBarStyle={{ padding: '0 24px', marginBottom: 0, background: '#fff' }}
          items={[
            {
              key: '1',
              label: <span style={{ padding: '12px 0', display: 'inline-block' }}><TeamOutlined /> {t('adminPanel.tabs.personnel')}</span>,
              children: (
                <div style={{ padding: 24 }}>
                  <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Input
                      prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                      placeholder={t('adminPanel.searchPlaceholder')}
                      size="large"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{ borderRadius: 12, flex: '1 1 200px', minWidth: 200 }}
                    />
                    <Select
                      placeholder={t('adminPanel.filterRole')}
                      value={roleFilter}
                      onChange={setRoleFilter}
                      allowClear
                      size="large"
                      style={{ borderRadius: 12, width: 160 }}
                      options={roles?.map((r: Role) => ({ label: r.name.toUpperCase(), value: r.name }))}
                    />
                    <Select
                      placeholder={t('adminPanel.filterDept')}
                      value={deptFilter}
                      onChange={setDeptFilter}
                      allowClear
                      size="large"
                      style={{ borderRadius: 12, width: 220 }}
                      options={departments?.map((d: Department) => ({ label: d.name, value: d.id }))}
                    />
                  </div>
                  <Table
                    dataSource={filteredUsers}
                    columns={userColumns}
                    loading={usersLoading}
                    rowKey="id"
                    pagination={{ pageSize: 8 }}
                  />
                </div>
              ),
            },
            {
              key: '2',
              label: <span style={{ padding: '12px 0', display: 'inline-block' }}><ApartmentOutlined /> {t('adminPanel.tabs.units')}</span>,
              children: (
                <div style={{ padding: 24 }}>
                  <Title level={5} style={{ marginBottom: 16 }}>{t('adminPanel.tabs.faculties')}</Title>
                  <Table
                    dataSource={faculties}
                    columns={facultyColumns}
                    rowKey="id"
                    pagination={false}
                    style={{ marginBottom: 32 }}
                  />
                  <Title level={5} style={{ marginBottom: 16 }}>{t('adminPanel.tabs.departments')}</Title>
                  <Table dataSource={departments} columns={deptColumns} loading={deptsLoading} rowKey="id" pagination={{ pageSize: 8 }} />
                </div>
              ),
            },
            {
              key: '3',
              label: <span style={{ padding: '12px 0', display: 'inline-block' }}><AuditOutlined /> {t('adminPanel.tabs.logs')}</span>,
              children: (
                <div style={{ padding: 24 }}>
                  <Table
                    dataSource={auditLogsData?.items || []}
                    columns={auditColumns}
                    loading={logsLoading}
                    rowKey="id"
                    pagination={{
                      current: logsPage,
                      pageSize: logsPageSize,
                      total: auditLogsData?.total || 0,
                      onChange: (page, size) => {
                        setLogsPage(page);
                        setLogsPageSize(size);
                      },
                      showSizeChanger: true,
                    }}
                    scroll={{ x: 800 }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Add Staff Modal */}
      <Modal
        title={null}
        open={isTempCredModalVisible}
        onCancel={() => setIsTempCredModalVisible(false)}
        onOk={() => tempCredForm.submit()}
        confirmLoading={generateTempMutation.isPending}
        width={480}
        okText="Create Account"
        okButtonProps={{ size: 'large', style: { borderRadius: 12, background: '#c0392b', borderColor: '#c0392b' } }}
        cancelButtonProps={{ size: 'large', style: { borderRadius: 12 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, background: '#f9e8e6', borderRadius: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <UserAddOutlined style={{ fontSize: 28, color: '#c0392b' }} />
          </div>
          <Title level={4} style={{ margin: 0 }}>{t('adminPanel.modals.addStaff.title')}</Title>
          <Text type="secondary">{t('adminPanel.modals.addStaff.desc')}</Text>
        </div>
        <Form form={tempCredForm} layout="vertical" onFinish={v => {
          if (typeof v.role_names === 'string') v.role_names = [v.role_names];
          generateTempMutation.mutate(v);
        }}>
          <Form.Item name="name" label={t('adminPanel.modals.addStaff.displayName')}>
            <Input placeholder="Prof. Dr. Jane Smith" size="large" />
          </Form.Item>
          <Form.Item name="role_names" label={t('adminPanel.modals.addStaff.roles')} rules={[{ required: true }]}>
            <Select placeholder={t('adminPanel.modals.addStaff.roles')} size="large" onChange={(val) => tempCredForm.setFieldValue('_selected_role', val)}>
              {roles?.filter((r: Role) => {
                if (r.name === 'student') return false;
                if (isFacultyAffairsAdmin) return r.name === 'registrar';
                if (!isSuperAdmin) return r.name !== 'super_admin' && r.name !== 'dept_admin' && r.name !== 'faculty_affairs_admin';
                return true;
              }).map((r: Role) => (
                <Select.Option key={r.name} value={r.name}>{r.name.toUpperCase()}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev._selected_role !== cur._selected_role}>
            {({ getFieldValue }) => {
              const role = getFieldValue('_selected_role') || getFieldValue('role_names');
              if (role === 'super_admin') return null;
              const isFacultyRole = role === 'registrar' || role === 'faculty_affairs_admin';
              if (isFacultyAffairsAdmin || (isSuperAdmin && isFacultyRole)) {
                return (
                  <Form.Item name="faculty_id" label={t('adminPanel.faculty')} rules={[{ required: true }]}>
                    <Select placeholder={t('adminPanel.faculty')} size="large">
                      {faculties?.filter((f: Faculty) => isFacultyAffairsAdmin ? userFacultyIds.includes(f.id) : true).map((f: Faculty) => (
                        <Select.Option key={f.id} value={f.id}>{f.name} ({f.code})</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                );
              }
              return (
                <Form.Item name="department_id" label={t('adminPanel.modals.addStaff.dept')} rules={[{ required: !isSuperAdmin }]}>
                  <Select placeholder={t('adminPanel.modals.addStaff.dept')} size="large">
                    {departments?.filter((d: Department) => isSuperAdmin || userDeptIds.includes(d.id)).map((d: Department) => (
                      <Select.Option key={d.id} value={d.id}>{d.name} ({d.code})</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>

      {/* Temp Credentials Result Modal */}
      <Modal
        title={null}
        open={!!tempCredentials}
        onCancel={() => setTempCredentials(null)}
        footer={[
          <Button key="close" type="primary" size="large" onClick={() => setTempCredentials(null)} style={{ borderRadius: 12 }}>
            Done
          </Button>
        ]}
        width={440}
      >
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ width: 64, height: 64, background: '#e8f8e8', borderRadius: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <SafetyCertificateOutlined style={{ fontSize: 28, color: '#27ae60' }} />
          </div>
          <Title level={4} style={{ margin: '0 0 8px' }}>{t('adminPanel.modals.credentials.title')}</Title>
          <Text type="secondary">{t('adminPanel.modals.credentials.desc')}</Text>

          <Card style={{ marginTop: 24, background: '#fafafa', borderRadius: 12, textAlign: 'left' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <div>
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('adminPanel.modals.credentials.username')}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ fontSize: 18, fontFamily: 'monospace' }}>{tempCredentials?.temp_eid}</Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(tempCredentials?.temp_eid || ''); message.success(t('adminPanel.messages.copied')); }}
                  />
                </div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('adminPanel.modals.credentials.password')}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ fontSize: 18, fontFamily: 'monospace' }}>{tempCredentials?.temp_password}</Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(tempCredentials?.temp_password || ''); message.success(t('adminPanel.messages.copied')); }}
                  />
                </div>
              </div>
            </Space>
          </Card>

          <div style={{ marginTop: 16, padding: '12px 16px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffe58f' }}>
            <Text style={{ fontSize: 12, color: '#d48806' }}>
              {t('adminPanel.modals.credentials.warning')}
            </Text>
          </div>
        </div>
      </Modal>

      {/* Role Management Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--gray-200)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e8f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SafetyCertificateOutlined style={{ fontSize: 20, color: '#2980b9' }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gray-900)', lineHeight: 1.2 }}>
                {t('adminPanel.modals.manageRoles.title', { name: activeUser?.name || activeUser?.eid })}
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--gray-500)', marginTop: 2 }}>
                {activeUser?.email || activeUser?.eid}
              </div>
            </div>
          </div>
        }
        open={isRoleModalVisible}
        onCancel={() => { setIsRoleModalVisible(false); setSelectedUser(null); roleForm.resetFields(); }}
        footer={null}
        width={780}
        styles={{ body: { paddingTop: 16 } }}
      >
        {activeUser && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                {t('adminPanel.modals.manageRoles.current')}
              </div>
              {activeUser.role_assignments.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0' }}>
                  <Text type="secondary" style={{ fontSize: 14 }}>{t('adminPanel.modals.manageRoles.noRoles')}</Text>
                </div>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size={10}>
                  {activeUser.role_assignments.map(a => (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', background: '#fff', borderRadius: 12,
                      border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      transition: 'all 0.2s ease'
                    }}>
                      <Space size={12}>
                        <Tag color={a.is_active ? roleColor(a.role.name) : 'default'} style={{ padding: '4px 12px', borderRadius: 20, fontWeight: 600, fontSize: 12, margin: 0 }}>
                          {a.role.name.toUpperCase()}
                        </Tag>
                        {a.department && <Text strong style={{ color: '#334155' }}>{a.department.name} ({a.department.code})</Text>}
                        {a.faculty && <Text strong style={{ color: '#334155' }}>{a.faculty.name} ({a.faculty.code})</Text>}
                      </Space>
                      <Space size={12}>
                        <Tooltip title={!isSuperAdmin && a.role.name === 'super_admin' ? 'Only super_admin can modify' : (a.is_active ? t('adminPanel.modals.manageRoles.deactivate') : t('adminPanel.modals.manageRoles.activate'))}>
                          <Switch
                            checked={a.is_active}
                            loading={toggleRoleMutation.isPending}
                            disabled={!isSuperAdmin && a.role.name === 'super_admin'}
                            onChange={(checked) => toggleRoleMutation.mutate({ assignmentId: a.id, isActive: checked })}
                          />
                        </Tooltip>
                        <Tooltip title={t('adminPanel.modals.manageRoles.remove')}>
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined style={{ fontSize: 16 }} />}
                            loading={removeRoleMutation.isPending}
                            disabled={!isSuperAdmin && a.role.name === 'super_admin'}
                            onClick={() => removeRoleMutation.mutate({ userId: activeUser.id, assignmentId: a.id })}
                            style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          />
                        </Tooltip>
                      </Space>
                    </div>
                  ))}
                </Space>
              )}
            </div>

            <div style={{ padding: '20px', background: '#f8fafc', borderRadius: 14, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserAddOutlined style={{ color: '#2563eb' }} />
                <span>{t('adminPanel.modals.manageRoles.addNew')}</span>
              </div>
              <Form
                form={roleForm}
                layout="vertical"
                style={{ margin: 0 }}
                onFinish={(v) => {
                  assignRoleMutation.mutate({
                    userId: activeUser.id,
                    roleId: v.role_id,
                    deptId: v.department_id,
                    facultyId: v.faculty_id,
                  });
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', width: '100%' }}>
                  <Form.Item name="role_id" label={<span style={{ fontWeight: 600, fontSize: 12, color: '#475569' }}>{t('adminPanel.modals.manageRoles.role')}</span>} rules={[{ required: true, message: 'Seçiniz' }]} style={{ margin: 0, flex: 2 }}>
                    <Select placeholder={t('adminPanel.modals.manageRoles.role')} size="large" style={{ width: '100%' }} onChange={() => { roleForm.setFieldValue('department_id', undefined); roleForm.setFieldValue('faculty_id', undefined); }}>
                      {roles?.filter((r: Role) => {
                        if (isFacultyAffairsAdmin) return ['registrar'].includes(r.name);
                        if (!isSuperAdmin) return r.name !== 'super_admin' && r.name !== 'dept_admin' && r.name !== 'faculty_affairs_admin';
                        return true;
                      }).map((r: Role) => (
                        <Select.Option key={r.id} value={r.id}>
                          <span style={{ fontWeight: 500 }}>{r.name.toUpperCase()}</span>
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.role_id !== cur.role_id}>
                    {({ getFieldValue }) => {
                      const roleId = getFieldValue('role_id');
                      const role = roles?.find((r: Role) => r.id === roleId);
                      const roleName = role?.name;

                      if (roleName === 'super_admin') {
                        return (
                          <Form.Item label={<span style={{ fontWeight: 600, fontSize: 12, color: '#475569' }}>{t('common.unit')}</span>} style={{ margin: 0, flex: 3 }}>
                            <Input size="large" disabled placeholder="Sistem Geneli (Birim Atanmaz)" style={{ background: '#f1f5f9', color: '#64748b', borderColor: '#cbd5e1' }} />
                          </Form.Item>
                        );
                      }
                      if (roleName === 'registrar' || roleName === 'faculty_affairs_admin') {
                        return (
                          <Form.Item name="faculty_id" label={<span style={{ fontWeight: 600, fontSize: 12, color: '#475569' }}>{t('adminPanel.faculty')}</span>} rules={[{ required: true, message: 'Seçiniz' }]} style={{ margin: 0, flex: 3 }}>
                            <Select placeholder={t('adminPanel.faculty')} size="large" style={{ width: '100%' }} allowClear showSearch optionFilterProp="children">
                              {faculties?.filter((f: Faculty) => isFacultyAffairsAdmin ? userFacultyIds.includes(f.id) : true).map((f: Faculty) => (
                                <Select.Option key={f.id} value={f.id}>{f.code} - {f.name}</Select.Option>
                              ))}
                            </Select>
                          </Form.Item>
                        );
                      }
                      return (
                        <Form.Item name="department_id" label={<span style={{ fontWeight: 600, fontSize: 12, color: '#475569' }}>{t('adminPanel.modals.manageRoles.dept')}</span>} rules={[{ required: !!roleName, message: 'Seçiniz' }]} style={{ margin: 0, flex: 3 }}>
                          <Select placeholder={t('adminPanel.modals.manageRoles.dept')} size="large" style={{ width: '100%' }} allowClear showSearch optionFilterProp="children" disabled={!roleName}>
                            {departments?.filter((d: Department) => isSuperAdmin || userDeptIds.includes(d.id)).map((d: Department) => (
                              <Select.Option key={d.id} value={d.id}>{d.code} - {d.name}</Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Form.Item style={{ margin: 0, flexShrink: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      size="large"
                      icon={<UserAddOutlined />}
                      loading={assignRoleMutation.isPending}
                      style={{
                        background: '#c0392b',
                        borderColor: '#c0392b',
                        color: '#fff',
                        fontWeight: 600,
                        padding: '0 24px',
                        borderRadius: 8,
                        boxShadow: '0 2px 4px rgba(192, 57, 43, 0.25)',
                        height: 40
                      }}
                    >
                      {t('adminPanel.modals.manageRoles.assign')}
                    </Button>
                  </Form.Item>
                </div>
              </Form>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Department Modal */}
      <Modal
        title={t('adminPanel.modals.newDept.title')}
        open={isDeptModalVisible}
        onCancel={() => setIsDeptModalVisible(false)}
        onOk={() => deptForm.submit()}
        confirmLoading={createDeptMutation.isPending}
        okButtonProps={{ style: { borderRadius: 12 } }}
        cancelButtonProps={{ style: { borderRadius: 12 } }}
      >
        <Form form={deptForm} layout="vertical" onFinish={v => createDeptMutation.mutate(v)}>
          <Form.Item name="name" label={t('adminPanel.modals.newDept.unitName')} rules={[{ required: true }]}>
            <Input placeholder="Computer Engineering" />
          </Form.Item>
          <Form.Item name="code" label={t('adminPanel.modals.newDept.unitCode')} rules={[{ required: true }]}>
            <Input placeholder="COM" />
          </Form.Item>
          <Form.Item name="faculty_id" label={t('adminPanel.modals.newDept.faculty')}>
            <Select placeholder={t('adminPanel.modals.newDept.selectFaculty')} allowClear>
              {faculties?.filter((f: Faculty) => f.is_active).map((f: Faculty) => (
                <Select.Option key={f.id} value={f.id}>{f.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Faculty Modal */}
      <Modal
        title={t('adminPanel.modals.newFaculty.title')}
        open={isFacultyModalVisible}
        onCancel={() => setIsFacultyModalVisible(false)}
        onOk={() => facultyForm.submit()}
        confirmLoading={createFacultyMutation.isPending}
        okButtonProps={{ style: { borderRadius: 12 } }}
        cancelButtonProps={{ style: { borderRadius: 12 } }}
      >
        <Form form={facultyForm} layout="vertical" onFinish={v => createFacultyMutation.mutate(v)}>
          <Form.Item name="name" label={t('adminPanel.modals.newFaculty.name')} rules={[{ required: true }]}>
            <Input placeholder="Faculty of Engineering" />
          </Form.Item>
          <Form.Item name="code" label={t('adminPanel.modals.newFaculty.code')} rules={[{ required: true }]}>
            <Input placeholder="ENG" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminPanel;
