import { Body, Controller, Get, Header, Param, Post, StreamableFile } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthenticatedUser } from '../common/security/auth.types';
import {
  CurrentUser,
  RequirePermissions,
  RequireStepUpMfa,
} from '../common/security/decorators';
import { KomdigiForwardService } from './komdigi-forward.service';

export class ForwardToKomdigiDto {
  /**
   * Catatan internal admin, disimpan pada `complaint_submissions.notes`.
   * TIDAK ikut ke dalam surat: isi surat hanya berasal dari data report yang
   * sudah dibekukan, supaya tidak ada keterangan yang lolos tanpa jejak.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

@Controller('admin/reports/:reportCode/forward/komdigi')
export class KomdigiController {
  constructor(private readonly forward: KomdigiForwardService) {}

  /**
   * Hasil gate kelayakan tanpa efek samping.
   *
   * Dipanggil setiap kali panel admin dibuka, sehingga daftar penghalang yang
   * ditampilkan selalu berasal dari server. Tidak ada penilaian kelayakan yang
   * dikerjakan di sisi klien.
   */
  @Get('preview')
  @RequirePermissions('report.fulfill')
  preview(@Param('reportCode') reportCode: string) {
    return this.forward.preview(reportCode);
  }

  /**
   * Pratinjau surat sebagai PDF, tanpa mengirim apa pun.
   *
   * Dibuka langsung di peramban, bukan diunduh, supaya admin dapat membaca
   * surat sebelum menekan kirim. Isinya dirender dari data yang sama dengan
   * pengiriman sungguhan, termasuk pasal yang lolos gate, sehingga yang
   * terbaca di sini adalah yang benar-benar akan dikirim.
   *
   * Tidak dibatasi status `APPROVED`: surat yang sudah terkirim tetap dapat
   * dibaca ulang untuk keperluan telusur.
   */
  @Get('letter')
  @RequirePermissions('report.fulfill')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'no-store')
  async letter(@Param('reportCode') reportCode: string): Promise<StreamableFile> {
    const { buffer, letterNumber } = await this.forward.renderPreviewLetter(reportCode);
    const safeName = letterNumber.replace(/[^\w.-]+/g, '-');

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="pratinjau-${safeName}.pdf"`,
    });
  }

  /**
   * Meneruskan aduan ke Komdigi.
   *
   * Menuntut OTP ulang (step-up MFA) seperti perubahan harga dan pembatalan
   * bukti. Alasannya sederhana: surat ini keluar atas nama sistem ke instansi
   * negara, memuat identitas pelanggan, dan tidak dapat ditarik kembali.
   * Sesi yang tertinggal terbuka tidak boleh cukup untuk mengirimkannya.
   */
  @Post()
  @RequirePermissions('report.fulfill')
  @RequireStepUpMfa()
  send(
    @Param('reportCode') reportCode: string,
    @Body() dto: ForwardToKomdigiDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.forward.forward({
      reportCode,
      adminId: user.id,
      adminRole: user.roleCode,
      note: dto.note,
    });
  }
}
