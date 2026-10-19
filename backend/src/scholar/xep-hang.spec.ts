import { describe, expect, it, vi } from 'vitest';
import {
  chuanHoaIssn,
  docBangCore,
  docBangSjr,
  docCsv,
  docDanhSachBanCore,
  nhacBangSjr,
  soSanhMa,
  goiYTheoCore,
  goiYTheoTr22,
  khopHoiNghi,
  maTheoBang,
  vietTatUngVien,
} from './xep-hang';
import { XepHangService } from './xep-hang.service';

/**
 * Gợi ý mã Phụ lục 2 từ bảng SCImago / CORE (4/10/2026). Trước đó form ghi "hệ
 * thống không tự đoán Q1–Q4", và đợt soát toàn Khoa tìm ra hàng chục mã lệch.
 */

/** Bảng SJR thu nhỏ: 25 tạp chí cùng một ngành (đủ để có hạng 18 và hạng 22). */
function bangMau(nam: number, them: string[] = []) {
  const h = `Rank;Sourceid;Title;Type;Issn;Publisher;SJR;SJR Best Quartile;Total Docs. (${nam});Categories`;
  const dong = Array.from({ length: 25 }, (_, i) => {
    const sjr = (30 - i).toFixed(3).replace('.', ',');
    return `${i + 1};${1000 + i};"Tap chi ${i + 1}";journal;"1111${String(1000 + i).slice(-4)}";"NXB";${sjr};Q1;10;"Physics (Q1)"`;
  });
  return [h, ...dong, ...them].join('\n');
}

describe('đọc CSV', () => {
  it('ô có nháy chứa dấu phân cách và nháy kép', () => {
    expect(docCsv('a;"b;c";"d ""e"""\n1;2;3', ';')).toEqual([
      ['a', 'b;c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
  it('chuẩn hoá ISSN: có/không gạch, chữ X, trùng', () => {
    expect(chuanHoaIssn('0026-3672, 1436-5073; 00263672')).toEqual(['00263672', '14365073']);
    expect(chuanHoaIssn('2302-929x')).toEqual(['2302929X']);
    expect(chuanHoaIssn(null)).toEqual([]);
  });
});

describe('docBangSjr — hạng trong ngành và mã của một bảng', () => {
  const { nam, ds } = docBangSjr(
    bangMau(2025, [
      // Hạng 3 ở ngành nhỏ nhưng chỉ Q2 ở đó → KHÔNG phải TOP 20 (mục 1.1a cần Q1).
      `26;2000;"Nganh nho";journal;"22220000";"NXB";5,000;Q2;10;"Surfaces and Interfaces (Q2)"`,
      `27;2001;"A";journal;"22220001";"NXB";9,000;Q1;10;"Surfaces and Interfaces (Q1)"`,
      `28;2002;"B";journal;"22220002";"NXB";8,000;Q1;10;"Surfaces and Interfaces (Q1)"`,
      `29;3000;"Ky yeu";conference and proceedings;"17426588";"IOP";0,200;Q4;10;"Physics (Q4)"`,
    ]),
  );
  const theo = (sid: string) => ds.find((x) => x.sourceId === sid)!;

  it('năm của bảng đọc từ cột "Total Docs. (YYYY)"', () => {
    expect(nam).toBe(2025);
  });
  it('hạng 18 (Q1) → 1.1a; hạng 22 (Q1) → 1.1b', () => {
    expect(theo('1017').categories[0].rank).toBe(18);
    expect(theo('1017').code).toBe('1.1a');
    expect(theo('1021').code).toBe('1.1b');
  });
  it('hạng 3 ở ngành mà tạp chí chỉ Q2 → 1.1c, không phải TOP 20', () => {
    expect(theo('2000').categories[0].rank).toBe(3);
    expect(theo('2000').code).toBe('1.1c');
  });
  it('kỷ yếu (conference and proceedings) → 2.1e', () => {
    expect(theo('3000').code).toBe('2.1e');
  });
  it('mã của bảng lấy ngành cho mã CAO nhất', () => {
    expect(
      maTheoBang('journal', [
        { name: 'X', quartile: 'Q3', rank: 5, total: 50 },
        { name: 'Y', quartile: 'Q1', rank: 40, total: 300 },
      ]),
    ).toBe('1.1b');
  });
});

const nam = (code: string | null, quartile: string | null, top = false) => ({
  code,
  bestQuartile: quartile,
  categories: top ? [{ name: 'Physics', quartile: 'Q1', rank: 18, total: 300 }] : [],
});

describe('Phụ lục 2 tr. 2.2 — lấy kết quả cao hơn giữa bảng mới và bảng liền trước', () => {
  it('bài 2026: SJR 2025 Q2 nhưng SJR 2024 Q1 TOP 20 → 1.1a', () => {
    const g = goiYTheoTr22(
      new Map([
        [2025, nam('1.1c', 'Q2')],
        [2024, nam('1.1a', 'Q1', true)],
      ]),
      2026,
      [2025, 2024, 2023],
    );
    expect(g.ma).toBe('1.1a');
    expect(g.bang.map((b) => b.nam)).toEqual([2025, 2024]);
    expect(g.thieuBang).toBeNull();
  });
  it('bài 2025 xét SJR 2024 và 2023 — bảng 2025 KHÔNG áp', () => {
    const g = goiYTheoTr22(
      new Map([
        [2025, nam('1.1b', 'Q1')],
        [2024, nam('1.1d', 'Q3')],
        [2023, nam('1.1e', 'Q4')],
      ]),
      2025,
      [2025, 2024, 2023],
    );
    expect(g.ma).toBe('1.1d');
    expect(g.bang.map((b) => b.nam)).toEqual([2024, 2023]);
  });
  it('chưa nạp bảng (Y−1) → dùng hai bảng mới nhất đã có, và nói ra', () => {
    const g = goiYTheoTr22(new Map([[2025, nam('1.1c', 'Q2')]]), 2027, [2025, 2024]);
    expect(g.bang.map((b) => b.nam)).toEqual([2025, 2024]);
    expect(g.thieuBang).toBe(2026);
    expect(g.ma).toBe('1.1c');
  });
  it('tạp chí vắng mặt ở bảng mới (bị loại khỏi Scopus) → bảng đó không cho mã', () => {
    const g = goiYTheoTr22(new Map([[2024, nam('1.1d', 'Q3')]]), 2026, [2025, 2024]);
    expect(g.ma).toBe('1.1d');
    expect(g.bang[0]).toMatchObject({ nam: 2025, ma: null });
  });
});

const CORE = `2172, International Conference on Advanced Communications and Computation,INFOCOMP,CORE2023,Unranked,Yes,46,,
11,"ACM Conference on Applications, Technologies, Architectures, and Protocols for Computer Communication",SIGCOMM,CORE2023,A*,Yes,4606,,
50,International Conference on Acoustics Speech and Signal Processing,ICASSP,CORE2023,B,Yes,4006,,
51,International Conference on Acoustics Speech and Signal Processing,ICASSP,ICORE2026,A,Yes,4006,,
60,International Conference on Image Processing,ICIP,CORE2023,B,Yes,4603,,`;

describe('CORE — hội nghị (Phụ lục 2 mục 2.1)', () => {
  const ds = docBangCore(CORE);
  it('đọc tệp Export (không có dòng tiêu đề, tên có dấu phẩy trong nháy)', () => {
    expect(ds).toHaveLength(5);
    expect(ds[1]).toMatchObject({ acronym: 'SIGCOMM', rank: 'A*', source: 'CORE2023' });
  });
  it('chữ viết tắt trong tên kỷ yếu', () => {
    expect(vietTatUngVien('2025 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP 2025)')).toContain('ICASSP');
    expect(vietTatUngVien('Eighth International Conference on Image Processing and Machine Vision (IPMV 2026)')).toContain('IPMV');
  });
  it('khớp theo viết tắt + tên; bài 2026 lấy cao hơn giữa ICORE2026 (A) và CORE2023 (B) → 2.1b', () => {
    const khop = khopHoiNghi(
      '2026 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP)',
      ds,
    );
    expect(khop.map((h) => h.source).sort()).toEqual(['CORE2023', 'ICORE2026']);
    expect(goiYTheoCore(khop, 2026).ma).toBe('2.1b');
    // Bài 2025: ICORE2026 chưa ra → chỉ CORE2023 (B) → 2.1c.
    expect(goiYTheoCore(khop, 2025).ma).toBe('2.1c');
  });
  it('không bắt nhầm hội nghị khác tên dù trùng vài chữ', () => {
    expect(khopHoiNghi('International Conference on Image Processing and Machine Vision (IPMV 2026)', ds)).toEqual([]);
  });
});

describe('XepHangService.goiY', () => {
  function dung(rows: Record<string, unknown>[], core: Record<string, unknown>[] = []) {
    const prisma = {
      journalRanking: {
        findMany: vi.fn((args: { distinct?: string[] }) =>
          Promise.resolve(
            args.distinct ? [{ year: 2025 }, { year: 2024 }, { year: 2023 }] : rows,
          ),
        ),
      },
      conferenceRanking: { findMany: vi.fn().mockResolvedValue(core) },
    };
    return { svc: new XepHangService(prisma as never), prisma };
  }
  const dongNam = (year: number, code: string, quartile: string, rank = 30) => ({
    year,
    sourceId: '15652',
    title: 'Ceramics International',
    bestQuartile: quartile,
    code,
    categories: [{ name: 'Process Chemistry and Technology', quartile, rank, total: 70 }],
  });

  it('tạp chí theo ISSN — bài 2026: 2025 1.1b, 2024 TOP 20 → 1.1a, kèm lời giải thích', async () => {
    const { svc, prisma } = dung([dongNam(2025, '1.1b', 'Q1', 25), dongNam(2024, '1.1a', 'Q1', 18)]);
    const g = await svc.goiY({ issn: '0272-8842', year: 2026 });
    expect(prisma.journalRanking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { issns: { hasSome: ['02728842'] } } }),
    );
    expect(g).toMatchObject({ nguon: 'sjr', ma: '1.1a', tieuDe: 'Ceramics International' });
    expect(g.bang[1].hang).toContain('TOP 20: Process Chemistry and Technology #18');
    expect(g.giaiThich).toContain('Phụ lục 2 tr. 2.2');
  });

  it('không thấy trong bảng → không đoán, bảo tra tay', async () => {
    const { svc } = dung([]);
    const g = await svc.goiY({ issn: '9999-9999', year: 2026 });
    expect(g).toMatchObject({ nguon: null, ma: null });
    expect(g.giaiThich).toContain('Tra tay');
  });

  it('kỷ yếu có tên hội nghị → dò CORE trước', async () => {
    const { svc } = dung([], docBangCore(CORE));
    const g = await svc.goiY({
      venue: '2026 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP)',
      year: 2026,
    });
    expect(g).toMatchObject({ nguon: 'core', ma: '2.1b' });
  });
});

describe('tự động hoá — CORE, nhắc SJR, so mã', () => {
  it('đọc danh sách phiên bản CORE trên trang, mới nhất trước', () => {
    const html =
      '<select name="source" id="s"><option value="all">All</option><option value="ICORE2026">ICORE2026</option>' +
      '<option value="CORE2023" selected>CORE2023</option><option value="CORE2021">CORE2021</option></select>';
    expect(docDanhSachBanCore(html)).toEqual(['ICORE2026', 'CORE2023', 'CORE2021']);
  });

  it('nhắc bảng SJR kỳ đang chạy còn thiếu — bảng chưa ra thì chưa nhắc', () => {
    const t10 = new Date(2026, 9, 4);
    expect(nhacBangSjr([2024, 2023], t10)).toHaveLength(1);
    expect(nhacBangSjr([2024, 2023], t10)[0]).toContain('SJR 2025');
    expect(nhacBangSjr([2025, 2024, 2023], t10)).toEqual([]);
    // Tháng 3/2026: SCImago chưa ra bảng 2025 → không đòi.
    expect(nhacBangSjr([2024, 2023], new Date(2026, 2, 1))).toEqual([]);
    // Tháng 12/2026: kỳ 2026-2027 — bảng 2026 chưa ra; còn thiếu 2024.
    const t12 = nhacBangSjr([2025], new Date(2026, 11, 1));
    expect(t12).toHaveLength(1);
    expect(t12[0]).toContain('SJR 2024');
  });

  it('so mã khai với gợi ý: nâng / hạ / đổi mục; mã ngoài nhóm thì không so', () => {
    expect(soSanhMa('1.1b', '1.1a')).toBe('nang');
    expect(soSanhMa('1.1a', '1.1d')).toBe('ha');
    expect(soSanhMa('1.1e', '2.1e')).toBe('doi');
    expect(soSanhMa('2.1e', '1.1c')).toBe('nang');
    expect(soSanhMa('1.1c', '1.1c')).toBeNull();
    expect(soSanhMa('1.2', '1.1c')).toBeNull();
  });
});

describe('XepHangService — soát mã lệch và áp mã', () => {
  const bai = (o: Record<string, unknown> = {}) => ({
    id: 'p1',
    title: 'Bài thử',
    containerTitle: 'Ceramics International',
    issn: '0272-8842',
    type: 'journal-article',
    publishedYear: 2026,
    publishedMonth: 8,
    catalogCode: '1.1b',
    authors: [{ userId: 'u-thu', user: { lastName: 'Nguyễn Văn', firstName: 'Thử' } }],
    ...o,
  });
  const dongTapChi = (year: number, code: string, rank: number) => ({
    year,
    sourceId: '15652',
    title: 'Ceramics International',
    issns: ['02728842'],
    bestQuartile: 'Q1',
    code,
    categories: [{ name: 'Process Chemistry and Technology', quartile: 'Q1', rank, total: 70 }],
  });
  function dungSoat(pubs: ReturnType<typeof bai>[]) {
    const prisma = {
      publication: {
        findMany: vi.fn().mockResolvedValue(pubs),
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(pubs.find((p) => p.id === where.id) ?? null),
        ),
        update: vi.fn().mockResolvedValue({}),
      },
      journalRanking: {
        findMany: vi.fn((args: { distinct?: string[] }) =>
          Promise.resolve(
            args.distinct
              ? [{ year: 2025 }, { year: 2024 }, { year: 2023 }]
              : [dongTapChi(2025, '1.1b', 25), dongTapChi(2024, '1.1a', 18)],
          ),
        ),
      },
      conferenceRanking: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const bus = { emit: vi.fn() };
    return { svc: new XepHangService(prisma as never, bus as never), prisma, bus };
  }

  it('liệt kê bài có mã khác bảng; bỏ bài khớp và bài ngoài khoảng tháng', async () => {
    const { svc } = dungSoat([
      bai(),
      bai({ id: 'p2', catalogCode: '1.1a' }),
      bai({ id: 'p3', publishedMonth: 11 }),
    ]);
    const kq = await svc.lechMa('2025-11', '2026-10');
    expect(kq.soBai).toBe(2);
    expect(kq.items.map((x) => [x.id, x.maKhai, x.maGoiY, x.huong])).toEqual([
      ['p1', '1.1b', '1.1a', 'nang'],
    ]);
    expect(kq.items[0].tacGia).toEqual(['Nguyễn Văn Thử']);
  });

  it('áp mã: tính lại gợi ý, ghi mã + nhật ký trong một giao dịch, báo ACADsoom', async () => {
    const { svc, prisma, bus } = dungSoat([bai()]);
    expect(await svc.apDungMa('admin-1', 'p1', '1.1b')).toEqual({ id: 'p1', maMoi: '1.1a' });
    expect(prisma.publication.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ catalogCode: '1.1a', quartile: 'Q1', classifiedBy: 'admin-1' }),
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'publication.admin-fix',
      entityId: 'p1',
      changes: { truoc: { catalogCode: '1.1b' }, sau: { catalogCode: '1.1a' } },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith('publication.changed', { id: 'p1', userIds: ['u-thu'] });
  });

  it('mã trong CSDL đã khác mã quản trị đang nhìn → dừng, không ghi gì', async () => {
    const { svc, prisma } = dungSoat([bai({ catalogCode: '1.1c' })]);
    await expect(svc.apDungMa('admin-1', 'p1', '1.1b')).rejects.toBeDefined();
    expect(prisma.publication.update).not.toHaveBeenCalled();
  });
});

describe('XepHangService.taiCore — tải CORE thẳng từ portal', () => {
  it('nạp hai phiên bản mới nhất; lượt hằng tháng bỏ qua bản đã có', async () => {
    const html =
      '<select name="source"><option value="all">All</option><option value="ICORE2026">a</option>' +
      '<option value="CORE2023">b</option><option value="CORE2021">c</option></select>';
    const csv = (ban: string | null) =>
      Array.from(
        { length: 120 },
        (_, i) => `${i + 1},Hoi nghi thu ${i + 1},HN${i + 1},${ban},${i % 4 ? 'B' : 'A'},Yes,46,,`,
      ).join('\n');
    const goi = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            url.includes('do=Export') ? csv(new URL(url).searchParams.get('source')) : html,
          ),
      }),
    );
    vi.stubGlobal('fetch', goi);
    const prisma = {
      conferenceRanking: {
        findMany: vi.fn().mockResolvedValue([{ source: 'CORE2023' }]),
        deleteMany: vi.fn().mockReturnValue('xoa'),
        createMany: vi.fn().mockReturnValue('tao'),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    try {
      const svc = new XepHangService(prisma as never);
      const thang = await svc.taiCore(false);
      expect(thang.phienBan).toEqual([
        { ban: 'ICORE2026', trangThai: 'đã nạp 120 hội nghị' },
        { ban: 'CORE2023', trangThai: 'đã có, không tải lại' },
      ]);
      expect(goi).toHaveBeenCalledTimes(2);
      const epBuoc = await svc.taiCore(true);
      expect(epBuoc.phienBan.map((x) => x.ban)).toEqual(['ICORE2026', 'CORE2023']);
      expect(goi).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
