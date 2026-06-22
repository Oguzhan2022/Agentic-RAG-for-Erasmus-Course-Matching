import React from 'react';
import { Card, Button, Select, Typography, message, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getDepartments, api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { Department } from '../types';

const { Title, Text } = Typography;

const DeptSelection: React.FC = () => {
  const { checkAuth } = useAuth();
  const { t } = useTranslation();
  const [selectedDept, setSelectedDept] = React.useState<number | null>(null);

  const { data: departments, isLoading } = useQuery({
    queryKey: ['departments-selection'],
    queryFn: getDepartments,
  });

  const saveDeptMutation = useMutation({
    mutationFn: (deptId: number) => api.post('/admin/me/select-department', { department_id: deptId }),
    onSuccess: () => {
      message.success(t('deptSelection.success'));
      checkAuth();
    },
    onError: () => {
      message.error(t('deptSelection.error'));
    }
  });

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f0f2f5'
    }}>
      <Card title={t('deptSelection.welcome')} style={{ width: 400, textAlign: 'center' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Text>{t('deptSelection.prompt')}</Text>
          <Select
            placeholder={t('deptSelection.placeholder')}
            style={{ width: '100%' }}
            loading={isLoading}
            onChange={(val: number) => setSelectedDept(val)}
          >
            {departments?.map((d: Department) => (
              <Select.Option key={d.id} value={d.id}>{d.name} ({d.code})</Select.Option>
            ))}
          </Select>
          <Button
            type="primary"
            block
            disabled={!selectedDept}
            loading={saveDeptMutation.isPending}
            onClick={() => selectedDept && saveDeptMutation.mutate(selectedDept)}
          >
            {t('deptSelection.confirm')}
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default DeptSelection;
