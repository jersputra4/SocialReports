import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, LoadingBlock } from '../components/ui';
import { useApiQuery } from '../hooks/useApi';

/**
 * Panduan pelapor.
 *
 * Halaman publik, sengaja dapat dibaca sebelum seseorang mendaftar. Panduan
 * paling berguna justru pada saat itu — ketika orang masih menimbang apakah
 * kasusnya punya dasar hukum sama sekali.
 *
 * Daftar pasal TIDAK ditulis ulang di dalam berkas ini. Ia ditarik dari
 * katalog hukum milik sistem, yaitu sumber yang sama dengan yang dipakai
 * pelapor saat memilih dasar hukum dan yang dipakai gerbang kelayakan saat
 * menilai laporan. Dengan begitu panduan tidak mungkin menyimpang dari
 * aturan yang benar-benar berlaku di dalam sistem: ketika admin memperbarui
 * teks pasal, halaman ini ikut berubah tanpa disentuh.
 */

interface LawOption {
  lawId: string;
  name: string;
  shortName: string | null;
  versionId: string;
  version: string;
}

interface ArticleOption {
  articleId: string;
  number: string;
  title: string | null;
  paragraphs: Array<{ paragraphId: string; number: string; text: string }>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </section>
  );
}

export default function GuidePage() {
  const laws = useApiQuery<LawOption[]>('/legal/laws');
  const firstLaw = laws.data?.[0] ?? null;

  const articles = useApiQuery<ArticleOption[]>(
    firstLaw ? `/legal/versions/${firstLaw.versionId}/articles` : null,
    [firstLaw?.versionId],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header>
        <h1 className="text-3xl font-semibold text-ink">Panduan pelapor</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Apa yang perlu Anda siapkan sebelum melaporkan konten, dan apa yang terjadi sesudahnya.
        </p>
      </header>

      <Alert tone="info" title="Yang kami kerjakan, dan yang tidak">
        <p>
          Kami menyusun laporan Anda menjadi berkas aduan yang layak diperiksa, lalu
          meneruskannya ke kanal resmi bila memenuhi syarat. Kami{' '}
          <strong>tidak menjanjikan konten akan dihapus</strong> — keputusan itu ada pada
          platform dan pemerintah, bukan pada kami. Yang Anda bayar adalah pekerjaan
          penyusunan dan penerusan laporan.
        </p>
      </Alert>

      <Section title="Lima langkah membuat laporan">
        <p>
          <strong>Satu, target dan paket.</strong> Tempelkan tautan konten atau akun yang
          dilaporkan, pilih paket, lalu tuliskan kronologi kejadian minimal lima puluh
          karakter. Sistem akan menyimpan cuplikan halaman itu sebagai bukti keadaannya
          saat dilaporkan — penting, karena konten bisa dihapus atau disunting kemudian.
        </p>
        <p>
          <strong>Dua, kebijakan platform.</strong> Pilih ketentuan platform mana yang
          menurut Anda dilanggar.
        </p>
        <p>
          <strong>Tiga, dasar hukum.</strong> Pilih pasal yang relevan dari daftar di bawah.
        </p>
        <p>
          <strong>Empat, bukti.</strong> Unggah tangkapan layar dan berkas pendukung,
          masing-masing paling besar lima megabita.
        </p>
        <p>
          <strong>Lima, pembayaran.</strong> Setelah dibayar, laporan masuk antrean tinjau
          dan seluruh datanya dibekukan.
        </p>
      </Section>

      <Section title="Bukti seperti apa yang kuat">
        <p>
          Tangkapan layar yang <strong>memperlihatkan tautan atau nama akun</strong> jauh
          lebih berguna daripada potongan gambar tanpa konteks. Peninjau perlu melihat di
          mana konten itu berada, bukan hanya apa isinya.
        </p>
        <p>
          <strong>Sertakan tanggal dan waktu</strong> bila terlihat di layar. Ini membantu
          menunjukkan kapan konten muncul dan berapa lama bertahan.
        </p>
        <p>
          <strong>Rekam percakapan secara utuh</strong>, bukan satu balasan saja. Kalimat
          yang dipotong dari konteksnya sering berubah artinya, dan peninjau akan
          menanyakannya.
        </p>
        <p>
          <strong>Jangan menyunting gambar.</strong> Menambahkan tanda panah atau lingkaran
          membuat bukti kehilangan nilainya. Kalau perlu menunjuk sesuatu, jelaskan di
          kolom kronologi.
        </p>
        <p>
          <strong>Tulis kronologi seperti bercerita kepada orang yang belum tahu apa-apa.</strong>{' '}
          Siapa, kapan, di mana, dan mengapa hal itu merugikan Anda. Kronologi yang jelas
          adalah bagian yang paling sering menentukan diterima atau tidaknya laporan.
        </p>
      </Section>

      <Section title="Dasar hukum yang tersedia">
        <p>
          Daftar ini diambil langsung dari katalog hukum yang dipakai sistem, jadi isinya
          sama persis dengan yang akan Anda pilih saat membuat laporan.
        </p>

        {laws.loading && <LoadingBlock label="Memuat daftar pasal…" />}

        {firstLaw && (
          <p className="text-xs text-ink-muted">
            {firstLaw.name} — versi {firstLaw.version}
          </p>
        )}

        {articles.data && articles.data.length > 0 && (
          <div className="mt-3 space-y-3">
            {articles.data.map((article) => (
              <Card key={article.articleId} title={`Pasal ${article.number}`}>
                {article.title && (
                  <p className="mb-2 text-sm font-medium text-ink">{article.title}</p>
                )}
                <ul className="space-y-2">
                  {article.paragraphs.map((paragraph) => (
                    <li key={paragraph.paragraphId} className="text-sm text-ink-secondary">
                      <span className="font-medium text-ink">Ayat ({paragraph.number}): </span>
                      {paragraph.text}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}

        {articles.data && articles.data.length === 0 && (
          <p className="text-ink-muted">Katalog pasal belum diisi.</p>
        )}
      </Section>

      <Section title="Apa yang terjadi setelah laporan dikirim">
        <p>
          Laporan masuk antrean tinjau. Seorang peninjau memeriksa apakah buktinya memadai
          dan dasar hukumnya tepat, lalu menyetujui, menolak, atau mengembalikannya untuk
          diperbaiki. Setiap keputusan disertai alasan tertulis yang dapat Anda baca.
        </p>
        <p>
          Laporan yang disetujui dan memenuhi syarat diteruskan ke kanal resmi dalam bentuk
          surat beserta lampiran bukti. Anda dapat melihat perubahan statusnya kapan saja di
          halaman report Anda.
        </p>
        <p>
          Laporan yang dikembalikan bukan berarti ditolak. Biasanya ada satu hal yang perlu
          dilengkapi — bukti tambahan, atau kronologi yang perlu diperjelas.
        </p>
      </Section>

      <Section title="Sebelum Anda melapor">
        <p>
          Melaporkan orang lain dengan tuduhan yang tidak berdasar dapat berbalik menjadi
          masalah hukum bagi pelapor. Laporkan apa yang benar-benar Anda alami dan dapat
          Anda buktikan.
        </p>
        <p className="text-xs text-ink-muted">
          Halaman ini disusun untuk membantu Anda menyiapkan laporan, dan{' '}
          <strong>bukan nasihat hukum</strong>. Penentuan pasal yang berlaku atas suatu
          perbuatan ada pada penegak hukum. Untuk kasus yang serius, pertimbangkan
          berkonsultasi dengan advokat atau lembaga bantuan hukum.
        </p>
      </Section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link to="/daftar" className="btn-primary">
          Buat akun
        </Link>
        <Link to="/masuk" className="btn-ghost">
          Masuk
        </Link>
      </div>
    </div>
  );
}
