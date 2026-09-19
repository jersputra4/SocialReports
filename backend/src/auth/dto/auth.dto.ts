import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Format email tidak valid.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Nama lengkap wajib diisi.' })
  @MaxLength(160)
  fullName!: string;

  @IsString()
  @MinLength(10, { message: 'Kata sandi minimal 10 karakter.' })
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{6,32}$/, { message: 'Format nomor telepon tidak valid.' })
  phone?: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Format email tidak valid.' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Kata sandi wajib diisi.' })
  @MaxLength(200)
  password!: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  challengeId!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Kode OTP terdiri dari 6 angka.' })
  otp!: string;
}

export class ResendOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  challengeId!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(32, 128)
  token!: string;
}

export class RequestPasswordResetDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Format email tidak valid.' })
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @Length(32, 128)
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword!: string;
}

export class StepUpVerifyDto {
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Kode OTP terdiri dari 6 angka.' })
  otp!: string;
}

export class ToggleMfaDto {
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Kode OTP terdiri dari 6 angka.' })
  otp!: string;
}
