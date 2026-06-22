import { useState } from 'react';
import { Card, Form, Input, Button, Alert, Typography, Dropdown, Menu } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined as LangIcon } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authLogin } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

import { getSafeRedirect } from '../utils/url';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login, setTempToken } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlRedirect = searchParams.get('redirect');

  const onFinish = async (values: { eid: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authLogin(values.eid, values.password);
      if (res.deactivated) {
        navigate('/account-deactivated');
      } else if (res.needs_cats_link) {
        setTempToken(res.temp_token);
        navigate(urlRedirect ? `/link-cats?redirect=${encodeURIComponent(urlRedirect)}` : '/link-cats');
      } else {
        login(res.user);
        const target = res.redirect || urlRedirect;
        navigate(getSafeRedirect(target));
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      let msg = t('login.errors.invalid');
      if (status === 429) {
        msg = detail || t('login.errors.tooMany');
      } else if (status === 503) {
        msg = detail || t('login.errors.catsUnreachable');
      } else if (detail) {
        // Map specific backend strings to keys if they arrive in English
        if (detail === 'Invalid credentials') {
          msg = t('login.errors.invalid');
        } else {
          msg = detail;
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 50%, #3a1a1a 100%)',
      padding: 16,
      position: 'relative',
    }}>
      <style>{`
        .login-lang-btn {
          position: absolute;
          top: 24px;
          right: 24px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.85);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s ease;
          min-width: 80px;
          justify-content: space-between;
        }
        .login-lang-btn:hover {
          color: #fff;
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.25);
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
          background-color: rgba(192,57,43,0.2) !important;
          color: #e74c3c !important;
          font-weight: 600 !important;
        }
      `}</style>

      <Dropdown
        menu={{
          items: [
            { key: 'en', label: 'EN' },
            { key: 'tr', label: 'TR' },
          ],
          onClick: ({ key }) => changeLanguage(key),
          selectable: true,
          defaultSelectedKeys: [i18n.language.split('-')[0]],
        }}
        trigger={['click']}
        overlayClassName="lp-lang-popup"
      >
        <button className="login-lang-btn">
          <span style={{ textTransform: 'uppercase' }}>{i18n.language.split('-')[0]}</span>
          <LangIcon style={{ fontSize: 13 }} />
        </button>
      </Dropdown>
      <Card
        style={{
          width: 400,
          maxWidth: '100%',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          border: 'none',
        }}
        styles={{ body: { padding: '40px 32px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/iku-logo.png"
            alt="IKU Logo"
            style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 16 }}
          />
          <Title level={3} style={{ margin: 0, color: '#1a1a1a' }}>
            {t('login.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('login.subtitle')}
          </Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 20 }}
          />
        )}

        <Form
          name="login"
          onFinish={onFinish}
          layout="vertical"
          size="large"
          requiredMark={false}
        >
          <Form.Item
            name="eid"
            rules={[{ required: true, message: t('login.form.usernameRequired') }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bbb' }} />}
              placeholder={t('login.form.usernamePlaceholder')}
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.form.passwordRequired') }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bbb' }} />}
              placeholder={t('login.form.passwordPlaceholder')}
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{
                height: 44,
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              {t('login.form.submit')}
            </Button>
          </Form.Item>
        </Form>

        <div style={{
          textAlign: 'center',
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid #f0f0f0',
        }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('login.footer')}
          </Text>
        </div>
      </Card>
    </div>
  );
}
