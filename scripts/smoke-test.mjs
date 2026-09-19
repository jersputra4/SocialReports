#!/usr/bin/env node
/**
 * Smoke test end-to-end.
 *
 *   node scripts/smoke-test.mjs
 *
 * Menelusuri alur nyata lewat HTTP terhadap stack yang sedang berjalan:
 * daftar -> verifikasi email -> masuk -> buat report -> pilih kebijakan dan
 * dasar hukum -> unggah evidence -> checkout -> bayar lewat gateway simulasi ->
 * pastikan webhook duplikat tidak menghasilkan transisi kedua.
 *
 * Bila ADMIN_EMAIL dan ADMIN_PASSWORD diisi, alur berlanjut ke sisi operasional:
 * review -> catat pelaporan -> unggah bukti pengerjaan -> tandai selesai ->
 * buat PDF dengan lampiran bukti -> verifikasi rantai hash audit.
 *
 * Tanpa dependensi. Memakai kotak masuk lokal untuk mengambil OTP dan token,
 * jadi hanya berjalan ketika MAIL_DRIVER=mailbox dan bukan production.
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
const API = `${BASE}/api/v1`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

let passed = 0;
let failed = 0;
const failures = [];

function log(symbol, message, detail = '') {
  const line = `  ${symbol}  ${message}${detail ? `  ${detail}` : ''}`;
  console.log(line);
}

function pass(message, detail) {
  passed += 1;
  log('PASS', message, detail);
}

function fail(message, detail) {
  failed += 1;
  failures.push(`${message} — ${detail}`);
  log('FAIL', message, detail);
}

function assert(condition, message, detail = '') {
  if (condition) pass(message, detail);
  else fail(message, detail || 'kondisi tidak terpenuhi');
  return Boolean(condition);
}

/** Sesi sederhana: menyimpan cookie dan mengirim token CSRF. */
function createSession(label) {
  const cookies = new Map();

  const storeCookies = (response) => {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  };

  const request = async (method, path, body, isForm = false) => {
    const headers = { Accept: 'application/json' };

    if (cookies.size > 0) {
      headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (method !== 'GET') {
      const csrf = cookies.get('srs_csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    let payload;
    if (isForm) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${API}${path}`, { method, headers, body: payload });
    storeCookies(response);

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = { raw: text };
    }

    return { status: response.status, body: json };
  };

  return {
    label,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    upload: (path, form) => request('POST', path, form, true),
  };
}

const anonymous = createSession('anonim');

async function latestMail(to) {
  const response = await anonymous.get(`/dev/mailbox/latest?to=${encodeURIComponent(to)}`);
  return response.body;
}

function pngBuffer() {
  // PNG 1x1 piksel yang valid — cukup untuk menguji pipeline unggahan.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

function formDataWithPng(fields) {
  const form = new FormData();
  form.append('file', new Blob([pngBuffer()], { type: 'image/png' }), 'bukti.png');
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  return form;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForStatus(session, reportCode, wanted, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const response = await session.get(`/reports/${reportCode}`);
    last = response.body?.status ?? '';
    if (wanted.includes(last)) return last;
    await sleep(1000);
  }
  return last;
}

async function main() {
  console.log('\nSmoke test Sistem Pelaporan Konten');
  console.log(`  target: ${BASE}\n`);

  // ------------------------------------------------------------- kesehatan --
  console.log('· Kesehatan layanan');
  const health = await anonymous.get('/health/ready');
  assert(health.status === 200, 'API menjawab', `HTTP ${health.status}`);
  assert(health.body?.checks?.database === true, 'Database terhubung');
  assert(health.body?.checks?.redis === true, 'Redis terhubung');
  assert(health.body?.checks?.storage === true, 'Object storage terhubung');
  if (health.body?.checks?.fetcher !== true) {
    log('INFO', 'Metadata Fetcher tidak aktif — report tetap dapat dibuat secara manual');
  }

  // ------------------------------------------------------------ pendaftaran --
  console.log('\n· Pendaftaran dan verifikasi email');
  const email = `smoke-${Date.now()}@contoh.test`;
  const password = 'hujan-sore-di-bandung-2026';

  const register = await anonymous.post('/auth/register', {
    email,
    fullName: 'Pengguna Smoke Test',
    password,
  });
  assert(register.status === 202, 'Pendaftaran diterima', `HTTP ${register.status}`);

  const weak = await anonymous.post('/auth/register', {
    email: `weak-${Date.now()}@contoh.test`,
    fullName: 'Kata Sandi Lemah',
    password: 'password123',
  });
  assert(weak.status === 400, 'Kata sandi umum ditolak', `HTTP ${weak.status}`);

  const verificationMail = await latestMail(email);
  const link = verificationMail?.highlight ?? '';
  const token = link.split('token=')[1] ?? '';
  if (!assert(token.length > 20, 'Tautan verifikasi diterima di kotak masuk lokal')) return;

  const verify = await anonymous.post('/auth/verify-email', { token });
  assert(verify.status === 200, 'Email terverifikasi', `HTTP ${verify.status}`);

  const reuse = await anonymous.post('/auth/verify-email', { token });
  assert(reuse.status === 400, 'Token verifikasi tidak dapat dipakai dua kali');

  // ------------------------------------------------------------------ masuk --
  console.log('\n· Masuk');
  const user = createSession('pengguna');

  const badLogin = await user.post('/auth/login', { email, password: 'salah-sekali-123' });
  assert(badLogin.status === 401, 'Kata sandi salah ditolak', `HTTP ${badLogin.status}`);

  const login = await user.post('/auth/login', { email, password });
  if (!assert(login.status === 200 && login.body?.mfaRequired === false, 'Masuk berhasil')) return;

  const me = await user.get('/auth/me');
  assert(me.body?.email === email, 'Identitas sesi sesuai');

  // ------------------------------------------------------------ buat report --
  console.log('\n· Membuat report');
  const [actionTypes, packages] = await Promise.all([
    user.get('/action-types'),
    user.get('/packages'),
  ]);
  if (!assert(Array.isArray(actionTypes.body) && actionTypes.body.length > 0, 'Jenis tindakan tersedia')) return;
  if (!assert(Array.isArray(packages.body) && packages.body.length > 0, 'Paket tersedia')) return;

  const paket300 = packages.body.find((item) => item.quantity === 300) ?? packages.body[0];
  assert(
    paket300.subtotal === '300000' && paket300.taxAmount === '33000' && paket300.totalAmount === '333000',
    'Harga paket 300 unit sesuai dokumen',
    `${paket300.subtotal} + ${paket300.taxAmount} = ${paket300.totalAmount}`,
  );

  const ditolak = await user.post('/reports', {
    actionTypeId: actionTypes.body[0].id,
    packageId: paket300.packageId,
    targetUrl: 'https://penyerang-tidak-didukung.example/abc',
  });
  assert(ditolak.status === 400, 'Platform di luar daftar ditolak', `HTTP ${ditolak.status}`);

  const created = await user.post('/reports', {
    actionTypeId: actionTypes.body[0].id,
    packageId: paket300.packageId,
    targetUrl: 'https://x.com/contoh/status/1234567890',
    description: 'Report uji otomatis dari smoke test.',
  });
  const reportCode = created.body?.reportCode;
  if (!assert(/^RPT-[0-9A-HJKMNP-TV-Z]{10}$/.test(reportCode ?? ''), 'Report dibuat dengan kode valid', reportCode)) {
    return;
  }

  const detail = await user.get(`/reports/${reportCode}`);
  const platformId = detail.body?.targetSnapshot?.platformId;
  if (!assert(Boolean(platformId), 'Platform target dikenali')) return;

  const policies = await user.get(`/platforms/${platformId}/policies`);
  if (!assert(policies.body?.length > 0, 'Kebijakan platform tersedia')) return;

  const setPolicies = await user.post(`/reports/${reportCode}/policies`, {
    policies: [{ policyVersionId: policies.body[0].versionId }],
  });
  assert(setPolicies.status === 201 || setPolicies.status === 200, 'Kebijakan tersimpan');

  const laws = await user.get('/legal/laws');
  const articles = await user.get(`/legal/versions/${laws.body[0].versionId}/articles`);
  const paragraphId = articles.body?.[0]?.paragraphs?.[0]?.paragraphId;
  if (!assert(Boolean(paragraphId), 'Dasar hukum tersedia')) return;

  const setLegal = await user.post(`/reports/${reportCode}/legal-basis`, {
    legalBasis: [{ paragraphId }],
  });
  assert(setLegal.status === 201 || setLegal.status === 200, 'Dasar hukum tersimpan');

  const evidence = await user.upload(
    `/reports/${reportCode}/evidences`,
    formDataWithPng({ caption: 'Tangkapan layar uji' }),
  );
  assert(evidence.status === 201 || evidence.status === 200, 'Evidence terunggah');
  assert(
    typeof evidence.body?.fileHash === 'string' && evidence.body.fileHash.length === 64,
    'Hash SHA-256 evidence tersimpan',
  );

  // --------------------------------------------------------------- checkout --
  console.log('\n· Tagihan dan pembayaran');

  const tanpaConsent = await user.post(`/reports/${reportCode}/checkout`, {
    noRefundConsentVersion: '0.9',
  });
  assert(tanpaConsent.status === 400, 'Versi ketentuan yang kedaluwarsa ditolak');

  const checkout = await user.post(`/reports/${reportCode}/checkout`, {
    noRefundConsentVersion: '1.1',
    paymentMethod: 'VA_BNI',
  });
  const orderId = checkout.body?.gatewayOrderId;
  if (!assert(Boolean(orderId), 'Tagihan dibuat', orderId)) return;

  const afterCheckout = await user.get(`/reports/${reportCode}`);
  assert(afterCheckout.body?.status === 'WAITING_PAYMENT', 'Report menunggu pembayaran');
  assert(
    afterCheckout.body?.totalAmountSnapshot === '333000',
    'Snapshot total tersimpan',
    afterCheckout.body?.totalAmountSnapshot,
  );

  const order = await anonymous.get(`/mock-gateway/orders/${orderId}`);
  assert(order.body?.amount === '333000', 'Gateway menerima nilai tagihan yang sama');

  const pay = await anonymous.post(`/mock-gateway/orders/${orderId}/pay`, {
    amount: 333000,
    paymentMethod: 'VA_BNI',
  });
  assert(pay.body?.webhookDelivered === true, 'Webhook terkirim ke backend');

  const statusAfterPay = await waitForStatus(user, reportCode, ['WAITING_REVIEW', 'PAID']);
  if (!assert(
    ['WAITING_REVIEW', 'PAID'].includes(statusAfterPay),
    'Report lunas dan masuk antrean review',
    statusAfterPay,
  )) return;

  const withInvoice = await user.get(`/reports/${reportCode}`);
  assert(withInvoice.body?.invoices?.length === 1, 'Invoice diterbitkan');

  // ------------------------------------------------------------ idempotency --
  const historyBefore = withInvoice.body?.statusHistory?.length ?? 0;
  const replay = await anonymous.post(`/mock-gateway/orders/${orderId}/replay`, {
    eventId: 'evt_smoke_duplikat',
    times: 5,
  });
  assert(Array.isArray(replay.body?.results), 'Webhook duplikat dikirim 5 kali');

  await sleep(3000);
  const afterReplay = await user.get(`/reports/${reportCode}`);
  assert(
    (afterReplay.body?.statusHistory?.length ?? 0) === historyBefore,
    'Webhook duplikat tidak menghasilkan transisi kedua',
    `riwayat tetap ${historyBefore} entri`,
  );

  // -------------------------------------------------------- akses objek lain --
  console.log('\n· Batas akses');
  const orangLain = createSession('orang-lain');
  const otherEmail = `smoke-lain-${Date.now()}@contoh.test`;
  await anonymous.post('/auth/register', {
    email: otherEmail,
    fullName: 'Pengguna Lain',
    password,
  });
  const otherMail = await latestMail(otherEmail);
  const otherToken = (otherMail?.highlight ?? '').split('token=')[1] ?? '';
  await anonymous.post('/auth/verify-email', { token: otherToken });
  await orangLain.post('/auth/login', { email: otherEmail, password });

  const curi = await orangLain.get(`/reports/${reportCode}`);
  assert(curi.status === 404, 'Report milik orang lain menghasilkan 404', `HTTP ${curi.status}`);

  // ------------------------------------------------------------- sisi admin --
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.log('\n· Sisi operasional dilewati');
    console.log('  Isi ADMIN_EMAIL dan ADMIN_PASSWORD untuk menjalankan alur review,');
    console.log('  pelaporan, bukti pengerjaan, PDF, dan verifikasi audit.');
    return;
  }

  console.log('\n· Sisi operasional');
  const admin = createSession('admin');
  const adminLogin = await admin.post('/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  if (adminLogin.body?.mfaRequired) {
    const otpMail = await latestMail(ADMIN_EMAIL);
    const otp = otpMail?.highlight ?? '';
    const verifyOtp = await admin.post('/auth/mfa/verify', {
      challengeId: adminLogin.body.challengeId,
      otp,
    });
    if (!assert(verifyOtp.status === 200, 'Admin masuk dengan OTP', `HTTP ${verifyOtp.status}`)) return;
  } else {
    assert(adminLogin.status === 200, 'Admin masuk');
  }

  const transisiTerlarang = await admin.post(`/admin/reports/${reportCode}/mark-completed`, {});
  assert(
    transisiTerlarang.status === 409,
    'Transisi di luar tabel 7.2 ditolak dengan 409',
    `HTTP ${transisiTerlarang.status}`,
  );

  const alasanPendek = await admin.post(`/admin/reports/${reportCode}/review`, {
    decision: 'APPROVED',
    reason: 'ok',
  });
  assert(alasanPendek.status === 400, 'Alasan review kurang dari 10 karakter ditolak');

  const review = await admin.post(`/admin/reports/${reportCode}/review`, {
    decision: 'APPROVED',
    reason: 'Bukti dan dasar hukum sudah lengkap serta relevan dengan kebijakan platform.',
  });
  assert(review.body?.status === 'APPROVED', 'Report disetujui', review.body?.status);

  const submit = await admin.post(`/admin/reports/${reportCode}/submissions`, {
    channel: 'WEB_FORM',
    externalReference: 'SMOKE-REF-001',
    notes: 'Dilaporkan lewat formulir resmi platform.',
  });
  assert(submit.body?.status === 'SUBMITTED', 'Pelaporan tercatat dan report SUBMITTED');

  const selesaiTanpaBukti = await admin.post(`/admin/reports/${reportCode}/mark-completed`, {});
  assert(
    selesaiTanpaBukti.status === 409,
    'Tandai selesai tanpa bukti pengerjaan ditolak',
    `HTTP ${selesaiTanpaBukti.status}`,
  );

  const proof = await admin.upload(
    `/admin/reports/${reportCode}/proofs`,
    formDataWithPng({
      proofType: 'POST_REPORTED',
      reportedAt: new Date().toISOString(),
      caption: 'Tangkapan layar konfirmasi pelaporan.',
      unitsReported: 300,
      visibleToUser: 'true',
    }),
  );
  assert(proof.status === 201 || proof.status === 200, 'Bukti pengerjaan terunggah');

  const complete = await admin.post(`/admin/reports/${reportCode}/mark-completed`, {});
  assert(complete.body?.status === 'COMPLETED', 'Report selesai setelah ada bukti', complete.body?.status);

  const userProofs = await user.get(`/reports/${reportCode}/proofs`);
  assert(userProofs.body?.items?.length === 1, 'Pelapor melihat bukti pengerjaan');
  assert(
    userProofs.body?.progress?.percentage === 100,
    'Progres unit terbaca 100%',
    `${userProofs.body?.progress?.percentage}%`,
  );

  const proofOrangLain = await orangLain.get(`/reports/${reportCode}/proofs`);
  assert(proofOrangLain.status === 404, 'Bukti tidak terlihat oleh pengguna lain');

  const pdf = await user.post(`/reports/${reportCode}/documents`, { includeProofs: true });
  assert(pdf.body?.accepted === true, 'Pembuatan PDF diantrekan');

  await sleep(6000);
  const documents = await user.get(`/reports/${reportCode}/documents`);
  assert(
    Array.isArray(documents.body) && documents.body.length >= 1,
    'PDF tersedia dengan versi dan hash',
    documents.body?.[0] ? `versi ${documents.body[0].version}` : '',
  );

  const chain = await admin.get('/admin/audit/verify-chain');
  assert(chain.body?.valid === true, 'Rantai hash audit utuh setelah seluruh alur');

  const logs = await admin.get(`/admin/audit/logs?entityId=${reportCode}&limit=100`);
  assert(
    Array.isArray(logs.body) && logs.body.length >= 5,
    'Seluruh tindakan pada report tercatat di audit log',
    `${logs.body?.length} entri`,
  );
}

main()
  .catch((error) => {
    fail('Smoke test berhenti karena galat', error?.message ?? String(error));
  })
  .finally(() => {
    console.log(`\n  ${passed} lulus, ${failed} gagal\n`);
    if (failures.length > 0) {
      console.log('  Ringkasan kegagalan:');
      for (const item of failures) console.log(`   - ${item}`);
      console.log('');
    }
    process.exit(failed === 0 ? 0 : 1);
  });
