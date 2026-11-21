import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chuanIssn, HANG_MUC, CHUAN, TAP_CHI_TRONG_NUOC } from './hdgs-vat-ly';
import { tinhCongTrinh, tongHop, type CongTrinhVao, type NhapTay } from './hdgs-tinh';
import type { HdgsQueryType, NhapTayBodyType } from './hdgs.model';

/**
 * Bộ tính điểm HĐGS ngành Vật lý (Khoa yêu cầu 20/11/2026) — luật ở hdgs-vat-ly.ts,
 * phép tính ở hdgs-tinh.ts. Ở đây chỉ gom dữ kiện: công trình ĐÃ XÁC NHẬN của từng
 * người, bảng SCImago hiện hành lúc xuất bản, và phần người đó tự nhập (HdgsInput).
 * Điểm không lưu — mỗi lần xem tính lại, nên sửa luật / nạp bảng là số đổi theo.
 */

type Dong = {
  userId: string;
  authorIndex: number;
  isFirst: boolean;
  isCorresponding: boolean;
  publication: {
    id: string;
    title: string;
    containerTitle: string | null;
    type: string;
    catalogCode: string | null;
    issn: string | null;
    publishedYear: number | null;
    countYear: number | null;
    status: string;
    doi: string | null;
    url: string | null;
    totalAuthors: number;
    authorsRaw: unknown;
    authors: { authorIndex: number; isCorresponding: boolean }[];
  };
};

type BangSjr = {
  year: number;
  issns: string[];
  bestQuartile: string | null;
  hIndex: number | null;
  type: string;
  createdAt: Date;
};

const CHON_DONG = {
  userId: true,
  authorIndex: true,
  isFirst: true,
  isCorresponding: true,
  publication: {
    select: {
      id: true,
      title: true,
      containerTitle: true,
      type: true,
      catalogCode: true,
      issn: true,
      publishedYear: true,
      countYear: true,
      status: true,
      doi: true,
      url: true,
      totalAuthors: true,
      authorsRaw: true,
      authors: {
        where: { claimStatus: { not: 'REJECTED' as const } },
        select: { authorIndex: true, isCorresponding: true },
      },
    },
  },
} as const;

@Injectable()
export class HdgsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Luật đang dùng — cho trang giải thích ở phys-profile. */
  luat() {
    return { hangMuc: HANG_MUC, tapChiTrongNuoc: TAP_CHI_TRONG_NUOC, chuan: CHUAN };
  }

  async cuaToi(userId: string, q: Partial<HdgsQueryType>) {
    return this.tinhChoNguoi(userId, q);
  }

  async cuaNguoi(userId: string, q: Partial<HdgsQueryType>) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new NotFoundException([{ field: 'userId', error: 'Không tìm thấy cán bộ' }]);
    return this.tinhChoNguoi(userId, q);
  }

  /** Lưu phần tự nhập cho MỘT công trình — chỉ trên công trình mình đã xác nhận đứng tên. */
  async luuNhapTay(userId: string, publicationId: string, body: NhapTayBodyType) {
    const dong = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId, userId } },
      select: { claimStatus: true, publication: { select: { deletedAt: true } } },
    });
    if (!dong || dong.claimStatus !== 'CONFIRMED' || dong.publication.deletedAt) {
      throw new ForbiddenException([
        { field: 'publicationId', error: 'Chỉ nhập được cho công trình Thầy/Cô đã xác nhận đứng tên.' },
      ]);
    }
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    await this.prisma.hdgsInput.upsert({
      where: { userId_publicationId: { userId, publicationId } },
      create: { userId, publicationId, ...data },
      update: data,
    });
    return this.tinhChoNguoi(userId, {});
  }

  /** Bảng cả Khoa: một dòng mỗi cán bộ có công trình đã xác nhận. */
  async caKhoa(q: Partial<HdgsQueryType>) {
    const denNam = q.den ?? new Date().getFullYear();
    const dong = (await this.prisma.publicationAuthor.findMany({
      where: { claimStatus: 'CONFIRMED', publication: { deletedAt: null }, user: { isActive: true } },
      select: CHON_DONG,
    })) as unknown as Dong[];
    const [bang, namCo, nhap, nguoi] = await Promise.all([
      this.bangSjr(dong),
      this.namBangDaNap(),
      this.prisma.hdgsInput.findMany({}),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(dong.map((d) => d.userId))] } },
        select: { id: true, firstName: true, lastName: true, email: true, department: { select: { name: true } } },
      }),
    ]);
    const nhapTheo = new Map(nhap.map((n) => [`${n.userId}:${n.publicationId}`, n]));
    const theoNguoi = new Map<string, Dong[]>();
    for (const d of dong) {
      const a = theoNguoi.get(d.userId);
      if (a) a.push(d);
      else theoNguoi.set(d.userId, [d]);
    }
    const items = nguoi.map((u) => {
      const ds = (theoNguoi.get(u.id) ?? []).map((d) =>
        tinhCongTrinh(this.vao(d, bang, namCo), (nhapTheo.get(`${u.id}:${d.publication.id}`) ?? {}) as NhapTay),
      );
      const t = tongHop(ds, denNam, q.tuNamQT ?? null);
      return {
        userId: u.id,
        ten: [u.lastName, u.firstName].filter(Boolean).join(' ') || u.email,
        email: u.email,
        boMon: u.department?.name ?? null,
        tong: t.tong,
        baNamCuoi: t.baNamCuoi,
        baiBaoShtt: t.baiBaoShtt,
        baoCao: t.baoCao,
        sach: t.sach,
        baiQuocTeChinh: t.baiQuocTeChinh,
        soCongTrinh: t.soCongTrinh,
        datPGS: t.dat.PGS.every((m) => m.dat),
        datGS: t.dat.GS.every((m) => m.dat),
        daNhapTay: ds.filter((k) => nhapTheo.has(`${u.id}:${k.id}`)).length,
      };
    });
    items.sort((a, b) => b.tong - a.tong);
    return { denNam, tuNamQT: q.tuNamQT ?? null, bangSjr: namCo, items };
  }

  // ── Nội bộ ────────────────────────────────────────────────────────────────
  private async tinhChoNguoi(userId: string, q: Partial<HdgsQueryType>) {
    const denNam = q.den ?? new Date().getFullYear();
    const dong = (await this.prisma.publicationAuthor.findMany({
      where: { userId, claimStatus: 'CONFIRMED', publication: { deletedAt: null } },
      select: CHON_DONG,
    })) as unknown as Dong[];
    const [bang, namCo, nhap, u] = await Promise.all([
      this.bangSjr(dong),
      this.namBangDaNap(),
      this.prisma.hdgsInput.findMany({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);
    const nhapTheo = new Map(nhap.map((n) => [n.publicationId, n]));
    const rows = dong
      .map((d) => {
        const n = nhapTheo.get(d.publication.id) ?? null;
        return {
          ...tinhCongTrinh(this.vao(d, bang, namCo), (n ?? {}) as NhapTay),
          nhap: n
            ? {
                hangMuc: n.hangMuc,
                impactFactor: n.impactFactor,
                trichDan: n.trichDan,
                quartile: n.quartile,
                hIndex: n.hIndex,
                online: n.online,
                dongGop: n.dongGop,
                laTacGiaChinh: n.laTacGiaChinh,
                nxbUyTin: n.nxbUyTin,
                ghiChu: n.ghiChu,
              }
            : null,
        };
      })
      .sort((a, b) => (b.nam ?? 0) - (a.nam ?? 0) || b.diem - a.diem);
    return {
      nguoi: { id: userId, ten: [u?.lastName, u?.firstName].filter(Boolean).join(' ') || u?.email || '' },
      denNam,
      tuNamQT: q.tuNamQT ?? null,
      bangSjr: namCo,
      tong: tongHop(rows, denNam, q.tuNamQT ?? null),
      rows,
    };
  }

  /** Các năm bảng SCImago đã nạp. */
  private async namBangDaNap(): Promise<number[]> {
    const ds = await this.prisma.journalRanking.findMany({
      distinct: ['year'],
      select: { year: true },
      orderBy: { year: 'asc' },
    });
    return ds.map((d) => d.year);
  }

  /** Dòng SCImago của mọi ISSN xuất hiện trong các công trình — một lần truy vấn. */
  private async bangSjr(dong: Dong[]): Promise<BangSjr[]> {
    const issn = [...new Set(dong.flatMap((d) => chuanIssn(d.publication.issn)))];
    if (!issn.length) return [];
    return this.prisma.journalRanking.findMany({
      where: { issns: { hasSome: issn } },
      select: { year: true, issns: true, bestQuartile: true, hIndex: true, type: true, createdAt: true },
    });
  }

  /**
   * Dữ kiện của một công trình cho phép tính. Bảng SCImago "hiện hành lúc xuất bản"
   * = bảng năm (năm công bố − 1): SCImago công bố bảng năm Y−1 trong năm Y. Bảng đó
   * đã nạp mà tạp chí vắng mặt → coi như không thuộc Scopus năm ấy. Chưa nạp → lấy
   * bảng gần nhất có tạp chí, đánh dấu `lech` để giao diện nói ra.
   */
  private vao(d: Dong, bang: BangSjr[], namCo: number[]): CongTrinhVao {
    const p = d.publication;
    const nam = p.publishedYear ?? p.countYear ?? null;
    const issn = chuanIssn(p.issn);
    const cua = issn.length ? bang.filter((b) => b.issns.some((x) => issn.includes(x))) : [];
    let sjr: CongTrinhVao['sjr'] = null;
    if (cua.length) {
      const muc = (nam ?? new Date().getFullYear()) - 1;
      const dung = cua.find((b) => b.year === muc);
      const thanh = (b: BangSjr, lech: boolean) => ({
        nam: b.year,
        quartile: b.bestQuartile,
        hIndex: b.hIndex,
        type: b.type,
        lech,
        napLuc: b.createdAt,
        can: muc,
      });
      if (dung) sjr = thanh(dung, false);
      else if (!namCo.includes(muc)) {
        const gan = [...cua].sort((a, b) => Math.abs(a.year - muc) - Math.abs(b.year - muc))[0];
        sjr = thanh(gan, true);
      }
    }
    const raw = Array.isArray(p.authorsRaw) ? (p.authorsRaw as { isCorresponding?: boolean | null }[]) : [];
    const lienHe = [
      ...p.authors.filter((a) => a.isCorresponding && a.authorIndex >= 0).map((a) => a.authorIndex),
      ...raw.map((r, i) => (r?.isCorresponding ? i : -1)).filter((i) => i >= 0),
    ];
    return {
      id: p.id,
      title: p.title,
      containerTitle: p.containerTitle,
      type: p.type,
      catalogCode: p.catalogCode,
      issn: p.issn,
      nam,
      status: p.status,
      coOnline: !!(p.doi || p.url),
      tongTacGia: raw.length || p.totalAuthors || 1,
      viTriToi: d.authorIndex,
      toiLaFirst: d.isFirst,
      toiLaLienHe: d.isCorresponding,
      lienHe: [...new Set(lienHe)],
      sjr,
    };
  }
}
