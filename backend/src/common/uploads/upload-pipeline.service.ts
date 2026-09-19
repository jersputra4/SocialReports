import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';
import { sha256Hex } from '../utils/crypto.util';
import { detectImage, hasDoubleExtension, sanitizeFileName } from '../utils/magic-bytes.util';
import { MalwareScanner } from './malware-scanner';

export interface ProcessedUpload {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  extension: string;
  size: number;
  sha256: string;
  scan: { clean: boolean; reason?: string };
}

/**
 * Pipeline unggahan berkas yang sama untuk evidence dan bukti pengerjaan
 * (BRD 8.2, AC-20).
 *
 * Urutannya penting:
 *   1. batas ukuran dilihat lebih dulu supaya berkas besar tidak diproses;
 *   2. jenis berkas ditentukan dari magic bytes, bukan dari nama atau
 *      content-type kiriman klien;
 *   3. gambar di-encode ulang — ini sekaligus membuang metadata EXIF/GPS dan
 *      membuang byte asing yang menempel di luar struktur gambar;
 *   4. hash SHA-256 dihitung dari hasil encode ulang, yaitu byte yang benar-
 *      benar disimpan, sehingga hash dapat dipakai membuktikan keutuhan;
 *   5. pemindaian malware dijalankan terakhir terhadap byte yang sama.
 */
@Injectable()
export class UploadPipelineService {
  private readonly logger = new Logger(UploadPipelineService.name);

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly scanner: MalwareScanner,
  ) {}

  async process(file: { originalname: string; buffer: Buffer; size: number }): Promise<ProcessedUpload> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Berkas kosong.');
    }
    if (file.buffer.length > this.config.upload.maxBytes) {
      throw new BadRequestException(
        `Ukuran berkas melebihi batas ${Math.floor(this.config.upload.maxBytes / 1024 / 1024)} MB.`,
      );
    }
    if (hasDoubleExtension(file.originalname)) {
      throw new BadRequestException(
        'Nama berkas memakai ekstensi ganda. Ganti namanya lalu unggah ulang.',
      );
    }

    const detected = detectImage(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Hanya gambar PNG, JPEG, atau WebP yang diterima. Isi berkas tidak cocok dengan jenis gambar mana pun.',
      );
    }

    const normalized = await this.reencode(file.buffer, detected.mime);

    if (normalized.length > this.config.upload.maxBytes) {
      throw new BadRequestException('Ukuran berkas melebihi batas setelah diproses.');
    }

    const scan = await this.scanner.scan(normalized, file.originalname);

    return {
      buffer: normalized,
      fileName: sanitizeFileName(file.originalname, detected.extension),
      mimeType: detected.mime,
      extension: detected.extension,
      size: normalized.length,
      sha256: sha256Hex(normalized),
      scan: scan.clean ? { clean: true } : { clean: false, reason: scan.reason },
    };
  }

  /**
   * Encode ulang gambar tanpa metadata.
   *
   * `rotate()` menerapkan orientasi EXIF lebih dulu supaya gambar tetap tegak
   * setelah metadata dibuang. sharp tidak menyalin metadata kecuali diminta,
   * jadi EXIF, GPS, dan profil lain hilang di sini (BRD 8.2, AC-20).
   */
  private async reencode(buffer: Buffer, mime: string): Promise<Buffer> {
    try {
      const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();

      switch (mime) {
        case 'image/png':
          return await pipeline.png({ compressionLevel: 9 }).toBuffer();
        case 'image/webp':
          return await pipeline.webp({ quality: 88 }).toBuffer();
        case 'image/jpeg':
        default:
          return await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      }
    } catch (error) {
      this.logger.warn(`Gambar tidak dapat diproses: ${(error as Error).message}`);
      throw new BadRequestException(
        'Gambar tidak dapat diproses. Pastikan berkasnya tidak rusak.',
      );
    }
  }
}
