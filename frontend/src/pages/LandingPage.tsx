import { useNavigate } from 'react-router-dom';

import {
  ExperimentOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  GlobalOutlined,
  FileSearchOutlined,
  ArrowRightOutlined,
  LoginOutlined,
  BankOutlined,
  GlobalOutlined as LangIcon,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { Select, Dropdown } from 'antd';


export default function LandingPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const FEATURES = [
    {
      icon: <ExperimentOutlined />,
      title: t('landing.features.items.aiMatching.title'),
      desc: t('landing.features.items.aiMatching.desc'),
    },
    {
      icon: <SafetyCertificateOutlined />,
      title: t('landing.features.items.smartVerification.title'),
      desc: t('landing.features.items.smartVerification.desc'),
    },
    {
      icon: <TeamOutlined />,
      title: t('landing.features.items.workflow.title'),
      desc: t('landing.features.items.workflow.desc'),
    },
    {
      icon: <BankOutlined />,
      title: t('landing.features.items.uniProfiles.title'),
      desc: t('landing.features.items.uniProfiles.desc'),
    },
    {
      icon: <GlobalOutlined />,
      title: t('landing.features.items.partnerUnis.title'),
      desc: t('landing.features.items.partnerUnis.desc'),
    },
    {
      icon: <FileSearchOutlined />,
      title: t('landing.features.items.explainable.title'),
      desc: t('landing.features.items.explainable.desc'),
    },
  ];


  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f8' }}>
      <style>{`
        @keyframes lp-fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes lp-fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes lp-accentSlide {
          from { width: 0; }
          to { width: 48px; }
        }

        .lp-hero-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 36px;
          background: #c0392b;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          transition: all 0.25s ease;
        }
        .lp-hero-btn:hover {
          background: #a93226;
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(192, 57, 43, 0.35);
        }
        .lp-hero-btn:active { transform: translateY(0); }

        .lp-hero-btn-outline {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 32px;
          background: transparent;
          color: rgba(255,255,255,0.85);
          border: 1.5px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s ease;
        }
        .lp-hero-btn-outline:hover {
          border-color: rgba(255,255,255,0.5);
          color: #fff;
          background: rgba(255,255,255,0.05);
        }

        .lp-feature-card {
          background: #ffffff;
          border: 1px solid #eaeaea;
          border-radius: 14px;
          padding: 32px 26px;
          transition: all 0.3s ease;
          position: relative;
        }
        .lp-feature-card:hover {
          border-color: #ddd;
          transform: translateY(-3px);
          box-shadow: 0 8px 30px rgba(0,0,0,0.06);
        }
        .lp-feature-card:hover .lp-feature-icon {
          color: #c0392b;
          background: rgba(192,57,43,0.08);
        }

        .lp-feature-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: #f5f5f5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          color: #666;
          transition: all 0.3s ease;
          margin-bottom: 20px;
        }

        .lp-stat-item {
          text-align: center;
          padding: 0 36px;
          position: relative;
        }
        .lp-stat-item:not(:last-child)::after {
          content: '';
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 1px;
          height: 36px;
          background: rgba(255,255,255,0.12);
        }

        .lp-nav-login {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 20px;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.85);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.25s ease;
          letter-spacing: 0.01em;
        }
        .lp-nav-login:hover {
          color: #fff;
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.25);
        }

        .lp-lang-select .ant-select-selector {
          background: rgba(255,255,255,0.08) !important;
          border: 1px solid rgba(255,255,255,0.12) !important;
          border-radius: 6px !important;
          color: rgba(255,255,255,0.85) !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 13px !important;
          height: 35px !important;
          display: flex !important;
          align-items: center !important;
          transition: all 0.25s ease !important;
          padding: 0 12px !important;
        }
        .lp-lang-select:hover .ant-select-selector {
          background: rgba(255,255,255,0.12) !important;
          border-color: rgba(255,255,255,0.25) !important;
          color: #fff !important;
        }
        .lp-lang-select .ant-select-selection-item {
          line-height: 33px !important;
          font-weight: 500 !important;
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          color: #fff !important;
        }
        .lp-lang-select:hover .ant-select-selection-item {
          color: #fff !important;
        }
        .lp-lang-select .ant-select-arrow {
          color: rgba(255,255,255,0.6) !important;
          font-size: 10px !important;
        }
        .lp-lang-select .ant-select-selection-item .anticon {
          color: rgba(255,255,255,0.85) !important;
        }
        .lp-lang-select:hover .ant-select-selection-item .anticon {
          color: #fff !important;
        }

        /* Dropdown styles */
        .lp-lang-popup {
          background-color: #2c2c2c !important;
          padding: 4px !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 8px !important;
        }
        .lp-lang-popup .ant-select-item {
          color: rgba(255,255,255,0.7) !important;
          border-radius: 4px !important;
          transition: all 0.2s ease !important;
        }
        .lp-lang-popup .ant-select-item-option-active {
          background-color: rgba(255,255,255,0.08) !important;
          color: #fff !important;
        }
        .lp-lang-popup .ant-select-item-option-selected {
          background-color: rgba(192,57,43,0.2) !important;
          color: #e74c3c !important;
          font-weight: 600 !important;
        }

        @media (max-width: 768px) {
          .lp-features-grid {
            grid-template-columns: 1fr !important;
          }
          .lp-stats-row {
            flex-direction: column !important;
            gap: 20px !important;
          }
          .lp-stat-item::after {
            display: none !important;
          }
          .lp-stat-item {
            padding: 0 !important;
          }
          .lp-hero-title {
            font-size: 36px !important;
          }
          .lp-hero-subtitle {
            font-size: 15px !important;
          }
          .lp-nav {
            padding: 14px 20px !important;
          }
          .lp-hero-actions {
            flex-direction: column !important;
          }
        }
        @media (max-width: 480px) {
          .lp-hero-title {
            font-size: 30px !important;
          }
        }
      `}</style>

      {/* ── Dark Hero (compact) ── */}
      <div style={{
        background: 'linear-gradient(165deg, #1a1a1a 0%, #2c2c2c 60%, #3a2020 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle grid */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          pointerEvents: 'none',
        }} />

        {/* Red glow */}
        <div style={{
          position: 'absolute',
          top: '-30%',
          right: '-15%',
          width: '500px',
          height: '500px',
          background: 'radial-gradient(circle, rgba(192,57,43,0.1) 0%, transparent 65%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />

        {/* Navigation */}
        <nav
          className="lp-nav"
          style={{
            position: 'relative',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 48px',
            animation: 'lp-fadeIn 0.6s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/iku-logo.png" alt="IKU" style={{ width: 30, height: 30, objectFit: 'contain' }} />
            <span style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 17,
              color: '#fff',
            }}>
              {t('landing.nav.brand')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Dropdown
              menu={{
                items: [
                  { key: 'en', label: 'EN' },
                  { key: 'tr', label: 'TR' },
                ],
                onClick: ({ key }) => changeLanguage(key),
                selectable: true,
                defaultSelectedKeys: [i18n.language.split('-')[0]],
              }}
              trigger={['click']}
              overlayClassName="lp-lang-popup"
            >
              <button className="lp-nav-login" style={{ minWidth: 70, justifyContent: 'space-between' }}>
                <span style={{ textTransform: 'uppercase' }}>{i18n.language.split('-')[0]}</span>
                <LangIcon style={{ fontSize: 13 }} />
              </button>
            </Dropdown>
            <button className="lp-nav-login" onClick={() => navigate('/login')}>
              <LoginOutlined />
              {t('landing.nav.signIn')}
            </button>
          </div>
        </nav>

        {/* Hero Content */}
        <section style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '120px 24px 160px',
          minHeight: 'calc(100vh - 72px)',
        }}>
          <div style={{ animation: 'lp-fadeUp 0.7s ease-out' }}>
            <img
              src="/iku-logo.png"
              alt="Istanbul Kultur University"
              style={{
                width: 72,
                height: 72,
                objectFit: 'contain',
                marginBottom: 24,
                filter: 'drop-shadow(0 2px 16px rgba(192,57,43,0.25))',
              }}
            />
          </div>

          <div style={{ animation: 'lp-fadeUp 0.7s ease-out 0.1s both' }}>
            <div style={{
              display: 'inline-block',
              padding: '5px 14px',
              background: 'rgba(192,57,43,0.1)',
              border: '1px solid rgba(192,57,43,0.2)',
              borderRadius: 16,
              marginBottom: 24,
            }}>
              <span style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: 600,
                color: '#e74c3c',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {t('landing.hero.badge')}
              </span>
            </div>
          </div>

          <h1
            className="lp-hero-title"
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 64,
              fontWeight: 400,
              color: '#ffffff',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              maxWidth: 800,
              margin: '0 auto 24px',
              animation: 'lp-fadeUp 0.7s ease-out 0.2s both',
            }}
          >
            {t('landing.hero.title')}{' '}
            <span style={{ color: '#e74c3c', fontStyle: 'italic' }}>{t('landing.hero.titleHighlight')}</span>{' '}
            {t('landing.hero.titleEnd')}
          </h1>

          <p
            className="lp-hero-subtitle"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 18,
              color: 'rgba(255,255,255,0.5)',
              lineHeight: 1.6,
              maxWidth: 560,
              margin: '0 auto 48px',
              fontWeight: 400,
              animation: 'lp-fadeUp 0.7s ease-out 0.3s both',
            }}
          >
            {t('landing.hero.subtitle')}
          </p>

          <div
            className="lp-hero-actions"
            style={{
              display: 'flex',
              gap: 14,
              animation: 'lp-fadeUp 0.7s ease-out 0.4s both',
            }}
          >
            <button className="lp-hero-btn" onClick={() => navigate('/login')}>
              {t('landing.hero.cta')}
              <ArrowRightOutlined style={{ fontSize: 13 }} />
            </button>
          </div>
        </section>
      </div>

      {/* ── Features Section (Light) ── */}
      <section style={{
        padding: '80px 24px',
        maxWidth: 1060,
        margin: '0 auto',
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: 56,
          animation: 'lp-fadeUp 0.6s ease-out 0.6s both',
        }}>
          <h2 style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: 32,
            fontWeight: 400,
            color: '#1a1a1a',
            letterSpacing: '-0.01em',
            marginBottom: 12,
          }}>
            {t('landing.features.sectionTitle')}
          </h2>
          <div style={{
            width: 48,
            height: 2,
            background: '#c0392b',
            margin: '0 auto 16px',
            borderRadius: 1,
            animation: 'lp-accentSlide 0.6s ease-out 0.8s both',
          }} />
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            color: '#888',
            maxWidth: 460,
            margin: '0 auto',
            lineHeight: 1.7,
          }}>
            {t('landing.features.sectionSubtitle')}
          </p>
        </div>

        <div
          className="lp-features-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 18,
          }}
        >
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="lp-feature-card"
              style={{
                animation: `lp-fadeUp 0.5s ease-out ${0.7 + i * 0.08}s both`,
              }}
            >
              <div className="lp-feature-icon">
                {f.icon}
              </div>
              <h3 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 15,
                fontWeight: 600,
                color: '#1a1a1a',
                marginBottom: 8,
              }}>
                {f.title}
              </h3>
              <p style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                color: '#888',
                lineHeight: 1.7,
                margin: 0,
              }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section style={{
        padding: '56px 24px',
        textAlign: 'center',
        background: '#fff',
        borderTop: '1px solid #eee',
      }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: 26,
          fontWeight: 400,
          color: '#1a1a1a',
          marginBottom: 10,
        }}>
          {t('landing.cta.title')}
        </h2>
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 14,
          color: '#999',
          marginBottom: 28,
        }}>
          {t('landing.cta.subtitle')}
        </p>
        <button className="lp-hero-btn" onClick={() => navigate('/login')}>
          {t('landing.cta.button')}
          <ArrowRightOutlined style={{ fontSize: 13 }} />
        </button>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        padding: '24px 48px',
        background: '#f7f7f8',
        borderTop: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src="/iku-logo.png"
            alt="IKU"
            style={{ width: 18, height: 18, objectFit: 'contain', opacity: 0.4 }}
          />
          <span style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            color: '#aaa',
          }}>
            {t('landing.footer.dept')}
          </span>
        </div>
        <span style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          color: '#ccc',
        }}>
          {t('landing.footer.system')}
        </span>
      </footer>
    </div>
  );
}
