import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, Spin } from 'antd';
import enUS from 'antd/locale/en_US';
import trTR from 'antd/locale/tr_TR';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import UniversityListPage from './pages/UniversityListPage';
import UniversityDetailPage from './pages/UniversityDetailPage';
import CourseListPage from './pages/CourseListPage';
import UploadPage from './pages/UploadPage';
import MatchingPage from './pages/MatchingPage2';
import MatchJobResultsPage from './pages/MatchJobResultsPage';
import AdminPanel from './pages/AdminPanel';
import DeptSelection from './pages/DeptSelection';
import CATSLinkPage from './pages/CATSLinkPage';
import StudentHomePage from './pages/StudentHomePage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import StudentCourseSelectionPage from './pages/StudentCourseSelectionPage';
import CoordinatorDashboardPage from './pages/CoordinatorDashboardPage';
import CoordinatorReviewPage from './pages/CoordinatorReviewPage';
import CoordinatorManualReviewPage from './pages/CoordinatorManualReviewPage';
import PartnerUniversitiesPage from './pages/PartnerUniversitiesPage';
import PartnerUniversityInfoPage from './pages/PartnerUniversityInfoPage';
import UniversityInfoPage from './pages/UniversityInfoPage';
import GradeConversionPage from './pages/GradeConversionPage';
import TranscriptsPage from './pages/TranscriptsPage';
import StudentTranscriptsPage from './pages/StudentTranscriptsPage';
import StudentTranscriptDetail from './pages/StudentTranscriptDetail';
import SenateDecisionsPage from './pages/SenateDecisionsPage';
import UploadTransferFormPage from './pages/UploadTransferFormPage';
import AccountDeactivatedPage from './pages/AccountDeactivatedPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
});

const appTheme = {
  token: {
    colorPrimary: '#c0392b',
    colorLink: '#c0392b',
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f0f0f0',
    borderRadius: 6,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  components: {
    Layout: {
      siderBg: '#2c2c2c',
      headerBg: '#ffffff',
    },
    Menu: {
      darkItemBg: '#2c2c2c',
      darkItemSelectedBg: '#c0392b',
      darkItemHoverBg: '#444444',
    },
  },
};

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f0f0',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  const hasNoDepartment = user.roles.some((r: any) => r.role === 'student' && !r.department_code);
  const isStudentOnly = user.roles.every((r: any) => r.role === 'student');
  const isRegistrarOnly = user.roles.some((r: any) => r.role === 'registrar')
    && !user.roles.some((r: any) => ['coordinator', 'dept_admin', 'super_admin'].includes(r.role));
  const isFacultyAffairsAdmin = user.roles.some((r: any) => r.role === 'faculty_affairs_admin')
    && !user.roles.some((r: any) => ['coordinator', 'dept_admin', 'super_admin'].includes(r.role));

  if (hasNoDepartment) {
    return (
      <Routes>
        <Route path="/select-department" element={<DeptSelection />} />
        <Route path="*" element={<Navigate to="/select-department" replace />} />
      </Routes>
    );
  }

  // Students see the application pages
  if (isStudentOnly) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<StudentDashboardPage />} />
          <Route path="/applications/:id" element={<StudentCourseSelectionPage />} />
          <Route path="/partner-universities" element={<PartnerUniversitiesPage />} />
          <Route path="/partner-universities/:uniId" element={<PartnerUniversitiesPage />} />
          <Route path="/partner-universities/:uniId/info" element={<PartnerUniversityInfoPage />} />
          <Route path="/student-transcripts" element={<StudentTranscriptsPage />} />
          <Route path="/student-transcripts/:id" element={<StudentTranscriptDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Registrar and faculty_affairs_admin users see transcript, grading, senate, and admin views
  if (isRegistrarOnly || isFacultyAffairsAdmin) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/transcripts" element={<TranscriptsPage />} />
          <Route path="/transcripts/:id" element={<TranscriptsPage />} />
          <Route path="/grade-conversion" element={<GradeConversionPage />} />
          <Route path="/senate-decisions" element={<SenateDecisionsPage />} />
          <Route path="/upload-transfer-form" element={<UploadTransferFormPage />} />
          <Route path="/upload-transfer-form/:id" element={<UploadTransferFormPage />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Route>
        <Route path="*" element={<Navigate to="/transcripts" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<UniversityListPage />} />
        <Route path="/universities/:id" element={<UniversityDetailPage />} />
        <Route path="/courses" element={<CourseListPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/matching" element={<MatchingPage />} />
        <Route path="/matching/:jobId/results" element={<MatchJobResultsPage />} />
        <Route path="/coordinator" element={<CoordinatorDashboardPage />} />
        <Route path="/coordinator/applications/:id" element={<CoordinatorReviewPage />} />
        <Route path="/coordinator/manual-review/:selectionId" element={<CoordinatorManualReviewPage />} />
        <Route path="/university-info" element={<UniversityInfoPage />} />
        <Route path="/grade-conversion" element={<GradeConversionPage />} />
        <Route path="/transcripts" element={<TranscriptsPage />} />
        <Route path="/transcripts/:id" element={<TranscriptsPage />} />
        <Route path="/senate-decisions" element={<SenateDecisionsPage />} />
        <Route path="/upload-transfer-form" element={<UploadTransferFormPage />} />
        <Route path="/upload-transfer-form/:id" element={<UploadTransferFormPage />} />
        {user.is_admin && <Route path="/admin" element={<AdminPanel />} />}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f0f0',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <ProtectedRoutes /> : <LandingPage />}
      />
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/link-cats" element={<CATSLinkPage />} />
      <Route path="/account-deactivated" element={<AccountDeactivatedPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}


export default function App() {
  const { i18n } = useTranslation();
  const antdLocale = useMemo(() => (i18n.language?.startsWith('tr') ? trTR : enUS), [i18n.language]);

  return (
    <ConfigProvider theme={appTheme} locale={antdLocale}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
