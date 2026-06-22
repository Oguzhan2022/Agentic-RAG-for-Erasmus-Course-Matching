import React from 'react';
import { Tag, Tooltip } from 'antd';
import {
  EditOutlined, ClockCircleOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ExclamationCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ApplicationStatus } from '../types';

interface Props {
  status: ApplicationStatus | string;
  size?: 'small' | 'default';
}

const ApplicationStatusBadge: React.FC<Props> = ({ status, size = 'default' }) => {
  const { t } = useTranslation();

  const getStatusCfg = (s: string) => {
    switch (s) {
      case 'draft':
        return { color: '#1677ff', icon: <EditOutlined />, key: 'draft' };
      case 'submitted':
        return { color: '#fa8c16', icon: <ClockCircleOutlined />, key: 'submitted' };
      case 'rejected':
        return { color: '#ff4d4f', icon: <CloseCircleOutlined />, key: 'rejected' };
      case 'learning_agreement_ready':
        return { color: '#52c41a', icon: <SafetyCertificateOutlined />, key: 'laReady' };
      case 'revision_requested':
        return { color: '#faad14', icon: <ExclamationCircleOutlined />, key: 'revision' };
      default:
        return { color: '#8c8c8c', icon: null, key: null };
    }
  };

  const cfg = getStatusCfg(status);
  const label = cfg.key ? t(`applicationStatus.${cfg.key}.label`) : status.replace(/_/g, ' ').toUpperCase();
  const desc = cfg.key ? t(`applicationStatus.${cfg.key}.desc`) : '';

  const isSmall = size === 'small';
  const tag = (
    <Tag
      icon={cfg.icon}
      color={cfg.color}
      style={{
        fontSize: isSmall ? 10 : 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        borderRadius: 4,
        padding: isSmall ? '0 6px' : '1px 8px',
      }}
    >
      {label}
    </Tag>
  );

  return desc ? <Tooltip title={desc}>{tag}</Tooltip> : tag;
};

export default ApplicationStatusBadge;
