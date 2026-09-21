import { useLocation } from 'react-router-dom';

/**
 * Tombol hubungi kami lewat WhatsApp.
 *
 * Murni tautan `wa.me` yang dibuka di tab baru — tidak ada permintaan ke
 * backend, tidak ada kredensial, tidak ada data pengguna yang dikirim ke pihak
 * mana pun. Nomor tujuan berasal dari `VITE_WHATSAPP_NUMBER`.
 *
 * Nomor itu ikut terbakar ke dalam bundel JavaScript saat build, jadi ia dapat
 * dibaca siapa saja yang membuka situs. Untuk nomor layanan pelanggan hal itu
 * memang tujuannya. Jangan pernah menaruh nomor pribadi di sini.
 *
 * Tombol tidak ditampilkan di panel admin. Admin bukan pelanggan, dan tombol
 * mengambang di layar kerja hanya menutupi isi tabel.
 */

/** Nomor internasional tanpa tanda plus, mis. 6281234567890. */
const NOMOR = import.meta.env.VITE_WHATSAPP_NUMBER ?? '';

const PESAN_BAWAAN = 'Halo, saya ingin bertanya tentang layanan pelaporan konten.';

export default function ContactWhatsApp() {
  const { pathname } = useLocation();

  // Tanpa nomor, tombol tidak punya tujuan. Lebih baik tidak muncul sama
  // sekali daripada muncul lalu membuka tautan yang rusak.
  if (!NOMOR) return null;
  if (pathname.startsWith('/admin')) return null;

  const pesan = import.meta.env.VITE_WHATSAPP_MESSAGE ?? PESAN_BAWAAN;
  const url = `https://wa.me/${NOMOR}?text=${encodeURIComponent(pesan)}`;

  return (
    <a
      href={url}
      target="_blank"
      // `noopener` mencegah halaman tujuan mengakses `window.opener` milik
      // situs ini; `noreferrer` menahan pengiriman alamat halaman asal.
      rel="noopener noreferrer"
      aria-label="Hubungi kami lewat WhatsApp"
      title="Hubungi kami lewat WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.38-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.07-.13-.27-.2-.57-.35z" />
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02h-.01c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.23 8.22z" />
      </svg>
      Hubungi kami
    </a>
  );
}
