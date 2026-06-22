import { useState, useEffect, useMemo } from 'react';
import { Layout as AntLayout, Menu, Drawer, Button, Dropdown, Select, Typography, ConfigProvider } from 'antd';
import {
  BankOutlined,
  BookOutlined,
  UploadOutlined,
  SwapOutlined,
  MenuOutlined,
  LogoutOutlined,
  SettingOutlined,
  AuditOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  GoldOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { authLogout, getDepartments, getFaculties, getStudentApplications } from '../api/client';

const { Sider, Content, Header } = AntLayout;

const SidebarContent = ({
  onNavigate,
  selectedKey,
  departmentLabel,
  roleThemes,
}: {
  onNavigate: (key: string) => void;
  selectedKey: string;
  departmentLabel?: string;
  roleThemes: { bg: string; border: string; active: string; hover: string };
}) => {
  const { user, isSuperAdmin } = useAuth();
  const { t, i18n } = useTranslation();

  const activeColor = roleThemes.active;

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const baseMenuItems = [
    { key: '/', icon: <BankOutlined />, label: t('sidebar.menu.universities') },
    { key: '/courses', icon: <BookOutlined />, label: t('sidebar.menu.courses') },
    { key: '/upload', icon: <UploadOutlined />, label: t('sidebar.menu.upload') },
    { key: '/matching', icon: <SwapOutlined />, label: t('sidebar.menu.matching') },
    { key: '/coordinator', icon: <AuditOutlined />, label: t('sidebar.menu.reviewPanel') },
    { key: '/university-info', icon: <InfoCircleOutlined />, label: t('sidebar.menu.uniInfo') },
    { key: '/grade-conversion', icon: <GoldOutlined />, label: t('sidebar.menu.gradeConversion') },
    { key: '/transcripts', icon: <FileTextOutlined />, label: t('sidebar.menu.transcripts') },
    { key: '/senate-decisions', icon: <FileTextOutlined />, label: t('sidebar.menu.senateDecisions') },
    { key: '/upload-transfer-form', icon: <UploadOutlined />, label: t('sidebar.menu.uploadTransferForm') },
  ];
  const isStudentOnly = user?.roles.every((r: any) => r.role === 'student');
  const hasCoordinatorRole = user?.roles.some((r: any) => ['coordinator', 'dept_admin'].includes(r.role)) || isSuperAdmin;
  const isRegistrarOnly = user?.roles.some((r: any) => r.role === 'registrar')
    && !user?.roles.some((r: any) => ['coordinator', 'dept_admin', 'super_admin'].includes(r.role));
  const isFacultyAffairsAdmin2 = user?.roles.some((r: any) => r.role === 'faculty_affairs_admin') && !isSuperAdmin;

  // Check if student has any LA-ready application (to show transcript menu)
  const { data: studentApps } = useQuery({
    queryKey: ['student-applications-sidebar'],
    queryFn: getStudentApplications,
    enabled: !!isStudentOnly,
  });
  const hasLaReady = studentApps?.some((app: any) => app.status === 'learning_agreement_ready');

  const studentItems = [
    { key: '/', icon: <BookOutlined />, label: t('sidebar.menu.myApplications') },
    { key: '/partner-universities', icon: <GlobalOutlined />, label: t('sidebar.menu.partnerUnis') },
  ];
  if (hasLaReady) {
    studentItems.push({ key: '/student-transcripts', icon: <FileTextOutlined />, label: t('sidebar.menu.myTranscripts') });
  }

  const registrarMenuItems = [
    { key: '/transcripts', icon: <FileTextOutlined />, label: t('sidebar.menu.transcripts') },
    { key: '/grade-conversion', icon: <GoldOutlined />, label: t('sidebar.menu.gradeConversion') },
    { key: '/senate-decisions', icon: <FileTextOutlined />, label: t('sidebar.menu.senateDecisions') },
    { key: '/upload-transfer-form', icon: <UploadOutlined />, label: t('sidebar.menu.uploadTransferForm') },
  ];

  const items = isStudentOnly
    ? studentItems
    : isRegistrarOnly
    ? registrarMenuItems
    : isFacultyAffairsAdmin2
    ? registrarMenuItems
    : [...baseMenuItems].filter(item => hasCoordinatorRole || item.key !== '/coordinator');
  if (user?.is_admin) {
    items.push({ key: '/admin', icon: <SettingOutlined />, label: t('sidebar.menu.adminPanel') });
  }

  return (
  <>
    {/* Logo area */}
    <div style={{
      padding: '20px 20px 24px',
      borderBottom: `1px solid ${roleThemes.border}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <img
          src="/iku-logo.png"
          alt="IKU Logo"
          style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }}
        />
        <div>
          <div style={{
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}>
            Erasmus Match
          </div>
          <div style={{
            color: '#777',
            fontSize: 10,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {t('landing.nav.brand') === 'Erasmus Match' ? 'Course System' : t('landing.nav.brand')}
          </div>
        </div>
      </div>
    </div>

    {/* Navigation label */}
    <div style={{
      padding: '16px 20px 8px',
      fontSize: 10,
      fontWeight: 600,
      color: '#555',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    }}>
      {t('sidebar.navLabel')}
    </div>

    <ConfigProvider
      theme={{
        components: {
          Menu: {
            darkItemSelectedBg: activeColor,
            darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
            darkItemSelectedColor: activeColor === '#ffffff' ? '#111111' : '#ffffff',
          },
        },
      }}
    >
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={items}
        onClick={({ key }) => onNavigate(key)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '0 8px',
        }}
        theme="dark"
      />
    </ConfigProvider>

    {/* Footer info */}
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: '16px 20px',
      borderTop: `1px solid ${roleThemes.border}`,
    }}>
      <style>{`
        .sidebar-lang-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.6);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px;
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s ease;
          width: 100%;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .sidebar-lang-btn:hover {
          color: #fff;
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.2);
        }
        .lp-lang-popup {
          background-color: #2c2c2c !important;
          padding: 4px !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 8px !important;
        }
        .lp-lang-popup .ant-dropdown-menu {
          background-color: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
        .lp-lang-popup .ant-dropdown-menu-item {
          color: rgba(255,255,255,0.7) !important;
          border-radius: 4px !important;
          transition: all 0.2s ease !important;
          padding: 8px 12px !important;
        }
        .lp-lang-popup .ant-dropdown-menu-item-active {
          background-color: rgba(255,255,255,0.08) !important;
          color: #fff !important;
        }
        .lp-lang-popup .ant-dropdown-menu-item-selected {
          background-color: ${activeColor}22 !important;
          color: #ffffff !important;
          font-weight: 600 !important;
          border-left: 3px solid ${activeColor} !important;
          border-radius: 0 4px 4px 0 !important;
        }
      `}</style>

      <Dropdown
        menu={{
          items: [
            { key: 'en', label: 'English' },
            { key: 'tr', label: 'Türkçe' },
          ],
          onClick: ({ key }) => changeLanguage(key),
          selectable: true,
          defaultSelectedKeys: [i18n.language.split('-')[0]],
        }}
        trigger={['click']}
        overlayClassName="lp-lang-popup"
        placement="topRight"
      >
        <button className="sidebar-lang-btn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GlobalOutlined style={{ fontSize: 12 }} />
            <span style={{ textTransform: 'uppercase' }}>{i18n.language.split('-')[0]}</span>
          </div>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{i18n.language.split('-')[0] === 'tr' ? 'TR' : 'EN'}</span>
        </button>
      </Dropdown>

      <div style={{
        fontSize: 10,
        color: '#555',
        letterSpacing: '0.02em',
      }}>
        IKU Computer Engineering
      </div>
    </div>
  </>
);
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleLogout = async () => {
    try {
      await authLogout();
    } catch { /* ignore */ }
    logout();
    navigate('/');
  };

  if (!user) return null;

  return (
    <Dropdown
      menu={{
        items: [
          {
            key: 'info',
            label: (
              <div style={{ padding: '4px 0' }}>
                <div style={{ fontSize: 12, color: '#999' }}>{user.eid}</div>
                <div style={{ fontSize: 11, color: '#bbb' }}>{user.email}</div>
              </div>
            ),
            disabled: true,
          },
          { type: 'divider' },
          {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: t('common.logout'),
            danger: true,
            onClick: handleLogout,
          },
        ],
      }}
      trigger={['click']}
      placement="bottomRight"
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        padding: '4px 12px',
        borderRadius: 6,
        transition: 'background 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#c0392b',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
        }}>
          {user.displayName?.charAt(0)}
        </div>
        <span className="header-user-name" style={{
          fontSize: 13,
          fontWeight: 500,
          color: '#333',
        }}>
          {user.displayName}
        </span>
      </div>
    </Dropdown>
  );
}

function DepartmentSelector({ className }: { className?: string }) {
  const { user, activeDepartment, setActiveDepartment, isSuperAdmin } = useAuth();
  const { t } = useTranslation();
  const isFacultyScoped = user?.roles?.some((r: any) => ['registrar', 'faculty_affairs_admin'].includes(r.role));

  const { data: departments } = useQuery({
    queryKey: ['public-departments'],
    queryFn: getDepartments,
  });

  const { data: allFaculties } = useQuery({
    queryKey: ['public-faculties-layout'],
    queryFn: getFaculties,
    enabled: !!isFacultyScoped,
  });

  if (!user) return null;

  // Faculty-scoped users: resolve departments from their faculty_id
  const userFacIds = user?.roles?.filter((r: any) => r.faculty_id).map((r: any) => r.faculty_id) || [];
  const roleDeptCodes = user?.roles?.filter((r: any) => r.department_code).map((r: any) => r.department_code) || [];
  const allAllowedDeptCodes = isFacultyScoped
    ? departments?.filter(d => userFacIds.includes(d.faculty_id)).map(d => d.code) || []
    : roleDeptCodes;
  const visibleDepartments = isSuperAdmin
    ? departments
    : departments?.filter(d => allAllowedDeptCodes.includes(d.code));

  // If user has exactly one department and isn't super admin, just show label
  if (!isSuperAdmin && visibleDepartments?.length === 1) {
    return (
      <div className={className} style={{ marginRight: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{t('common.unit')}</Typography.Text>
        <Typography.Text strong style={{ fontSize: 13 }}>{visibleDepartments[0].code}</Typography.Text>
      </div>
    );
  }

  return (
    <div className={className} style={{ marginRight: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{t('common.unit')}</Typography.Text>
      <Select
        value={activeDepartment || undefined}
        onChange={(val: string) => setActiveDepartment(val)}
        style={{ width: 160 }}
        size="small"
        placeholder={t('common.selectUnit')}
        bordered={false}
        dropdownStyle={{ borderRadius: 8 }}
      >
        {visibleDepartments?.map(d => (
          <Select.Option key={d.code} value={d.code}>{d.code}</Select.Option>
        ))}
      </Select>
    </div>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { user, activeDepartment, setActiveDepartment, isSuperAdmin } = useAuth();

  const primaryRole = useMemo(() => {
    if (isSuperAdmin) return 'super_admin';
    if (!user?.roles?.length) return 'student';
    const roleNames = user.roles.map((r: any) => r.role);
    if (roleNames.includes('super_admin')) return 'super_admin';
    if (roleNames.includes('dept_admin')) return 'dept_admin';
    if (roleNames.includes('faculty_affairs_admin')) return 'faculty_affairs_admin';
    if (roleNames.includes('coordinator')) return 'coordinator';
    if (roleNames.includes('registrar')) return 'registrar';
    return 'student';
  }, [user, isSuperAdmin]);

  const roleThemes = useMemo(() => {
    const themes: Record<string, { bg: string; border: string; active: string; hover: string }> = {
      student: {
        bg: 'linear-gradient(180deg, #4a1310 0%, #260907 100%)',
        border: '#6f1f1a',
        active: '#c0392b',
        hover: 'rgba(192, 57, 43, 0.15)',
      },
      coordinator: {
        bg: 'linear-gradient(180deg, #10264c 0%, #071226 100%)',
        border: '#1c3e7a',
        active: '#2980b9',
        hover: 'rgba(41, 128, 185, 0.15)',
      },
      registrar: {
        bg: 'linear-gradient(180deg, #10381e 0%, #06190c 100%)',
        border: '#1c5b33',
        active: '#27ae60',
        hover: 'rgba(39, 174, 96, 0.15)',
      },
      dept_admin: {
        bg: 'linear-gradient(180deg, #37474f 0%, #1c262b 100%)',
        border: '#546e7a',
        active: '#78909c',
        hover: 'rgba(120, 144, 156, 0.15)',
      },
      faculty_affairs_admin: {
        bg: 'linear-gradient(180deg, #120324 0%, #080112 100%)',
        border: '#27064a',
        active: '#4c1d95',
        hover: 'rgba(76, 29, 149, 0.15)',
      },
      super_admin: {
        bg: 'linear-gradient(180deg, #1c1c1c 0%, #111111 100%)',
        border: '#2c2c2c',
        active: '#333333',
        hover: 'rgba(255, 255, 255, 0.08)',
      },
    };
    return themes[primaryRole] || themes.student;
  }, [primaryRole]);

  const isStudentOnly = user?.roles?.every((r: any) => r.role === 'student');
  const hasCoordinatorRole = user?.roles?.some((r: any) => ['coordinator', 'dept_admin'].includes(r.role)) || isSuperAdmin;
  const isRegistrarOnly = user?.roles?.some((r: any) => r.role === 'registrar')
    && !user?.roles?.some((r: any) => ['coordinator', 'dept_admin', 'super_admin'].includes(r.role));
  const isFacultyAffairsAdmin = user?.roles?.some((r: any) => r.role === 'faculty_affairs_admin')
    && !isSuperAdmin;

  const { data: allDepartments } = useQuery({
    queryKey: ['public-departments-layout'],
    queryFn: getDepartments,
  });

  const { data: studentApps } = useQuery({
    queryKey: ['student-applications-layout'],
    queryFn: getStudentApplications,
    enabled: !!isStudentOnly,
  });

  const departmentLabel = activeDepartment
    ? allDepartments?.find(d => d.code === activeDepartment)?.name
    : undefined;

  // Auto-select first department for scoped users if none is active
  useEffect(() => {
    if (!user || activeDepartment) return;
    if (!allDepartments?.length) return;
    const savedDept = localStorage.getItem('activeDept');
    if (savedDept) { setActiveDepartment(savedDept); return; }
    if (isSuperAdmin) {
      setActiveDepartment(allDepartments[0].code);
      return;
    }
    // For faculty-scoped users, pick first allowed department
    const isFacScoped = user.roles?.some((r: any) => ['registrar', 'faculty_affairs_admin'].includes(r.role));
    if (isFacScoped) {
      const facIds = user.roles?.filter((r: any) => r.faculty_id).map((r: any) => r.faculty_id) || [];
      const deptCodes = user.roles?.filter((r: any) => r.department_code).map((r: any) => r.department_code) || [];
      const allowed = facIds.length
        ? allDepartments.filter(d => facIds.includes(d.faculty_id))
        : allDepartments.filter(d => deptCodes.includes(d.code));
      if (allowed.length) setActiveDepartment(allowed[0].code);
    }
  }, [user, activeDepartment, allDepartments, isSuperAdmin, setActiveDepartment]);

  const hasLaReady = studentApps?.some((app: any) => app.status === 'learning_agreement_ready');

  const baseMenuItems = [
    { key: '/', icon: <BankOutlined />, label: t('sidebar.menu.universities') },
    { key: '/courses', icon: <BookOutlined />, label: t('sidebar.menu.courses') },
    { key: '/upload', icon: <UploadOutlined />, label: t('sidebar.menu.upload') },
    { key: '/matching', icon: <SwapOutlined />, label: t('sidebar.menu.matching') },
    { key: '/coordinator', icon: <AuditOutlined />, label: t('sidebar.menu.reviewPanel') },
    { key: '/university-info', icon: <InfoCircleOutlined />, label: t('sidebar.menu.uniInfo') },
    { key: '/grade-conversion', icon: <GoldOutlined />, label: t('sidebar.menu.gradeConversion') },
    { key: '/transcripts', icon: <FileTextOutlined />, label: t('sidebar.menu.transcripts') },
    { key: '/senate-decisions', icon: <FileTextOutlined />, label: t('sidebar.menu.senateDecisions') },
    { key: '/upload-transfer-form', icon: <UploadOutlined />, label: t('sidebar.menu.uploadTransferForm') },
  ];

  const studentMenuItems = [
    { key: '/', icon: <BookOutlined />, label: t('sidebar.menu.myApplications') },
    { key: '/partner-universities', icon: <GlobalOutlined />, label: t('sidebar.menu.partnerUnis') },
  ];
  if (hasLaReady) {
    studentMenuItems.push({ key: '/student-transcripts', icon: <FileTextOutlined />, label: t('sidebar.menu.myTranscripts') });
  }

  const registrarMenuItems = [
    { key: '/transcripts', icon: <FileTextOutlined />, label: t('sidebar.menu.transcripts') },
    { key: '/grade-conversion', icon: <GoldOutlined />, label: t('sidebar.menu.gradeConversion') },
    { key: '/senate-decisions', icon: <FileTextOutlined />, label: t('sidebar.menu.senateDecisions') },
    { key: '/upload-transfer-form', icon: <UploadOutlined />, label: t('sidebar.menu.uploadTransferForm') },
  ];

  const items = isStudentOnly
    ? studentMenuItems
    : isRegistrarOnly
    ? registrarMenuItems
    : isFacultyAffairsAdmin
    ? registrarMenuItems
    : [...baseMenuItems].filter(item => hasCoordinatorRole || item.key !== '/coordinator');
  if (user?.is_admin || isFacultyAffairsAdmin) {
    items.push({ key: '/admin', icon: <SettingOutlined />, label: t('sidebar.menu.adminPanel') });
  }

  const selectedKey = items.find(
    item => location.pathname === item.key ||
    (item.key !== '/' && location.pathname.startsWith(item.key + '/'))
  )?.key || '/';

  const handleNavigate = (key: string) => {
    navigate(key);
    setDrawerOpen(false);
  };

  return (
    <AntLayout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Desktop sidebar — sticky */}
      <Sider
        width={240}
        collapsedWidth={0}
        collapsed={sidebarCollapsed}
        trigger={null}
        className="desktop-sider"
        style={{
          background: roleThemes.bg,
          borderRight: sidebarCollapsed ? 'none' : `1px solid ${roleThemes.border}`,
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflow: 'hidden',
          flexShrink: 0,
          transition: 'all 0.2s ease',
        }}
      >
        <SidebarContent onNavigate={handleNavigate} selectedKey={selectedKey} departmentLabel={departmentLabel} roleThemes={roleThemes} />
      </Sider>

      {/* Mobile drawer */}
      <Drawer
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={260}
        styles={{
          body: { padding: 0, background: roleThemes.bg },
          header: { display: 'none' },
        }}
        className="mobile-drawer"
      >
        <SidebarContent onNavigate={handleNavigate} selectedKey={selectedKey} departmentLabel={departmentLabel} roleThemes={roleThemes} />
      </Drawer>

      <AntLayout style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Header style={{
          background: '#ffffff',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #ededed',
          height: 56,
          lineHeight: '56px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Desktop: toggle sidebar collapse */}
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setSidebarCollapsed(v => !v)}
              className="desktop-menu-btn"
              style={{ color: '#555' }}
            />
            {/* Mobile: open drawer */}
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
              className="mobile-menu-btn"
              style={{ display: 'none' }}
            />
            <h1 style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: '#1a1a1a',
              letterSpacing: '-0.01em',
            }}>
              {items.find(i => i.key === selectedKey)?.label || t('common.dashboard')}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <DepartmentSelector className="header-dept-selector" />
            <UserMenu />
          </div>
        </Header>
        <Content className="main-content" style={{
          margin: 0,
          padding: 28,
          background: '#f0f0f0',
          flex: 1,
          overflowY: 'auto',
        }}>
          <div className="page-enter">
            <Outlet />
          </div>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
