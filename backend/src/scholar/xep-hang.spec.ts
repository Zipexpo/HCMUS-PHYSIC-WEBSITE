import { describe, expect, it, vi } from 'vitest';
import {
  chuanHoaChiMuc,
  chuanHoaIssn,
  docKhoangNam,
  nhacDanhSachScopus,
  xetScopus,
  xetWos,
  type NguonChiMuc,
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
  it('cùng viết tắt mà khác tên riêng thì không khớp, dù trùng "International Conference on"', () => {
    const atc = [
      {
        title:
          'International Conference on Advanced and Trusted Computing (was International Conference on Autonomic and Trusted Computing)',
        acronym: 'ATC',
        source: 'CORE2023',
        rank: 'C',
      },
    ];
    expect(
      khopHoiNghi('2025 International Conference on Advanced Technologies for Communications (ATC)', atc),
    ).toEqual([]);
    expect(khopHoiNghi('2025 IEEE International Conference on Advanced and Trusted Computing (ATC)', atc)).toHaveLength(1);
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
      // Chưa nạp danh sách Scopus / WoS → gợi ý y như trước 21/11/2026.
      indexedSource: { findMany: vi.fn().mockResolvedValue([]) },
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
      indexedSource: { findMany: vi.fn().mockResolvedValue([]) },
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

describe('XepHangService.napSjr — bảng đầy đủ ~32.000 dòng', () => {
  it('ghi trong MỘT giao dịch tự mở, trần thời gian đủ dài (không dùng trần mặc định 5 giây)', async () => {
    const dong = Array.from(
      { length: 10_001 },
      (_, i) => `${i + 1};${1000 + i};"Tap chi ${i + 1}";journal;"${10_000_000 + i}";1,5;Q2;10;"Physics (Q2)"`,
    );
    const csv = ['Rank;Sourceid;Title;Type;Issn;SJR;SJR Best Quartile;Total Docs. (2025);Categories', ...dong].join('\n');
    const tx = {
      journalRanking: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2000 }),
      },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const kq = await new XepHangService(prisma as never).napSjr(csv);
    expect(kq).toMatchObject({ loai: 'sjr', ten: 'SJR 2025', soDong: 10_001 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const [fn, opts] = prisma.$transaction.mock.calls[0] as unknown as [unknown, { timeout: number }];
    expect(typeof fn).toBe('function');
    expect(opts.timeout).toBeGreaterThanOrEqual(60_000);
    expect(tx.journalRanking.deleteMany).toHaveBeenCalledWith({ where: { year: 2025 } });
    expect(tx.journalRanking.createMany).toHaveBeenCalledTimes(6);
    const ghi = tx.journalRanking.createMany.mock.calls.reduce((t, [a]) => t + a.data.length, 0);
    expect(ghi).toBe(10_001);
  });
});

// ── Danh sách chỉ mục Scopus / WoS (21/11/2026) ─────────────────────────────

/** Optical and Quantum Electronics: Scopus ghi phủ 1969–2025 nhưng ngừng nhận sau tập 56 số 8 (2024). */
const OQE: NguonChiMuc = {
  sourceId: '12313',
  title: 'Optical and Quantum Electronics',
  type: 'Journal',
  issns: ['03068919', '1572817X'],
  coverage: [[1969, 2025]],
  active: false,
  finalYear: 2024,
  finalIssue: 'tập 56, số 8',
  finalReason: 'Discontinuation',
};
const nguon = (o: Partial<NguonChiMuc>): NguonChiMuc => ({
  sourceId: '1',
  title: 'Tap chi',
  type: 'Journal',
  issns: ['11112222'],
  coverage: [[2020, 2026]],
  active: true,
  finalYear: null,
  finalIssue: null,
  finalReason: null,
  ...o,
});

describe('Danh sách chỉ mục — đọc và xét năm', () => {
  it('cột Coverage của Scopus: nhiều khoảng, năm lẻ, sắp tăng dần', () => {
    expect(docKhoangNam('2026; 2023-2024; 1997')).toEqual([
      [1997, 1997],
      [2023, 2024],
      [2026, 2026],
    ]);
    expect(docKhoangNam('')).toEqual([]);
  });

  it('Scopus: khoá theo Sourcerecord ID, ISSN chuẩn hoá, gộp dòng trùng', () => {
    const ds = chuanHoaChiMuc('scopus', [
      { sourceId: '12313', title: 'Optical and Quantum Electronics', issn: '0306-8919 1572-817x', coverage: '1969-2025', active: false },
      { sourceId: '12313', title: 'Optical and Quantum Electronics', issn: '0306-8919', finalYear: 2024, finalIssue: 'tập 56, số 8', finalReason: 'Discontinuation' },
      { sourceId: '99', title: 'Kỷ yếu', type: 'Conference Proceedings', issn: '1742-6588', coverage: '2004-2026', active: true },
    ]);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({
      sourceId: '12313',
      issns: ['03068919', '1572817X'],
      coverage: [[1969, 2025]],
      active: false,
      finalYear: 2024,
      finalIssue: 'tập 56, số 8',
    });
    expect(ds[1].type).toBe('Conference Proceedings');
  });

  it('WoS: một tạp chí ở hai bộ (SCIE và SSCI) thành một dòng', () => {
    const ds = chuanHoaChiMuc('wos', [
      { title: 'Energy Policy', type: 'SSCI', issn: '0301-4215 1873-6777' },
      { title: 'ENERGY POLICY', type: 'SCIE', issn: '0301-4215' },
      { title: 'Optics Letters', type: 'SCIE', issn: '0146-9592' },
    ]);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({ sourceId: '03014215', type: 'SCIE, SSCI', coverage: [], active: true });
  });

  it('Scopus đã ngừng nhận: bài năm sau → không thuộc; cùng năm → phải xem số; trước đó → thuộc', () => {
    const sau = xetScopus([OQE], 2025, 'Scopus Sources Oct. 2026');
    expect(sau.trangThai).toBe('khong');
    expect(sau.lyDo).toContain('ngừng nhận «Optical and Quantum Electronics» sau tập 56, số 8, năm 2024');
    expect(xetScopus([OQE], 2024, 'x').trangThai).toBe('xem');
    expect(xetScopus([OQE], 2023, 'x')).toMatchObject({
      trangThai: 'co',
      lyDo: '«Optical and Quantum Electronics» — Scopus phủ 1969–2025.',
    });
  });

  it('ISSN ghi nhầm sang tạp chí khác: lời giải thích nêu tên theo Scopus', () => {
    // Đo 21/11/2026: một bài "Archives of Medical Research" ghi ISSN 0066-6769 của tạp chí khác.
    const x = xetScopus(
      [nguon({ title: 'Archivos de Investigacion Medica', coverage: [[1970, 1991]], active: false })],
      2020,
      'x',
    );
    expect(x).toMatchObject({ trangThai: 'khong', tieuDe: 'Archivos de Investigacion Medica' });
    expect(x.lyDo).toBe('«Archivos de Investigacion Medica» — Scopus phủ 1970–1991; năm 2020 không nằm trong đó.');
  });

  it('khoảng trống trong Coverage, nguồn còn nhận bài, không có trong danh sách', () => {
    const gian = nguon({ coverage: [[1997, 2015], [2018, 2026]] });
    expect(xetScopus([gian], 2016, 'x')).toMatchObject({ trangThai: 'khong' });
    expect(xetScopus([gian], 2016, 'x').lyDo).toContain('1997–2015, 2018–2026; năm 2016 không nằm trong đó');
    expect(xetScopus([nguon({})], 2027, 'x')).toMatchObject({ trangThai: 'co' });
    expect(xetScopus([nguon({ active: false })], 2027, 'x')).toMatchObject({ trangThai: 'khong' });
    expect(xetScopus([], 2026, 'Scopus Sources Oct. 2026')).toEqual({
      trangThai: 'khong',
      tieuDe: null,
      lyDo: 'Không có trong danh sách Scopus (Scopus Sources Oct. 2026).',
    });
  });

  it('WoS chỉ nói hiện tại — lời giải thích ghi rõ bản danh sách', () => {
    expect(xetWos([nguon({ type: 'ESCI' })], 'WoS MJL 2026-11-18')).toMatchObject({
      trangThai: 'co',
      lyDo: expect.stringContaining('Thuộc Web of Science (ESCI) theo danh sách WoS MJL 2026-11-18'),
    });
    expect(xetWos([], 'WoS MJL 2026-11-18').trangThai).toBe('khong');
  });

  it('nhắc nạp danh sách Scopus: chưa nạp, hoặc nạp quá 120 ngày', () => {
    const nay = new Date('2026-11-21T00:00:00Z');
    expect(nhacDanhSachScopus(null, nay)[0]).toContain('Chưa nạp danh sách Scopus');
    expect(nhacDanhSachScopus(new Date('2026-11-01T00:00:00Z'), nay)).toEqual([]);
    expect(nhacDanhSachScopus(new Date('2026-05-01T00:00:00Z'), nay)[0]).toContain('nạp đã 204 ngày');
  });
});

/** Dịch vụ với bảng SJR + danh sách chỉ mục giả — `findMany` lọc theo ISSN như Postgres. */
function dungChiMuc(o: {
  sjr?: Record<string, unknown>[];
  scopus?: NguonChiMuc[];
  wos?: NguonChiMuc[];
  pubs?: Record<string, unknown>[];
}) {
  const ban = [
    ...(o.scopus ? [{ indexer: 'scopus', version: 'Scopus Sources Oct. 2026' }] : []),
    ...(o.wos ? [{ indexer: 'wos', version: 'WoS MJL 2026-11-18' }] : []),
  ];
  const dong = [
    ...(o.scopus ?? []).map((x) => ({ ...x, indexer: 'scopus' })),
    ...(o.wos ?? []).map((x) => ({ ...x, indexer: 'wos' })),
  ];
  type Args = { distinct?: string[]; where?: { issns?: { hasSome: string[] } } };
  const theoIssn = <T extends { issns: string[] }>(ds: T[], args: Args) => {
    const can = args.where?.issns?.hasSome;
    return can ? ds.filter((x) => x.issns.some((i) => can.includes(i))) : [];
  };
  const prisma = {
    publication: { findMany: vi.fn().mockResolvedValue(o.pubs ?? []) },
    journalRanking: {
      findMany: vi.fn((args: Args) =>
        Promise.resolve(
          args.distinct
            ? [{ year: 2025 }, { year: 2024 }, { year: 2023 }]
            : theoIssn((o.sjr ?? []) as { issns: string[] }[], args),
        ),
      ),
    },
    conferenceRanking: { findMany: vi.fn().mockResolvedValue([]) },
    indexedSource: {
      findMany: vi.fn((args: Args) => Promise.resolve(args.distinct ? ban : theoIssn(dong, args))),
    },
  };
  return { svc: new XepHangService(prisma as never), prisma };
}

const sjrOqe = (year: number, code: string, quartile: string) => ({
  year,
  sourceId: '12313',
  title: 'Optical and Quantum Electronics',
  issns: ['03068919', '1572817X'],
  bestQuartile: quartile,
  code,
  categories: [{ name: 'Electrical and Electronic Engineering', quartile, rank: 300, total: 900 }],
});

describe('XepHangService.goiY — có danh sách Scopus / WoS', () => {
  it('bảng SJR năm trước còn cho hạng nhưng Scopus đã loại → giữ mã, CẢNH BÁO', async () => {
    const { svc } = dungChiMuc({
      sjr: [sjrOqe(2024, '1.1c', 'Q2'), sjrOqe(2023, '1.1b', 'Q1')],
      scopus: [OQE],
    });
    const g = await svc.goiY({ issn: '1572-817X', year: 2025 });
    expect(g).toMatchObject({ nguon: 'sjr', ma: '1.1b' });
    expect(g.canhBao).toContain('ngừng nhận «Optical and Quantum Electronics»');
    expect(g.canhBao).toContain('Khoa quyết');
  });

  it('Scopus còn nhận → không cảnh báo', async () => {
    const { svc } = dungChiMuc({
      sjr: [sjrOqe(2024, '1.1c', 'Q2')],
      scopus: [{ ...OQE, active: true, finalYear: null, finalIssue: null, finalReason: null, coverage: [[1969, 2026]] }],
    });
    const g = await svc.goiY({ issn: '1572-817X', year: 2025 });
    expect(g.canhBao ?? null).toBeNull();
  });

  it('không có hạng SJR nhưng thuộc WoS → 1.1f', async () => {
    const { svc } = dungChiMuc({
      scopus: [],
      wos: [nguon({ title: 'Journal of Wos Only', type: 'ESCI', issns: ['55556666'] })],
    });
    const g = await svc.goiY({ issn: '5555-6666', year: 2026 });
    expect(g).toMatchObject({ nguon: 'wos', ma: '1.1f', tieuDe: 'Journal of Wos Only' });
    expect(g.giaiThich).toContain('Không có hạng Scopus Q1–Q4 → 1.1f');
  });

  it('thuộc Scopus mà chưa có hạng, chưa nạp WoS → không đoán mã, nói rõ', async () => {
    const { svc } = dungChiMuc({ scopus: [nguon({ title: 'Tap chi moi', issns: ['77778888'] })] });
    const g = await svc.goiY({ issn: '7777-8888', year: 2026 });
    expect(g).toMatchObject({ nguon: 'scopus', ma: null, tieuDe: 'Tap chi moi' });
    expect(g.giaiThich).toContain('chưa có hạng Q1–Q4');
    expect(g.giaiThich).toContain('chưa nạp danh sách WoS');
  });

  it('không thuộc Scopus lẫn WoS → nói không phải mục 1.1', async () => {
    const { svc } = dungChiMuc({ scopus: [], wos: [] });
    const g = await svc.goiY({ issn: '3009-3953', year: 2026 });
    expect(g).toMatchObject({ nguon: null, ma: null });
    expect(g.giaiThich).toContain('không thuộc Scopus / WoS năm công bố');
  });

  it('kỷ yếu: bộ kỷ yếu thuộc Scopus → 2.1e', async () => {
    const { svc } = dungChiMuc({
      scopus: [nguon({ title: 'Journal of Physics: Conference Series', type: 'Conference Proceedings', issns: ['17426588'], coverage: [[2004, 2026]] })],
    });
    const g = await svc.goiY({ issn: '1742-6588', venue: 'Journal of Physics: Conference Series', year: 2026, loai: 'hoi-nghi' });
    expect(g).toMatchObject({ nguon: 'scopus', ma: '2.1e' });
  });
});

describe('XepHangService.lechMa — có danh sách Scopus / WoS', () => {
  const bai = (o: Record<string, unknown>) => ({
    id: 'p',
    title: 'Bài thử',
    containerTitle: null,
    issn: null,
    type: 'journal-article',
    publishedYear: 2025,
    publishedMonth: 12,
    catalogCode: '1.1c',
    authors: [],
    ...o,
  });

  it('khai mã Scopus ở tạp chí Scopus đã loại → "ngoai", không có mã để áp', async () => {
    const { svc } = dungChiMuc({
      sjr: [sjrOqe(2024, '1.1c', 'Q2'), sjrOqe(2023, '1.1c', 'Q2')],
      scopus: [OQE],
      pubs: [bai({ id: 'oqe', issn: '1572-817X', containerTitle: 'Optical and Quantum Electronics' })],
    });
    const kq = await svc.lechMa('2025-11', '2026-10');
    expect(kq.items).toHaveLength(1);
    expect(kq.items[0]).toMatchObject({ id: 'oqe', maKhai: '1.1c', maGoiY: null, huong: 'ngoai' });
    expect(kq.items[0].giaiThich).toContain('Khai 1.1c (mã Scopus) — Scopus ngừng nhận');
  });

  it('khai 1.1e mà tạp chí chỉ thuộc WoS (không hạng SJR) → đổi mục sang 1.1f', async () => {
    const { svc } = dungChiMuc({
      scopus: [],
      wos: [nguon({ title: 'Journal of Wos Only', type: 'ESCI', issns: ['55556666'] })],
      pubs: [bai({ id: 'w', issn: '5555-6666', catalogCode: '1.1e', publishedYear: 2026, publishedMonth: 3 })],
    });
    const kq = await svc.lechMa('2025-11', '2026-10');
    // Có mã thay thế áp được (1.1f) → mục thường, có nút sửa — không phải "ngoai".
    expect(kq.items.map((x) => [x.id, x.huong, x.maGoiY])).toEqual([['w', 'doi', '1.1f']]);
    expect(kq.items[0].giaiThich).toContain('→ 1.1f');
  });

  it('bảng SJR có tạp chí mà danh sách Scopus ghi ISSN khác → không kết luận "ngoai"', async () => {
    const { svc } = dungChiMuc({
      sjr: [sjrOqe(2024, '1.1c', 'Q2'), sjrOqe(2023, '1.1c', 'Q2')],
      scopus: [nguon({ issns: ['99990000'] })],
      pubs: [bai({ id: 'k', issn: '1572-817X' })],
    });
    const kq = await svc.lechMa('2025-11', '2026-10');
    expect(kq.items).toEqual([]);
  });

  it('khai 1.1f ở tạp chí không có trong danh sách WoS (và không hạng SJR) → "ngoai"', async () => {
    const { svc } = dungChiMuc({
      scopus: [],
      wos: [],
      pubs: [bai({ id: 'f', issn: '3126-3011', catalogCode: '1.1f', publishedYear: 2026, publishedMonth: 5 })],
    });
    const kq = await svc.lechMa('2025-11', '2026-10');
    expect(kq.items.map((x) => [x.id, x.huong])).toEqual([['f', 'ngoai']]);
    expect(kq.items[0].giaiThich).toContain('Khai 1.1f (WoS) — Không có trong danh sách Web of Science');
  });
});

describe('XepHangService.napChiMuc — gói trình duyệt dựng từ tệp gốc', () => {
  const tx = () => ({
    indexedSource: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 2000 }),
    },
  });

  it('không phải gói JSON → 422, không ghi gì', async () => {
    const prisma = { $transaction: vi.fn() };
    await expect(new XepHangService(prisma as never).napChiMuc('scopus', 'Sourcerecord ID;Title')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('gói Scopus quá ít nguồn (tệp đã lọc) → từ chối, không xoá danh sách đang có', async () => {
    const prisma = { $transaction: vi.fn() };
    const goi = { phienBan: 'Scopus Sources Oct. 2026', ds: [{ sourceId: '1', title: 'A', issn: '1111-2222' }] };
    await expect(new XepHangService(prisma as never).napChiMuc('scopus', JSON.stringify(goi))).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('WoS đủ bộ: thay trọn danh sách WoS trong một giao dịch, đếm theo bộ', async () => {
    const t = tx();
    const prisma = { $transaction: vi.fn((fn: (x: typeof t) => Promise<unknown>) => fn(t)) };
    const ds = Array.from({ length: 3200 }, (_, i) => ({
      title: `Journal ${i}`,
      type: i < 2000 ? 'SCIE' : 'ESCI',
      issn: `${String(20_000_000 + i)}`,
    }));
    const kq = await new XepHangService(prisma as never).napChiMuc(
      'wos',
      JSON.stringify({ phienBan: 'WoS MJL 2026-11-18', ds }),
    );
    expect(kq).toMatchObject({ loai: 'wos', ten: 'WoS MJL 2026-11-18', soDong: 3200 });
    expect(kq.ghiChu).toBe('SCIE 2.000 · ESCI 1.200.');
    expect(t.indexedSource.deleteMany).toHaveBeenCalledWith({ where: { indexer: 'wos' } });
    expect(t.indexedSource.createMany).toHaveBeenCalledTimes(2);
    expect(t.indexedSource.createMany.mock.calls[0][0].data[0]).toMatchObject({
      indexer: 'wos',
      version: 'WoS MJL 2026-11-18',
      sourceId: '20000000',
      issns: ['20000000'],
      coverage: [],
    });
  });
});
