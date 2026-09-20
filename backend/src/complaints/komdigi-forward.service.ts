import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { sha256Hex } from '../common/utils/crypto.util';
import { DocumentsService } from '../documents/documents.service';
import { MailerService } from '../mailer/mailer.service';
import { MailAttachment } from '../mailer/mail-attachments';
import { OutboxEventType, OutboxService } from '../notifications/outbox.service';
import { ReportTransitionService } from '../reports/report-transition.service';
import { StorageService } from '../storage/storage.service';
import {
  EligibilityResult,
  KOMDIGI_CHANNEL,
  evaluateKomdigiEligibility,
} from './komdigi-eligibility';
import {
  ReportRow,
  SenderIdentity,
  attachableEvidences,
  formatKomdigiLetterNumber,
  toEligibilityInput,
  toLetterData,
} from './komdigi-mapper';

/** Relasi yang dibutuhkan gate dan surat, dalam satu query. */
const REPORT_INCLUDE = {
  user: { select: { fullName: true, email: true } },
  actionType: { select: { name: true } },
  targetSnapshot: { select: { originalUrl: true, canonicalUrl: true } },
  evidences: { orderBy: { createdAt: 'asc' } },
  legalBasis: {
    orderBy: { createdAt: 'asc' },
    include: {
      paragraph: {
        include: { article: { include: { legalVersion: { include: { law: true } } } } },
      },
    },
  },
} as const;

export interface ForwardPreview {
  reportCode: string;
  eligibility: EligibilityResult;
  letterNumber: string;
  attachmentCount: number;
  attachmentBytes: number;
  recipient: string;
}

/**
 * Penerusan aduan ke Komdigi.
 *
 * Urutan langkahnya dipilih supaya kegagalan yang mungkin terjadi selalu jatuh
 * ke sisi yang aman.
 *
 * Baris `complaint_submissions` dibuat berstatus PENDING SEBELUM email dikirim.
 * Kalau proses mati di antara pengiriman dan pencatatan hasil, yang tertinggal
 * adalah baris PENDING — dan indeks unik parsial dari migrasi 0008 menahan
 * percobaan berikutnya sampai seseorang memeriksanya. Urutan sebaliknya, kirim
 * dulu lalu catat, akan membuat percobaan ulang mengirim surat kedua ke
 * instansi untuk aduan yang sama. Surat ganda ke instansi jauh lebih mahal
 * daripada satu baris yang butuh diperiksa manusia.
 *
 * Pengiriman email berada DI LUAR transaksi database. Panggilan jaringan di
 * dalam transaksi akan menahan kunci baris report selama SMTP berlangsung.
 */
@Injectable()
export class KomdigiForwardService {
  private readonly logger = new Logger(KomdigiForwardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly transitions: ReportTransitionService,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
    private readonly mailer: MailerService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------- pratinjau --

  /** Hasil gate tanpa efek samping, untuk ditampilkan di panel admin. */
  async preview(reportCode: string): Promise<ForwardPreview> {
    const report = await this.loadReport(reportCode);
    const alreadyForwarded = await this.hasLiveSubmission(report.id);
    const eligibility = evaluateKomdigiEligibility(
      toEligibilityInput(this.toRow(report), alreadyForwarded),
    );

    const attachable = attachableEvidences(this.toRow(report));

    return {
      reportCode: report.reportCode,
      eligibility,
      letterNumber: formatKomdigiLetterNumber({
        reportCode: report.reportCode,
        attempt: (await this.countSubmissions(report.id)) + 1,
        date: new Date(),
      }),
      attachmentCount: attachable.length,
      attachmentBytes: attachable.reduce((sum, item) => sum + item.fileSize, 0),
      recipient: this.config.komdigi.emailTo,
    };
  }

  // -------------------------------------------------------------- kirim -----

  async forward(input: {
    reportCode: string;
    adminId: string;
    adminRole: string;
    note?: string;
  }): Promise<{ reportCode: string; status: string; letterNumber: string; messageId: string | null }> {
    this.assertConfigured();
    await this.assertDailyLimit();

    const report = await this.loadReport(input.reportCode);
    const row = this.toRow(report);

    const alreadyForwarded = await this.hasLiveSubmission(report.id);
    const eligibility = evaluateKomdigiEligibility(
      toEligibilityInput(row, alreadyForwarded),
    );
    if (!eligibility.eligible) {
      throw new ConflictException({
        message: 'Report belum memenuhi syarat penerusan ke Komdigi.',
        blockers: eligibility.blockers,
      });
    }

    const attempt = (await this.countSubmissions(report.id)) + 1;
    const letterNumber = formatKomdigiLetterNumber({
      reportCode: report.reportCode,
      attempt,
      date: new Date(),
    });

    // Langkah 1: catat niat kirim. Indeks unik parsial menolak kiriman kedua.
    const submissionId = await this.createPendingSubmission({
      reportId: report.id,
      adminId: input.adminId,
      letterNumber,
      note: input.note,
      attempt,
    });

    try {
      const letterDate = new Date();
      const letterData = toLetterData({
        report: row,
        sender: this.senderIdentity(),
        letterNumber,
        letterDate,
        citedArticles: eligibility.citedArticles,
        generatedAt: letterDate,
      });

      const letterPdf = await this.documents.renderKomdigiLetter(letterData);
      const payloadHash = sha256Hex(letterPdf);

      const attachments = await this.collectAttachments(row, letterNumber, letterPdf);

      // Langkah 2: kirim. Di luar transaksi; kegagalan ditangkap di bawah.
      const sent = await this.mailer.send(this.config.komdigi.emailTo, {
        subject: `Aduan Konten ${report.reportCode} — ${letterNumber}`,
        text: this.plainBody(letterNumber, report.reportCode, attachments.length),
        html: this.htmlBody(letterNumber, report.reportCode, attachments.length),
        attachments,
      });

      // Langkah 3: catat hasil dan pindahkan status, dalam satu transaksi.
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.complaintSubmission.update({
          where: { id: submissionId },
          data: {
            deliveryStatus: 'SENT',
            messageId: sent.messageId?.slice(0, 512) ?? null,
            payloadHash,
            lastAttemptAt: new Date(),
            lastError: null,
          },
        });

        await this.audit.record(
          {
            action: AuditAction.EXTERNAL_SUBMISSION,
            entityType: 'report',
            entityId: report.reportCode,
            actorId: input.adminId,
            actorRole: input.adminRole,
            after: {
              channel: KOMDIGI_CHANNEL,
              letterNumber,
              payloadHash,
              attachmentCount: attachments.length,
              citedArticles: eligibility.citedArticles,
            },
          },
          tx,
        );

        await this.outbox.enqueue(
          {
            eventType: OutboxEventType.COMPLAINT_SUBMITTED,
            reportId: report.id,
            reportCode: report.reportCode,
            status: report.status,
          },
          tx,
        );

        return this.transitions.transitionWithin(tx, {
          reportId: report.id,
          to: 'SUBMITTED',
          actor: 'ADMIN',
          actorId: input.adminId,
          actorRole: input.adminRole,
          extraGuards: ['COMPLAINT_SUBMISSION'],
        });
      });

      this.logger.log(
        `Aduan ${report.reportCode} diteruskan ke Komdigi sebagai ${letterNumber} ` +
          `(${attachments.length} lampiran).`,
      );

      return {
        reportCode: updated.reportCode,
        status: updated.status,
        letterNumber,
        messageId: sent.messageId,
      };
    } catch (error) {
      await this.markFailed(submissionId, error as Error);
      throw error;
    }
  }

  // ------------------------------------------------------------ pembantu ---

  private assertConfigured(): void {
    if (!this.config.komdigi.enabled) {
      throw new BadRequestException(
        'Penerusan ke Komdigi tidak aktif. Setel KOMDIGI_ENABLED=true.',
      );
    }
    if (this.config.komdigi.emailTo.trim().length === 0) {
      throw new BadRequestException(
        'Alamat tujuan Komdigi belum diisi. Setel KOMDIGI_EMAIL_TO.',
      );
    }
  }

  /**
   * Pagar kecepatan.
   *
   * Satu kesalahan pada antarmuka atau satu job yang mengulang tanpa henti
   * dapat mengirim ratusan surat ke alamat instansi dalam hitungan menit.
   * Batas harian membuat kesalahan seperti itu berhenti sendiri.
   */
  private async assertDailyLimit(): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sent = await this.prisma.complaintSubmission.count({
      where: {
        channel: KOMDIGI_CHANNEL,
        deliveryStatus: 'SENT',
        submittedAt: { gte: since },
      },
    });

    if (sent >= this.config.komdigi.dailyLimit) {
      throw new ConflictException(
        `Batas ${this.config.komdigi.dailyLimit} kiriman Komdigi per 24 jam sudah tercapai.`,
      );
    }
  }

  private async loadReport(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      include: REPORT_INCLUDE,
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');
    return report;
  }

  /** Menyempitkan hasil query Prisma ke bentuk yang dipakai modul murni. */
  private toRow(report: Awaited<ReturnType<KomdigiForwardService['loadReport']>>): ReportRow {
    return report as unknown as ReportRow;
  }

  private async hasLiveSubmission(reportId: string): Promise<boolean> {
    const live = await this.prisma.complaintSubmission.count({
      where: {
        reportId,
        channel: KOMDIGI_CHANNEL,
        deliveryStatus: { in: ['PENDING', 'SENT'] },
      },
    });
    return live > 0;
  }

  private countSubmissions(reportId: string): Promise<number> {
    return this.prisma.complaintSubmission.count({
      where: { reportId, channel: KOMDIGI_CHANNEL },
    });
  }

  private senderIdentity(): SenderIdentity {
    return {
      organizationName: this.config.komdigi.senderName,
      address: this.config.komdigi.senderAddress,
      email: this.config.komdigi.senderEmail,
      phone: this.config.komdigi.senderPhone,
    };
  }

  private async createPendingSubmission(input: {
    reportId: string;
    adminId: string;
    letterNumber: string;
    note?: string;
    attempt: number;
  }): Promise<string> {
    try {
      const created = await this.prisma.complaintSubmission.create({
        data: {
          reportId: input.reportId,
          channel: KOMDIGI_CHANNEL,
          submittedBy: input.adminId,
          submittedAt: new Date(),
          externalReference: null,
          notes: input.note,
          deliveryStatus: 'PENDING',
          attemptCount: input.attempt,
          lastAttemptAt: new Date(),
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Aduan ini sedang atau sudah diteruskan ke Komdigi.',
        );
      }
      throw error;
    }
  }

  private async markFailed(submissionId: string, error: Error): Promise<void> {
    try {
      await this.prisma.complaintSubmission.update({
        where: { id: submissionId },
        data: {
          deliveryStatus: 'FAILED',
          lastError: error.message.slice(0, 512),
          lastAttemptAt: new Date(),
        },
      });
    } catch (updateError) {
      // Kegagalan mencatat kegagalan tidak boleh menutupi galat aslinya.
      this.logger.error(
        `Gagal menandai submission ${submissionId} sebagai FAILED: ` +
          `${(updateError as Error).message}`,
      );
    }
  }

  /**
   * Menyusun lampiran: surat lebih dulu, lalu bukti yang lolos pemindaian.
   *
   * Bukti yang gagal diambil dari penyimpanan dilewati dengan catatan log,
   * bukan menggagalkan seluruh pengiriman — daftar bukti di dalam surat tetap
   * memuat nama dan hash-nya, sehingga penerima tahu ada berkas yang hilang.
   */
  private async collectAttachments(
    row: ReportRow,
    letterNumber: string,
    letterPdf: Buffer,
  ): Promise<MailAttachment[]> {
    const safeNumber = letterNumber.replace(/[^\w.-]+/g, '-');
    const attachments: MailAttachment[] = [
      {
        filename: `surat-aduan-${safeNumber}.pdf`,
        content: letterPdf,
        contentType: 'application/pdf',
      },
    ];

    let total = letterPdf.length;

    for (const evidence of attachableEvidences(row)) {
      if (total + evidence.fileSize > this.config.komdigi.maxAttachmentBytes) {
        this.logger.warn(
          `Bukti ${evidence.fileName} dilewati: melewati batas ` +
            `${this.config.komdigi.maxAttachmentBytes} byte.`,
        );
        continue;
      }

      try {
        const content = await this.storage.get(evidence.storagePath);
        attachments.push({
          filename: evidence.fileName,
          content,
          contentType: evidence.fileType,
        });
        total += content.length;
      } catch (error) {
        this.logger.warn(
          `Bukti ${evidence.fileName} tidak dapat diambil: ${(error as Error).message}`,
        );
      }
    }

    return attachments;
  }

  private plainBody(letterNumber: string, reportCode: string, attachments: number): string {
    return [
      'Dengan hormat,',
      '',
      `Terlampir surat aduan konten nomor ${letterNumber} dengan nomor acuan ${reportCode}.`,
      `Surat beserta ${attachments - 1} berkas bukti disertakan sebagai lampiran.`,
      '',
      'Uraian lengkap, dasar hukum, dan daftar bukti berikut nilai SHA-256 tiap berkas',
      'tercantum di dalam surat terlampir.',
      '',
      'Hormat kami,',
      this.config.komdigi.senderName,
    ].join('\n');
  }

  private htmlBody(letterNumber: string, reportCode: string, attachments: number): string {
    const text = this.plainBody(letterNumber, reportCode, attachments);
    return `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;
  }
}
