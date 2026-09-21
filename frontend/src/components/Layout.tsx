import { PropsWithChildren, ReactNode, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Button } from './ui';

interface NavItem {
  to: string;
  label: string;
  glyph: string;
  permission?: string;
  staffOnly?: boolean;
}

const USER_NAV: NavItem[] = [
  { to: '/', label: 'Ringkasan', glyph: '◈' },
  { to: '/report', label: 'Report saya', glyph: '▤' },
  { to: '/report/baru', label: 'Buat report', glyph: '＋' },
  { to: '/panduan', label: 'Panduan', glyph: '?' },
  { to: '/pengaturan', label: 'Pengaturan', glyph: '⚙' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dasbor admin', glyph: '◈', permission: 'report.review' },
  { to: '/admin/report', label: 'Semua report', glyph: '▤', permission: 'report.review' },
  { to: '/admin/pembayaran', label: 'Pembayaran', glyph: '₪', permission: 'payment.verify' },
  { to: '/admin/notifikasi', label: 'Notifikasi', glyph: '✉', permission: 'notification.manage' },
  { to: '/admin/harga', label: 'Harga & PPN', glyph: '％', permission: 'pricing.manage' },
  { to: '/admin/audit', label: 'Audit log', glyph: '⛨', permission: 'audit.read' },
];

function NavSection({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  onNavigate: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/' || item.to === '/admin'}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent-600 font-semibold text-white'
                    : 'text-ink-secondary hover:bg-plane hover:text-ink'
                }`
              }
            >
              <span aria-hidden className="w-4 text-center">
                {item.glyph}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Layout({ children }: PropsWithChildren) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const adminItems = ADMIN_NAV.filter((item) => !item.permission || can(item.permission));

  const handleLogout = async () => {
    await logout();
    navigate('/masuk');
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Navigasi samping — menjadi laci pada layar kecil. */}
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Lewati ke konten
      </a>

      <header className="flex items-center justify-between border-b border-hairline bg-surface px-4 py-3 lg:hidden no-print">
        <Link to="/" className="font-semibold">
          Pelaporan Konten
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-lg border border-baseline px-3 py-1.5 text-sm"
          aria-expanded={menuOpen}
          aria-controls="navigasi-utama"
        >
          {menuOpen ? 'Tutup' : 'Menu'}
        </button>
      </header>

      <nav
        id="navigasi-utama"
        className={`${
          menuOpen ? 'block' : 'hidden'
        } border-b border-hairline bg-surface px-3 py-4 lg:block lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:min-h-screen no-print`}
      >
        <div className="hidden px-3 pb-6 lg:block">
          <Link to="/" className="text-base font-semibold leading-tight">
            Sistem Pelaporan
            <span className="block text-ink-secondary">Konten Media Sosial</span>
          </Link>
        </div>

        <NavSection title="Pengguna" items={USER_NAV} onNavigate={() => setMenuOpen(false)} />
        <NavSection title="Operasional" items={adminItems} onNavigate={() => setMenuOpen(false)} />

        {import.meta.env.DEV && (
          <NavSection
            title="Pengembangan"
            items={[{ to: '/dev/mailbox', label: 'Kotak masuk lokal', glyph: '✉' }]}
            onNavigate={() => setMenuOpen(false)}
          />
        )}

        <div className="mt-auto border-t border-hairline px-3 pt-4">
          <p className="truncate text-sm font-medium">{user?.fullName}</p>
          <p className="truncate text-xs text-ink-muted">{user?.email}</p>
          <p className="mt-1 text-xs text-ink-muted">Peran: {user?.role}</p>
          <Button onClick={handleLogout} className="mt-3 w-full">
            Keluar
          </Button>
        </div>
      </nav>

      <main id="konten" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {user?.mustChangePassword && location.pathname !== '/pengaturan' && (
          <div className="mb-6">
            <Alert tone="warning" title="Kata sandi perlu diganti">
              <p>
                Akun ini dibuat dengan kata sandi sementara.{' '}
                <Link to="/pengaturan" className="font-medium underline">
                  Ganti sekarang
                </Link>{' '}
                sebelum melanjutkan.
              </p>
            </Alert>
          </div>
        )}
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}
