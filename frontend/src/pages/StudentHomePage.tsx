import { Card, Typography, Space } from 'antd';
import { ToolOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function StudentHomePage() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 120px)',
      padding: 24,
    }}>
      <Card
        style={{
          maxWidth: 520,
          textAlign: 'center',
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}
        styles={{ body: { padding: '48px 40px' } }}
      >
        <div style={{
          width: 80, height: 80,
          background: '#fff3e6', borderRadius: 24,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24,
        }}>
          <ToolOutlined style={{ fontSize: 36, color: '#f39c12' }} />
        </div>
        <Title level={3} style={{ margin: '0 0 12px', color: '#1a1a1a' }}>
          System Under Preparation
        </Title>
        <Space direction="vertical" size={8}>
          <Text type="secondary" style={{ fontSize: 15, lineHeight: 1.6 }}>
            The student module is currently being developed. You will be notified when the course selection
            and matching features become available for students.
          </Text>
          <Text type="secondary" style={{ fontSize: 13, marginTop: 16, display: 'block' }}>
            Your account has been registered successfully. No further action is required at this time.
          </Text>
        </Space>
      </Card>
    </div>
  );
}
