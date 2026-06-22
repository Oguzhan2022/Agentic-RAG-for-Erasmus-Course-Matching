import React, { useState, useMemo } from 'react';
import {
  Typography, Card, Table, Button, Tag, Spin, Alert, Input, Tabs,
  Row, Col, Space, Tooltip, message, Badge, Empty, Progress,
} from 'antd';
import {
  GlobalOutlined, SearchOutlined, CopyOutlined,
  CheckCircleOutlined, RobotOutlined,
  HomeOutlined, CarOutlined, StarOutlined, WarningOutlined,
  ApartmentOutlined, ThunderboltOutlined, InfoCircleOutlined,
  RightOutlined, ArrowRightOutlined, SwapOutlined,
  AuditOutlined, EnvironmentOutlined, LinkOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUniversities, getUniversityProfile, getUniversityPrompt, importLLMData,
  getDepartments,
} from '../api/client';
import { useTranslation } from 'react-i18next';
import type { University } from '../types';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const RANK_SOURCES = [
  { source: 'QS World', key: 'qs_world', color: '#7c3aed' },
  { source: 'THE World', key: 'the_world', color: '#2563eb' },
  { source: 'CWUR World', key: 'cwur_world', color: '#d97706' },
  { source: 'Shanghai', key: 'shanghai_world', color: '#dc2626' },
  { source: 'URAP', key: 'urap_world', color: '#059669' },
  { source: 'edurank', key: 'edurank_world', color: '#0284c7' },
  { source: 'uniRank', key: 'unirank_world', color: '#6b7280' },
];

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high:    { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  medium:  { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  low:     { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  easy:    { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  moderate:{ bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  hard:    { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  budget_heaven: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  good_value:    { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  expensive:     { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
};

/* ── Small components ────────────────────────────────────────────────── */

function Pill({ value }: { value?: string | null }) {
  const { t } = useTranslation();
  if (!value) return <span style={{ color: '#ccc' }}>—</span>;
  const c = LEVEL_COLORS[value];
  if (!c) return <Tag>{value}</Tag>;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>
      {t(`universityInfo.profile.levels.${value}`, { defaultValue: value.replace('_', ' ') })}
    </span>
  );
}

function DataField({ icon, label, children, span = 24 }: { icon?: React.ReactNode; label: string; children: React.ReactNode; span?: number }) {
  return (
    <Col xs={24} sm={span}>
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
          {icon}{label}
        </div>
        <div style={{ fontSize: 13, color: '#222', lineHeight: 1.6 }}>
          {children}
        </div>
      </div>
    </Col>
  );
}

function TagList({ items, color }: { items: string[]; color?: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {items.map((t, i) => (
        <Tag key={i} color={color} style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>{t}</Tag>
      ))}
    </div>
  );
}

function RankBadge({ value, color }: { value?: number | null; color: string }) {
  if (!value) return <span style={{ color: '#d9d9d9', fontSize: 12 }}>—</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: color, color: '#fff',
      borderRadius: 6, padding: '3px 10px', fontSize: 13, fontWeight: 800,
      fontFamily: "'Inter', monospace", letterSpacing: '-0.02em',
      minWidth: 48,
    }}>
      #{value}
    </span>
  );
}

/* ── Section wrapper ─────────────────────────────────────────────────── */

function Section({ icon, title, children, rightExtra }: { icon: React.ReactNode; title: string; children: React.ReactNode; rightExtra?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {React.cloneElement(icon as React.ReactElement<any>, { style: { fontSize: 14, color: '#c0392b' } })}
          </div>
          <Text strong style={{ fontSize: 14, color: '#1a1a1a' }}>{title}</Text>
        </div>
        {rightExtra}
      </div>
      <div style={{ paddingLeft: 36 }}>
        {children}
      </div>
    </div>
  );
}

/* ── LLM Generator ───────────────────────────────────────────────────── */

function LLMPanel({ profile, uniId, uniName }: { profile: any; uniId: number; uniName: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [promptText, setPromptText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [step, setStep] = useState(0);
  const [fixPrompt, setFixPrompt] = useState<string | null>(null);

  const { isFetching: loadingPrompt, refetch: fetchPrompt } = useQuery({
    queryKey: ['uni-prompt', uniId],
    queryFn: () => getUniversityPrompt(uniId),
    enabled: false,
  });

  const importMut = useMutation({
    mutationFn: () => importLLMData(uniId, pasteText),
    onSuccess: () => {
      message.success(t('universityInfo.generator.success'));
      setPasteText('');
      setStep(0);
      setFixPrompt(null);
      qc.invalidateQueries({ queryKey: ['uni-profile', uniId] });
    },
    onError: (e: any) => {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'object' && detail !== null ? detail.msg : String(detail || t('universityInfo.generator.error'));
      const fp = typeof detail === 'object' && detail !== null ? detail.fix_prompt : null;
      message.error(msg);
      if (fp) setFixPrompt(fp);
    },
  });

  const handleGenerate = async () => {
    const result = await fetchPrompt();
    if (result.data) {
      setPromptText(result.data.prompt);
      setStep(1);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    message.success(t('universityInfo.generator.copied'));
  };

  const stepStyle = (active: boolean, done: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
    background: done ? '#f0fdf4' : active ? '#fafafa' : '#fff',
    border: `1px solid ${done ? '#bbf7d0' : active ? '#e8e8e8' : '#f0f0f0'}`,
    borderRadius: 10, marginBottom: 8,
    opacity: (!active && !done) ? 0.5 : 1,
    transition: 'all 0.2s',
  });

  return (
    <div>
      {/* Workflow steps */}
      <div style={{
        background: '#fafafa', borderRadius: 12, padding: 20,
        border: '1px solid #f0f0f0', marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <RobotOutlined style={{ color: '#c0392b', fontSize: 16 }} />
          <Text strong style={{ fontSize: 14 }}>{t('universityInfo.generator.mainTitle')}</Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
            {t('universityInfo.generator.for')} {uniName}
          </Text>
        </div>

        {/* Step 1 */}
        <div style={stepStyle(step === 0 || step === 1, step >= 1)}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: step >= 1 ? '#52c41a' : '#1a1a1a',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            {step >= 1 ? <CheckCircleOutlined /> : '1'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong style={{ fontSize: 13 }}>{t('universityInfo.generator.step1Title')}</Text>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {t('universityInfo.generator.step1Desc')}
            </div>
          </div>
          <Button
            icon={<ThunderboltOutlined />}
            loading={loadingPrompt}
            onClick={handleGenerate}
            type="primary"
            size="small"
            style={{ background: '#1a1a1a', borderColor: '#1a1a1a', borderRadius: 6 }}
          >
            {t('universityInfo.generator.generate')}
          </Button>
        </div>

        {promptText && (
          <div style={{ margin: '8px 0 12px 36px' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <Button icon={<CopyOutlined />} onClick={handleCopy} size="small" style={{ borderRadius: 6 }}>
                {t('universityInfo.generator.copy')}
              </Button>
              <Button size="small" style={{ borderRadius: 6 }} onClick={() => { setStep(2); }}>
                {t('universityInfo.generator.nextPaste')} <ArrowRightOutlined />
              </Button>
            </div>
            <TextArea
              value={promptText}
              readOnly
              rows={5}
              style={{ fontFamily: "'Consolas', 'Monaco', monospace", fontSize: 11, background: '#fff', borderRadius: 8, border: '1px solid #e8e8e8' }}
            />
          </div>
        )}

        {/* Step 2 */}
        <div style={stepStyle(step === 2, false)}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: '#1a1a1a',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            2
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong style={{ fontSize: 13 }}>{t('universityInfo.generator.step2Title')}</Text>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {t('universityInfo.generator.step2Desc')}
            </div>
          </div>
        </div>

        <div style={{ margin: '4px 0 0 36px' }}>
          <TextArea
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); if (e.target.value && step < 2) setStep(2); }}
            placeholder='{\n  "university_name": "...",\n  "rankings": { ... },\n  ...\n}'
            rows={8}
            style={{ fontFamily: "'Consolas', 'Monaco', monospace", fontSize: 11, borderRadius: 8, border: '1px solid #e8e8e8' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <Button
              icon={<CheckCircleOutlined />}
              loading={importMut.isPending}
              onClick={() => importMut.mutate()}
              disabled={!pasteText.trim()}
              type="primary"
              style={{ background: '#c0392b', borderColor: '#c0392b', borderRadius: 6, fontWeight: 600 }}
            >
              {t('universityInfo.generator.importSave')}
            </Button>
            {profile?.llm_imported_at && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('universityInfo.generator.lastImport')}: {new Date(profile.llm_imported_at).toLocaleString()}
              </Text>
            )}
          </div>
        </div>

        {/* Fix prompt on error */}
        {fixPrompt && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={t('universityInfo.generator.formatError')}
            description={
              <div>
                <Text style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  {t('universityInfo.generator.fixDesc')}
                </Text>
                <TextArea
                  value={fixPrompt}
                  readOnly
                  rows={4}
                  style={{ fontFamily: "'Consolas', monospace", fontSize: 11, borderRadius: 8, marginBottom: 8 }}
                />
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => { navigator.clipboard.writeText(fixPrompt); message.success(t('universityInfo.generator.fixCopied')); }}
                  style={{ borderRadius: 6, marginRight: 8 }}
                >
                  {t('universityInfo.generator.copyFix')}
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => setFixPrompt(null)}
                >
                  {t('universityInfo.generator.dismiss')}
                </Button>
              </div>
            }
            style={{ borderRadius: 10, border: '1px solid #ffe58f', marginTop: 12 }}
          />
        )}
      </div>

      {/* Quick guide */}
      {!profile?.llm_data && (
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message={t('universityInfo.generator.quickGuide.title')}
          description={
            <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 2 }}>
              <li>{t('universityInfo.generator.quickGuide.step1')}</li>
              <li>{t('universityInfo.generator.quickGuide.step2')}</li>
              <li>{t('universityInfo.generator.quickGuide.step3')}</li>
              <li>{t('universityInfo.generator.quickGuide.step4')}</li>
            </ol>
          }
          style={{ borderRadius: 10, border: '1px solid #e8e8e8' }}
        />
      )}
    </div>
  );
}

/* ── Profile Data Display ────────────────────────────────────────────── */

function ProfileDataDisplay({ data, rankings }: { data: any; rankings?: any }) {
  const { t } = useTranslation();
  const hasRankings = rankings && Object.values(rankings).some((v: any) => v != null);

  if (!data && !hasRankings) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: '#888' }}>{t('universityInfo.profile.noProfileDataYet')}</span>
          }
        />
      </div>
    );
  }

  return (
    <div>
      {data && (
        <Alert
          message={t('universityInfo.profile.aiGeneratedBanner')}
          description={t('universityInfo.profile.aiGeneratedDesc')}
          type="info"
          showIcon
          icon={<RobotOutlined />}
          style={{ marginBottom: 20, borderRadius: 12, border: '1px solid #bae0ff', background: '#f0f9ff' }}
        />
      )}
      {/* Rankings */}
      {hasRankings && (
        <Section icon={<StarOutlined />} title={t('universityInfo.profile.worldRankings')}>
          <Row gutter={[10, 8]}>
            {RANK_SOURCES.filter(r => rankings[r.key] != null).map(r => (
              <Col key={r.key}>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '10px 16px', background: '#fafafa', borderRadius: 10,
                  border: '1px solid #f0f0f0', minWidth: 90,
                }}>
                  <div style={{ fontSize: 10, color: '#888', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {r.source}
                  </div>
                  <RankBadge value={rankings[r.key]} color={r.color} />
                </div>
              </Col>
            ))}
          </Row>
        </Section>
      )}

      {!data && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Empty description={t('universityInfo.profile.noLLMData')} />
        </div>
      )}

      {data && <>
        {/* City Profile */}
        <Section icon={<GlobalOutlined />} title={t('universityInfo.profile.sections.city')}>
          {data.city_description && (
            <Paragraph style={{ fontSize: 13, lineHeight: 1.8, color: '#444', marginBottom: 14 }}>
              {data.city_description}
            </Paragraph>
          )}
          <Row gutter={[16, 4]}>
            <DataField icon={<InfoCircleOutlined />} label={t('universityInfo.profile.fields.safety')} span={8}>
              <Pill value={data.safety_level} />
            </DataField>
            <DataField icon={<GlobalOutlined />} label={t('universityInfo.profile.fields.english')} span={8}>
              <Pill value={data.english_friendliness} />
            </DataField>
            <DataField label={t('universityInfo.profile.fields.climate')} span={8}>
              {data.climate || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            {data.city_population && (
              <DataField label={t('universityInfo.profile.fields.population')} span={8}>
                {data.city_population.toLocaleString()}
              </DataField>
            )}
          </Row>
        </Section>

        {/* Transportation */}
        <Section icon={<CarOutlined />} title={t('universityInfo.profile.sections.transport')}>
          <Row gutter={[16, 4]}>
            <DataField label={t('universityInfo.profile.fields.airport')} span={12}>
              {data.nearest_airport || <span style={{ color: '#ccc' }}>—</span>}
              {data.airport_distance_km && (
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>({data.airport_distance_km} km)</Text>
              )}
            </DataField>
            <DataField label={t('universityInfo.profile.fields.cityCenter')} span={12}>
              {data.distance_to_city_center || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            <DataField label={t('universityInfo.profile.fields.fromAirport')} span={24}>
              {data.airport_transport || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            <DataField label={t('universityInfo.profile.fields.publicTransport')} span={24}>
              {data.public_transport_quality || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            {data.notable_connections?.length > 0 && (
              <DataField label={t('universityInfo.profile.fields.nearbyCities')} span={24}>
                <TagList items={data.notable_connections} />
              </DataField>
            )}
          </Row>
        </Section>

        {/* Accommodation */}
        <Section icon={<HomeOutlined />} title={t('universityInfo.profile.sections.accommodation')}>
          <Row gutter={[16, 4]}>
            <DataField label={t('universityInfo.profile.fields.dorm')} span={8}>
              {data.dorm_available != null
                ? <Tag color={data.dorm_available ? 'green' : 'red'} style={{ borderRadius: 20, fontSize: 11 }}>
                    {data.dorm_available ? t('universityInfo.profile.values.available') : t('universityInfo.profile.values.notAvailable')}
                  </Tag>
                : <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            {data.dorm_cost_min_eur != null && (
              <DataField label={t('universityInfo.profile.fields.dormCost')} span={8}>
                <span style={{ fontWeight: 600 }}>€{data.dorm_cost_min_eur}–€{data.dorm_cost_max_eur || data.dorm_cost_min_eur}</span>
              </DataField>
            )}
            {data.private_room_min_eur != null && (
              <DataField label={t('universityInfo.profile.fields.privateRoom')} span={8}>
                <span style={{ fontWeight: 600 }}>€{data.private_room_min_eur}–€{data.private_room_max_eur || data.private_room_min_eur}</span>
              </DataField>
            )}
            <DataField label={t('universityInfo.profile.fields.housingDifficulty')} span={8}>
              <Pill value={data.housing_difficulty} />
            </DataField>
            {data.accommodation_notes && (
              <DataField label={t('universityInfo.profile.fields.notes')} span={16}>
                {data.accommodation_notes}
              </DataField>
            )}
          </Row>
        </Section>

        {/* Cost of Living */}
        {data.erasmus_grant_sufficient != null && (
          <Section icon={<InfoCircleOutlined />} title={t('universityInfo.profile.sections.cost')}>
            <Row gutter={[16, 4]}>
              <DataField label={t('universityInfo.profile.fields.grantSufficient')} span={12}>
                <Tag color={data.erasmus_grant_sufficient ? 'green' : 'red'} style={{ borderRadius: 20, fontSize: 11 }}>
                  {data.erasmus_grant_sufficient ? t('universityInfo.profile.values.grantYes') : t('universityInfo.profile.values.grantNo')}
                </Tag>
              </DataField>
            </Row>
          </Section>
        )}

        {/* Social Life */}
        <Section icon={<StarOutlined />} title={t('universityInfo.profile.sections.social')}>
          <Row gutter={[16, 4]}>
            <DataField label={t('universityInfo.profile.fields.nightlife')} span={24}>
              {data.nightlife || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            <DataField label={t('universityInfo.profile.fields.community')} span={24}>
              {data.erasmus_community || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            <DataField label={t('universityInfo.profile.fields.organizations')} span={24}>
              {data.student_organizations || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            {data.key_spots?.length > 0 && (
              <DataField label={t('universityInfo.profile.fields.keySpots')} span={24}>
                <TagList items={data.key_spots} color="blue" />
              </DataField>
            )}
          </Row>
        </Section>

        {/* Academic */}
        <Section icon={<ApartmentOutlined />} title={t('universityInfo.profile.sections.academic')}>
          <Row gutter={[16, 4]}>
            <DataField label={t('universityInfo.profile.fields.language')} span={12}>
              {data.language_of_instruction || <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            <DataField label={t('universityInfo.profile.fields.englishCourses')} span={12}>
              {data.english_courses_available != null
                ? <Tag color={data.english_courses_available ? 'green' : 'orange'} style={{ borderRadius: 20, fontSize: 11 }}>
                    {data.english_courses_available ? t('universityInfo.profile.values.available') : t('universityInfo.profile.values.limited')}
                  </Tag>
                : <span style={{ color: '#ccc' }}>—</span>}
            </DataField>
            {data.notable_programs?.length > 0 && (
              <DataField label={t('universityInfo.profile.fields.programs')} span={24}>
                <TagList items={data.notable_programs} />
              </DataField>
            )}
            {data.academic_notes && (
              <DataField label={t('universityInfo.profile.fields.specialNotes')} span={24}>
                {data.academic_notes}
              </DataField>
            )}
          </Row>
        </Section>

        {/* Student Summary */}
        <Section icon={<AuditOutlined />} title={t('universityInfo.profile.sections.summary')}>
          <Row gutter={[16, 4]}>
            <DataField label={t('universityInfo.profile.fields.rating')} span={8}>
              <Pill value={data.overall_rating} />
            </DataField>
            {data.best_for?.length > 0 && (
              <DataField label={t('universityInfo.profile.fields.bestFor')} span={16}>
                <TagList items={data.best_for} color="green" />
              </DataField>
            )}
            {data.watch_out_for?.length > 0 && (
              <DataField label={t('universityInfo.profile.fields.watchOut')} span={24}>
                <TagList items={data.watch_out_for} color="orange" />
              </DataField>
            )}
          </Row>
        </Section>

        {/* Sources */}
        {data.sources?.length > 0 && (
          <Section icon={<LinkOutlined />} title={t('universityInfo.profile.sections.sources')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.sources.map((s: { title: string; url: string }, i: number) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer"
                  style={{
                    fontSize: 11, color: '#1677ff', background: '#f0f5ff',
                    padding: '3px 10px', borderRadius: 4, border: '1px solid #d6e4ff',
                    textDecoration: 'none', display: 'inline-block',
                  }}>
                  {s.title || s.url}
                </a>
              ))}
            </div>
          </Section>
        )}
      </>}
    </div>
  );
}

/* ── University Detail ───────────────────────────────────────────────── */

function UniDetail({ uni }: { uni: University }) {
  const { t } = useTranslation();
  const { data: profile, isLoading } = useQuery({
    queryKey: ['uni-profile', uni.id],
    queryFn: () => getUniversityProfile(uni.id),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const hasRankings = profile && Object.values(profile.rankings || {}).some((v: any) => v != null);
  const hasLLM = !!profile?.llm_data;
  const completeness = [hasRankings, hasLLM].filter(Boolean).length;

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 100%)',
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, background: '#c0392b',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <GlobalOutlined style={{ color: '#fff', fontSize: 20 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title level={4} style={{ color: '#fff', margin: 0, lineHeight: 1.3, fontSize: 16 }}>
            {uni.name}
          </Title>
          <Text style={{ color: '#888', fontSize: 12 }}>
            <EnvironmentOutlined style={{ marginRight: 4 }} />
            {[uni.city, uni.country].filter(Boolean).join(', ')}
          </Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {hasRankings && (
            <Tag color="purple" style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>{t('universityProfile.rankings')}</Tag>
          )}
          {hasLLM && (
            <Tag color="green" style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>{t('universityProfile.aiProfileTitle').split(' ')[0]}</Tag>
          )}
          {!hasRankings && !hasLLM && (
            <Tag style={{ margin: 0, borderRadius: 6, fontSize: 11, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#888' }}>
              {t('universityProfile.noData')}
            </Tag>
          )}
        </div>
      </div>

      <Tabs
        defaultActiveKey="llm"
        style={{ marginTop: -8 }}
        items={[
          {
            key: 'llm',
            label: <span><RobotOutlined style={{ marginRight: 5 }} />{t('universityInfo.generator.title')}</span>,
            children: <LLMPanel profile={profile} uniId={uni.id} uniName={uni.name} />,
          },
          {
            key: 'profile',
            label: (
              <span>
                <InfoCircleOutlined style={{ marginRight: 5 }} />
                {t('universityInfo.profile.title')}
                {hasLLM && <Badge dot style={{ marginLeft: 4 }} />}
              </span>
            ),
            children: <ProfileDataDisplay data={profile?.llm_data} rankings={profile?.rankings} />,
          },
        ]}
      />
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────── */

export default function UniversityInfoPage() {
  const { t } = useTranslation();
  const { activeDepartment, user } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedUni, setSelectedUni] = useState<University | null>(null);

  const { data: allDepartments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => getDepartments(),
  });

  const activeDeptId = useMemo(() => {
    if (!activeDepartment) return null;
    const dept = allDepartments.find(d => d.code === activeDepartment);
    return dept?.id || null;
  }, [activeDepartment, allDepartments]);

  const { data: universities, isLoading } = useQuery({
    queryKey: ['universities-info-list', activeDepartment],
    queryFn: () => getUniversities(activeDepartment, false),
    staleTime: 60_000,
  });

  const partnerUnis = (universities || []).filter(u => !u.is_home);
  const filtered = partnerUnis.filter(u => {
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      (u.city || '').toLowerCase().includes(q) ||
      (u.country || '').toLowerCase().includes(q)
    );
  });

  const columns = [
    {
      title: t('universityInfo.columns.university'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row: University) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
          <div style={{ fontSize: 11, color: '#888' }}>
            <EnvironmentOutlined style={{ marginRight: 3, fontSize: 10 }} />
            {[row.city, row.country].filter(Boolean).join(', ')}
          </div>
        </div>
      ),
    },
    {
      title: t('universityInfo.columns.country'),
      dataIndex: 'country',
      key: 'country',
      width: 120,
      render: (v: string) => <span style={{ fontSize: 12, color: '#555' }}>{v || '—'}</span>,
    },
    {
      title: t('universityInfo.columns.status'),
      key: 'status',
      width: 100,
      render: (_: any, row: University) => (
        <Tag color={row.is_active ? 'green' : 'default'} style={{ borderRadius: 6, fontSize: 11 }}>
          {row.is_active ? t('universityInfo.status.active') : t('universityInfo.status.inactive')}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 100,
      render: (_: any, row: University) => (
        <Button
          size="small"
          type={selectedUni?.id === row.id ? 'primary' : 'default'}
          onClick={() => setSelectedUni(selectedUni?.id === row.id ? null : row)}
          style={selectedUni?.id === row.id
            ? { background: '#c0392b', borderColor: '#c0392b', borderRadius: 6, fontWeight: 600 }
            : { borderRadius: 6 }}
        >
          {selectedUni?.id === row.id ? t('universityInfo.actions.close') : t('universityInfo.actions.manage')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      {/* Header banner */}
      <Card
        style={{
          marginBottom: 20,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 100%)',
          border: 'none',
        }}
        styles={{ body: { padding: '20px 24px' } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('universityInfo.coordinatorPanel')}
            </Text>
            <Title level={4} style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: 18 }}>
              {t('universityInfo.managementTitle')}
            </Title>
            <Text style={{ color: '#777', fontSize: 12 }}>
              {t('universityInfo.managementDesc')}
            </Text>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'rgba(192, 57, 43, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <InfoCircleOutlined style={{ color: '#c0392b', fontSize: 20 }} />
          </div>
        </div>
      </Card>

      {/* University list */}
      <Card
        style={{ borderRadius: 10, marginBottom: selectedUni ? 16 : 0, border: '1px solid #e8e8e8' }}
        styles={{ header: { borderBottom: '1px solid #f0f0f0' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t('universityInfo.partnerUniversities')}</span>
            <span style={{ fontSize: 12, color: '#aaa' }}>{partnerUnis.length} {t('universityInfo.total')}</span>
            <Input
              placeholder={t('universityInfo.searchPlaceholder')}
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 240, borderRadius: 8 }}
              size="small"
              allowClear
            />
          </div>
        }
      >
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={{ pageSize: 15, showSizeChanger: false }}
          onRow={row => ({
            style: {
              background: selectedUni?.id === row.id ? '#fff5f5' : undefined,
              cursor: 'pointer',
            },
            onClick: () => setSelectedUni(selectedUni?.id === row.id ? null : row),
          })}
        />
      </Card>

      {/* Detail panel */}
      {selectedUni && (
        <Card
          style={{ borderRadius: 10, border: '1px solid #e8e8e8' }}
          styles={{ body: { paddingTop: 16 } }}
        >
          <UniDetail uni={selectedUni} />
        </Card>
      )}
    </div>
  );
}
