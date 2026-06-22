import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IngestionStatus } from '../types';

const statusConfig: Record<IngestionStatus, { color: string; dot: string }> = {
  pending:   { color: 'default',    dot: '#bfbfbf' },
  parsing:   { color: 'processing', dot: '#1890ff' },
  parsed:    { color: 'cyan',       dot: '#13c2c2' },
  embedding: { color: 'blue',       dot: '#2f54eb' },
  ready:     { color: 'success',    dot: '#52c41a' },
  failed:    { color: 'error',      dot: '#ff4d4f' },
};

export default function ParsingStatusBadge({ status }: { status: IngestionStatus }) {
  const { t } = useTranslation();
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <Tag
      color={config.color}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: config.dot,
        display: 'inline-block',
        animation: (status === 'parsing' || status === 'embedding') ? 'pulse 1.5s infinite' : 'none',
      }} />
      {t(`universities.statuses.${status}`)}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </Tag>
  );
}
