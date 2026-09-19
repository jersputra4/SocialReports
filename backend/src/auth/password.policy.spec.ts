import { PasswordPolicy } from './password.policy';

const policy = new PasswordPolicy({ minLengthUser: 10, minLengthAdmin: 12 });

describe('kebijakan kata sandi (BRD 4.3, AC-02)', () => {
  it('menuntut 10 karakter untuk user dan 12 untuk admin', async () => {
    expect((await policy.check('sembilan9', false)).valid).toBe(false);
    expect((await policy.check('kopi-pagi-biru', false)).valid).toBe(true);

    expect((await policy.check('sebelas1234', true)).valid).toBe(false);
    expect((await policy.check('kopi-pagi-biru', true)).valid).toBe(true);
  });

  it('menolak kata sandi dari daftar umum', async () => {
    for (const weak of ['password123', 'qwerty12345', 'admin1234', 'rahasia123', 'welcome123']) {
      const result = await policy.check(weak, false);
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/umum|bocor/);
    }
  });

  it('menolak varian angka di belakang kata umum', async () => {
    expect((await policy.check('password2026', false)).valid).toBe(false);
    expect((await policy.check('indonesia99', false)).valid).toBe(false);
  });

  it('menolak substitusi karakter yang umum', async () => {
    expect((await policy.check('p4ssw0rd', false)).valid).toBe(false);
    expect((await policy.check('r4h4si4', false)).valid).toBe(false);
  });

  it('menolak kata sandi yang memuat email atau nama pengguna', async () => {
    const byEmail = await policy.check('budisantoso-aman', false, {
      email: 'budisantoso@example.com',
    });
    expect(byEmail.valid).toBe(false);

    const byName = await policy.check('kopi-santoso-biru', false, { fullName: 'Budi Santoso' });
    expect(byName.valid).toBe(false);
  });

  it('menolak satu karakter yang diulang', async () => {
    expect((await policy.check('aaaaaaaaaaaa', false)).valid).toBe(false);
  });

  it('menolak spasi di awal atau akhir', async () => {
    expect((await policy.check(' kopipagibiru', false)).valid).toBe(false);
    expect((await policy.check('kopipagibiru ', false)).valid).toBe(false);
  });

  it('menerima frasa panjang yang wajar', async () => {
    for (const good of [
      'hujan-sore-di-bandung',
      'Tiga Gelas Teh Tawar',
      'jembatan.merah.2019.kota',
    ]) {
      const result = await policy.check(good, true);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });
});
