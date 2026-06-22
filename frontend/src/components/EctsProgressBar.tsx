import React from 'react';
import { Card, Row, Col } from 'antd';
import { BookOutlined, CheckCircleOutlined, ExclamationCircleOutlined, BulbOutlined, EditOutlined, HomeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

interface Props {
  selected: number;
  approved: number;
  suggested?: number;
  suggestedLabel?: string;
  draft?: number;
  draftLabel?: string;
  /** When set, suggestedTotal = suggestedBase + suggested (instead of selected + suggested) */
  suggestedBase?: number;
  target?: number;
  threshold?: number;
  /** Home ECTS — shown as a right-aligned badge next to the partner total */
  homeSelected?: number;
  homeApproved?: number;
  homeTarget?: number;
  isCoordinator?: boolean;
}

const EctsProgressBar: React.FC<Props> = ({
  selected, approved, suggested = 0, suggestedLabel, draft = 0, draftLabel, suggestedBase,
  target = 30, threshold = 28,
  homeSelected, homeApproved, homeTarget = 30,
  isCoordinator = false,
}) => {
  const { t } = useTranslation();
  const hasApproved = approved > 0;
  // Primary progress is the total selected (which includes approved + draft)
  const effectiveValue = isCoordinator ? approved : Math.max(approved, selected);
  const selectedPct = Math.min((selected / target) * 100, 100);
  const approvedPct = Math.min((approved / target) * 100, 100);
  const meets = effectiveValue >= threshold;
  const missing = Math.max(target - effectiveValue, 0);

  // suggestedTotal: if suggestedBase given use that, else student mode: selected + suggested
  const base = suggestedBase !== undefined ? suggestedBase : effectiveValue;
  const suggestedTotal = base + suggested;
  const suggestedMeets = suggested > 0 && suggestedTotal >= threshold;

  const thresholdLeft = `${(threshold / target) * 100}%`;

  const rightLabel = isCoordinator 
    ? `${approved} / ${target} ECTS ${t('coordinatorReview.approved')}`
    : `${effectiveValue} / ${target} ECTS ${meets ? t('coordinatorReview.ready') : t('coordinatorReview.planned')}`;
  const rightColor = meets ? '#52c41a' : '#1890ff';

  const homeProvided = homeSelected !== undefined || homeApproved !== undefined;
  const homeEffective = homeSelected ?? homeApproved ?? 0;
  const homeMeets = (homeApproved ?? homeEffective) >= homeTarget;
  const homeColor = homeMeets ? '#52c41a' : '#1890ff';
  const homeBadge = `${homeEffective}/${homeTarget}`;
  const homeCourseInfo = homeApproved !== undefined
    ? t('coordinatorReview.ectsApprovedDesc', { approved: homeApproved, total: homeEffective, defaultValue: `(${homeApproved} of ${homeEffective} ects approved)` })
    : '';

  const barFillColor = meets
    ? 'linear-gradient(90deg, #52c41a, #73d13d)'
    : 'linear-gradient(90deg, #91d5ff, #69c0ff)';

  return (
    <Card
      size="small"
      style={{
        marginBottom: 16,
        borderRadius: 10,
        border: meets ? '1px solid #b7eb8f' : '1px solid #e8e8e8',
        background: meets ? '#f6ffed' : '#fff',
      }}
    >
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#666', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {t('coordinatorReview.ectsProgress')}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: rightColor }}>
              {rightLabel}
            </span>
          </div>

          <div style={{ position: 'relative', height: 20, background: '#f5f5f5', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, height: '100%',
              width: `${selectedPct}%`,
              background: hasApproved ? 'linear-gradient(90deg, #91d5ff, #69c0ff)' : barFillColor,
              borderRadius: 10,
              transition: 'width 0.4s ease',
            }} />
            {approved > 0 && (
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: `${approvedPct}%`,
                background: approved >= threshold
                  ? 'linear-gradient(90deg, #52c41a, #73d13d)'
                  : 'linear-gradient(90deg, #95de64, #bae637)',
                borderRadius: 10,
                transition: 'width 0.4s ease',
              }} />
            )}
            <div style={{
              position: 'absolute', top: 0, left: thresholdLeft,
              height: '100%', width: 2,
              background: '#faad14',
            }} />
            <div style={{
              position: 'relative', lineHeight: '20px', textAlign: 'center',
              fontSize: 11, fontWeight: 700,
              color: (hasApproved ? approvedPct : selectedPct) > 50 ? '#fff' : '#333',
              textShadow: (hasApproved ? approvedPct : selectedPct) > 50 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
            }}>
              {meets
                ? t('coordinatorReview.enoughEcts').toUpperCase()
                : t('coordinatorReview.ectsRemaining', { count: missing, defaultValue: `${missing} ECTS REMAINING` }).toUpperCase()}
            </div>
          </div>

          <div style={{ marginTop: 6, display: 'flex', gap: 16, fontSize: 11, color: '#888', flexWrap: 'wrap' }}>
            <span><BookOutlined style={{ color: '#69c0ff', marginRight: 4 }} />{t('coordinatorReview.selected')}: {selected}</span>
            <span><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />{t('coordinatorReview.approved')}: {approved}</span>
            {(draft || 0) > 0 && <span><EditOutlined style={{ color: '#fa8c16', marginRight: 4 }} />{draftLabel || t('coordinatorDashboard.statusOptions.draft')}: {draft}</span>}
            {(suggested || 0) > 0 && <span><BulbOutlined style={{ color: '#faad14', marginRight: 4 }} />{suggestedLabel || t('coordinatorReview.matchCandidatesHeader').replace('Candidates', 'Candidate')}: {suggested}</span>}
            {!meets && (
              <span><ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 4 }} />{t('coordinatorReview.needMore', { count: missing, defaultValue: `Need ${missing} more` })}</span>
            )}
          </div>

          {homeProvided && (
            <div style={{
              marginTop: 6, display: 'flex', justifyContent: 'flex-end',
              alignItems: 'center', gap: 8,
              fontSize: 11, fontWeight: 700, color: homeColor,
            }}>
              <span>
                <HomeOutlined style={{ marginRight: 4 }} />
                {homeBadge}
              </span>
              {homeCourseInfo && (
                <span style={{ fontWeight: 500, color: '#888' }}>
                  {homeCourseInfo}
                </span>
              )}
            </div>
          )}

          {!meets && suggestedMeets && (
            <div style={{
              marginTop: 6, fontSize: 11, color: '#d46b08', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <BulbOutlined />
              {suggestedLabel === 'Override pending'
                ? t('coordinatorReview.suggestedMeetsOverride', { count: suggested, total: suggestedTotal, defaultValue: `After student approves override (${suggested} ECTS): ${suggestedTotal} ECTS approved — threshold met` })
                : t('coordinatorReview.suggestedMeetsGeneric', { label: suggestedLabel || t('coordinatorReview.matchCandidatesHeader').toLowerCase(), count: suggested, total: suggestedTotal, defaultValue: `With suggested courses (${suggested} ECTS): ${suggestedTotal} ECTS total — enough to submit` })
              }
            </div>
          )}
        </Col>
      </Row>
    </Card>
  );
};

export default EctsProgressBar;
