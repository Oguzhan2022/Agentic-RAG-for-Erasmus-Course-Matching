import React from 'react';
import { Tag, Tooltip } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const VERIFICATION_CONFIG: Record<string, { color: string; icon: React.ReactNode; labelKey: string }> = {
  approved:     { color: '#52c41a', icon: <CheckCircleOutlined />, labelKey: 'applicationDetail.labels.status.approved' },
  rejected:     { color: '#ff4d4f', icon: <CloseCircleOutlined />, labelKey: 'applicationDetail.labels.status.notRec' },
  risk_flagged: { color: '#faad14', icon: <WarningOutlined />,     labelKey: 'applicationDetail.labels.status.risk_flagged' },
};

interface Props {
  status?: string | null;
  confidence?: number;
  reason?: string | null;
  isRecommended?: boolean;
}

const VerificationBadge: React.FC<Props> = ({ status, confidence, reason, isRecommended }) => {
  const { t } = useTranslation();
  if (!status) return null;

  const cfg = VERIFICATION_CONFIG[status] || { color: '#8c8c8c', icon: null, labelKey: `applicationDetail.labels.status.${status}` };

  const tag = (
    <Tag
      icon={cfg.icon}
      color={cfg.color}
      style={{ fontWeight: 600, fontSize: 10, letterSpacing: 0.3 }}
    >
      {t(cfg.labelKey, { defaultValue: status.toUpperCase() }).toUpperCase()}
      {!isRecommended && status !== 'rejected' && (
        <span style={{ opacity: 0.7, marginLeft: 3 }}>&middot; {t('applicationDetail.labels.status.notRecSuffix', { defaultValue: 'NOT REC.' })}</span>
      )}
    </Tag>
  );

  return reason ? <Tooltip title={reason}>{tag}</Tooltip> : tag;
};

export default VerificationBadge;
