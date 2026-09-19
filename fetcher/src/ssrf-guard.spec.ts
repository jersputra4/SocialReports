import {
  isAllowedContentType,
  isBlockedIpv4,
  isBlockedIpv6,
  isDomainAllowed,
  isIpLiteral,
  validateUrlShape,
} from './ssrf-guard';

const ALLOWLIST = [
  'facebook.com', 'fb.com', 'fb.watch', 'instagram.com', 'tiktok.com',
  'vm.tiktok.com', 'x.com', 'twitter.com', 't.co', 'youtube.com', 'youtu.be',
];

describe('bentuk URL (BRD 4.2, AC-09)', () => {
  it('menerima URL platform yang didukung', () => {
    for (const url of [
      'https://www.instagram.com/p/ABC123/',
      'https://x.com/akun/status/1234567890',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://vm.tiktok.com/ZSabcdef/',
      'http://facebook.com/permalink',
    ]) {
      expect(validateUrlShape(url, ALLOWLIST).ok).toBe(true);
    }
  });

  it('menolak domain di luar allowlist', () => {
    for (const url of [
      'https://contoh-lain.com/p/1',
      'https://instagram.com.penyerang.id/p/1',
      'https://notyoutube.be/abc',
      'https://internal.corp/admin',
    ]) {
      const result = validateUrlShape(url, ALLOWLIST);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/tidak ada pada daftar/);
    }
  });

  it('menolak skema selain http dan https', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://x.com/1',
      'ftp://x.com/berkas',
      'data:text/html,<script>1</script>',
    ]) {
      expect(validateUrlShape(url, ALLOWLIST).ok).toBe(false);
    }
  });

  it('menolak port selain 80 dan 443', () => {
    expect(validateUrlShape('https://x.com:8080/a', ALLOWLIST).ok).toBe(false);
    expect(validateUrlShape('http://x.com:22/a', ALLOWLIST).ok).toBe(false);
    expect(validateUrlShape('https://x.com:443/a', ALLOWLIST).ok).toBe(true);
  });

  it('menolak userinfo pada URL', () => {
    const result = validateUrlShape('https://admin:rahasia@x.com/a', ALLOWLIST);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/kredensial/);
  });

  it('menolak alamat IP langsung, termasuk bentuk numerik', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://2130706433/',
      'http://0x7f000001/',
    ]) {
      expect(validateUrlShape(url, ALLOWLIST).ok).toBe(false);
    }
  });

  it('mengenali host yang berupa literal IP', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('2130706433')).toBe(true);
    expect(isIpLiteral('0x7f000001')).toBe(true);
    expect(isIpLiteral('instagram.com')).toBe(false);
  });
});

describe('pencocokan domain', () => {
  it('menerima sub-domain tetapi bukan sufiks palsu', () => {
    expect(isDomainAllowed('www.instagram.com', ALLOWLIST)).toBe(true);
    expect(isDomainAllowed('m.facebook.com', ALLOWLIST)).toBe(true);
    expect(isDomainAllowed('evilinstagram.com', ALLOWLIST)).toBe(false);
    expect(isDomainAllowed('instagram.com.evil.id', ALLOWLIST)).toBe(false);
  });
});

describe('penyaringan alamat IP hasil resolusi (AC-09)', () => {
  it('menolak loopback, privat, link-local, dan multicast IPv4', () => {
    for (const ip of [
      '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '169.254.0.1', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255',
      '198.18.0.1', '192.0.2.5', '203.0.113.9',
    ]) {
      expect(isBlockedIpv4(ip)).toBe(true);
    }
  });

  it('menerima alamat publik IPv4', () => {
    for (const ip of ['157.240.22.35', '104.244.42.1', '8.8.8.8', '172.15.0.1', '172.32.0.1']) {
      expect(isBlockedIpv4(ip)).toBe(false);
    }
  });

  it('menolak bentuk IPv4 yang tidak dikenal', () => {
    expect(isBlockedIpv4('999.1.1.1')).toBe(true);
    expect(isBlockedIpv4('abc')).toBe(true);
    expect(isBlockedIpv4('1.2.3')).toBe(true);
  });

  it('menolak loopback, ULA, link-local, dan multicast IPv6', () => {
    for (const ip of [
      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::1',
    ]) {
      expect(isBlockedIpv6(ip)).toBe(true);
    }
  });

  it('menerima alamat publik IPv6', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIpv6('2a03:2880:f10c::1')).toBe(false);
  });
});

describe('content-type', () => {
  it('hanya menerima teks, JSON, XML, dan gambar', () => {
    expect(isAllowedContentType('text/html; charset=utf-8')).toBe(true);
    expect(isAllowedContentType('application/json')).toBe(true);
    expect(isAllowedContentType('image/png')).toBe(true);
    expect(isAllowedContentType('application/octet-stream')).toBe(false);
    expect(isAllowedContentType('application/pdf')).toBe(false);
    expect(isAllowedContentType(undefined)).toBe(false);
  });
});
