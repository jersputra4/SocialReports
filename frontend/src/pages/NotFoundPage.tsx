import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Halaman tidak ditemukan</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Alamat yang Anda buka tidak ada, atau report yang dimaksud bukan milik akun Anda.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/" className="btn-primary">
            Ke halaman utama
          </Link>
          <Link to="/report" className="btn-secondary">
            Lihat report saya
          </Link>
        </div>
      </div>
    </div>
  );
}
