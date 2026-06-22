import React, { useState } from 'react';
import {
  Drawer, Button, Empty, Spin, Typography, Radio, Tag, Divider, message,
} from 'antd';
import {
  CheckCircleOutlined, ExclamationCircleOutlined,
  DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getMatchCandidates, selectCourse } from '../api/client';
import VerificationBadge from './VerificationBadge';
import ExplainabilityPanel from './ExplainabilityPanel';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  partnerCourse: any;
  applicationId: number;
  onSelect: (match: any) => void;
}

export default function MatchSelectionDrawer({
  open, onClose, partnerCourse, applicationId, onSelect,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const partnerCourseId = partnerCourse?.partner_course_id || partnerCourse?.id;

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates', applicationId, partnerCourseId],
    queryFn: () => getMatchCandidates(applicationId, partnerCourseId!),
    enabled: open && !!applicationId && !!partnerCourseId,
    staleTime: 0,
  });

  const autoSelectId = partnerCourse?.autoSelectHome;

  const toggleExpand = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const handleConfirm = () => {
    const match = candidates?.candidates?.find((c: any) => c.id === selectedId);
    if (match) {
      selectCourse(applicationId, {
        partner_course_id: partnerCourseId,
        home_course_id: match.home_course_id,
        course_match_id: match.id,
      }).then(() => {
        onSelect(match);
        message.success('Match selected!');
      }).catch(() => {
        message.error('Failed to select match');
      });
    } else if (autoSelectId) {
      const autoMatch = candidates?.candidates?.find((c: any) => c.home_course_id === autoSelectId);
      if (autoMatch) {
        selectCourse(applicationId, {
          partner_course_id: partnerCourseId,
          home_course_id: autoMatch.home_course_id,
          course_match_id: autoMatch.id,
        }).then(() => {
          onSelect(autoMatch);
          message.success('Match selected!');
        });
      }
    }
  };

  const candidatesList = candidates?.candidates || [];

  return (
    <Drawer
      title={
        <div>
          <Text strong style={{ fontSize: 15 }}>Select Match</Text>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {partnerCourse?.course_name || 'Course'}
          </div>
        </div>
      }
      placement="right"
      width={680}
      open={open}
      onClose={onClose}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            onClick={handleConfirm}
            disabled={!selectedId && !autoSelectId}
          >
            Confirm Selection
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#888' }}>Loading candidates...</div>
        </div>
      )}

      {!isLoading && candidatesList.length === 0 && (
        <Empty description="No match candidates found for this course" />
      )}

      <Radio.Group
        value={selectedId || autoSelectId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{ width: '100%' }}
      >
        {candidatesList.map((match: any) => {
          const pct = Math.round(match.overall_score * 100);
          const isActive = selectedId === match.id || autoSelectId === match.home_course_id;
          const isRisk = match.verification_status === 'risk_flagged';
          const isApproved = match.verification_status === 'approved';
          const isRejected = match.verification_status === 'rejected';
          const isExp = expanded.has(match.id);

          return (
            <div key={match.id} style={{
              marginBottom: 10,
              padding: 14,
              border: `2px solid ${isRejected ? '#ffccc7' : isRisk ? '#ffe58f' : isActive ? '#91d5ff' : '#f0f0f0'}`,
              borderRadius: 10,
              background: isRejected ? '#fff2f0' : isRisk ? '#fffbe6' : isActive ? '#e6f7ff' : '#fff',
              transition: 'all 0.2s ease',
            }}>
              {/* Header row: Radio info left, toggle button right */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Radio value={match.id} style={{ marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.4 }}>
                    {match.home_course_name}
                  </Text>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    <Tag color={pct >= 70 ? '#52c41a' : pct >= 40 ? '#faad14' : '#ff4d4f'} style={{ fontWeight: 600, fontSize: 10 }}>
                      {pct}%
                    </Tag>
                    {isApproved && (
                      <Tag color="gold" style={{ fontSize: 10, fontWeight: 700 }}>AI RECOMMENDATION</Tag>
                    )}
                    {isRisk && (
                      <Tag color="orange" icon={<ExclamationCircleOutlined />} style={{ fontSize: 10, fontWeight: 700 }}>
                        RISK FLAGGED
                      </Tag>
                    )}
                    {isRejected && (
                      <Tag color="red" style={{ fontSize: 10, fontWeight: 700 }}>NOT RECOMMENDED</Tag>
                    )}
                    <VerificationBadge
                      status={match.verification_status}
                      confidence={match.verification_confidence ?? undefined}
                      reason={match.verification_reason ?? undefined}
                      isRecommended={match.is_recommended}
                    />
                  </div>
                </div>
                <button
                  onClick={() => toggleExpand(match.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    color: isExp ? '#1677ff' : '#666',
                    background: isExp ? '#f0f5ff' : '#fafafa',
                    border: `1px solid ${isExp ? '#adc6ff' : '#e8e8e8'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                  }}
                >
                  {isExp ? (
                    <>Hide <UpOutlined style={{ fontSize: 9 }} /></>
                  ) : (
                    <>Details <DownOutlined style={{ fontSize: 9 }} /></>
                  )}
                </button>
              </div>

              {/* Details panel */}
              {isExp && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
                  <ExplainabilityPanel
                    scoreBreakdown={match.score_breakdown}
                    matchedTopics={match.matched_topics}
                    missingTopics={match.missing_topics}
                    extraPartnerTopics={match.extra_partner_topics}
                    coreHomeTopics={match.core_home_topics}
                    structuralNotes={match.structural_notes}
                    warnings={match.warnings}
                    verificationStatus={match.verification_status}
                    verificationReason={match.verification_reason}
                    contentOverlapAssessment={match.content_overlap_assessment}
                    coreTopicCoverage={match.core_topic_coverage}
                    overallScore={match.overall_score}
                  />
                </div>
              )}
            </div>
          );
        })}
      </Radio.Group>
    </Drawer>
  );
}
