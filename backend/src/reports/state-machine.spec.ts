import {
  TRANSITIONS,
  TransitionNotAllowedError,
  allowedTargetsForActor,
  assertTransition,
  isTransitionAllowed,
  type ReportStatusValue,
} from './state-machine';

const ALL_STATUSES: ReportStatusValue[] = [
  'DRAFT', 'WAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED', 'EXPIRED',
  'PAID', 'WAITING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVISION',
  'SUBMITTED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED',
];

describe('state machine report (BRD 7.2)', () => {
  it('memuat seluruh 24 baris tabel transisi', () => {
    const ids = new Set(TRANSITIONS.map((t) => t.id));
    expect(ids.size).toBe(24);
    for (let id = 1; id <= 24; id += 1) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('menolak seluruh pasangan transisi di luar tabel (AC-23)', () => {
    let allowed = 0;
    let rejected = 0;

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const inTable = TRANSITIONS.some((t) => t.from === from && t.to === to);
        expect(isTransitionAllowed(from, to)).toBe(inTable);
        if (inTable) allowed += 1;
        else rejected += 1;
      }
    }

    // 16 x 16 = 256 pasangan; yang diizinkan hanya sebanyak baris tabel.
    expect(allowed + rejected).toBe(256);
    expect(allowed).toBe(TRANSITIONS.length);
  });

  it('menolak contoh eksplisit DRAFT -> APPROVED', () => {
    expect(() =>
      assertTransition({ from: 'DRAFT', to: 'APPROVED', actor: 'ADMIN' }),
    ).toThrow(TransitionNotAllowedError);
  });

  it('tidak ada transisi keluar dari status final selain ARCHIVED', () => {
    for (const terminal of ['REJECTED', 'CANCELLED'] as ReportStatusValue[]) {
      const targets = TRANSITIONS.filter((t) => t.from === terminal).map((t) => t.to);
      expect(targets).toEqual(['ARCHIVED']);
    }
    expect(TRANSITIONS.filter((t) => t.from === 'ARCHIVED')).toHaveLength(0);
  });

  it('tidak ada satu pun transisi menuju status refund', () => {
    // BRD 6.4: tidak ada tabel, status, atau alur refund.
    const statuses = TRANSITIONS.flatMap((t) => [t.from, t.to]).join(' ');
    expect(statuses.toLowerCase()).not.toContain('refund');
  });

  describe('kewenangan aktor', () => {
    it('user tidak dapat menyetujui report', () => {
      expect(() =>
        assertTransition({
          from: 'WAITING_REVIEW', to: 'APPROVED', actor: 'USER',
          reason: 'Saya setujui sendiri saja', satisfiedGuards: ['REVIEW_DECISION'],
        }),
      ).toThrow(/tidak berwenang/);
    });

    it('user tidak dapat menandai report selesai', () => {
      expect(() =>
        assertTransition({
          from: 'SUBMITTED', to: 'COMPLETED', actor: 'USER',
          satisfiedGuards: ['ACTIVE_PROOF', 'UNITS_FULFILLED'],
        }),
      ).toThrow(/tidak berwenang/);
    });

    it('admin dapat menandai report selesai bila prasyarat terpenuhi', () => {
      const rule = assertTransition({
        from: 'SUBMITTED', to: 'COMPLETED', actor: 'ADMIN',
        satisfiedGuards: ['ACTIVE_PROOF', 'UNITS_FULFILLED'],
      });
      expect(rule.id).toBe(20);
    });

    it('hanya sistem yang menandai pembayaran lunas', () => {
      expect(allowedTargetsForActor('WAITING_PAYMENT', 'USER')).toEqual(['CANCELLED']);
      expect(allowedTargetsForActor('WAITING_PAYMENT', 'SYSTEM')).toEqual(
        expect.arrayContaining(['PAID', 'PAYMENT_REVIEW', 'EXPIRED']),
      );
    });
  });

  describe('prasyarat', () => {
    it('COMPLETED ditolak tanpa bukti pengerjaan aktif (AC-26)', () => {
      expect(() =>
        assertTransition({
          from: 'SUBMITTED', to: 'COMPLETED', actor: 'ADMIN',
          satisfiedGuards: ['UNITS_FULFILLED'],
        }),
      ).toThrow(/ACTIVE_PROOF/);
    });

    it('SUBMITTED ditolak tanpa record complaint_submissions (AC-24)', () => {
      expect(() =>
        assertTransition({ from: 'APPROVED', to: 'SUBMITTED', actor: 'ADMIN' }),
      ).toThrow(/COMPLAINT_SUBMISSION/);
    });

    it('WAITING_PAYMENT ditolak tanpa consent tanpa refund (AC-18)', () => {
      expect(() =>
        assertTransition({
          from: 'DRAFT', to: 'WAITING_PAYMENT', actor: 'USER',
          satisfiedGuards: ['DATA_COMPLETE', 'EMAIL_VERIFIED', 'SNAPSHOT_SEALED', 'PAYMENT_ORDER_CREATED'],
        }),
      ).toThrow(/NO_REFUND_CONSENT/);
    });

    it('perbaikan dari NEEDS_REVISION tidak menuntut pembayaran baru (AC-22)', () => {
      const rule = assertTransition({
        from: 'NEEDS_REVISION', to: 'WAITING_REVIEW', actor: 'USER',
        satisfiedGuards: ['DATA_COMPLETE'],
      });
      expect(rule.guards).not.toContain('PAYMENT_ORDER_CREATED');
      expect(rule.to).toBe('WAITING_REVIEW');
    });
  });

  describe('alasan wajib', () => {
    it('penolakan review tanpa alasan ditolak (AC-21)', () => {
      expect(() =>
        assertTransition({
          from: 'WAITING_REVIEW', to: 'REJECTED', actor: 'REVIEWER',
          satisfiedGuards: ['REVIEW_DECISION'],
        }),
      ).toThrow(/alasan wajib/);
    });

    it('alasan kurang dari 10 karakter ditolak', () => {
      expect(() =>
        assertTransition({
          from: 'WAITING_REVIEW', to: 'REJECTED', actor: 'REVIEWER',
          reason: 'tidak', satisfiedGuards: ['REVIEW_DECISION'],
        }),
      ).toThrow(/alasan wajib/);
    });

    it('alasan memadai diterima', () => {
      const rule = assertTransition({
        from: 'WAITING_REVIEW', to: 'REJECTED', actor: 'REVIEWER',
        reason: 'Target tidak memenuhi kriteria kebijakan platform.',
        satisfiedGuards: ['REVIEW_DECISION'],
      });
      expect(rule.id).toBe(14);
    });
  });

  describe('alur lengkap DRAFT sampai ARCHIVED', () => {
    it('setiap langkah jalur bahagia diizinkan', () => {
      const path: Array<[ReportStatusValue, ReportStatusValue]> = [
        ['DRAFT', 'WAITING_PAYMENT'],
        ['WAITING_PAYMENT', 'PAID'],
        ['PAID', 'WAITING_REVIEW'],
        ['WAITING_REVIEW', 'APPROVED'],
        ['APPROVED', 'SUBMITTED'],
        ['SUBMITTED', 'PARTIALLY_COMPLETED'],
        ['PARTIALLY_COMPLETED', 'COMPLETED'],
        ['COMPLETED', 'ARCHIVED'],
      ];
      for (const [from, to] of path) {
        expect(isTransitionAllowed(from, to)).toBe(true);
      }
    });

    it('jalur pembayaran bermasalah tetap dapat pulih', () => {
      expect(isTransitionAllowed('WAITING_PAYMENT', 'PAYMENT_REVIEW')).toBe(true);
      expect(isTransitionAllowed('PAYMENT_REVIEW', 'PAID')).toBe(true);
      expect(isTransitionAllowed('PAYMENT_REVIEW', 'PAYMENT_REJECTED')).toBe(true);
      expect(isTransitionAllowed('PAYMENT_REJECTED', 'WAITING_PAYMENT')).toBe(true);
      expect(isTransitionAllowed('EXPIRED', 'WAITING_PAYMENT')).toBe(true);
    });
  });
});
