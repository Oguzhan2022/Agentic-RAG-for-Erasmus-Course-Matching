import { Card, Typography, Button } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

export default function AccountDeactivatedPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

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
          width: 420,
          maxWidth: '100%',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          border: 'none',
          textAlign: 'center',
        }}
        styles={{ body: { padding: '48px 32px' } }}
      >
        <div style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: '#fdecea',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
          <StopOutlined style={{ fontSize: 32, color: '#c0392b' }} />
        </div>

        <Title level={3} style={{ margin: '0 0 8px', color: '#1a1a1a' }}>
          {t('deactivated.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.7 }}>
          {t('deactivated.message')}
        </Text>

        <Button
          type="primary"
          size="large"
          block
          style={{
            marginTop: 32,
            height: 44,
            borderRadius: 8,
            fontWeight: 600,
          }}
          onClick={() => navigate('/login')}
        >
          {t('deactivated.backToLogin')}
        </Button>
      </Card>
    </div>
  );
}
