import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleName } from '../shared/constants/role.constants';
import { apDungCach1, phuongAnChia, trangThaiSau, vanTay, vanTayTaiKhoan, type DongChia } from './thoa-thuan';
import { ThoaThuanService } from './thoa-thuan.service';

// Bài 4 tác giả: hàng 1 = A (đại diện, tài khoản), hàng 2 = học viên thuộc Trường
// KHÔNG tài khoản, hàng 3 = B (tài khoản), hàng 4 = người nước ngoài.
const RAW = [{ name: 'A' }, { name: 'HV' }, { name: 'B' }, { name: 'Foreign', isForeign: true }];

describe('phuongAnChia — ghép tỷ lệ tài khoản + người không tài khoản', () => {
  it('người không tài khoản ghép vào hàng KHÔNG phải tài khoản theo thứ tự; cờ thuộc Trường theo địa chỉ', () => {
    const ds = phuongAnChia({
      taiKhoan: [
        { userId: 'a', ten: 'A', email: 'a@x', authorIndex: 0, sharePercent: 50 },
        { userId: 'b', ten: 'B', email: 'b@x', authorIndex: 2, sharePercent: 30 },
      ],
      ngoai: [{ name: 'HV', sharePercent: 20 }, { name: 'Foreign', sharePercent: 0 }],
      raw: RAW,
    });
    expect(ds.map((d) => [d.hang, d.ten, d.userId, d.sharePercent, d.thuocTruong])).toEqual([
      [1, 'A', 'a', 50, true],
      [2, 'HV', null, 20, true],
      [3, 'B', 'b', 30, true],
    ]);
  });

  it('vân tay tài khoản không đổi khi chỉ đổi tên hiển thị; vân tay đầy đủ đổi khi người không tài khoản đổi %', () => {
    const base = {
      taiKhoan: [{ userId: 'a', ten: 'A', email: null, authorIndex: 0, sharePercent: 80 }],
      raw: RAW,
    };
    const d1 = phuongAnChia({ ...base, ngoai: [{ name: 'HV', sharePercent: 20 }] });
    const d2 = phuongAnChia({ ...base, ngoai: [{ name: 'HV', sharePercent: 10 }] });
    expect(vanTayTaiKhoan(d1)).toBe(vanTayTaiKhoan(d2));
    expect(vanTay(d1)).not.toBe(vanTay(d2));
  });
});

describe('trangThaiSau', () => {
  const ds: DongChia[] = [
    { hang: 1, ten: 'A', userId: 'a', email: null, sharePercent: 60, thuocTruong: true },
    { hang: 2, ten: 'B', userId: 'b', email: null, sharePercent: 40, thuocTruong: true },
  ];
  const ky = (id: string) => ({ userId: id, ten: id, at: '' });
  it('thiếu chữ ký → CHO_KY; đủ → CHO_DUYET', () => {
    expect(trangThaiSau({ hienTai: 'CHO_KY', shares: ds, chuKy: [ky('a')], tuChoi: [], coBanQuet: false })).toBe('CHO_KY');
    expect(trangThaiSau({ hienTai: 'CHO_KY', shares: ds, chuKy: [ky('a'), ky('b')], tuChoi: [], coBanQuet: false })).toBe('CHO_DUYET');
  });
  it('có người thuộc Trường không tài khoản → cần bản quét', () => {
    const coTay = [...ds, { hang: 3, ten: 'HV', userId: null, email: null, sharePercent: 1, thuocTruong: true }];
    expect(trangThaiSau({ hienTai: 'CHO_KY', shares: coTay, chuKy: [ky('a'), ky('b')], tuChoi: [], coBanQuet: false })).toBe('CHO_KY');
    expect(trangThaiSau({ hienTai: 'CHO_KY', shares: coTay, chuKy: [ky('a'), ky('b')], tuChoi: [], coBanQuet: true })).toBe('CHO_DUYET');
  });
  it('có người không đồng ý → BI_TU_CHOI_KY; Khoa từ chối chỉ quay lại hàng duyệt khi có bản quét mới', () => {
    expect(trangThaiSau({ hienTai: 'CHO_KY', shares: ds, chuKy: [ky('a')], tuChoi: [{ userId: 'b', ten: 'b', at: '', lyDo: 'x' }], coBanQuet: false })).toBe('BI_TU_CHOI_KY');
    const du = { shares: ds, chuKy: [ky('a'), ky('b')], tuChoi: [], coBanQuet: true };
    expect(trangThaiSau({ hienTai: 'KHOA_TU_CHOI', ...du })).toBe('KHOA_TU_CHOI');
    expect(trangThaiSau({ hienTai: 'KHOA_TU_CHOI', ...du, banQuetMoi: true })).toBe('CHO_DUYET');
    expect(trangThaiSau({ hienTai: 'DA_DUYET', ...du })).toBe('DA_DUYET');
  });
  it('apDungCach1: chưa có đơn (bài cũ) hoặc đã duyệt', () => {
    expect(apDungCach1(null)).toBe(true);
    expect(apDungCach1({ status: 'DA_DUYET' })).toBe(true);
    expect(apDungCach1({ status: 'CHO_DUYET' })).toBe(false);
    expect(apDungCach1({ status: 'CHO_KY' })).toBe(false);
  });
});

// ── Vòng đời với CSDL giả ──────────────────────────────────────────────────
const NGUOI: Record<string, { email: string; firstName: string; lastName: string }> = {
  a: { email: 'a@hcmus.edu.vn', firstName: 'An', lastName: 'Nguyễn' },
  b: { email: 'b@hcmus.edu.vn', firstName: 'Bình', lastName: 'Trần' },
};

function dung() {
  const tacGia = [
    { userId: 'a', authorIndex: 0, sharePercent: 60 as number | null, claimStatus: 'CONFIRMED' },
    { userId: 'b', authorIndex: 2, sharePercent: 40 as number | null, claimStatus: 'CONFIRMED' },
  ];
  const don: any[] = [];
  let n = 0;
  const prisma = {
    publication: {
      findUnique: vi.fn(async () => ({ id: 'p1', authorsRaw: RAW, title: 'Bài', totalAuthors: 4, deletedAt: null })),
      update: vi.fn(async () => ({})),
    },
    publicationAuthor: {
      findMany: vi.fn(async ({ where }: any) =>
        tacGia
          .filter((t) => (where.claimStatus?.not ? t.claimStatus !== where.claimStatus.not : t.claimStatus === where.claimStatus))
          .map((t) => ({ ...t, user: NGUOI[t.userId] })),
      ),
      findFirst: vi.fn(async () => null),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => (NGUOI[where.id] ? { ...NGUOI[where.id], canViewStats: false, isActive: true } : null)),
    },
    shareAgreement: {
      findFirst: vi.fn(async ({ where }: any) =>
        [...don].reverse().find((d) => d.publicationId === where.publicationId && d.status !== 'HET_HIEU_LUC') ?? null,
      ),
      findUnique: vi.fn(async ({ where }: any) => don.find((d) => d.id === where.id) ?? null),
      findMany: vi.fn(async () => [...don]),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => {
        const d = { id: `d${++n}`, declines: [], scanStoredName: null, createdAt: new Date(), ...data };
        don.push(d);
        return d;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(don.find((d) => d.id === where.id), data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const d = don.find((x) => x.id === where.id && x.status === where.status);
        if (!d) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const bus = { emit: vi.fn() };
  const svc = new ThoaThuanService(prisma as any, bus as any);
  return { svc, prisma, bus, don, tacGia };
}
const GV = RoleName.Lecturer;

describe('ThoaThuanService — chỉ lập đơn khi khai mới / đổi tỷ lệ', () => {
  let t: ReturnType<typeof dung>;
  beforeEach(() => {
    t = dung();
  });

  it('BÀI CŨ không đổi tỷ lệ → không lập đơn (223 khoản giữ nguyên)', async () => {
    const truoc = await t.svc.chupTruoc('p1');
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc, ngoai: [] });
    expect(t.don).toHaveLength(0);
  });

  it('đổi tỷ lệ → lập đơn chờ ký, người lập tự ký, báo người còn lại', async () => {
    const truoc = await t.svc.chupTruoc('p1');
    t.tacGia[0].sharePercent = 70;
    t.tacGia[1].sharePercent = 30;
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc, ngoai: [] });
    expect(t.don).toHaveLength(1);
    expect(t.don[0].status).toBe('CHO_KY');
    expect(t.don[0].signatures.map((c: any) => c.userId)).toEqual(['a']);
    expect(t.bus.emit).toHaveBeenCalledWith('publication.agreement', expect.objectContaining({ key: 'ky', emails: ['b@hcmus.edu.vn'] }));
  });

  it('lưu lại y nguyên → không lập đơn thứ hai; về Cách 2 → đơn hết hiệu lực', async () => {
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [], baiMoi: true });
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [] });
    expect(t.don).toHaveLength(1);
    t.tacGia.forEach((x) => (x.sharePercent = null));
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [] });
    expect(t.don[0].status).toBe('HET_HIEU_LUC');
  });

  it('đủ chữ ký → chờ Khoa duyệt; Khoa duyệt → DA_DUYET + báo người lập; duyệt lần hai → 409', async () => {
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [], baiMoi: true });
    const id = t.don[0].id;
    const kq = await t.svc.ky(id, 'b', GV);
    expect(kq.status).toBe('CHO_DUYET');
    expect(apDungCach1(t.don[0])).toBe(false); // chưa duyệt → vẫn Cách 2
    await t.svc.tichHopQuyet(id, { ok: true, by: 'Văn phòng Khoa' });
    expect(t.don[0].status).toBe('DA_DUYET');
    expect(apDungCach1(t.don[0])).toBe(true);
    expect(t.bus.emit).toHaveBeenCalledWith('publication.agreement', expect.objectContaining({ key: 'DA_DUYET', emails: ['a@hcmus.edu.vn'] }));
    await expect(t.svc.tichHopQuyet(id, { ok: true, by: 'x' })).rejects.toMatchObject({ status: 409 });
  });

  it('có học viên thuộc Trường không tài khoản → chờ bản quét rồi mới vào hàng duyệt', async () => {
    t.tacGia[0].sharePercent = 50;
    t.tacGia[1].sharePercent = 30;
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [{ name: 'HV', sharePercent: 20 }], baiMoi: true });
    const id = t.don[0].id;
    expect((await t.svc.ky(id, 'b', GV)).status).toBe('CHO_KY');
    const kq = await t.svc.taiBanQuet(id, 'a', GV, {
      path: 'x',
      filename: 'f.pdf',
      originalname: 'don.pdf',
      mimetype: 'application/pdf',
    } as any);
    expect(kq.status).toBe('CHO_DUYET');
    expect(kq.coBanQuet).toBe(true);
  });

  it('không đồng ý (bắt lý do) → BI_TU_CHOI_KY + báo người lập; sau đó ký lại được', async () => {
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [], baiMoi: true });
    const id = t.don[0].id;
    await expect(t.svc.khongDongY(id, 'b', GV, 'ngắn')).rejects.toMatchObject({ status: 422 });
    const kq = await t.svc.khongDongY(id, 'b', GV, 'Tôi làm phần đo đạc chính, đề nghị 50%.');
    expect(kq.status).toBe('BI_TU_CHOI_KY');
    expect(t.bus.emit).toHaveBeenCalledWith('publication.agreement', expect.objectContaining({ key: 'khong-dong-y', emails: ['a@hcmus.edu.vn'] }));
    expect((await t.svc.ky(id, 'b', GV)).status).toBe('CHO_DUYET');
  });

  it('Khoa từ chối phải ghi lý do; người ngoài đơn không ký được', async () => {
    await t.svc.capNhatSauKhiLuu('p1', 'a', { truoc: null, ngoai: [], baiMoi: true });
    const id = t.don[0].id;
    await expect(t.svc.ky(id, 'la', GV)).rejects.toMatchObject({ status: 403 });
    await t.svc.ky(id, 'b', GV);
    await expect(t.svc.tichHopQuyet(id, { ok: false, by: 'VP' })).rejects.toMatchObject({ status: 422 });
    await t.svc.tichHopQuyet(id, { ok: false, note: 'Bản quét mờ', by: 'VP' });
    expect(t.don[0].status).toBe('KHOA_TU_CHOI');
  });
});

// ── Cổng ở kênh tích hợp NCKH: đơn chưa duyệt → không gửi tỷ lệ (Cách 2) ────────
import { ScholarService } from './scholar.service';

describe('integrationList — gác tỷ lệ Cách 1 theo đơn thoả thuận', () => {
  const dong = (pubId: string, pct: number) => ({
    publicationId: pubId,
    userId: 'a',
    authorIndex: 0,
    isFirst: true,
    isCorresponding: false,
    isLast: false,
    sharePercent: pct,
    claimStatus: 'CONFIRMED',
    updatedAt: new Date(),
    user: { email: 'a@hcmus.edu.vn' },
    publication: {
      id: pubId,
      doi: null,
      source: 'crossref',
      title: pubId,
      containerTitle: null,
      url: null,
      status: 'PUBLISHED',
      countYear: 2026,
      publishedYear: 2026,
      publishedMonth: 1,
      acceptedYear: null,
      acceptedMonth: null,
      catalogCode: '1.1c',
      quartile: 'Q2',
      satellite: false,
      reprint: false,
      fromProject: false,
      stage: 0,
      totalAuthors: 2,
      schoolAuthors: 2,
      mainAuthorAtSchool: true,
      externalMainAuthors: 0,
      authorsRaw: [{ name: 'A' }, { name: 'B' }],
      deletedAt: null,
      updatedAt: new Date(),
      authors: [{ claimStatus: 'CONFIRMED', authorIndex: 0, isFirst: true, isCorresponding: false, isLast: false }],
    },
  });

  it('bài cũ (không đơn) và đơn đã duyệt → gửi %; đơn chờ ký / chờ duyệt → null', async () => {
    const prisma = {
      publicationAuthor: {
        findMany: vi.fn(async () => [dong('cu', 60), dong('duyet', 70), dong('cho', 80), dong('choKy', 90)]),
      },
    };
    const thoaThuan = {
      donMoiNhatTheoBai: vi.fn(
        async () =>
          new Map([
            ['duyet', { id: 'd1', status: 'DA_DUYET' }],
            ['cho', { id: 'd2', status: 'CHO_DUYET' }],
            ['choKy', { id: 'd3', status: 'CHO_KY' }],
          ]),
      ),
    };
    const svc = new ScholarService(prisma as never, {} as never, {} as never, {} as never, {} as never, thoaThuan as never);
    const { items } = (await svc.integrationList({} as never)) as { items: any[] };
    const theo = Object.fromEntries(items.map((x) => [x.publicationId, [x.sharePercent, x.thoaThuan?.status ?? null]]));
    expect(theo).toEqual({
      cu: [60, null],
      duyet: [70, 'DA_DUYET'],
      cho: [null, 'CHO_DUYET'],
      choKy: [null, 'CHO_KY'],
    });
  });
});
