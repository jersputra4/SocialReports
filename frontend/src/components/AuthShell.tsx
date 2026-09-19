import { PropsWithChildren, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Kerangka halaman untuk alur masuk, daftar, dan pemulihan akun. */
export function AuthShell({
  title,
  description,
  footer,
  children,
}: PropsWithChildren<{ title: string; description?: string; footer?: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Panel penjelas: menegaskan batas sistem sejak halaman pertama. */}
      <aside className="hidden bg-accent-900 px-10 py-12 text-white lg:flex lg:w-[44%] lg:flex-col lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-accent-200">Sistem Pelaporan</p>
          <h1 className="mt-3 max-w-md text-3xl font-semibold leading-tight">
            Membuat, mendokumentasikan, dan memantau laporan konten media sosial.
          </h1>
          <p className="mt-5 max-w-md text-accent-100">
            Sistem ini hanya membuat dan mengelola laporan. Penurunan konten atau akun
            sepenuhnya menjadi keputusan platform terkait.
          </p>
        </div>

        <dl className="mt-10 grid max-w-md gap-5 text-sm">
          <div>
            <dt className="font-semibold">Dokumentasi yang dibekukan</dt>
            <dd className="text-accent-100">
              Harga, kebijakan platform, dan dasar hukum disalin saat report dibuat, lalu
              dikunci — perubahan aturan di kemudian hari tidak mengubah isi report Anda.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Bukti pengerjaan</dt>
            <dd className="text-accent-100">
              Setelah dilaporkan, admin mengunggah tangkapan layar sebagai bukti. Anda dapat
              melihatnya langsung di detail report.
            </dd>
          </div>
        </dl>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 block text-sm font-semibold lg:hidden">
            Sistem Pelaporan Konten
          </Link>

          <h2 className="text-2xl font-semibold">{title}</h2>
          {description && <p className="mt-2 text-sm text-ink-secondary">{description}</p>}

          <div className="mt-6">{children}</div>

          {footer && <div className="mt-6 text-sm text-ink-secondary">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
