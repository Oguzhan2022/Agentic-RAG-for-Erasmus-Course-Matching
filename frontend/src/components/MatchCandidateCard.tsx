import React from 'react';
import { Card, Tag, Button, Row, Col, Tooltip, Progress } from 'antd';
import { SelectOutlined } from '@ant-design/icons';
import type { CourseMatchResult } from '../types';
import VerificationBadge from './VerificationBadge';
import { useTranslation } from 'react-i18next';

interface Props {
  match: CourseMatchResult;
  rank: number;
  onSelect?: (homeCourseId: number) => void;
  selected?: boolean;
  disabled?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  technical: '#1890ff',
  social: '#722ed1',
  studio_based: '#fa8c16',
};

function scoreColor(score: number): string {
  if (score >= 0.7) return '#52c41a';
  if (score >= 0.4) return '#faad14';
  return '#ff4d4f';
}

const MatchCandidateCard: React.FC<Props> = ({
  match, rank, onSelect, selected = false, disabled = false,
}) => {
  const { t } = useTranslation();
  const isNotRec = match.verification_status === 'rejected';
  const pct = Math.round(match.overall_score * 100);
  const color = scoreColor(match.overall_score);
  const rankBg = rank === 1 ? '#52c41a' : rank === 2 ? '#faad14' : '#d9d9d9';
  const rankFg = rank >= 3 ? '#666' : '#fff';

  return (
    <Card
      size="small"
      style={{
        marginBottom: 8,
        borderRadius: 8,
        border: selected ? '2px solid #52c41a' : isNotRec ? '1px solid #ffccc7' : '1px solid #f0f0f0',
        background: isNotRec ? '#fff2f0' : selected ? '#f6ffed' : '#fff',
        opacity: isNotRec && !selected ? 0.8 : 1,
      }}
      styles={{ body: { padding: 12 } }}
    >
      <div className="match-candidate-card-wrapper">
        {/* Left side: Rank + Score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: rankBg, color: rankFg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700,
          }}>
            #{rank}
          </div>
          <Progress
            type="circle"
            percent={pct}
            size={42}
            strokeColor={color}
            format={() => (
              <span style={{ fontSize: 10, fontWeight: 700, color }}>{pct}%</span>
            )}
          />
        </div>

        {/* Center: Info */}
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            {match.home_course_code && (
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#888', flexShrink: 0 }}>
                {match.home_course_code}
              </span>
            )}
            <span style={{ fontWeight: 600, fontSize: 13, wordBreak: 'break-word' }}>
              {match.home_course_name}
            </span>
            {match.home_course_ects != null && (
              <span style={{
                fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                color: '#fff', background: '#1a1a1a',
                padding: '2px 7px', borderRadius: 10,
                whiteSpace: 'nowrap', alignSelf: 'center'
              }}>
                {match.home_course_ects} ECTS
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {match.category && (
              <Tag color={CATEGORY_COLORS[match.category] || 'default'} style={{ fontSize: 10, fontWeight: 600, margin: 0 }}>
                {t(`applicationDetail.labels.courseCategories.${match.category.toLowerCase().replace(/\s+/g, '_')}`, { defaultValue: match.category.toUpperCase() }).toUpperCase()}
              </Tag>
            )}
            {match.content_overlap_assessment && (
              <Tag color="blue" style={{ fontSize: 9, margin: 0 }}>
                {t(`applicationDetail.labels.coverage.${match.content_overlap_assessment.toLowerCase()}`, { defaultValue: match.content_overlap_assessment.toUpperCase() }).toUpperCase()}
              </Tag>
            )}
            {match.core_topic_coverage && (
              <Tag style={{ fontSize: 9, margin: 0 }}>
                {t(`applicationDetail.labels.coverage.${match.core_topic_coverage.toLowerCase()}`, { defaultValue: match.core_topic_coverage.toUpperCase() }).toUpperCase()} {t('applicationDetail.labels.analysis.coverage', { defaultValue: 'COVERAGE' }).toUpperCase()}
              </Tag>
            )}
            <VerificationBadge
              status={match.verification_status}
              reason={match.verification_reason ?? undefined}
              isRecommended={match.is_recommended}
            />
          </div>
        </div>

        {/* Right side: Action */}
        {onSelect && (
          <div style={{ alignSelf: 'center', marginLeft: 'auto' }}>
            <Button
              type={selected ? 'primary' : 'default'}
              icon={<SelectOutlined />}
              onClick={() => onSelect(match.home_course_id)}
              disabled={disabled || (isNotRec && !selected)}
              size="small"
              style={{ fontWeight: 600, width: '100%' }}
            >
              {selected ? t('applicationDetail.actions.selected', { defaultValue: 'Selected' }) : t('applicationDetail.actions.select', { defaultValue: 'Select' })}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};

export default MatchCandidateCard;
