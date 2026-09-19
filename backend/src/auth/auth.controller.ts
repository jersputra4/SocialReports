import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { AuthenticatedRequest, AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, Public, RateLimit } from '../common/security/decorators';
import { SessionService } from '../common/security/session.service';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  LoginDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResendOtpDto,
  StepUpVerifyDto,
  ToggleMfaDto,
  VerifyEmailDto,
  VerifyOtpDto,
} from './dto/auth.dto';

const MFA_COOKIE = 'srs_mfa';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private setMfaCookie(response: Response, binding: string, expiresAt: Date): void {
    response.cookie(MFA_COOKIE, binding, {
      httpOnly: true,
      secure: this.config.session.cookieSecure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearMfaCookie(response: Response): void {
    response.clearCookie(MFA_COOKIE, { path: '/' });
  }

  // ------------------------------------------------------------- registrasi --

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'register', limit: 5, windowSeconds: 600, keyFromBody: 'email' })
  async register(@Body() dto: RegisterDto) {
    await this.auth.register(dto);
    return {
      message:
        'Bila email tersebut belum terdaftar, tautan verifikasi sudah kami kirim. Silakan periksa kotak masuk Anda.',
    };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'verify-email', limit: 10, windowSeconds: 600 })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { message: 'Email berhasil diverifikasi. Anda sudah dapat masuk.' };
  }

  // ------------------------------------------------------------------ login --

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'login', limit: 5, windowSeconds: 60, keyFromBody: 'email' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password, {
      ipAddress: request.ip,
      userAgent: request.header('user-agent') ?? undefined,
    });

    if (result.kind === 'MFA_REQUIRED') {
      this.setMfaCookie(response, result.binding, result.expiresAt);
      return {
        mfaRequired: true,
        challengeId: result.challengeId,
        expiresAt: result.expiresAt.toISOString(),
        message: 'Kode verifikasi sudah dikirim ke email Anda.',
      };
    }

    this.sessions.attachCookies(response, result.token, result.csrfToken, result.expiresAt);
    return {
      mfaRequired: false,
      csrfToken: result.csrfToken,
      mustChangePassword: result.mustChangePassword,
    };
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'mfa-verify', limit: 10, windowSeconds: 300 })
  async verifyMfa(
    @Body() dto: VerifyOtpDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.completeMfaLogin({
      challengeId: dto.challengeId,
      otp: dto.otp,
      binding: request.cookies?.[MFA_COOKIE],
      context: {
        ipAddress: request.ip,
        userAgent: request.header('user-agent') ?? undefined,
      },
    });

    this.clearMfaCookie(response);
    this.sessions.attachCookies(response, result.token, result.csrfToken, result.expiresAt);
    return { csrfToken: result.csrfToken, mustChangePassword: result.mustChangePassword };
  }

  @Public()
  @Post('mfa/resend')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'mfa-resend', limit: 3, windowSeconds: 600 })
  async resendMfa(
    @Body() dto: ResendOtpDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challenge = await this.auth.resendMfa(dto.challengeId, request.ip);
    this.setMfaCookie(response, challenge.binding, challenge.expiresAt);
    return {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt.toISOString(),
      message: 'Kode baru sudah dikirim ke email Anda.',
    };
  }

  // ----------------------------------------------------------- step-up MFA --

  @Post('mfa/step-up/request')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'step-up', limit: 3, windowSeconds: 600 })
  async requestStepUp(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challenge = await this.auth.requestStepUp(user.id, request.ip);
    this.setMfaCookie(response, challenge.binding, challenge.expiresAt);
    return {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt.toISOString(),
      message: 'Kode konfirmasi sudah dikirim ke email Anda.',
    };
  }

  @Post('mfa/step-up/verify')
  @HttpCode(HttpStatus.OK)
  async verifyStepUp(
    @Body() dto: VerifyOtpDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.verifyStepUp({
      userId: user.id,
      sessionId: user.sessionId,
      challengeId: dto.challengeId,
      otp: dto.otp,
      binding: request.cookies?.[MFA_COOKIE],
    });
    this.clearMfaCookie(response);
    return {
      message: 'Konfirmasi berhasil.',
      validUntil: new Date(
        Date.now() + this.config.session.stepUpWindowMinutes * 60_000,
      ).toISOString(),
    };
  }

  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  async enableMfa(@Body() dto: ToggleMfaDto, @CurrentUser() user: AuthenticatedUser) {
    void dto;
    await this.auth.setMfaEnabled(user.id, true);
    return { mfaEnabled: true };
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  async disableMfa(@Body() dto: StepUpVerifyDto, @CurrentUser() user: AuthenticatedUser) {
    void dto;
    await this.auth.setMfaEnabled(user.id, false);
    return { mfaEnabled: false };
  }

  // ---------------------------------------------------------- kata sandi ----

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'password-reset', limit: 3, windowSeconds: 600, keyFromBody: 'email' })
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.email);
    return {
      message:
        'Bila email tersebut terdaftar, tautan untuk mengatur ulang kata sandi sudah kami kirim.',
    };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'password-reset-confirm', limit: 5, windowSeconds: 600 })
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
    return { message: 'Kata sandi berhasil diubah. Silakan masuk kembali.' };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
    );
    return { message: 'Kata sandi berhasil diperbarui.' };
  }

  // ---------------------------------------------------------------- sesi ----

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.roleCode,
      isStaff: user.isStaff,
      permissions: user.permissions,
      mustChangePassword: user.mustChangePassword,
      stepUpValidUntil: user.mfaVerifiedAt
        ? new Date(
            user.mfaVerifiedAt.getTime() + this.config.session.stepUpWindowMinutes * 60_000,
          ).toISOString()
        : null,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(user.sessionId, user.id);
    this.sessions.clearCookies(response);
    return { message: 'Anda sudah keluar.' };
  }
}
