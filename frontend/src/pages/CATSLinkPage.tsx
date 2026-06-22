import { useState } from 'react';
import { Card, Form, Input, Button, Alert, Typography, Space } from 'antd';
import { UserOutlined, LockOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authLinkCats } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

import { getSafeRedirect } from '../utils/url';

const { Title, Text } = Typography;

export default function CATSLinkPage() {
  const { tempToken, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlRedirect = searchParams.get('redirect');

  if (!tempToken) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 50%, #3a1a1a 100%)',
        padding: 16,
      }}>
        <Card style={{ width: 400, borderRadius: 12, textAlign: 'center' }}>
          <Title level={4}>Session Expired</Title>
          <Text type="secondary">Please sign in again.</Text>
          <Button type="primary" block style={{ marginTop: 16 }} onClick={() => navigate('/login')}>
            Back to Login
          </Button>
        </Card>
      </div>
    );
  }

  const onFinish = async (values: { eid: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authLinkCats(values.eid, values.password, tempToken);
      login(res.user);
      const target = res.redirect || urlRedirect;
      navigate(getSafeRedirect(target));
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      let msg = 'CATS verification failed.';
      if (status === 503) {
        msg = 'CATS portal is unreachable. Please try again later.';
      } else if (status === 400) {
        msg = detail || 'This CATS account is already linked to another user.';
      } else if (status === 401 || status === 403) {
        msg = 'Session expired. Please sign in again.';
      } else if (detail) {
        msg = detail;
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
    }}>
      <Card
        style={{
          width: 440,
          maxWidth: '100%',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          border: 'none',
        }}
        styles={{ body: { padding: '40px 32px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64,
            background: '#f9e8e6', borderRadius: 20,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <LinkOutlined style={{ fontSize: 28, color: '#c0392b' }} />
          </div>
          <Title level={3} style={{ margin: 0, color: '#1a1a1a' }}>
            Account Verification
          </Title>
          <Space direction="vertical" size={4} style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Your account has been pre-registered.
            </Text>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Please verify by entering your CATS credentials.
            </Text>
          </Space>
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
          name="link-cats"
          onFinish={onFinish}
          layout="vertical"
          size="large"
          requiredMark={false}
        >
          <Form.Item
            name="eid"
            rules={[{ required: true, message: 'Enter your CATS username' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bbb' }} />}
              placeholder="CATS Username"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Enter your CATS password' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bbb' }} />}
              placeholder="CATS Password"
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
              Verify with CATS
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
            Verify with your CATS (cats.iku.edu.tr) account.
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            This is a one-time process.
          </Text>
        </div>
      </Card>
    </div>
  );
}
