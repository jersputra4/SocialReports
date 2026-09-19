/**
 * Kebijakan kata sandi — BRD/SRS v1.1 §4.3, AC-02, AC-05.
 *
 *   - minimal 10 karakter (user) dan 12 karakter (admin/staf internal)
 *   - ditolak bila ada pada daftar kata sandi umum/bocor
 *   - tidak ada aturan komposisi wajib: panjang dan daftar larangan lebih
 *     efektif daripada memaksa simbol, yang justru mendorong pola tertebak
 *
 * Daftar di bawah adalah cuplikan yang dibundel agar pemeriksaan tetap
 * berjalan tanpa layanan luar. Di lingkungan nyata daftar ini diganti dengan
 * korpus yang lebih besar (mis. Have I Been Pwned k-anonymity API atau salinan
 * daftar 100 ribu teratas) lewat `CommonPasswordSource`.
 */

const BUNDLED_COMMON_PASSWORDS: readonly string[] = [
  '123456', '123456789', '12345678', 'password', 'qwerty123', 'qwerty1', '111111',
  '12345', 'secret', '123123', '1234567890', '1234567', '000000', 'qwerty',
  'abc123', 'password1', 'password123', 'iloveyou', '11111111', 'dragon',
  'monkey', '123321', '654321', '666666', '1qaz2wsx', '123qwe', 'qwertyuiop',
  'sunshine', 'princess', 'football', 'baseball', 'welcome', 'welcome1',
  'welcome123', 'admin', 'admin123', 'administrator', 'root', 'toor', 'letmein',
  'letmein123', 'master', 'superman', 'trustno1', 'passw0rd', 'p@ssw0rd',
  'p@ssword', 'pa$$w0rd', 'changeme', 'changeme123', 'default', 'default123',
  'test123', 'testtest', 'guest', 'guest123', 'user123', 'login', 'access',
  'shadow', 'michael', 'jennifer', 'jordan23', 'hunter2', 'computer', 'internet',
  'samsung', 'google', 'facebook', 'whatever', 'zaq12wsx', 'asdfghjkl',
  'qazwsxedc', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'aaaaaa', 'abcdefg',
  'abcd1234', 'a1b2c3d4', 'password12', 'passwordpassword', 'qwerty12345',
  // konteks Indonesia
  'indonesia', 'jakarta', 'bandung', 'surabaya', 'indonesia123', 'rahasia',
  'rahasia123', 'katasandi', 'katasandi123', 'sayangku', 'bismillah',
  'kamusayang', 'admin1234', 'adminadmin', 'user1234',
  // pola khas lingkungan uji coba
  'demo1234', 'demo12345', 'prototype', 'prototype123', 'sandbox123',
  'social123', 'report123', 'laporan123',
];

export interface PasswordSource {
  /** true bila kata sandi ada pada daftar umum/bocor. */
  isCommon(password: string): Promise<boolean> | boolean;
}

export class BundledPasswordSource implements PasswordSource {
  private readonly set = new Set(BUNDLED_COMMON_PASSWORDS);

  isCommon(password: string): boolean {
    const normalized = password.trim().toLowerCase();
    if (this.set.has(normalized)) return true;

    // Varian dengan angka di belakang: "password2024", "admin2026"
    const stripped = normalized.replace(/[0-9]{1,4}[!@#$%^&*]?$/, '');
    if (stripped.length >= 4 && this.set.has(stripped)) return true;

    // Substitusi karakter yang umum: 4->a, 3->e, 0->o, 1->i, $->s
    const unleet = normalized
      .replace(/4/g, 'a').replace(/3/g, 'e').replace(/0/g, 'o')
      .replace(/1/g, 'i').replace(/\$/g, 's').replace(/@/g, 'a');
    return this.set.has(unleet);
  }
}

export interface PasswordCheckResult {
  valid: boolean;
  errors: string[];
}

export interface PasswordPolicyOptions {
  minLengthUser: number;
  minLengthAdmin: number;
}

export class PasswordPolicy {
  constructor(
    private readonly options: PasswordPolicyOptions,
    private readonly source: PasswordSource = new BundledPasswordSource(),
  ) {}

  minLengthFor(isStaff: boolean): number {
    return isStaff ? this.options.minLengthAdmin : this.options.minLengthUser;
  }

  async check(
    password: string,
    isStaff: boolean,
    context: { email?: string; fullName?: string } = {},
  ): Promise<PasswordCheckResult> {
    const errors: string[] = [];
    const minLength = this.minLengthFor(isStaff);

    if (password.length < minLength) {
      errors.push(`Kata sandi minimal ${minLength} karakter.`);
    }
    if (password.length > 200) {
      errors.push('Kata sandi maksimal 200 karakter.');
    }
    if (/^\s|\s$/.test(password)) {
      errors.push('Kata sandi tidak boleh diawali atau diakhiri spasi.');
    }
    if (await this.source.isCommon(password)) {
      errors.push('Kata sandi terlalu umum atau pernah bocor. Pilih yang lain.');
    }

    const lowered = password.toLowerCase();
    const localPart = context.email?.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && lowered.includes(localPart)) {
      errors.push('Kata sandi tidak boleh memuat bagian alamat email Anda.');
    }
    if (context.fullName) {
      for (const part of context.fullName.toLowerCase().split(/\s+/)) {
        if (part.length >= 4 && lowered.includes(part)) {
          errors.push('Kata sandi tidak boleh memuat nama Anda.');
          break;
        }
      }
    }

    // Satu karakter berulang atau deret berurutan.
    if (/^(.)\1+$/.test(password)) {
      errors.push('Kata sandi tidak boleh berupa satu karakter yang diulang.');
    }

    return { valid: errors.length === 0, errors };
  }
}
