import React from 'react';
import {
  Typography, Card, Tag, Spin, Row, Col, Button, Empty, Alert,
} from 'antd';
import {
  GlobalOutlined, HomeOutlined, CarOutlined, StarOutlined,
  ApartmentOutlined, InfoCircleOutlined, ArrowLeftOutlined,
  AuditOutlined, EnvironmentOutlined, LinkOutlined,
  CheckCircleOutlined, BankOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getUniversity, getUniversityProfile } from '../api/client';
import { useTranslation } from 'react-i18next';

const { Title, Text, Paragraph } = Typography;

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

function Pill({ value }: { value?: string | null }) {
  if (!value) return <span style={{ color: '#ccc' }}>-</span>;
  const c = LEVEL_COLORS[value];
  if (!c) return <Tag>{value}</Tag>;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      textTransform: 'capitalize',
    }}>
      {value.replace('_', ' ')}
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
  if (!value) return <span style={{ color: '#d9d9d9', fontSize: 12 }}>-</span>;
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

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, background: '#fef2f2',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {React.cloneElement(icon as React.ReactElement<any>, { style: { fontSize: 14, color: '#c0392b' } })}
        </div>
        <Text strong style={{ fontSize: 14, color: '#1a1a1a' }}>{title}</Text>
      </div>
      <div className="info-section-content" style={{ paddingLeft: 36 }}>
        {children}
      </div>
    </div>
  );
}

export default function PartnerUniversityInfoPage() {
  const { t } = useTranslation();
  const { uniId } = useParams<{ uniId: string }>();
  const navigate = useNavigate();
  const id = Number(uniId);

  const { data: uni, isLoading: loadingUni } = useQuery({
    queryKey: ['uni-basic', id],
    queryFn: () => getUniversity(id),
    enabled: !!id,
  });

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ['uni-profile-student', id],
    queryFn: () => getUniversityProfile(id),
    enabled: !!id,
    staleTime: 120_000,
  });

  const isLoading = loadingUni || loadingProfile;
  const d = profile?.llm_data;
  const r = profile?.rankings;
  const hasRankings = r && Object.values(r).some((v: any) => v != null);
  const hasLLM = !!d;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>


      {isLoading && (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      )}

      {!isLoading && !uni && (
        <Card style={{ borderRadius: 10, textAlign: 'center', padding: 60 }}>
          <Empty description={t('universityProfile.notFound')} />
        </Card>
      )}

      {!isLoading && uni && (
        <>
          {/* Header banner */}
          <Card
            style={{
              marginBottom: 20,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 100%)',
              border: 'none',
            }}
            styles={{ body: { padding: '18px 24px' } }}
          >
            <div className="uni-info-header">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Button
                  icon={<ArrowLeftOutlined />}
                  onClick={() => navigate(-1)}
                  className="mobile-back-btn"
                  style={{ 
                    background: 'rgba(255,255,255,0.08)', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    color: '#fff', 
                    borderRadius: '50%',
                    width: 36, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 4
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, background: '#c0392b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <BankOutlined style={{ color: '#fff', fontSize: 16 }} />
                    </div>
                    <Title level={4} style={{ color: '#fff', margin: 0, lineHeight: 1.2, fontSize: 18 }}>
                      {uni.name}
                    </Title>
                  </div>
                  {(uni.city || uni.country) && (
                    <div style={{ color: '#aaa', fontSize: 12, marginLeft: 44 }}>
                      <EnvironmentOutlined style={{ marginRight: 5 }} />
                      {[uni.city, uni.country].filter(Boolean).join(', ')}
                    </div>
                  )}
                  <div className="uni-info-header-tags" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, marginLeft: 44 }}>
                    {hasRankings && (
                      <Tag color="purple" style={{ margin: 0, borderRadius: 6, fontSize: 10, background: 'rgba(124, 58, 237, 0.2)', border: '1px solid rgba(124, 58, 237, 0.3)', color: '#d8b4fe' }}>{t('partnerUniversities.browser.semester') === 'Semester' ? 'Rankings' : 'Sıralamalar'}</Tag>
                    )}
                    {hasLLM && (
                      <Tag color="green" style={{ margin: 0, borderRadius: 6, fontSize: 10, background: 'rgba(34, 197, 94, 0.2)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#bbf7d0' }}>{t('partnerUniversities.browser.semester') === 'Semester' ? 'Profile' : 'Profil'}</Tag>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {!hasRankings && !hasLLM && (
            <Card style={{ borderRadius: 10, textAlign: 'center', padding: 60 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('universityProfile.noData')}
              />
            </Card>
          )}

          {hasLLM && (
            <Alert
              message={t('universityProfile.aiProfileTitle')}
              description={t('universityProfile.aiProfileDesc')}
              type="info"
              showIcon
              icon={<ExperimentOutlined />}
              style={{ marginBottom: 20, borderRadius: 12, border: '1px solid #bae0ff', background: '#f0f9ff' }}
            />
          )}

          {(hasRankings || hasLLM) && (
            <Card style={{ borderRadius: 12, border: '1px solid #e8e8e8' }} styles={{ body: { padding: '24px 28px' } }}>
              {/* Rankings */}
              {hasRankings && (
                <Section icon={<StarOutlined />} title={t('universityProfile.rankings')}>
                  <Row gutter={[10, 8]}>
                    {RANK_SOURCES.filter(rs => (r as any)[rs.key] != null).map(rs => (
                      <Col key={rs.key}>
                        <div style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          padding: '10px 16px', background: '#fafafa', borderRadius: 10,
                          border: '1px solid #f0f0f0', minWidth: 90,
                        }}>
                          <div style={{ fontSize: 10, color: '#888', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {rs.source}
                          </div>
                          <RankBadge value={(r as any)[rs.key]} color={rs.color} />
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Section>
              )}

              {d && (
                <>
                  {/* City Profile */}
                  <Section icon={<GlobalOutlined />} title={t('universityProfile.cityProfile.title')}>
                    {d.city_description && (
                      <Paragraph style={{ fontSize: 13, lineHeight: 1.8, color: '#444', marginBottom: 14 }}>
                        {d.city_description}
                      </Paragraph>
                    )}
                    <Row gutter={[16, 4]}>
                      <DataField icon={<InfoCircleOutlined />} label={t('universityProfile.cityProfile.safety')} span={8}>
                        <Pill value={d.safety_level} />
                      </DataField>
                      <DataField icon={<GlobalOutlined />} label={t('universityProfile.cityProfile.english')} span={8}>
                        <Pill value={d.english_friendliness} />
                      </DataField>
                      <DataField label={t('universityProfile.cityProfile.climate')} span={8}>
                        {d.climate || <span style={{ color: '#ccc' }}>-</span>}
                      </DataField>
                      {d.city_population && (
                        <DataField label={t('universityProfile.cityProfile.population')} span={8}>
                          {d.city_population.toLocaleString()}
                        </DataField>
                      )}
                    </Row>
                  </Section>

                  {/* Transportation */}
                  {(d.nearest_airport || d.public_transport_quality) && (
                    <Section icon={<CarOutlined />} title={t('universityProfile.transportation.title')}>
                      <Row gutter={[16, 4]}>
                        <DataField label={t('universityProfile.transportation.airport')} span={12}>
                          {d.nearest_airport || <span style={{ color: '#ccc' }}>-</span>}
                          {d.airport_distance_km && (
                            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>({d.airport_distance_km} km)</Text>
                          )}
                        </DataField>
                        <DataField label={t('universityProfile.transportation.center')} span={12}>
                          {d.distance_to_city_center || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        <DataField label={t('universityProfile.transportation.fromAirport')} span={24}>
                          {d.airport_transport || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        <DataField label={t('universityProfile.transportation.publicTransport')} span={24}>
                          {d.public_transport_quality || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        {d.notable_connections?.length > 0 && (
                          <DataField label={t('universityProfile.transportation.nearbyCities')} span={24}>
                            <TagList items={d.notable_connections} />
                          </DataField>
                        )}
                      </Row>
                    </Section>
                  )}

                  {/* Accommodation */}
                  {(d.dorm_available != null || d.private_room_min_eur != null) && (
                    <Section icon={<HomeOutlined />} title={t('universityProfile.accommodation.title')}>
                      <Row gutter={[16, 4]}>
                        <DataField label={t('universityProfile.accommodation.dorm')} span={8}>
                          {d.dorm_available != null
                            ? <Tag color={d.dorm_available ? 'green' : 'red'} style={{ borderRadius: 20, fontSize: 11 }}>
                                {d.dorm_available ? t('universityProfile.accommodation.available') : t('universityProfile.accommodation.notAvailable')}
                              </Tag>
                            : <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        {d.dorm_cost_min_eur != null && (
                          <DataField label={t('universityProfile.accommodation.dormCost')} span={8}>
                            <span style={{ fontWeight: 600 }}>{'\u20AC'}{d.dorm_cost_min_eur}{'\u2013'}{'\u20AC'}{d.dorm_cost_max_eur || d.dorm_cost_min_eur}</span>
                          </DataField>
                        )}
                        {d.private_room_min_eur != null && (
                          <DataField label={t('universityProfile.accommodation.privateRoom')} span={8}>
                            <span style={{ fontWeight: 600 }}>{'\u20AC'}{d.private_room_min_eur}{'\u2013'}{'\u20AC'}{d.private_room_max_eur || d.private_room_min_eur}</span>
                          </DataField>
                        )}
                        <DataField label={t('universityProfile.accommodation.difficulty')} span={8}>
                          <Pill value={d.housing_difficulty} />
                        </DataField>
                        {d.accommodation_notes && (
                          <DataField label={t('universityProfile.accommodation.notes')} span={16}>
                            {d.accommodation_notes}
                          </DataField>
                        )}
                      </Row>
                    </Section>
                  )}

                  {/* Cost of Living */}
                  {d.erasmus_grant_sufficient != null && (
                    <Section icon={<InfoCircleOutlined />} title={t('universityProfile.costOfLiving.title')}>
                      <Row gutter={[16, 4]}>
                        <DataField label={t('universityProfile.costOfLiving.grantSufficient')} span={12}>
                          <Tag color={d.erasmus_grant_sufficient ? 'green' : 'red'} style={{ borderRadius: 20, fontSize: 11 }}>
                            {d.erasmus_grant_sufficient ? t('universityProfile.costOfLiving.yesBasics') : t('universityProfile.costOfLiving.noExtra')}
                          </Tag>
                        </DataField>
                      </Row>
                    </Section>
                  )}

                  {/* Social Life */}
                  {(d.nightlife || d.erasmus_community) && (
                    <Section icon={<StarOutlined />} title={t('universityProfile.socialLife.title')}>
                      <Row gutter={[16, 4]}>
                        <DataField label={t('universityProfile.socialLife.nightlife')} span={24}>
                          {d.nightlife || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        <DataField label={t('universityProfile.socialLife.community')} span={24}>
                          {d.erasmus_community || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        <DataField label={t('universityProfile.socialLife.organizations')} span={24}>
                          {d.student_organizations || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        {d.key_spots?.length > 0 && (
                          <DataField label={t('universityProfile.socialLife.keySpots')} span={24}>
                            <TagList items={d.key_spots} color="blue" />
                          </DataField>
                        )}
                      </Row>
                    </Section>
                  )}

                  {/* Academic */}
                  {(d.language_of_instruction || d.english_courses_available != null) && (
                    <Section icon={<ApartmentOutlined />} title={t('universityProfile.academicInfo.title')}>
                      <Row gutter={[16, 4]}>
                        <DataField label={t('universityProfile.academicInfo.language')} span={12}>
                          {d.language_of_instruction || <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        <DataField label={t('universityProfile.academicInfo.englishCourses')} span={12}>
                          {d.english_courses_available != null
                            ? <Tag color={d.english_courses_available ? 'green' : 'orange'} style={{ borderRadius: 20, fontSize: 11 }}>
                                {d.english_courses_available ? t('universityProfile.accommodation.available') : t('universityProfile.academicInfo.limited')}
                              </Tag>
                            : <span style={{ color: '#ccc' }}>-</span>}
                        </DataField>
                        {d.notable_programs?.length > 0 && (
                          <DataField label={t('universityProfile.academicInfo.notablePrograms')} span={24}>
                            <TagList items={d.notable_programs} />
                          </DataField>
                        )}
                        {d.academic_notes && (
                          <DataField label={t('universityProfile.academicInfo.specialNotes')} span={24}>
                            {d.academic_notes}
                          </DataField>
                        )}
                      </Row>
                    </Section>
                  )}

                  {/* Sources */}
                  {d.sources?.length > 0 && (
                    <Section icon={<LinkOutlined />} title={t('universityProfile.sources')}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {d.sources.map((s: { title: string; url: string }, i: number) => (
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
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
