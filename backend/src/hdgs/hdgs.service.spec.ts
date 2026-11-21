import { describe, expect, it, vi } from 'vitest';
import { HdgsService } from './hdgs.service';

const bai = (id: string, x: Record<string, unknown> = {}) => ({
  id,
  title: `Bài ${id}`,
  containerTitle: 'J',
  type: 'journal-article',
  catalogCode: '1.1b',
  issn: '1234-5678',
  publishedYear: 2025,
  countYear: 2025,
  status: 'PUBLISHED',
  doi: '10.1/x',
  url: null,
  totalAuthors: 3,
  authorsRaw: [{ name: 'A' }, { name: 'B' }, { name: 'C', isCorresponding: true }],
  authors: [{ authorIndex: 0, isCorresponding: false }],
  ...x,
});

function dung(opts: { bang?: any[]; namCo?: number[]; dong?: any[]; nhap?: any[]; xacNhan?: string } = {}) {
  const dong = opts.dong ?? [
    { userId: 'u1', authorIndex: 0, isFirst: true, isCorresponding: false, publication: bai('p1') },
  ];
  const prisma = {
    publicationAuthor: {
      findMany: vi.fn(async ({ where }: any) => dong.filter((d) => !where.userId || d.userId === where.userId)),
      findUnique: vi.fn(async () =>
        opts.xacNhan ? { claimStatus: opts.xacNhan, publication: { deletedAt: null } } : null,
      ),
    },
    journalRanking: {
      findMany: vi.fn(async ({ distinct }: any) =>
        distinct ? (opts.namCo ?? [2024]).map((year) => ({ year })) : (opts.bang ?? []),
      ),
    },
    hdgsInput: {
      findMany: vi.fn(async () => opts.nhap ?? []),
      upsert: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async () => ({ id: 'u1', firstName: 'An', lastName: 'Nguyễn Văn', email: 'a@x' })),
      findMany: vi.fn(async () => [
        { id: 'u1', firstName: 'An', lastName: 'Nguyễn Văn', email: 'a@x', department: { name: 'Vật lý Tin học' } },
      ]),
    },
  };
  return { svc: new HdgsService(prisma as any), prisma };
}

describe('HdgsService — dữ kiện + bảng SCImago hiện hành lúc xuất bản', () => {
  it('bài 2025 dùng bảng 2024 (đã nạp): Q1, H 120 → trần 3,0; liên hệ duy nhất hàng 3 → hai tác giả chính', async () => {
    const { svc } = dung({
      bang: [{ year: 2024, issns: ['12345678'], bestQuartile: 'Q1', hIndex: 120, type: 'journal' }],
    });
    const kq = await svc.cuaToi('u1', { den: 2026 });
    const r = kq.rows[0];
    expect(r.nguonQ).toBe('SCImago 2024');
    expect(r.tran).toBe(3);
    expect(r.soTacGiaChinh).toBe(2);
    // 3 × (1/3 ÷ 2 + 2/3 ÷ 3)
    expect(r.diem).toBeCloseTo(3 * (1 / 6 + 2 / 9), 2);
    expect(kq.tong.tong).toBe(r.diem);
  });

  it('bảng năm cần đã nạp mà tạp chí vắng → không coi là Scopus năm đó (lùi về mã đã khai)', async () => {
    const { svc } = dung({
      namCo: [2023, 2024],
      bang: [{ year: 2023, issns: ['12345678'], bestQuartile: 'Q1', hIndex: 120, type: 'journal' }],
    });
    const r = (await svc.cuaToi('u1', {})).rows[0];
    expect(r.nguonQ).toBe('theo mã 1.1b đã khai');
    expect(r.tran).toBe(2.5);
  });

  it('bảng năm cần chưa nạp → lấy bảng gần nhất, đánh dấu lệch', async () => {
    const { svc } = dung({
      namCo: [2023],
      bang: [{ year: 2023, issns: ['12345678'], bestQuartile: 'Q2', hIndex: 30, type: 'journal' }],
      dong: [{ userId: 'u1', authorIndex: 1, isFirst: false, isCorresponding: false, publication: bai('p1', { publishedYear: 2019 }) }],
    });
    const r = (await svc.cuaToi('u1', {})).rows[0];
    expect(r.nguonQ).toMatch(/^SCImago 2023 — chưa nạp bảng 2018, đang tạm lấy bảng gần nhất/);
    expect(r.laTacGiaChinh).toBe(false);
  });

  it('ghi lúc nạp bảng SCImago đã dùng (lần cập nhật cuối)', async () => {
    const { svc } = dung({
      namCo: [2023],
      bang: [
        { year: 2023, issns: ['12345678'], bestQuartile: 'Q2', hIndex: 30, type: 'journal', createdAt: new Date('2026-11-20T15:59:00Z') },
      ],
      dong: [{ userId: 'u1', authorIndex: 0, isFirst: true, isCorresponding: false, publication: bai('p1', { publishedYear: 2024 }) }],
    });
    const r = (await svc.cuaToi('u1', {})).rows[0];
    expect(r.nguonQ).toBe('SCImago 2023 · nạp 20/11/2026');
  });

  it('phần tự nhập đè lên hệ thống (IF 4,5 → 3,0) và trả lại cho form', async () => {
    const { svc } = dung({ nhap: [{ userId: 'u1', publicationId: 'p1', impactFactor: 4.5 }] });
    const r = (await svc.cuaToi('u1', {})).rows[0];
    expect(r.tran).toBe(3);
    expect(r.nhap?.impactFactor).toBe(4.5);
  });

  it('chỉ nhập được cho công trình mình đã xác nhận', async () => {
    await expect(dung({ xacNhan: 'PENDING' }).svc.luuNhapTay('u1', 'p1', { impactFactor: 3 })).rejects.toMatchObject({ status: 403 });
    const ok = dung({ xacNhan: 'CONFIRMED' });
    await ok.svc.luuNhapTay('u1', 'p1', { impactFactor: 3, trichDan: undefined });
    expect(ok.prisma.hdgsInput.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { impactFactor: 3 } }), // undefined KHÔNG ghi đè ô cũ
    );
  });

  it('bảng cả Khoa: một dòng mỗi người, kèm bộ môn và cờ đạt chuẩn', async () => {
    const kq = await dung().svc.caKhoa({ den: 2026 });
    expect(kq.items).toHaveLength(1);
    expect(kq.items[0]).toMatchObject({ userId: 'u1', ten: 'Nguyễn Văn An', boMon: 'Vật lý Tin học', soCongTrinh: 1, datPGS: false });
  });
});
