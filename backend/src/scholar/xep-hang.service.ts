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
  chuanHoaIssn,
  docBangCore,
  docBangSjr,
  docDanhSachBanCore,
  GIO_MA,
  goiYTheoCore,
  goiYTheoTr22,
  khopHoiNghi,
  maTheoCore,
  namBanCore,
  nhacBangSjr,
  QUARTILE_MA,
  soSanhMa,
  type HoiNghiCore,
  type NganhHang,
} from './xep-hang';
import type { GoiYQueryType, GoiYResType } from './xep-hang.model';

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
    await this.prisma.$transaction([
      this.prisma.journalRanking.deleteMany({ where: { year: nam } }),
      ...chia(ds, 2000).map((lo) =>
        this.prisma.journalRanking.createMany({
          data: lo.map((x) => ({
            year: nam,
            sourceId: x.sourceId,
            title: x.title,
            type: x.type,
            issns: x.issns,
            sjr: x.sjr,
            bestQuartile: x.bestQuartile,
            code: x.code,
            categories: x.categories as unknown as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        }),
      ),
    ]);
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
    const [sjr, core] = await Promise.all([
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
    ]);
    return {
      sjr: sjr.map((r) => ({ nam: r.year, soDong: r._count._all, luc: r._max.createdAt })),
      core: core
        .map((r) => ({ ban: r.source, soDong: r._count._all, luc: r._max.createdAt }))
        .sort((a, b) => namBanCore(b.ban) - namBanCore(a.ban)),
      canhBao: [
        ...nhacBangSjr(
          sjr.map((r) => r.year),
          new Date(),
        ),
        ...(core.length ? [] : ['Chưa có bảng CORE — bấm «Tải CORE tự động».']),
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

  async goiY(q: GoiYQueryType): Promise<GoiYResType> {
    const nam = q.year ?? new Date().getFullYear();
    const venue = (q.venue ?? '').trim();
    if ((q.loai === 'hoi-nghi' || laHoiNghi(venue)) && venue) {
      const core = this.goiYCore(venue, nam, await this.dsCore());
      if (core) return core;
    }
    const namDaNap = await this.namDaNap();
    if (!namDaNap.length) return CHUA_NAP;
    const issns = chuanHoaIssn(q.issn);
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
    return this.goiYTapChi(rows, nam, namDaNap);
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
    duLieu: { namDaNap: number[]; tapChi: DongTapChi[]; core: HoiNghiCore[] },
  ): GoiYResType {
    const nam = p.publishedYear ?? new Date().getFullYear();
    const venue = (p.containerTitle ?? '').trim();
    if (venue && (/proceedings|conference/i.test(p.type ?? '') || laHoiNghi(venue))) {
      const core = this.goiYCore(venue, nam, duLieu.core);
      if (core) return core;
    }
    const issns = chuanHoaIssn(p.issn);
    const rows = issns.length
      ? duLieu.tapChi.filter((r) => r.issns.some((i) => issns.includes(i)))
      : [];
    return this.goiYTapChi(rows, nam, duLieu.namDaNap);
  }

  private async napDuLieu(issns: string[], canCore: boolean) {
    const [namDaNap, tapChi, core] = await Promise.all([
      this.namDaNap(),
      issns.length
        ? this.prisma.journalRanking.findMany({
            where: { issns: { hasSome: issns } },
            select: CHON_TAP_CHI,
          })
        : Promise.resolve([] as DongTapChi[]),
      canCore ? this.dsCore() : Promise.resolve([] as HoiNghiCore[]),
    ]);
    return { namDaNap, tapChi, core };
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
      const huong = soSanhMa(p.catalogCode, g.ma);
      if (!huong || !g.ma) continue;
      items.push({
        id: p.id,
        title: p.title,
        venue: p.containerTitle,
        issn: p.issn,
        nam: p.publishedYear,
        thang: p.publishedMonth,
        maKhai: p.catalogCode as string,
        maGoiY: g.ma,
        huong,
        giaiThich: (p.publishedMonth ? '' : 'Bài chưa có tháng công bố. ') + g.giaiThich,
        tacGia: p.authors
          .map((a) => [a.user?.lastName, a.user?.firstName].filter(Boolean).join(' '))
          .filter(Boolean),
      });
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
