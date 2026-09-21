import { PropsWithChildren } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ContactWhatsApp from './components/ContactWhatsApp';
import { Layout } from './components/Layout';
import { LoadingBlock } from './components/ui';
import { useAuth } from './context/AuthContext';

import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';

import GuidePage from './pages/GuidePage';

import DashboardPage from './pages/user/DashboardPage';
import ReportsPage from './pages/user/ReportsPage';
import NewReportPage from './pages/user/NewReportPage';
import ReportDetailPage from './pages/user/ReportDetailPage';
import PaymentPage from './pages/user/PaymentPage';
import SettingsPage from './pages/user/SettingsPage';

import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminReportsPage from './pages/admin/AdminReportsPage';
import AdminReportDetailPage from './pages/admin/AdminReportDetailPage';
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage';
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage';
import AdminPricingPage from './pages/admin/AdminPricingPage';
import AdminAuditPage from './pages/admin/AdminAuditPage';

import DevMailboxPage from './pages/DevMailboxPage';
import NotFoundPage from './pages/NotFoundPage';

function RequireAuth({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingBlock label="Memeriksa sesi…" />;
  if (!user) return <Navigate to="/masuk" state={{ from: location.pathname }} replace />;

  return <Layout>{children}</Layout>;
}

function RequirePermission({ permission, children }: PropsWithChildren<{ permission: string }>) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="card p-8 text-center">
        <p className="font-semibold">Akses ditolak</p>
        <p className="mt-1 text-sm text-ink-secondary">
          Anda tidak memiliki izin <code className="font-mono">{permission}</code> untuk membuka
          halaman ini.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function RedirectIfAuthenticated({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingBlock label="Memeriksa sesi…" />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
      {/* Halaman publik */}
      <Route
        path="/masuk"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/daftar"
        element={
          <RedirectIfAuthenticated>
            <RegisterPage />
          </RedirectIfAuthenticated>
        }
      />
        <Route path="/panduan" element={<GuidePage />} />
      <Route path="/verifikasi-email" element={<VerifyEmailPage />} />
      <Route path="/lupa-kata-sandi" element={<ForgotPasswordPage />} />
      <Route path="/atur-ulang-kata-sandi" element={<ResetPasswordPage />} />
      <Route path="/dev/mailbox" element={<DevMailboxPage />} />

      {/* Halaman pengguna */}
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/report" element={<RequireAuth><ReportsPage /></RequireAuth>} />
      <Route path="/report/baru" element={<RequireAuth><NewReportPage /></RequireAuth>} />
      <Route path="/report/:reportCode" element={<RequireAuth><ReportDetailPage /></RequireAuth>} />
      <Route path="/pembayaran/:gatewayOrderId" element={<RequireAuth><PaymentPage /></RequireAuth>} />
      <Route path="/pengaturan" element={<RequireAuth><SettingsPage /></RequireAuth>} />

      {/* Halaman operasional */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequirePermission permission="report.review">
              <AdminDashboardPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/report"
        element={
          <RequireAuth>
            <RequirePermission permission="report.review">
              <AdminReportsPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/report/:reportCode"
        element={
          <RequireAuth>
            <RequirePermission permission="report.review">
              <AdminReportDetailPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/pembayaran"
        element={
          <RequireAuth>
            <RequirePermission permission="payment.verify">
              <AdminPaymentsPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/notifikasi"
        element={
          <RequireAuth>
            <RequirePermission permission="notification.manage">
              <AdminNotificationsPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/harga"
        element={
          <RequireAuth>
            <RequirePermission permission="pricing.manage">
              <AdminPricingPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/audit"
        element={
          <RequireAuth>
            <RequirePermission permission="audit.read">
              <AdminAuditPage />
            </RequirePermission>
          </RequireAuth>
        }
      />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      {/* Di luar <Routes> supaya tampil pada setiap halaman tanpa perlu
          disisipkan satu per satu. Komponennya sendiri yang memutuskan kapan
          menyembunyikan diri. */}
      <ContactWhatsApp />
    </>
  );
}
