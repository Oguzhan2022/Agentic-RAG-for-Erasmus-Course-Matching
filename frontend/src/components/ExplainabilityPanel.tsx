import React, { useState } from 'react';
import { Tag, Progress, Row, Col, Card, Collapse, Divider, Typography, Alert, Spin, Descriptions, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
  ThunderboltOutlined, InfoCircleOutlined, ExperimentOutlined,
  BookOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

function scoreColor(score: number): string {
  if (score >= 0.7) return '#52c41a';
  if (score >= 0.4) return '#faad14';
  return '#ff4d4f';
}

function ScoreRing({ score, size = 60 }: { score: number; size?: number }) {
  const percent = Math.round(score * 100);
  const color = scoreColor(score);
  return (
    <Progress
      type="circle"
      percent={percent}
      size={size}
      strokeColor={color}
      format={() => (
        <span style={{ fontSize: size * 0.22, fontWeight: 700, color }}>{percent}%</span>
      )}
    />
  );
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  technical:    { label: 'Technical', color: '#1890ff', icon: <ExperimentOutlined /> },
  social:       { label: 'Social',    color: '#722ed1', icon: <BookOutlined /> },
  studio_based: { label: 'Studio',    color: '#fa8c16', icon: <ThunderboltOutlined /> },
};

const VERIFICATION_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  approved:     { color: '#52c41a', icon: <CheckCircleOutlined />, label: 'Approved' },
  rejected:     { color: '#ff4d4f', icon: <CloseCircleOutlined />, label: 'Rejected' },
  risk_flagged: { color: '#faad14', icon: <WarningOutlined />,     label: 'Risk Flagged' },
};

interface Props {
  scoreBreakdown?: Record<string, { score: number; weight: number; weighted: number; evidence: string }>;
  matchedTopics?: string[];
  missingTopics?: string[];
  extraPartnerTopics?: string[];
  coreHomeTopics?: string[];
  structuralNotes?: string[];
  warnings?: string[];
  verificationStatus?: string | null;
  verificationReason?: string | null;
  contentOverlapAssessment?: string | null;
  coreTopicCoverage?: string | null;
  overallScore?: number;
  category?: string;
  compact?: boolean;
}

const ExplainabilityPanel: React.FC<Props> = ({
  scoreBreakdown,
  matchedTopics = [],
  missingTopics = [],
  extraPartnerTopics = [],
  coreHomeTopics = [],
  structuralNotes = [],
  warnings = [],
  verificationStatus,
  verificationReason,
  contentOverlapAssessment,
  coreTopicCoverage,
  overallScore,
  category,
  compact = false,
}) => {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { t } = useTranslation();

  if (compact) {
    return (
      <div style={{ marginTop: 4 }}>
        {overallScore !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <ScoreRing score={overallScore} size={40} />
            <div>
              {category && (
                <Tag
                  icon={CATEGORY_CONFIG[category]?.icon}
                  color={CATEGORY_CONFIG[category]?.color}
                  style={{ fontSize: 9, fontWeight: 600 }}
                >
                  {CATEGORY_CONFIG[category]?.label?.toUpperCase()}
                </Tag>
              )}
              {coreTopicCoverage && (
                <Tag style={{ fontSize: 9 }}>{coreTopicCoverage.toUpperCase()} COVERAGE</Tag>
              )}
            </div>
          </div>
        )}
        {matchedTopics.length > 0 && (
          <div>
            {matchedTopics.slice(0, 3).map((topic, i) => (
              <Tag key={i} color="green" style={{ fontSize: 9, margin: '0 2px 2px 0' }}>{topic}</Tag>
            ))}
            {matchedTopics.length > 3 && <Tag style={{ fontSize: 9 }}>+{matchedTopics.length - 3}</Tag>}
          </div>
        )}
      </div>
    );
  }

  const breakdownItems = scoreBreakdown && Object.keys(scoreBreakdown).length > 0 ? [{
    key: 'bd',
    label: <Text style={{ fontSize: 11, color: '#999' }}>{t('applicationDetail.labels.scoreBreakdown')}</Text>,
    children: (
      <div>
        {Object.entries(scoreBreakdown).map(([key, comp]) => {
          const percent = Math.round(comp.score * 100);
          const color = scoreColor(comp.score);
          return (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: 500, textTransform: 'capitalize' }}>{key}</Text>
                <Space size={4}>
                  <Tag style={{ fontSize: 9, margin: 0 }}>{Math.round(comp.weight * 100)}%w</Tag>
                  <Text strong style={{ fontSize: 11, color }}>{percent}%</Text>
                </Space>
              </div>
              <Progress percent={percent} showInfo={false} strokeColor={color} size="small" />
              {comp.evidence && (
                <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>{comp.evidence}</Text>
              )}
            </div>
          );
        })}
      </div>
    ),
  }] : [];

  return (
    <div>
      {/* Score + Verification */}
      {overallScore !== undefined && (
        <Card size="small" style={{ marginBottom: 10, borderRadius: 8, border: '1px solid #f0f0f0' }}>
          <Row gutter={12} align="middle">
            <Col>
              <ScoreRing score={overallScore} size={64} />
            </Col>
            <Col flex="auto">
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                {category && (
                  <Tag icon={CATEGORY_CONFIG[category]?.icon} color={CATEGORY_CONFIG[category]?.color} style={{ fontSize: 10, fontWeight: 600 }}>
                    {CATEGORY_CONFIG[category]?.label?.toUpperCase()}
                  </Tag>
                )}
                {coreTopicCoverage && (
                  <Tag style={{ fontSize: 10 }}>{coreTopicCoverage.toUpperCase()} COVERAGE</Tag>
                )}
                {contentOverlapAssessment && (
                  <Tag color="blue" style={{ fontSize: 10 }}>{contentOverlapAssessment.toUpperCase()}</Tag>
                )}
              </div>
              {verificationStatus && (
                <div style={{
                  padding: '4px 8px', borderRadius: 4,
                  background: verificationStatus === 'approved' ? '#f6ffed' : verificationStatus === 'rejected' ? '#fff1f0' : '#fffbe6',
                  border: `1px solid ${verificationStatus === 'approved' ? '#b7eb8f' : verificationStatus === 'rejected' ? '#ffa39e' : '#ffe58f'}`,
                  fontSize: 11, marginTop: 4,
                }}>
                  <Space size={4}>
                    {VERIFICATION_CONFIG[verificationStatus]?.icon}
                    <Text strong style={{ fontSize: 10, color: VERIFICATION_CONFIG[verificationStatus]?.color }}>
                      {VERIFICATION_CONFIG[verificationStatus]?.label.toUpperCase()}
                    </Text>
                  </Space>
                  {verificationReason && (
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>{verificationReason}</Text>
                  )}
                </div>
              )}
            </Col>
          </Row>
        </Card>
      )}

      {/* Score Breakdown (collapsible) */}
      {breakdownItems.length > 0 && (
        <Collapse
          size="small" ghost
          activeKey={breakdownOpen ? ['bd'] : []}
          onChange={keys => setBreakdownOpen(keys.length > 0)}
          items={breakdownItems}
          style={{ marginBottom: 8 }}
        />
      )}

      {/* Topics */}
      <div style={{ marginBottom: 8 }}>
        {matchedTopics.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
              {t('applicationDetail.labels.syllabusMatches')} ({matchedTopics.length})
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {matchedTopics.map((topic, i) => (
                <Tag key={i} color="green" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{topic}</Tag>
              ))}
            </div>
          </div>
        )}
        {missingTopics.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
              {t('applicationDetail.labels.missingFromHost')} ({missingTopics.length})
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {missingTopics.map((topic, i) => (
                <Tag key={i} color="red" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{topic}</Tag>
              ))}
            </div>
          </div>
        )}
        {extraPartnerTopics.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
              {t('applicationDetail.labels.enrichment')} ({extraPartnerTopics.length})
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {extraPartnerTopics.map((topic, i) => (
                <Tag key={i} color="cyan" style={{ fontSize: 10, maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{topic}</Tag>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Core Home Topics */}
      {coreHomeTopics.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4, letterSpacing: 0.5 }}>
            {t('applicationDetail.labels.coreHomeTopics')}
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {coreHomeTopics.map((topic, i) => (
              <Tag key={i} color="orange" style={{ fontSize: 10, whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 8px' }}>{topic}</Tag>
            ))}
          </div>
        </div>
      )}

      {/* Structural Notes */}
      {structuralNotes.length > 0 && structuralNotes.map((n, i) => (
        <Alert
          key={i} message={n} type="info" banner showIcon
          icon={<ThunderboltOutlined style={{ fontSize: 10 }} />}
          style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3, background: '#f0f5ff', border: 'none' }}
        />
      ))}

      {/* Warnings */}
      {warnings.length > 0 && warnings.slice(0, 3).map((w, i) => (
        <Alert
          key={i} message={w} type="warning" banner showIcon
          icon={<WarningOutlined style={{ fontSize: 10 }} />}
          style={{ padding: '2px 8px', fontSize: 10, marginBottom: 3 }}
        />
      ))}
    </div>
  );
};

export default ExplainabilityPanel;
