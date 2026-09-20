import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';

export interface StoredObject {
  path: string;
  size: number;
  contentType: string;
}

/**
 * Object storage untuk evidence, bukti pengerjaan, dan PDF.
 *
 * Bucket bersifat privat. Berkas tidak pernah dilayani langsung; akses selalu
 * lewat signed URL berumur pendek yang dibuat setelah backend memeriksa
 * kepemilikan objek (BRD 4.5, AC-29).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  /**
   * Klien kedua, dipakai HANYA untuk menandatangani URL unduh.
   *
   * Klien utama menunjuk alamat internal (`http://minio:9000`) karena itu yang
   * dapat dijangkau dari dalam jaringan Docker. Peramban tidak dapat
   * meresolusi nama itu. Tanda tangan SigV4 mencakup host, jadi URL tidak bisa
   * sekadar ditulis ulang setelah dibuat — ia harus ditandatangani sejak awal
   * memakai alamat publik.
   *
   * Bila `S3_PUBLIC_ENDPOINT` tidak diisi, nilainya sama dengan `S3_ENDPOINT`
   * dan klien ini berperilaku persis seperti klien utama.
   */
  private readonly signingClient: S3Client;
  private readonly bucket: string;
  private readonly ttlSeconds: number;
  private readonly serverSideEncryption: string | undefined;

  constructor(@Inject(CONFIG_TOKEN) config: AppConfig) {
    this.bucket = config.storage.bucket;
    this.ttlSeconds = config.storage.signedUrlTtlSeconds;
    this.serverSideEncryption = config.storage.serverSideEncryption;

    const common = {
      region: config.storage.region,
      forcePathStyle: config.storage.forcePathStyle,
      credentials: {
        accessKeyId: config.storage.accessKey,
        secretAccessKey: config.storage.secretKey,
      },
    };

    this.client = new S3Client({ ...common, endpoint: config.storage.endpoint });
    this.signingClient =
      config.storage.publicEndpoint === config.storage.endpoint
        ? this.client
        : new S3Client({ ...common, endpoint: config.storage.publicEndpoint });
  }

  async put(path: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: body,
        ContentType: contentType,
        // Header enkripsi hanya dikirim bila dikonfigurasi. MinIO menolaknya
        // dengan `NotImplemented` selama KMS belum aktif, dan penolakan itu
        // menggagalkan seluruh unggahan. Lihat catatan pada `S3_SSE`.
        ServerSideEncryption: this.serverSideEncryption,
        // Mencegah peramban menebak-nebak jenis berkas.
        ContentDisposition: 'attachment',
      }),
    );

    return { path, size: body.byteLength, contentType };
  }

  /**
   * URL unduh sementara. Umurnya dibatasi 120 detik oleh konfigurasi, dan
   * pemanggil wajib sudah memeriksa hak akses sebelum memanggil metode ini.
   */
  async signedDownloadUrl(path: string, downloadName?: string): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: path,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName.replace(/"/g, '')}"`
        : undefined,
    });

    const url = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.ttlSeconds,
    });
    return { url, expiresInSeconds: this.ttlSeconds };
  }

  async get(path: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: path }),
    );
    // AWS SDK v3 membungkus body dengan helper transformToByteArray, yang
    // menghabiskan stream sekaligus tanpa perlu menebak tipe tiap chunk.
    const body = result.Body as unknown as {
      transformToByteArray: () => Promise<Uint8Array>;
    };
    return Buffer.from(await body.transformToByteArray());
  }

  /**
   * Dipakai hanya untuk membersihkan berkas yang gagal lolos pemindaian
   * sebelum tercatat di database. Evidence dan bukti yang sudah tercatat tidak
   * pernah dihapus (BRD 8.2 — pembatalan memakai void).
   */
  async remove(path: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: path }))
      .catch((error) => this.logger.warn(`Gagal menghapus ${path}: ${(error as Error).message}`));
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  static evidencePath(reportId: string, evidenceId: string, extension: string): string {
    return `evidence/${reportId}/${evidenceId}.${extension}`;
  }

  /** BRD 8.2: proofs/{report_id}/{proof_id}.{ext} */
  static proofPath(reportId: string, proofId: string, extension: string): string {
    return `proofs/${reportId}/${proofId}.${extension}`;
  }

  static documentPath(reportId: string, documentId: string): string {
    return `documents/${reportId}/${documentId}.pdf`;
  }

  static auditCheckpointPath(date: string): string {
    return `audit-checkpoints/${date}.json`;
  }
}
