import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import {
  banCoreCanCo,
  chuanHoaChiMuc,
  chuanHoaIssn,
  docBangCore,
  docBangSjr,
  docDanhSachBanCore,
  GIO_MA,
  goiYTheoCore,
  goiYTheoTr22,
  khopHoiNghi,
  MA_SCOPUS,
  MA_WOS_CHUA_HANG,
  maTheoCore,
  namBanCore,
  nhacBangSjr,
  nhacDanhSachScopus,
  QUARTILE_MA,
  soSanhMa,
  xetScopus,
  xetWos,
  type ChiMuc,
  type HoiNghiCore,
  type NganhHang,
  type NguonChiMuc,
  type XetChiMuc,
} from './xep-hang';
import {
  GoiChiMucSchema,
  type GoiChiMucType,
  type GoiYQueryType,
  type GoiYResType,
} from './xep-hang.model';

const loiTep = (error: string) =>
  new UnprocessableEntityException([{ field: 'file', error }]);

/** Tên kỷ yếu / hội nghị — để dò CORE trước khi dò bảng tạp chí. */
const laHoiNghi = (venue: string) =>
  /\b(conference|proceedings|symposium|workshop|congress|colloquium)\b/i.test(venue);

const chia = <T>(ds: T[], n: number) =>
  Array.from({ length: Math.ceil(ds.length / n) }, (_, i) => ds.slice(i * n, i * n + n));

const CORE_URL = 'https://portal.core.edu.au/conf-ranks/';

const CHON_TAP_CHI = {
  year: true,
  sourceId: true,
  title: true,
  issns: true,
  bestQuartile: true,
  code: true,
  categories: true,
} as const;

type DongTapChi = {
  year: number;
  sourceId: string;
  title: string;
  issns: string[];
  bestQuartile: string | null;
  code: string | null;
  categories: Prisma.JsonValue;
};

/** Bài cần gợi ý — đủ để biết dò CORE hay bảng tạp chí. */
type BaiCanGoiY = {
  issn: string | null;
  containerTitle: string | null;
  type: string | null;
  publishedYear: number | null;
};

const CHON_CHI_MUC = {
  indexer: true,
  sourceId: true,
  title: true,
  type: true,
  issns: true,
  coverage: true,
  active: true,
  finalYear: true,
  finalIssue: true,
  finalReason: true,
} as const;

type DongChiMuc = Omit<NguonChiMuc, 'coverage'> & {
  indexer: string;
  coverage: Prisma.JsonValue;
};

/** Danh sách Scopus / WoS cho một lượt gợi ý: các nguồn khớp ISSN + bản đã nạp (null = chưa nạp). */
type DuLieuChiMuc = {
  dong: DongChiMuc[];
  ban: Record<ChiMuc, string | null>;
};

/** Kết quả xét một nơi đăng — null ở chỉ mục chưa nạp danh sách. */
type KetQuaChiMuc = { scopus: XetChiMuc | null; wos: XetChiMuc | null };

const KHONG_CHI_MUC: DuLieuChiMuc = { dong: [], ban: { scopus: null, wos: null } };

const nguonTu = (d: DongChiMuc): NguonChiMuc => ({
  ...d,
  coverage: (Array.isArray(d.coverage) ? d.coverage : []) as unknown as [number, number][],
});

const CHUA_NAP: GoiYResType = {
  nguon: null,
  ma: null,
  tieuDe: null,
  bang: [],
  giaiThich: 'Chưa nạp bảng SJR nào — tra tay ở SCImago, hoặc nhờ quản trị nạp bảng.',
};

/**
 * Bảng xếp hạng SCImago (tạp chí) và CORE (hội nghị) để GỢI Ý mã Phụ lục 2 lúc
 * khai. Quản trị nạp tệp SJR mỗi năm (SCImago chặn máy chủ — tải bằng trình
 * duyệt); CORE tự tải được. Gợi ý không tự ghi gì vào bài: người khai vẫn chọn,
 * còn mã LỆCH bảng thì quản trị xem ở danh sách soát và sửa từng bài (có nhật ký).
 */
@Injectable()
export class XepHangService {
  private readonly logger = new Logger(XepHangService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus?: EventBusService,
  ) {}

  /** Thay TRỌN bảng SJR của năm có trong tệp. */
  async napSjr(text: string) {
    let doc: ReturnType<typeof docBangSjr>;
    try {
      doc = docBangSjr(text);
    } catch (e) {
      throw loiTep((e as Error).message);
    }
    const { nam, ds } = doc;
    if (!nam) {
      throw loiTep('Không đọc được năm của bảng (cột "Total Docs. (YYYY)").');
    }
    // Bảng đầy đủ có ~30.000 nguồn. Ít hơn hẳn là tệp đã lọc (một ngành, một
    // nước…) — nạp vào thì hạng trong ngành và TOP 20 tính sai.
    if (ds.length < 10000) {
      throw loiTep(
        `Tệp chỉ có ${ds.length} nguồn — bảng SJR đầy đủ có khoảng 30.000. Tải lại ở ` +
          'scimagojr.com/journalrank.php KHÔNG chọn lọc ngành/nước rồi bấm "Download data".',
      );
    }
    // Giao dịch TỰ MỞ với trần thời gian riêng. Dạng mảng lệnh chạy qua adapter pg
    // cũng là giao dịch tương tác, trần mặc định 5 giây: lần nạp thật đầu tiên
    // (7/11/2026) ghi được 26.000/32.316 dòng thì hết 5,2 giây, Prisma rollback
    // và trang chỉ báo "Internal server error". Box ghi ~5.000 dòng/giây.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.journalRanking.deleteMany({ where: { year: nam } });
        for (const lo of chia(ds, 2000)) {
          await tx.journalRanking.createMany({
            data: lo.map((x) => ({
              year: nam,
              sourceId: x.sourceId,
              title: x.title,
              type: x.type,
              issns: x.issns,
              sjr: x.sjr,
              bestQuartile: x.bestQuartile,
              hIndex: x.hIndex,
              code: x.code,
              categories: x.categories as unknown as Prisma.InputJsonValue,
            })),
            skipDuplicates: true,
          });
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    const top = ds.filter((x) => x.code === '1.1a').length;
    return {
      loai: 'sjr' as const,
      ten: `SJR ${nam}`,
      soDong: ds.length,
      ghiChu: `${top} tạp chí thuộc TOP 20 ở một ngành mà tạp chí là Q1 (mã 1.1a).`,
    };
  }

  /** Thay TRỌN các phiên bản CORE có trong tệp (tệp Export thường chỉ một phiên bản). */
  async napCore(text: string) {
    const ds = docBangCore(text);
    if (ds.length < 100) {
      throw loiTep(
        `Tệp chỉ có ${ds.length} hội nghị — không giống tệp Export của portal.core.edu.au/conf-ranks.`,
      );
    }
    const ban = [...new Set(ds.map((x) => x.source))];
    await this.prisma.$transaction([
      this.prisma.conferenceRanking.deleteMany({ where: { source: { in: ban } } }),
      ...chia(ds, 2000).map((lo) =>
        this.prisma.conferenceRanking.createMany({ data: lo, skipDuplicates: true }),
      ),
    ]);
    return {
      loai: 'core' as const,
      ten: ban.join(', '),
      soDong: ds.length,
      ghiChu: `${ds.filter((x) => ['A*', 'A', 'B', 'C'].includes(x.rank)).length} hội nghị có hạng A*–C.`,
    };
  }

  /**
   * Thay TRỌN danh sách một chỉ mục (Scopus hoặc WoS) bằng gói trình duyệt dựng từ tệp
   * gốc. ~50.000 nguồn Scopus ghi ~10 giây — giao dịch tự mở với trần riêng như napSjr.
   */
  async napChiMuc(loai: ChiMuc, text: string) {
    const ten = loai === 'scopus' ? 'Scopus' : 'Web of Science';
    let goi: GoiChiMucType;
    try {
      goi = GoiChiMucSchema.parse(JSON.parse(text));
    } catch {
      throw loiTep(
        `Tệp không phải gói danh sách ${ten} — chọn tệp gốc ở trang Bảng xếp hạng (phys-profile) để trình duyệt đọc rồi gửi.`,
      );
    }
    const ds = chuanHoaChiMuc(loai, goi.ds);
    // Ít hơn hẳn danh sách đầy đủ = tệp đã lọc / chọn thiếu bộ. Nạp vào là XOÁ các
    // nguồn còn lại, và bài ở đó sẽ bị báo "không thuộc chỉ mục".
    const toiThieu = loai === 'scopus' ? 20_000 : 3_000;
    if (ds.length < toiThieu) {
      throw loiTep(
        `Gói chỉ có ${ds.length} nguồn — ` +
          (loai === 'scopus'
            ? 'danh sách Scopus đầy đủ có khoảng 50.000. Tải lại tệp Source List (.xlsx) ở trang Scopus Content của Elsevier.'
            : 'danh sách WoS đủ bốn bộ (SCIE, SSCI, AHCI, ESCI) có khoảng 22.000. Chọn cùng lúc mọi tệp CSV tải ở Master Journal List.'),
      );
    }
    await this.prisma.$transaction(
      async (tx) => {
        await tx.indexedSource.deleteMany({ where: { indexer: loai } });
        for (const lo of chia(ds, 2000)) {
          await tx.indexedSource.createMany({
            data: lo.map((x) => ({
              indexer: loai,
              version: goi.phienBan,
              sourceId: x.sourceId,
              title: x.title,
              type: x.type,
              issns: x.issns,
              coverage: x.coverage as unknown as Prisma.InputJsonValue,
              active: x.active,
              finalYear: x.finalYear,
              finalIssue: x.finalIssue,
              finalReason: x.finalReason,
            })),
            skipDuplicates: true,
          });
        }
      },
      { maxWait: 10_000, timeout: 180_000 },
    );
    const dem = new Map<string, number>();
    for (const x of ds) {
      for (const t of loai === 'wos' ? x.type.split(', ') : [x.type]) dem.set(t, (dem.get(t) ?? 0) + 1);
    }
    const theoLoai = [...dem.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} ${n.toLocaleString('vi-VN')}`)
      .join(' · ');
    return {
      loai,
      ten: goi.phienBan,
      soDong: ds.length,
      ghiChu:
        loai === 'scopus'
          ? `${theoLoai}. Còn nhận bài: ${ds.filter((x) => x.active).length.toLocaleString('vi-VN')}; Scopus đã ngừng nhận (có số cuối cùng): ${ds.filter((x) => x.finalYear !== null).length.toLocaleString('vi-VN')}.`
          : `${theoLoai}.`,
    };
  }

  /**
   * TỰ TẢI CORE: đọc danh sách phiên bản trên portal.core.edu.au rồi nạp hai phiên
   * bản mới nhất (gợi ý xét cả hai). Khác SCImago, trang CORE cho máy chủ tải thẳng.
   * `epBuoc` = tải lại cả phiên bản đã có (nút của quản trị); lượt hằng tháng chỉ
   * nạp phiên bản MỚI.
   */
  async taiCore(epBuoc: boolean) {
    const doc = async (url: string, ms: number) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    };
    let dsWeb: string[];
    try {
      dsWeb = docDanhSachBanCore(await doc(CORE_URL, 60_000));
    } catch (e) {
      throw new ServiceUnavailableException(
        `Không tới được portal.core.edu.au (${(e as Error).message}) — thử lại sau, hoặc tải tệp Export rồi nạp tay.`,
      );
    }
    if (!dsWeb.length) {
      throw new ServiceUnavailableException(
        'Không đọc được danh sách phiên bản CORE — trang có thể đã đổi giao diện; tải tệp Export rồi nạp tay.',
      );
    }
    const daCo = new Set(
      (
        await this.prisma.conferenceRanking.findMany({
          distinct: ['source'],
          select: { source: true },
        })
      ).map((r) => r.source),
    );
    const phienBan: { ban: string; trangThai: string }[] = [];
    for (const ban of banCoreCanCo(dsWeb)) {
      if (!epBuoc && daCo.has(ban)) {
        phienBan.push({ ban, trangThai: 'đã có, không tải lại' });
        continue;
      }
      const text = await doc(
        `${CORE_URL}?search=&by=all&source=${encodeURIComponent(ban)}&sort=atitle&page=1&do=Export`,
        120_000,
      );
      const kq = await this.napCore(text);
      phienBan.push({ ban, trangThai: `đã nạp ${kq.soDong} hội nghị` });
    }
    return { phienBan };
  }

  /** Ngày 2 hằng tháng, 4 giờ sáng: CORE có phiên bản mới thì tự nạp. */
  @Cron('0 4 2 * *', { name: 'kiemCoreHangThang' })
  async kiemCoreHangThang() {
    try {
      const { phienBan } = await this.taiCore(false);
      this.logger.log(
        `Kiểm CORE hằng tháng: ${phienBan.map((p) => `${p.ban} ${p.trangThai}`).join('; ')}`,
      );
    } catch (e) {
      this.logger.warn(`Kiểm CORE hằng tháng lỗi: ${(e as Error).message}`);
    }
  }

  async tinhTrang() {
    const [sjr, core, chiMuc] = await Promise.all([
      this.prisma.journalRanking.groupBy({
        by: ['year'],
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { year: 'desc' },
      }),
      this.prisma.conferenceRanking.groupBy({
        by: ['source'],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.indexedSource.groupBy({
        by: ['indexer', 'version'],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
    const dsChiMuc = chiMuc
      .map((r) => ({
        loai: r.indexer as ChiMuc,
        phienBan: r.version,
        soDong: r._count._all,
        luc: r._max.createdAt,
      }))
      .sort((a, b) => a.loai.localeCompare(b.loai));
    return {
      sjr: sjr.map((r) => ({ nam: r.year, soDong: r._count._all, luc: r._max.createdAt })),
      core: core
        .map((r) => ({ ban: r.source, soDong: r._count._all, luc: r._max.createdAt }))
        .sort((a, b) => namBanCore(b.ban) - namBanCore(a.ban)),
      chiMuc: dsChiMuc,
      canhBao: [
        ...nhacBangSjr(
          sjr.map((r) => r.year),
          new Date(),
        ),
        ...(core.length ? [] : ['Chưa có bảng CORE — bấm «Tải CORE tự động».']),
        ...nhacDanhSachScopus(
          dsChiMuc.find((c) => c.loai === 'scopus')?.luc ?? null,
          new Date(),
        ),
      ],
    };
  }

  // ── Gợi ý ──────────────────────────────────────────────────────────────────

  private async namDaNap() {
    return (
      await this.prisma.journalRanking.findMany({
        distinct: ['year'],
        select: { year: true },
      })
    ).map((r) => r.year);
  }

  private dsCore(): Promise<HoiNghiCore[]> {
    return this.prisma.conferenceRanking.findMany({
      select: { source: true, title: true, acronym: true, rank: true },
    });
  }

  /** Bản danh sách Scopus / WoS đang nạp — null ở chỉ mục chưa nạp. */
  private async banChiMuc(): Promise<Record<ChiMuc, string | null>> {
    const ds = await this.prisma.indexedSource.findMany({
      distinct: ['indexer'],
      select: { indexer: true, version: true },
    });
    return {
      scopus: ds.find((d) => d.indexer === 'scopus')?.version ?? null,
      wos: ds.find((d) => d.indexer === 'wos')?.version ?? null,
    };
  }

  /** Dòng Scopus / WoS của các ISSN — hoặc đúng tên nơi đăng khi bài không có ISSN. */
  private async napChiMucCho(issns: string[], venue = ''): Promise<DuLieuChiMuc> {
    const ban = await this.banChiMuc();
    if (!ban.scopus && !ban.wos) return KHONG_CHI_MUC;
    const where = issns.length
      ? { issns: { hasSome: issns } }
      : venue
        ? { title: { equals: venue, mode: 'insensitive' as const } }
        : null;
    const dong = where
      ? ((await this.prisma.indexedSource.findMany({ where, select: CHON_CHI_MUC })) as DongChiMuc[])
      : [];
    return { dong, ban };
  }

  /**
   * Nơi đăng thuộc Scopus (năm `nam`) / WoS không. Bài không có ISSN thì chỉ tra theo
   * ĐÚNG tên và chỉ tin kết quả khớp — tên viết khác đi một chữ là không thấy, nên
   * "không thấy theo tên" không được coi là "không thuộc".
   */
  private xetChiMuc(
    cm: DuLieuChiMuc,
    issns: string[],
    venue: string,
    nam: number,
  ): KetQuaChiMuc | null {
    if (!cm.ban.scopus && !cm.ban.wos) return null;
    const ten = venue.trim().toLowerCase();
    if (!issns.length && !ten) return null;
    const cua = cm.dong.filter((d) =>
      issns.length ? d.issns.some((i) => issns.includes(i)) : d.title.trim().toLowerCase() === ten,
    );
    const theo = (k: ChiMuc) => cua.filter((d) => d.indexer === k).map(nguonTu);
    const xet = (k: ChiMuc, f: (ds: NguonChiMuc[], ban: string) => XetChiMuc) => {
      const ban = cm.ban[k];
      if (!ban) return null;
      const ds = theo(k);
      return !issns.length && !ds.length ? null : f(ds, ban);
    };
    return {
      scopus: xet('scopus', (ds, ban) => xetScopus(ds, nam, ban)),
      wos: xet('wos', (ds, ban) => xetWos(ds, ban)),
    };
  }

  /**
   * Ghép danh sách chỉ mục vào gợi ý của bảng xếp hạng:
   *  · bảng cho mã Scopus (1.1a–e) mà Scopus đã ngừng nhận nơi đăng trước năm công bố
   *    → giữ mã, kèm CẢNH BÁO (bảng SJR năm trước vẫn còn tên tạp chí; Khoa quyết);
   *  · bảng không cho mã: thuộc WoS → 1.1f (tạp chí) hoặc 2.1e (kỷ yếu); thuộc Scopus →
   *    kỷ yếu 2.1e, tạp chí thì nói rõ "thuộc Scopus nhưng chưa có hạng"; không thuộc
   *    danh sách nào → nói ra, để người khai khỏi chọn mã Scopus.
   */
  private boSungChiMuc(
    kq: GoiYResType,
    km: KetQuaChiMuc | null,
    laKyYeu: boolean,
  ): GoiYResType {
    if (!km || (!km.scopus && !km.wos) || kq === CHUA_NAP) return kq;
    const { scopus, wos } = km;
    if (kq.ma) {
      // Không thấy ở danh sách Scopus mà bảng SJR có = hai nơi ghi ISSN khác nhau — không kết luận.
      if (MA_SCOPUS.has(kq.ma) && scopus && scopus.trangThai !== 'co' && scopus.tieuDe) {
        return {
          ...kq,
          canhBao:
            scopus.lyDo +
            (scopus.trangThai === 'khong'
              ? ' Bảng SJR năm trước vẫn còn tên tạp chí nên vẫn ra hạng — Khoa quyết bài có tính mục 1.1 (Scopus) không.'
              : ' Xem số của bài trước khi chọn mã Scopus.'),
        };
      }
      return kq;
    }
    const goc = kq.nguon ? kq.giaiThich : 'Không thấy nơi đăng trong các bảng SJR đã nạp.';
    const ra = (
      ma: string | null,
      nguon: GoiYResType['nguon'],
      tieuDe: string | null,
      cau: string,
    ): GoiYResType => ({
      ...kq,
      ma,
      nguon,
      tieuDe: kq.tieuDe ?? tieuDe,
      giaiThich: `${goc} ${cau}`,
    });
    const thuoc = scopus?.trangThai === 'co' ? scopus : wos?.trangThai === 'co' ? wos : null;
    if (laKyYeu) {
      return thuoc
        ? ra('2.1e', thuoc === scopus ? 'scopus' : 'wos', thuoc.tieuDe, `${thuoc.lyDo} → kỷ yếu thuộc WoS/Scopus: 2.1e.`)
        : ra(
            null,
            kq.nguon,
            null,
            `${[scopus?.lyDo, wos?.lyDo].filter(Boolean).join(' ')} Kỷ yếu WoS (CPCI) không có trong Master Journal List — tra tay nếu cần.`,
          );
    }
    if (wos?.trangThai === 'co') {
      return ra(
        MA_WOS_CHUA_HANG,
        'wos',
        wos.tieuDe,
        `${wos.lyDo} Không có hạng Scopus Q1–Q4 → ${MA_WOS_CHUA_HANG}.${scopus ? ` (${scopus.lyDo})` : ''}`,
      );
    }
    if (scopus?.trangThai === 'co') {
      return ra(
        null,
        'scopus',
        scopus.tieuDe,
        `${scopus.lyDo} Nhưng chưa có hạng Q1–Q4 trong bảng SJR đã nạp nên chưa xếp được 1.1a–e; nơi đăng thuộc WoS thì ${MA_WOS_CHUA_HANG}${wos ? '' : ' (chưa nạp danh sách WoS để kiểm)'}.`,
      );
    }
    const cau = [scopus?.lyDo, wos?.lyDo].filter(Boolean).join(' ');
    const ket =
      scopus && wos
        ? ' → không thuộc Scopus / WoS năm công bố: không phải mục 1.1, xem mục 1.2 hoặc 1.4.'
        : !wos
          ? ' Chưa nạp danh sách WoS nên chưa kiểm được mục 1.1f.'
          : ' Chưa nạp danh sách Scopus.';
    return ra(null, kq.nguon, null, cau + ket);
  }

  /**
   * Bài khai mã Scopus (1.1a–e) mà nơi đăng không thuộc Scopus năm công bố, hoặc khai
   * 1.1f mà không có trong danh sách WoS — lý do, hoặc null. Chỉ xét bài có ISSN.
   */
  private ngoaiChiMuc(
    p: BaiCanGoiY & { catalogCode: string | null },
    g: GoiYResType,
    duLieu: { tapChi: DongTapChi[]; chiMuc: DuLieuChiMuc },
  ): string | null {
    const code = p.catalogCode ?? '';
    const issns = chuanHoaIssn(p.issn);
    if (!issns.length) return null;
    const km = this.xetChiMuc(duLieu.chiMuc, issns, '', p.publishedYear ?? new Date().getFullYear());
    if (!km) return null;
    if (MA_SCOPUS.has(code) && km.scopus && km.scopus.trangThai !== 'co') {
      const coSjr = duLieu.tapChi.some((r) => r.issns.some((i) => issns.includes(i)));
      if (km.scopus.tieuDe || !coSjr) return `Khai ${code} (mã Scopus) — ${km.scopus.lyDo}`;
    }
    // 1.1f mà bảng SJR cho hạng thì đã có gợi ý nâng mã — không báo trùng.
    if (code === MA_WOS_CHUA_HANG && !g.ma && km.wos?.trangThai === 'khong') {
      return `Khai ${code} (WoS) — ${km.wos.lyDo}`;
    }
    return null;
  }

  async goiY(q: GoiYQueryType): Promise<GoiYResType> {
    const nam = q.year ?? new Date().getFullYear();
    const venue = (q.venue ?? '').trim();
    const issns = chuanHoaIssn(q.issn);
    const laKyYeu = q.loai === 'hoi-nghi' || laHoiNghi(venue);
    const km = this.xetChiMuc(await this.napChiMucCho(issns, venue), issns, venue, nam);
    if (laKyYeu && venue) {
      const core = this.goiYCore(venue, nam, await this.dsCore());
      if (core) return this.boSungChiMuc(core, km, true);
    }
    const namDaNap = await this.namDaNap();
    if (!namDaNap.length) return CHUA_NAP;
    let rows: DongTapChi[] = issns.length
      ? await this.prisma.journalRanking.findMany({
          where: { issns: { hasSome: issns } },
          select: CHON_TAP_CHI,
        })
      : [];
    if (!rows.length && venue) {
      rows = await this.prisma.journalRanking.findMany({
        where: { title: { equals: venue, mode: 'insensitive' } },
        select: CHON_TAP_CHI,
      });
    }
    return this.boSungChiMuc(this.goiYTapChi(rows, nam, namDaNap), km, laKyYeu);
  }

  private goiYCore(venue: string, nam: number, ds: HoiNghiCore[]): GoiYResType | null {
    const khop = khopHoiNghi(venue, ds);
    if (!khop.length) return null;
    const g = goiYTheoCore(khop, nam);
    if (!g.ban.length) return null;
    return {
      nguon: 'core',
      ma: g.ma,
      tieuDe: `${khop[0].title}${khop[0].acronym ? ` (${khop[0].acronym})` : ''}`,
      bang: g.ban.map((h) => ({ ten: h.source, ma: maTheoCore(h.rank), hang: h.rank })),
      giaiThich:
        g.ban.map((h) => `${h.source}: ${h.rank}`).join(' · ') +
        (g.ma
          ? ` → ${g.ma} (lấy kết quả cao hơn giữa phiên bản mới nhất và phiên bản liền trước).`
          : ' → không có hạng A*–C: kỷ yếu thuộc WoS/Scopus thì mục 2.1e, còn lại 2.2.'),
    };
  }

  private goiYTapChi(rows: DongTapChi[], nam: number, namDaNap: number[]): GoiYResType {
    if (!namDaNap.length) return CHUA_NAP;
    if (!rows.length) {
      return {
        nguon: null,
        ma: null,
        tieuDe: null,
        bang: [],
        giaiThich:
          'Không thấy nơi đăng trong các bảng SJR đã nạp (theo ISSN / tên) — có thể chưa thuộc Scopus. Tra tay ở SCImago / Web of Science.',
      };
    }
    // Một ISSN hiếm khi ứng với hai nguồn; nếu có, giữ nguồn xuất hiện ở nhiều năm nhất.
    const dem = new Map<string, number>();
    for (const r of rows) dem.set(r.sourceId, (dem.get(r.sourceId) ?? 0) + 1);
    const nguon = [...dem.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const theoNam = new Map(
      rows
        .filter((r) => r.sourceId === nguon)
        .map((r) => [
          r.year,
          {
            code: r.code,
            bestQuartile: r.bestQuartile,
            categories: (r.categories ?? []) as unknown as NganhHang[],
          },
        ]),
    );
    const g = goiYTheoTr22(theoNam, nam, namDaNap);
    const bang = g.bang.map((b) => ({
      ten: `SJR ${b.nam}`,
      ma: b.ma,
      hang: b.ma
        ? `${b.quartile ?? ''}${b.top20.length ? ` · TOP 20: ${b.top20.join('; ')}` : ''}`
        : 'không có trong bảng',
    }));
    return {
      nguon: 'sjr',
      ma: g.ma,
      tieuDe: rows.find((r) => r.sourceId === nguon)?.title ?? null,
      bang,
      giaiThich:
        `Bài công bố năm ${nam}: lấy kết quả CAO HƠN giữa ${bang.map((b) => b.ten).join(' và ')}` +
        ` (Phụ lục 2 tr. 2.2) → ${g.ma ?? 'không xác định'}.` +
        (g.thieuBang ? ` Chưa nạp bảng SJR ${g.thieuBang}.` : ''),
    };
  }

  /** Gợi ý cho MỘT bài với dữ liệu đã nạp sẵn — dùng chung cho danh sách soát và nút áp dụng. */
  private goiYChoBai(
    p: BaiCanGoiY,
    duLieu: {
      namDaNap: number[];
      tapChi: DongTapChi[];
      core: HoiNghiCore[];
      chiMuc: DuLieuChiMuc;
    },
  ): GoiYResType {
    const nam = p.publishedYear ?? new Date().getFullYear();
    const venue = (p.containerTitle ?? '').trim();
    const issns = chuanHoaIssn(p.issn);
    const laKyYeu = /proceedings|conference/i.test(p.type ?? '') || laHoiNghi(venue);
    // Dữ liệu chỉ mục nạp theo ISSN của cả lô — tra theo tên ở đây sẽ thiếu, nên chỉ xét bài có ISSN.
    const km = issns.length ? this.xetChiMuc(duLieu.chiMuc, issns, '', nam) : null;
    if (venue && laKyYeu) {
      const core = this.goiYCore(venue, nam, duLieu.core);
      if (core) return this.boSungChiMuc(core, km, true);
    }
    const rows = issns.length
      ? duLieu.tapChi.filter((r) => r.issns.some((i) => issns.includes(i)))
      : [];
    return this.boSungChiMuc(this.goiYTapChi(rows, nam, duLieu.namDaNap), km, laKyYeu);
  }

  private async napDuLieu(issns: string[], canCore: boolean) {
    const [namDaNap, tapChi, core, chiMuc] = await Promise.all([
      this.namDaNap(),
      issns.length
        ? this.prisma.journalRanking.findMany({
            where: { issns: { hasSome: issns } },
            select: CHON_TAP_CHI,
          })
        : Promise.resolve([] as DongTapChi[]),
      canCore ? this.dsCore() : Promise.resolve([] as HoiNghiCore[]),
      this.napChiMucCho(issns),
    ]);
    return { namDaNap, tapChi, core, chiMuc };
  }

  // ── Soát mã lệch ───────────────────────────────────────────────────────────

  /**
   * BÀI LỆCH MÃ trong một khoảng tháng (vd kỳ đánh giá 2025-11 → 2026-10): mã đang
   * khai khác gợi ý của bảng. Đúng việc đã soát TAY ngày 3–4/10/2026 (10 bài lệch
   * theo tr. 2.2), nay chạy được bất cứ lúc nào. Chỉ so mã tạp chí (1.1) và kỷ yếu
   * (2.1); bài chưa có tháng được giữ lại nếu năm nằm trong khoảng — kèm ghi chú.
   */
  async lechMa(tu: string, den: string) {
    const [ty, tm] = tu.split('-').map(Number);
    const [dy, dm] = den.split('-').map(Number);
    const ds = await this.prisma.publication.findMany({
      where: {
        deletedAt: null,
        catalogCode: { in: Object.keys(GIO_MA) },
        publishedYear: { gte: ty, lte: dy },
      },
      select: {
        id: true,
        title: true,
        containerTitle: true,
        issn: true,
        type: true,
        publishedYear: true,
        publishedMonth: true,
        catalogCode: true,
        authors: {
          where: { claimStatus: 'CONFIRMED' },
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: [{ publishedYear: 'asc' }, { publishedMonth: 'asc' }],
    });
    const trong = ds.filter((p) => {
      if (!p.publishedMonth) return true;
      const ym = (p.publishedYear ?? 0) * 100 + p.publishedMonth;
      return ym >= ty * 100 + tm && ym <= dy * 100 + dm;
    });
    const duLieu = await this.napDuLieu(
      [...new Set(trong.flatMap((p) => chuanHoaIssn(p.issn)))],
      trong.some((p) => /proceedings|conference/i.test(p.type ?? '') || laHoiNghi(p.containerTitle ?? '')),
    );
    const items = [];
    for (const p of trong) {
      const g = this.goiYChoBai(p, duLieu);
      const chung = {
        id: p.id,
        title: p.title,
        venue: p.containerTitle,
        issn: p.issn,
        nam: p.publishedYear,
        thang: p.publishedMonth,
        maKhai: p.catalogCode as string,
        tacGia: p.authors
          .map((a) => [a.user?.lastName, a.user?.firstName].filter(Boolean).join(' '))
          .filter(Boolean),
      };
      const thang = p.publishedMonth ? '' : 'Bài chưa có tháng công bố. ';
      // Khai mã Scopus mà nơi đăng không thuộc Scopus năm đó: không có mã nào để áp tự
      // động (1.2 hay 1.4 là việc Khoa xét), nên chỉ liệt kê — giao diện không có nút sửa.
      // Có mã thay thế áp được (khai 1.1e mà tạp chí chỉ thuộc WoS → 1.1f) thì để nhánh
      // thường bên dưới đưa ra, kèm nút sửa.
      const coMaThay = !!g.ma && !MA_SCOPUS.has(g.ma) && !!soSanhMa(p.catalogCode, g.ma);
      const ngoai = coMaThay ? null : this.ngoaiChiMuc(p, g, duLieu);
      if (ngoai) {
        items.push({
          ...chung,
          maGoiY: null,
          huong: 'ngoai' as const,
          giaiThich:
            thang + ngoai + (g.ma && g.ma !== p.catalogCode ? ` (Bảng SJR năm trước cho ${g.ma}.)` : ''),
        });
        continue;
      }
      const huong = soSanhMa(p.catalogCode, g.ma);
      if (!huong || !g.ma) continue;
      items.push({ ...chung, maGoiY: g.ma, huong, giaiThich: thang + g.giaiThich });
    }
    return { tu, den, soBai: trong.length, items };
  }

  /**
   * Áp mã của bảng cho MỘT bài (quản trị bấm ở danh sách soát). Tính lại gợi ý ngay
   * lúc bấm — không tin con số trình duyệt gửi lên — và chỉ ghi khi mã trong CSDL
   * vẫn là mã quản trị đang nhìn (`tuMa`): ai đó vừa sửa thì dừng. Ghi AuditLog như
   * mọi lần sửa của quản trị, và báo ACADsoom đồng bộ lại cho các tác giả.
   */
  async apDungMa(adminId: string, id: string, tuMa: string) {
    const p = await this.prisma.publication.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        issn: true,
        containerTitle: true,
        type: true,
        publishedYear: true,
        catalogCode: true,
        authors: { where: { claimStatus: 'CONFIRMED' }, select: { userId: true } },
      },
    });
    if (!p) throw new NotFoundException('Không tìm thấy công bố');
    if (p.catalogCode !== tuMa) {
      throw new UnprocessableEntityException([
        {
          field: 'tuMa',
          error: `Mã của bài vừa đổi (đang là ${p.catalogCode ?? 'trống'}) — tải lại danh sách rồi xem lại.`,
        },
      ]);
    }
    const duLieu = await this.napDuLieu(
      chuanHoaIssn(p.issn),
      /proceedings|conference/i.test(p.type ?? '') || laHoiNghi(p.containerTitle ?? ''),
    );
    const g = this.goiYChoBai(p, duLieu);
    if (!g.ma || !soSanhMa(p.catalogCode, g.ma)) {
      throw new UnprocessableEntityException([
        { field: 'tuMa', error: 'Bài không còn lệch bảng xếp hạng — không có gì để sửa.' },
      ]);
    }
    await this.prisma.$transaction([
      this.prisma.publication.update({
        where: { id },
        data: {
          catalogCode: g.ma,
          quartile: QUARTILE_MA[g.ma] ?? null,
          classifiedBy: adminId,
          classifiedAt: new Date(),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'publication.admin-fix',
          entityType: 'Publication',
          entityId: id,
          changes: {
            ly_do: `Soát mã theo bảng xếp hạng: ${g.giaiThich}`,
            truoc: { catalogCode: tuMa },
            sau: { catalogCode: g.ma },
          },
        },
      }),
    ]);
    this.bus?.emit('publication.changed', {
      id,
      userIds: p.authors.map((a) => a.userId).filter((u): u is string => !!u),
    });
    return { id, maMoi: g.ma };
  }
}
