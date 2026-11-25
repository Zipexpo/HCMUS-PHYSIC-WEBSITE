import { createReadStream, existsSync, mkdirSync, unlink } from 'node:fs';
import { join } from 'node:path';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { pageBySince } from './integration-cursor';
import { StaffPageService } from './staff-page.service';

/**
 * Tệp minh chứng của QUYẾT ĐỊNH (DecisionFile). Nằm trong volume `uploads/` (bền qua
 * deploy) nhưng main.ts CHẶN phục vụ tĩnh thư mục này — danh sách công nhận có tên +
 * mã người học, chỉ tải qua GET /scholar/decision-files/:fileId (có đăng nhập).
 */
export const SK_EVIDENCE_DIR = join(process.cwd(), 'uploads', 'initiative-evidence');
mkdirSync(SK_EVIDENCE_DIR, { recursive: true });

const CAP_NHAN: Record<string, string> = {
  CO_SO: 'Cấp cơ sở',
  BO: 'Cấp Bộ',
  TOAN_QUOC: 'Cấp toàn quốc',
};
import type { IntegrationQueryType } from './scholar.model';
import type {
  CapSangKien,
  CreateSangKienBodyType,
  TacGiaSangKienInput,
  UpdateSangKienBodyType,
} from './sang-kien.model';

/**
 * SÁNG KIẾN được công nhận — khai giống bài báo (Khoa yêu cầu 25/11/2026).
 *
 *   · MỘT MÃ SỐ, MỘT BẢN GHI dùng chung cho mọi đồng tác giả (như DOI của bài
 *     báo). Khai lại mã đã có thì KHÔNG tạo bản mới: giao diện tra mã trước và mời
 *     «gắn tên tôi vào» (`nhanTen`); tạo trùng thì báo lỗi kèm tên sáng kiến.
 *   · Người khai được CONFIRMED ngay; người bị gắn tên ở PENDING tới khi TỰ xác
 *     nhận. Tác giả không tài khoản (sinh viên, người đơn vị khác) chỉ là một dòng
 *     tên để giữ đúng thứ tự trong quyết định.
 *   · Không ai gỡ được tên người KHÁC đã xác nhận; lời mời đang chờ chỉ người mời
 *     rút được (quy tắc chung của Khoa từ 5/10/2026 — không thao tác trên hồ sơ
 *     người khác). Chính người đó thì bấm «Không phải tôi» / «Rút tên».
 *   · Mọi thay đổi đều chạm `Initiative.updatedAt`, nên kênh tích hợp chế độ
 *     `since` chỉ cần nhìn một cột, và gửi TRỌN danh sách người của sáng kiến vừa
 *     đổi (xem `integrationList`).
 */

// ── Lỗi ─────────────────────────────────────────────────────────────────────
export const SangKienNotFoundException = new NotFoundException([
  { field: 'id', error: 'Không tìm thấy sáng kiến' },
]);
export const MaSangKienKhongHopLeException = new UnprocessableEntityException([
  { field: 'code', error: 'Mã số sáng kiến không hợp lệ' },
]);
export const MaSangKienDaCoException = (ma: string, ten: string, nguoiKhai: string | null) =>
  new UnprocessableEntityException([
    {
      field: 'code',
      error:
        `Sáng kiến mã ${ma} đã có trên hệ thống: «${ten}»` +
        (nguoiKhai ? ` (do ${nguoiKhai} khai)` : '') +
        '. Đừng khai thêm bản mới — mở lại form, nhập mã này rồi bấm «Tôi là tác giả — gắn tên tôi».',
    },
  ]);
export const KhongPhaiTacGiaSangKienException = new ForbiddenException([
  {
    field: 'id',
    error: 'Chỉ tác giả đã xác nhận mới sửa được sáng kiến này',
  },
]);
export const PhaiCoTenMinhException = new UnprocessableEntityException([
  {
    field: 'authors',
    error: 'Danh sách tác giả phải có tên bạn. Muốn rút tên khỏi sáng kiến thì dùng nút «Rút tên».',
  },
]);
export const KhongGoTenNguoiKhacException = (ten: string) =>
  new UnprocessableEntityException([
    {
      field: 'authors',
      error: `Không gỡ được tên ${ten}: người này đã xác nhận là tác giả — chỉ chính họ rút tên được.`,
    },
  ]);
export const KhongRutMoiCuaNguoiKhacException = (ten: string) =>
  new UnprocessableEntityException([
    {
      field: 'authors',
      error: `Không gỡ được lời mời ${ten}: lời mời do người khác gửi — chỉ người mời rút lại, hoặc ${ten} tự bấm «Không phải tôi».`,
    },
  ]);
export const TaiKhoanKhongTonTaiException = new UnprocessableEntityException([
  { field: 'authors', error: 'Có tác giả được chọn không còn tài khoản trên hệ thống' },
]);
export const DongCoTaiKhoanException = new UnprocessableEntityException([
  {
    field: 'authorId',
    error: 'Dòng này đã gắn với một tài khoản — chỉ nhận được dòng tác giả chưa có tài khoản',
  },
]);
export const TepQdKhongCoException = new NotFoundException([
  { field: 'fileId', error: 'Không tìm thấy tệp minh chứng' },
]);
export const KhongGoTepQdException = new ForbiddenException([
  { field: 'fileId', error: 'Chỉ người đã tải tệp này hoặc quản trị Khoa gỡ được' },
]);

/**
 * KHOÁ của một quyết định để dùng chung minh chứng: số QĐ chuẩn hoá (bỏ khoảng trắng,
 * chữ hoa, «Đ»→«D», gạch nối Unicode → «-») + «|» + NĂM ký. Số QĐ đánh lại từ đầu mỗi
 * năm nên phải kèm năm. «3771/QĐ-KHTN» ngày 20/11/2026 → "3771/QD-KHTN|2026".
 */
export function khoaQuyetDinh(decisionNo: string, decisionDate: Date | string | null): string {
  const so = decisionNo
    .normalize('NFC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/Đ/g, 'D');
  const nam =
    decisionDate instanceof Date
      ? decisionDate.getUTCFullYear()
      : decisionDate
        ? Number(String(decisionDate).slice(0, 4))
        : '';
  return `${so}|${nam}`;
}

type TepQd = {
  id: string;
  label: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: Date;
};
/** Tệp minh chứng cho giao diện; `page` = trang chứa dòng của sáng kiến đang xem (nếu biết). */
const hinhTep = (f: TepQd, page: number | null) => ({
  id: f.id,
  label: f.label,
  originalName: f.originalName,
  mimeType: f.mimeType,
  size: f.size,
  uploadedBy: f.uploadedBy,
  createdAt: f.createdAt,
  page,
});

export const KhongChoDuyetException = new UnprocessableEntityException([
  { field: 'id', error: 'Sáng kiến này không ở trạng thái chờ Khoa duyệt' },
]);
export const ThieuLyDoTuChoiException = new UnprocessableEntityException([
  { field: 'note', error: 'Không duyệt thì ghi lý do để tác giả biết sửa gì' },
]);

// ── Duyệt ───────────────────────────────────────────────────────────────────
/**
 * NỘI DUNG của sáng kiến — phần mà đổi thì phải Khoa duyệt lại. Không gồm ghi chú,
 * liên kết, và TRẠNG THÁI XÁC NHẬN của từng người (xác nhận / rút tên là quyền
 * của chính người đó, không phải sửa sáng kiến).
 */
type BanTacGia = {
  userId: string | null;
  externalName: string | null;
  externalOrg: string | null;
  claimStatus?: string;
  ten?: string;
};
type BanNoiDung = {
  code: string;
  title: string;
  level: string;
  decisionNo: string;
  decisionDate: string | null;
  category: string | null;
  authors: BanTacGia[];
};

const TEN_TRUONG: Record<Exclude<keyof BanNoiDung, 'authors'> | 'authors', string> = {
  code: 'Mã số',
  title: 'Tên sáng kiến',
  level: 'Cấp',
  decisionNo: 'Số quyết định',
  decisionDate: 'Ngày quyết định',
  category: 'Nhóm',
  authors: 'Tác giả',
};

/** Bản chụp hợp lệ? (cột Json có thể là null / DbNull / rác cũ). */
function laBan(x: unknown): x is BanNoiDung {
  return !!x && typeof x === 'object' && Array.isArray((x as BanNoiDung).authors);
}

/** Chuỗi so sánh của danh sách tác giả — thứ tự + ai (không tính trạng thái xác nhận). */
const khoaTacGia = (ds: BanTacGia[]) =>
  ds.map((a) => (a.userId ? `u:${a.userId}` : `n:${a.externalName ?? ''}|${a.externalOrg ?? ''}`)).join(';');

/** Những trường khác nhau giữa bản đã duyệt và bản hiện tại — Khoa so trước khi duyệt. */
export function soThayDoi(cu: BanNoiDung, moi: BanNoiDung) {
  const out: Array<{ truong: string; tu: string; sang: string }> = [];
  for (const k of ['code', 'title', 'level', 'decisionNo', 'decisionDate', 'category'] as const) {
    if ((cu[k] ?? '') !== (moi[k] ?? '')) {
      out.push({ truong: TEN_TRUONG[k], tu: cu[k] ?? '', sang: moi[k] ?? '' });
    }
  }
  if (khoaTacGia(cu.authors) !== khoaTacGia(moi.authors)) {
    const ten = (ds: BanTacGia[]) => ds.map((a, i) => `${i + 1}. ${a.ten ?? a.externalName ?? ''}`).join('; ');
    out.push({ truong: TEN_TRUONG.authors, tu: ten(cu.authors), sang: ten(moi.authors) });
  }
  return out;
}

// ── Thuần ───────────────────────────────────────────────────────────────────
/**
 * Mã số sáng kiến dạng chuẩn để so trùng: bỏ mọi khoảng trắng, chữ hoa, gạch nối
 * Unicode (– — −) về «-». KHÔNG đổi O↔0, I↔1: bản quét hay lẫn nhưng tự đoán là
 * đè lên mã thật — người khai sửa tay.
 */
export function chuanHoaMaSangKien(x?: string | null): string | null {
  if (!x) return null;
  const s = x
    .normalize('NFC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
  return s.length >= 3 ? s : null;
}

const hoTen = (u?: { firstName: string | null; lastName: string | null } | null) =>
  [u?.lastName, u?.firstName].filter(Boolean).join(' ');

const ngay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Chuỗi rỗng → null; vắng mặt (undefined) giữ nguyên để PATCH không đụng tới. */
const rong = <T>(v: T | '' | null | undefined): T | null | undefined =>
  v === undefined ? undefined : v === '' || v === null ? null : v;

type DongMuon =
  | { kind: 'user'; userId: string; position: number }
  | { kind: 'ngoai'; externalName: string; externalOrg: string | null; position: number };

/**
 * Danh sách tác giả người dùng gửi → các dòng cần có, đánh lại thứ tự 0..n-1.
 * Tài khoản trùng thì giữ lần xuất hiện đầu. `nguoiKhai` chưa có trong danh sách
 * thì thêm vào CUỐI khi `themNguoiKhai` (lúc tạo mới).
 */
export function dungDanhSachTacGia(
  ds: TacGiaSangKienInput[],
  nguoiKhai: string,
  themNguoiKhai: boolean,
): DongMuon[] {
  const out: DongMuon[] = [];
  const daCo = new Set<string>();
  for (const a of ds) {
    if (a.userId) {
      if (daCo.has(a.userId)) continue;
      daCo.add(a.userId);
      out.push({ kind: 'user', userId: a.userId, position: out.length });
    } else if (a.externalName) {
      out.push({
        kind: 'ngoai',
        externalName: a.externalName,
        externalOrg: a.externalOrg || null,
        position: out.length,
      });
    }
  }
  if (themNguoiKhai && !daCo.has(nguoiKhai)) {
    out.push({ kind: 'user', userId: nguoiKhai, position: out.length });
  }
  return out;
}

const INCLUDE = {
  authors: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.InitiativeInclude;

type HangDayDu = Prisma.InitiativeGetPayload<{ include: typeof INCLUDE }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class SangKienService {
  private readonly logger = new Logger(SangKienService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
    // Không có (test) thì thôi đồng bộ trang nhân sự.
    @Optional() private readonly trang?: StaffPageService,
  ) {}

  /** Nội dung hiện tại dưới dạng bản chụp (kèm tên để Khoa đọc được chỗ đổi). */
  private banNoiDung(r: HangDayDu): BanNoiDung {
    return {
      code: r.code,
      title: r.title,
      level: r.level,
      decisionNo: r.decisionNo,
      decisionDate: ngay(r.decisionDate),
      category: r.category,
      authors: r.authors.map((a) => ({
        userId: a.userId,
        externalName: a.userId ? null : a.externalName,
        externalOrg: a.userId ? null : a.externalOrg,
        claimStatus: a.claimStatus,
        ten: a.userId ? hoTen(a.user) : (a.externalName ?? ''),
      })),
    };
  }

  private daDoiNoiDung(truoc: HangDayDu, sau: HangDayDu) {
    return soThayDoi(this.banNoiDung(truoc), this.banNoiDung(sau)).length > 0;
  }

  /**
   * Nội dung vừa đổi → chờ Khoa duyệt. Đang APPROVED thì chụp lại bản đã duyệt
   * (để Khoa so, và để trả lại nếu không duyệt); đang chờ sẵn thì giữ bản chụp cũ —
   * đó vẫn là bản Khoa duyệt gần nhất.
   */
  private async choDuyetLai(tx: Tx, truoc: HangDayDu) {
    if (truoc.reviewStatus === 'PENDING') return;
    await tx.initiative.update({
      where: { id: truoc.id },
      data: {
        reviewStatus: 'PENDING',
        reviewNote: null,
        ...(truoc.reviewStatus === 'APPROVED'
          ? { approvedSnapshot: this.banNoiDung(truoc) as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  private shape(r: HangDayDu, viewer: string | null, tepQd?: Map<string, TepQd[]>) {
    const tep = tepQd?.get(khoaQuyetDinh(r.decisionNo, r.decisionDate)) ?? [];
    const ban = laBan(r.approvedSnapshot) ? r.approvedSnapshot : null;
    const tacGia = r.authors.map((a) => ({
      id: a.id,
      position: a.position,
      userId: a.userId,
      displayName: a.userId ? hoTen(a.user) : (a.externalName ?? ''),
      externalOrg: a.userId ? null : a.externalOrg,
      departmentName: a.user?.department?.name ?? null,
      claimStatus: a.userId ? a.claimStatus : null,
      invitedBy: a.invitedBy,
    }));
    const nguoiKhai = r.authors.find((a) => a.userId && a.userId === r.createdBy);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      level: r.level as CapSangKien,
      decisionNo: r.decisionNo,
      decisionDate: ngay(r.decisionDate),
      category: r.category,
      note: r.note,
      url: r.url,
      createdBy: r.createdBy,
      createdByName: nguoiKhai ? hoTen(nguoiKhai.user) : null,
      myStatus: viewer ? (r.authors.find((a) => a.userId === viewer)?.claimStatus ?? null) : null,
      /** Người đang xem có cho hiện sáng kiến này trên trang nhân sự của mình không. */
      myShowOnWeb: viewer ? (r.authors.find((a) => a.userId === viewer)?.showOnWeb ?? null) : null,
      /**
       * Minh chứng DÙNG CHUNG của quyết định (mọi sáng kiến cùng số QĐ + năm). Tệp nào
       * là tệp chứa dòng của sáng kiến này thì kèm số trang để mở thẳng tới đó.
       */
      minhChung: tep.map((f) => hinhTep(f, f.id === r.evidenceFileId ? r.evidencePage : null)),
      authors: tacGia,
      reviewStatus: r.reviewStatus as 'APPROVED' | 'PENDING' | 'REJECTED',
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      source: r.source,
      /** Chỗ đổi so với bản Khoa đã duyệt (chỉ khi đang chờ duyệt một bản sửa). */
      thayDoi: ban ? soThayDoi(ban, this.banNoiDung(r)) : [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private emit(id: string, userIds: Array<string | null | undefined>) {
    const ids = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
    this.bus.emit('initiative.changed', { id, userIds: ids });
    // Trang nhân sự của những người bị ảnh hưởng — chạy nền, hỏng không làm hỏng thao tác.
    if (this.trang) {
      void Promise.allSettled(ids.map((u) => this.capNhatTrang(u))).then((kq) =>
        kq.forEach((k) => k.status === 'rejected' && this.logger.warn(`trang nhân sự: ${String(k.reason)}`)),
      );
    }
  }

  // ── Trang nhân sự ────────────────────────────────────────────────────────
  /**
   * Dòng «Sáng kiến» trên trang nhân sự của một người: sáng kiến người đó ĐÃ XÁC
   * NHẬN, bật «hiện trên trang», và Khoa ĐÃ DUYỆT. Đang chờ duyệt một bản sửa thì
   * hiện bản đã duyệt (nếu người đó có trong bản ấy); khai mới chưa duyệt thì chưa hiện.
   */
  async mucTrangCua(userId: string): Promise<Array<{ title: string; desc: string }>> {
    const rows = await this.prisma.initiativeAuthor.findMany({
      where: {
        userId,
        claimStatus: 'CONFIRMED',
        showOnWeb: true,
        initiative: { deletedAt: null, reviewStatus: { in: ['APPROVED', 'PENDING'] } },
      },
      include: { initiative: true },
    });
    const out: Array<{ ngay: string; title: string; desc: string }> = [];
    for (const { initiative: r } of rows) {
      const ban = r.reviewStatus === 'PENDING' ? (laBan(r.approvedSnapshot) ? r.approvedSnapshot : null) : null;
      if (r.reviewStatus === 'PENDING' && (!ban || !ban.authors.some((a) => a.userId === userId))) continue;
      const nd = ban ?? { ...r, decisionDate: ngay(r.decisionDate) };
      const d = nd.decisionDate ? nd.decisionDate.split('-').reverse().join('/') : '';
      out.push({
        ngay: nd.decisionDate ?? '',
        title: nd.title,
        desc: [nd.code, CAP_NHAN[nd.level] ?? nd.level, `QĐ ${nd.decisionNo}${d ? ` (${d})` : ''}`].join(' · '),
      });
    }
    return out.sort((a, b) => b.ngay.localeCompare(a.ngay)).map(({ title, desc }) => ({ title, desc }));
  }

  private async capNhatTrang(userId: string, lamMoi = true) {
    if (!this.trang) return null;
    return this.trang.ganMucSangKien(userId, await this.mucTrangCua(userId), { lamMoi });
  }

  /**
   * Một lượt cho MỌI người có tên trong sáng kiến (sau khi Khoa nạp danh sách) —
   * chỉ quản trị. Chỉ thay dòng do máy sinh trong mục «Sáng kiến», không xuất bản
   * nháp của ai. `dryRun` chỉ đếm.
   */
  async dongBoTrangTatCa(dryRun = false) {
    const ds = await this.prisma.initiativeAuthor.findMany({
      where: { userId: { not: null }, claimStatus: 'CONFIRMED', initiative: { deletedAt: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const ids = ds.map((x) => x.userId as string);
    const coTrang = await this.prisma.scholarProfile.count({
      where: { userId: { in: ids }, staffPageSlug: { not: null } },
    });
    if (dryRun || !this.trang) return { nguoi: ids.length, coTrang, doi: 0, boQua: 0 };
    const slugs: string[] = [];
    let doi = 0;
    let boQua = 0;
    for (const u of ids) {
      try {
        const kq = await this.capNhatTrang(u, false);
        if (!kq) boQua++;
        else if (kq.doi) {
          doi++;
          slugs.push(kq.slug);
        }
      } catch (e) {
        boQua++;
        this.logger.warn(`trang nhân sự ${u}: ${String(e)}`);
      }
    }
    await this.trang.lamMoiNhieuTrang(slugs);
    return { nguoi: ids.length, coTrang, doi, boQua };
  }

  /** Tác giả tự bật / tắt hiện sáng kiến này trên trang nhân sự của MÌNH. */
  async doiHienTrenWeb(userId: string, id: string, showOnWeb: boolean) {
    const done = await this.prisma.initiativeAuthor.updateMany({
      where: { initiativeId: id, userId, initiative: { deletedAt: null } },
      data: { showOnWeb },
    });
    if (!done.count) throw SangKienNotFoundException;
    await this.capNhatTrang(userId).catch((e) => this.logger.warn(`trang nhân sự: ${String(e)}`));
    return { ok: true, showOnWeb };
  }

  // ── Minh chứng DÙNG CHUNG theo quyết định ───────────────────────────────
  /** Tệp của nhiều QĐ một lượt → Map<decisionKey, tệp[]>. */
  private async tepTheoKhoa(keys: string[]) {
    const ds = keys.length
      ? await this.prisma.decisionFile.findMany({
          where: { decisionKey: { in: [...new Set(keys)] }, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const m = new Map<string, typeof ds>();
    for (const f of ds) m.set(f.decisionKey, [...(m.get(f.decisionKey) ?? []), f]);
    return m;
  }

  /** Định hình nhiều sáng kiến, kèm tệp minh chứng của QĐ từng cái (một truy vấn). */
  private async shapeNhieu(rows: HangDayDu[], viewer: string | null) {
    const tep = await this.tepTheoKhoa(rows.map((r) => khoaQuyetDinh(r.decisionNo, r.decisionDate)));
    return rows.map((r) => this.shape(r, viewer, tep));
  }

  /** Tệp minh chứng đã có của một QĐ — form khai mới hỏi trước để khỏi tải lại. */
  async tepCuaQuyetDinh(decisionNo: string, decisionDate: string) {
    const khoa = khoaQuyetDinh(decisionNo, decisionDate);
    const tep = (await this.tepTheoKhoa([khoa])).get(khoa) ?? [];
    return { items: tep.map((f) => hinhTep(f, null)) };
  }

  /**
   * Tải tệp minh chứng cho QĐ của sáng kiến `id` — MỘT lần cho cả QĐ: mọi sáng kiến
   * cùng số QĐ + năm thấy ngay. Người tải phải là tác giả đã xác nhận của sáng kiến
   * này, hoặc quản trị Khoa. Không bắt Khoa duyệt lại sáng kiến (như liên kết).
   */
  async taiLenTepQd(
    userId: string,
    laQuanTri: boolean,
    id: string,
    file: { filename: string; originalname: string; mimetype: string; size: number },
    label?: string | null,
  ) {
    const xoaTep = () => unlink(join(SK_EVIDENCE_DIR, file.filename), () => undefined);
    const r = await this.prisma.initiative.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!r) {
      xoaTep();
      throw SangKienNotFoundException;
    }
    const laTacGia = r.authors.some((a) => a.userId === userId && a.claimStatus === 'CONFIRMED');
    if (!laTacGia && !laQuanTri) {
      xoaTep();
      throw KhongPhaiTacGiaSangKienException;
    }
    await this.prisma.decisionFile.create({
      data: {
        decisionKey: khoaQuyetDinh(r.decisionNo, r.decisionDate),
        decisionNo: r.decisionNo,
        label: label?.trim() || null,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: userId,
      },
    });
    return this.findOne(id, userId);
  }

  /** Đọc một tệp minh chứng — ai đăng nhập cũng xem được (quyết định là văn bản trong Trường). */
  async docTepQd(fileId: string) {
    const f = await this.prisma.decisionFile.findFirst({ where: { id: fileId, deletedAt: null } });
    const duong = f ? join(SK_EVIDENCE_DIR, f.storedName) : null;
    if (!f || !duong || !existsSync(duong)) throw TepQdKhongCoException;
    return { stream: createReadStream(duong), originalName: f.originalName, mimeType: f.mimeType };
  }

  /** Gỡ một tệp (tải nhầm) — người đã tải hoặc quản trị Khoa. Con trỏ trang của sáng kiến tự về trống. */
  async goTepQd(userId: string, laQuanTri: boolean, fileId: string) {
    const f = await this.prisma.decisionFile.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!f) throw TepQdKhongCoException;
    if (f.uploadedBy !== userId && !laQuanTri) throw KhongGoTepQdException;
    await this.prisma.decisionFile.delete({ where: { id: f.id } });
    unlink(join(SK_EVIDENCE_DIR, f.storedName), () => undefined);
    return { removed: true };
  }

  /** Quản trị Khoa: admin, hoặc tài khoản được bật quyền xem thống kê (như de-nghi-sua). */
  async laQuanTri(userId: string, roleName: string) {
    if (roleName === 'ADMIN' || roleName === 'SUPER_ADMIN') return true;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { canViewStats: true, isActive: true } });
    return !!(u?.canViewStats && u.isActive);
  }

  // ── Đọc ───────────────────────────────────────────────────────────────────
  async list(userId: string, q?: string) {
    const where: Prisma.InitiativeWhereInput = {
      deletedAt: null,
      authors: { some: { userId, claimStatus: { in: ['CONFIRMED', 'PENDING'] } } },
      ...(q?.trim()
        ? {
            OR: [
              { title: { contains: q.trim(), mode: 'insensitive' } },
              { code: { contains: q.trim(), mode: 'insensitive' } },
              { decisionNo: { contains: q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.initiative.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ decisionDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { items: await this.shapeNhieu(rows, userId), total: rows.length };
  }

  /**
   * Ai đăng nhập cũng xem được: quyết định công nhận là văn bản công khai trong
   * Trường, và người chưa có tên cần xem để biết mình có nên «gắn tên tôi» không.
   */
  async findOne(id: string, viewer: string) {
    const r = await this.prisma.initiative.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!r) throw SangKienNotFoundException;
    return (await this.shapeNhieu([r], viewer))[0];
  }

  /** Tra mã trước khi khai — đã có thì giao diện mời gắn tên thay vì khai bản mới. */
  async traMa(code: string, viewer: string) {
    const ma = chuanHoaMaSangKien(code);
    if (!ma) return { found: false, item: null };
    const r = await this.prisma.initiative.findFirst({
      where: { code: ma, deletedAt: null },
      include: INCLUDE,
    });
    return r ? { found: true, item: (await this.shapeNhieu([r], viewer))[0] } : { found: false, item: null };
  }

  // ── Ghi ───────────────────────────────────────────────────────────────────
  private async kiemTaiKhoan(tx: Tx, rows: DongMuon[]) {
    const ids = rows.flatMap((r) => (r.kind === 'user' ? [r.userId] : []));
    if (!ids.length) return;
    const co = await tx.user.count({ where: { id: { in: ids }, isActive: true } });
    if (co !== ids.length) throw TaiKhoanKhongTonTaiException;
  }

  private async taoDong(tx: Tx, initiativeId: string, rows: DongMuon[], nguoiKhai: string) {
    const now = new Date();
    if (!rows.length) return;
    await tx.initiativeAuthor.createMany({
      data: rows.map((r) =>
        r.kind === 'user'
          ? {
              initiativeId,
              position: r.position,
              userId: r.userId,
              claimStatus: r.userId === nguoiKhai ? ('CONFIRMED' as const) : ('PENDING' as const),
              invitedBy: r.userId === nguoiKhai ? null : nguoiKhai,
              respondedAt: r.userId === nguoiKhai ? now : null,
            }
          : {
              initiativeId,
              position: r.position,
              externalName: r.externalName,
              externalOrg: r.externalOrg,
              // Dòng không tài khoản không xác nhận gì — để CONFIRMED cho khỏi lẫn
              // vào các phép đếm lời mời đang chờ.
              claimStatus: 'CONFIRMED' as const,
            },
      ),
    });
  }

  async create(userId: string, body: CreateSangKienBodyType) {
    const ma = chuanHoaMaSangKien(body.code);
    if (!ma) throw MaSangKienKhongHopLeException;
    const rows = dungDanhSachTacGia(body.authors ?? [], userId, true);
    const thongTin = {
      code: ma,
      title: body.title,
      level: body.level ?? 'CO_SO',
      decisionNo: body.decisionNo,
      decisionDate: body.decisionDate,
      category: body.category ?? null,
      note: rong(body.note) ?? null,
      url: rong(body.url) ?? null,
    };

    const id = await this.prisma.$transaction(async (tx) => {
      const cu = await tx.initiative.findUnique({ where: { code: ma }, include: INCLUDE });
      if (cu && !cu.deletedAt) {
        throw MaSangKienDaCoException(ma, cu.title, this.shape(cu, null).createdByName);
      }
      await this.kiemTaiKhoan(tx, rows);
      let moiId: string;
      if (cu) {
        // Bản cùng mã đã bị xoá: dựng lại TRÊN CHÍNH bản đó (giữ id) thay vì đụng
        // khoá duy nhất — bên ACADsoom thấy cùng initiativeId sống lại.
        await tx.initiativeAuthor.deleteMany({ where: { initiativeId: cu.id } });
        await tx.initiative.update({
          where: { id: cu.id },
          data: {
            ...thongTin,
            createdBy: userId,
            deletedAt: null,
            source: 'manual',
            reviewStatus: 'PENDING',
            approvedSnapshot: Prisma.DbNull,
            reviewNote: null,
            reviewedBy: null,
            reviewedAt: null,
          },
        });
        moiId = cu.id;
      } else {
        moiId = (await tx.initiative.create({ data: { ...thongTin, createdBy: userId } })).id;
      }
      await this.taoDong(tx, moiId, rows, userId);
      return moiId;
    });

    this.emit(id, rows.map((r) => (r.kind === 'user' ? r.userId : null)));
    return this.findOne(id, userId);
  }

  /** Tác giả ĐÃ XÁC NHẬN mới sửa được (giống bài báo). */
  private async assertXacNhan(tx: Tx | PrismaService, id: string, userId: string) {
    const r = await tx.initiative.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!r) throw SangKienNotFoundException;
    const toi = r.authors.find((a) => a.userId === userId);
    if (toi?.claimStatus !== 'CONFIRMED') throw KhongPhaiTacGiaSangKienException;
    return r;
  }

  async update(userId: string, id: string, body: UpdateSangKienBodyType) {
    const { authors, code, ...rest } = body;
    const anhHuong = new Set<string>([userId]);

    await this.prisma.$transaction(async (tx) => {
      const r = await this.assertXacNhan(tx, id, userId);
      r.authors.forEach((a) => a.userId && anhHuong.add(a.userId));

      const data: Prisma.InitiativeUpdateInput = { updatedAt: new Date() };
      if (code !== undefined) {
        const ma = chuanHoaMaSangKien(code);
        if (!ma) throw MaSangKienKhongHopLeException;
        if (ma !== r.code) {
          const khac = await tx.initiative.findUnique({ where: { code: ma }, include: INCLUDE });
          if (khac && !khac.deletedAt) {
            throw MaSangKienDaCoException(ma, khac.title, this.shape(khac, null).createdByName);
          }
          if (khac) {
            // Bản đã xoá đang giữ mã: đổi mã của nó đi để nhường khoá duy nhất.
            await tx.initiative.update({
              where: { id: khac.id },
              data: { code: `${ma}~${khac.id}` },
            });
          }
          data.code = ma;
        }
      }
      for (const k of ['title', 'level', 'decisionNo', 'decisionDate', 'category', 'note', 'url'] as const) {
        const v = rong(rest[k]);
        if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      }
      await tx.initiative.update({ where: { id }, data });

      if (authors !== undefined) {
        const moi = await this.dongBoTacGia(tx, r, userId, authors);
        moi.forEach((u) => anhHuong.add(u));
      }

      // Tác giả tự sửa NỘI DUNG → chờ Khoa duyệt (người dùng chốt 25/11/2026).
      const sau = await tx.initiative.findFirst({ where: { id }, include: INCLUDE });
      if (sau && this.daDoiNoiDung(r, sau)) await this.choDuyetLai(tx, r);
    });

    this.emit(id, [...anhHuong]);
    return this.findOne(id, userId);
  }

  /**
   * Sửa danh sách tác giả: giữ NGUYÊN trạng thái xác nhận của người đã có (chỉ đổi
   * thứ tự), mời người mới (PENDING), dòng không tài khoản thì thay cả loạt. Trả
   * về id những người mới được mời.
   */
  private async dongBoTacGia(
    tx: Tx,
    r: HangDayDu,
    userId: string,
    ds: TacGiaSangKienInput[],
  ): Promise<string[]> {
    const muon = dungDanhSachTacGia(ds, userId, false);
    const muonUser = new Map(
      muon.flatMap((m) => (m.kind === 'user' ? [[m.userId, m] as const] : [])),
    );
    if (!muonUser.has(userId)) throw PhaiCoTenMinhException;

    const dangCo = r.authors.filter((a) => a.userId);
    const coRoi = new Set(dangCo.map((a) => a.userId as string));

    // Người bị bỏ khỏi danh sách: chỉ được bỏ lời mời CỦA MÌNH đang chờ, hoặc người đã từ chối.
    const boDi = dangCo.filter((a) => !muonUser.has(a.userId as string));
    for (const a of boDi) {
      const ten = hoTen(a.user) || 'người này';
      if (a.claimStatus === 'CONFIRMED') throw KhongGoTenNguoiKhacException(ten);
      if (a.claimStatus === 'PENDING' && a.invitedBy !== userId) throw KhongRutMoiCuaNguoiKhacException(ten);
    }

    const themMoi = muon.filter(
      (m): m is Extract<DongMuon, { kind: 'user' }> => m.kind === 'user' && !coRoi.has(m.userId),
    );
    await this.kiemTaiKhoan(tx, themMoi);

    if (boDi.length) {
      await tx.initiativeAuthor.deleteMany({ where: { id: { in: boDi.map((a) => a.id) } } });
    }
    // Đổi thứ tự người đã có — không đụng trạng thái xác nhận.
    for (const a of dangCo) {
      const m = muonUser.get(a.userId as string);
      if (m && m.position !== a.position) {
        await tx.initiativeAuthor.update({ where: { id: a.id }, data: { position: m.position } });
      }
    }
    // Dòng không tài khoản chỉ là tên — thay cả loạt theo danh sách mới.
    await tx.initiativeAuthor.deleteMany({ where: { initiativeId: r.id, userId: null } });
    await this.taoDong(
      tx,
      r.id,
      [...themMoi, ...muon.filter((m) => m.kind === 'ngoai')],
      userId,
    );
    return themMoi.map((m) => m.userId);
  }

  /**
   * «Rút tên» — người gọi thôi đứng tên. Còn tác giả khác đã xác nhận thì chỉ dòng
   * của mình chuyển REJECTED; không còn ai thì xoá mềm cả sáng kiến (kênh tích hợp
   * báo `removed`).
   */
  async remove(userId: string, id: string) {
    const r = await this.prisma.initiative.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!r) throw SangKienNotFoundException;
    const toi = r.authors.find((a) => a.userId === userId);
    if (!toi || toi.claimStatus === 'REJECTED') throw KhongPhaiTacGiaSangKienException;
    const conNguoi = r.authors.some(
      (a) => a.userId && a.userId !== userId && a.claimStatus === 'CONFIRMED',
    );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (conNguoi) {
        await tx.initiativeAuthor.update({
          where: { id: toi.id },
          data: { claimStatus: 'REJECTED', respondedAt: now },
        });
        await tx.initiative.update({ where: { id }, data: { updatedAt: now } });
      } else {
        await tx.initiative.update({ where: { id }, data: { deletedAt: now } });
      }
    });
    this.emit(id, r.authors.map((a) => a.userId));
    return { removed: true, sharedWithOthers: conNguoi };
  }

  /**
   * «Tôi là tác giả — gắn tên tôi»: dùng khi mã đã được người khác khai. Có lời mời
   * đang chờ thì coi như xác nhận; chọn một dòng KHÔNG tài khoản (`authorId`) thì
   * dòng đó thành của mình, giữ nguyên thứ tự; không thì thêm vào cuối.
   */
  async nhanTen(userId: string, id: string, authorId?: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.initiative.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
      if (!r) throw SangKienNotFoundException;
      const toi = r.authors.find((a) => a.userId === userId);

      if (authorId) {
        const dong = r.authors.find((a) => a.id === authorId);
        if (!dong) throw SangKienNotFoundException;
        if (dong.userId) throw DongCoTaiKhoanException;
        if (toi) await tx.initiativeAuthor.delete({ where: { id: toi.id } });
        await tx.initiativeAuthor.update({
          where: { id: dong.id },
          data: {
            userId,
            externalName: null,
            externalOrg: null,
            claimStatus: 'CONFIRMED',
            invitedBy: null,
            respondedAt: now,
          },
        });
      } else if (toi) {
        await tx.initiativeAuthor.update({
          where: { id: toi.id },
          data: { claimStatus: 'CONFIRMED', respondedAt: now },
        });
      } else {
        const cuoi = r.authors.reduce((m, a) => Math.max(m, a.position), -1);
        await tx.initiativeAuthor.create({
          data: {
            initiativeId: id,
            position: cuoi + 1,
            userId,
            claimStatus: 'CONFIRMED',
            respondedAt: now,
          },
        });
      }
      await tx.initiative.update({ where: { id }, data: { updatedAt: now } });

      // Thêm / đổi người trong danh sách tác giả cũng là đổi nội dung → Khoa duyệt.
      // Chỉ xác nhận lời mời sẵn có thì không (danh sách không đổi).
      const sau = await tx.initiative.findFirst({ where: { id }, include: INCLUDE });
      if (sau && this.daDoiNoiDung(r, sau)) await this.choDuyetLai(tx, r);
    });
    this.emit(id, [userId]);
    return this.findOne(id, userId);
  }

  // ── Khoa duyệt ───────────────────────────────────────────────────────────
  /** Danh sách cho quản trị Khoa (admin hoặc canViewStats — XemThongKeGuard). */
  async danhSachDuyet(trangThai: 'PENDING' | 'REJECTED' | 'APPROVED' = 'PENDING') {
    const rows = await this.prisma.initiative.findMany({
      where: { deletedAt: null, reviewStatus: trangThai },
      include: INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    });
    return { items: await this.shapeNhieu(rows, null), total: rows.length };
  }

  /**
   * Khoa quyết. Duyệt → APPROVED, bỏ bản chụp. Không duyệt: nếu là bản SỬA của một
   * sáng kiến đã duyệt thì TRẢ LẠI nguyên bản đã duyệt (vẫn APPROVED, kèm lý do);
   * nếu là sáng kiến khai mới thì REJECTED — tác giả sửa rồi lại chờ duyệt.
   */
  async duyet(adminId: string, id: string, ok: boolean, note?: string | null) {
    const ghiChu = note?.trim() || null;
    if (!ok && (!ghiChu || ghiChu.length < 5)) throw ThieuLyDoTuChoiException;
    const now = new Date();
    const ids = await this.prisma.$transaction(async (tx) => {
      const r = await tx.initiative.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
      if (!r) throw SangKienNotFoundException;
      if (r.reviewStatus !== 'PENDING') throw KhongChoDuyetException;
      const ban = laBan(r.approvedSnapshot) ? r.approvedSnapshot : null;
      const chung = { reviewNote: ghiChu, reviewedBy: adminId, reviewedAt: now, approvedSnapshot: Prisma.DbNull };

      if (ok) {
        await tx.initiative.update({ where: { id }, data: { ...chung, reviewStatus: 'APPROVED' } });
      } else if (ban) {
        await this.traLaiBanDaDuyet(tx, r, ban);
        await tx.initiative.update({ where: { id }, data: { ...chung, reviewStatus: 'APPROVED' } });
      } else {
        await tx.initiative.update({ where: { id }, data: { ...chung, reviewStatus: 'REJECTED' } });
      }
      return [...r.authors.map((a) => a.userId), ...(ban?.authors.map((a) => a.userId) ?? [])];
    });
    this.emit(id, ids);
    return this.findOne(id, adminId);
  }

  /**
   * Trả nội dung về bản đã duyệt. Người vẫn còn dòng thì GIỮ trạng thái xác nhận
   * hiện tại (họ có thể vừa xác nhận / rút tên — đó là quyền của họ); người bị gỡ
   * trong bản sửa thì về lại với trạng thái lúc được duyệt.
   */
  private async traLaiBanDaDuyet(tx: Tx, r: HangDayDu, ban: BanNoiDung) {
    const hienTai = new Map(r.authors.filter((a) => a.userId).map((a) => [a.userId as string, a]));
    await tx.initiative.update({
      where: { id: r.id },
      data: {
        code: ban.code,
        title: ban.title,
        level: ban.level,
        decisionNo: ban.decisionNo,
        decisionDate: ban.decisionDate ? new Date(`${ban.decisionDate}T00:00:00.000Z`) : null,
        category: ban.category,
      },
    });
    await tx.initiativeAuthor.deleteMany({ where: { initiativeId: r.id } });
    await tx.initiativeAuthor.createMany({
      data: ban.authors.map((a, i) => {
        const cu = a.userId ? hienTai.get(a.userId) : undefined;
        return a.userId
          ? {
              initiativeId: r.id,
              position: i,
              userId: a.userId,
              claimStatus: (cu?.claimStatus ?? a.claimStatus ?? 'CONFIRMED') as 'CONFIRMED' | 'PENDING' | 'REJECTED',
              invitedBy: cu?.invitedBy ?? null,
              respondedAt: cu?.respondedAt ?? null,
            }
          : {
              initiativeId: r.id,
              position: i,
              externalName: a.externalName,
              externalOrg: a.externalOrg,
              claimStatus: 'CONFIRMED' as const,
            };
      }),
    });
  }

  // ── Lời mời ───────────────────────────────────────────────────────────────
  async loiMoi(userId: string) {
    const rows = await this.prisma.initiativeAuthor.findMany({
      where: { userId, claimStatus: 'PENDING', initiative: { deletedAt: null } },
      include: { initiative: { include: INCLUDE } },
      orderBy: { createdAt: 'desc' },
    });
    const moiBoi = [...new Set(rows.map((r) => r.invitedBy).filter((x): x is string => Boolean(x)))];
    const nguoiMoi = moiBoi.length
      ? await this.prisma.user.findMany({
          where: { id: { in: moiBoi } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const tenMoi = new Map(nguoiMoi.map((u) => [u.id, hoTen(u)]));
    return {
      items: rows.map((m) => {
        const s = this.shape(m.initiative, userId);
        return {
          initiativeId: s.id,
          code: s.code,
          title: s.title,
          level: s.level,
          decisionNo: s.decisionNo,
          decisionDate: s.decisionDate,
          invitedByName: m.invitedBy ? (tenMoi.get(m.invitedBy) ?? null) : null,
          authors: s.authors.map((a) => a.displayName),
        };
      }),
    };
  }

  async traLoiMoi(userId: string, id: string, accept: boolean) {
    const now = new Date();
    const done = await this.prisma.initiativeAuthor.updateMany({
      where: { initiativeId: id, userId, claimStatus: 'PENDING', initiative: { deletedAt: null } },
      data: { claimStatus: accept ? 'CONFIRMED' : 'REJECTED', respondedAt: now },
    });
    if (!done.count) throw SangKienNotFoundException;
    await this.prisma.initiative.update({ where: { id }, data: { updatedAt: now } });
    this.emit(id, [userId]);
    return { ok: true };
  }

  // ── Kênh tích hợp (ACADsoom) ─────────────────────────────────────────────
  /**
   * MỖI NGƯỜI CÓ TÀI KHOẢN MỘT DÒNG, khoá (initiativeId, email).
   *
   * Ảnh chụp (không `since`): chỉ sáng kiến chưa xoá, chỉ người ĐÃ XÁC NHẬN.
   *
   * `since`: mọi sáng kiến có `updatedAt` ≥ mốc (mọi thao tác đều chạm cột này),
   * và gửi TRỌN các dòng tài khoản của sáng kiến đó với CÙNG một mốc đổi — không
   * bao giờ bị cắt đôi giữa hai trang. Người chưa / thôi xác nhận và sáng kiến đã
   * xoá mang `removed: true`. Người bị gỡ hẳn khỏi danh sách thì không còn dòng
   * nào: bên nhận coi mỗi lượt của một initiativeId là TRỌN danh sách — email nào
   * của sáng kiến đó không có trong lượt là đã bị gỡ.
   */
  async integrationList(query: IntegrationQueryType) {
    const since = query.since;
    const loc = new Set(
      [query.email, ...(query.emails?.split(',') ?? [])]
        .map((e) => e?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e)),
    );
    const nam =
      query.from || query.to
        ? {
            decisionDate: {
              ...(query.from ? { gte: new Date(`${query.from}-01-01T00:00:00.000Z`) } : {}),
              ...(query.to ? { lt: new Date(`${query.to + 1}-01-01T00:00:00.000Z`) } : {}),
            },
          }
        : {};

    const rows = await this.prisma.initiative.findMany({
      where: {
        ...nam,
        ...(since ? { updatedAt: { gte: since } } : { deletedAt: null }),
        ...(loc.size
          ? {
              authors: {
                some: {
                  user: { email: { in: [...loc] } },
                  ...(since ? {} : { claimStatus: 'CONFIRMED' as const }),
                },
              },
            }
          : {}),
      },
      include: {
        authors: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: { user: { select: { email: true } } },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });

    // BẢN SỬA CHỜ DUYỆT không đi ra ngoài: sáng kiến đã duyệt mà tác giả đang sửa thì
    // gửi BẢN ĐÃ DUYỆT gần nhất (approvedSnapshot) như APPROVED — Khoa duyệt xong bản
    // sửa mới thay. Người có trong bản chụp mà nay không còn dòng thì tra email riêng.
    const banCua = (r: (typeof rows)[number]) =>
      r.reviewStatus === 'PENDING' && laBan(r.approvedSnapshot) ? r.approvedSnapshot : null;
    const idCanEmail = [
      ...new Set(
        rows.flatMap((r) => banCua(r)?.authors.flatMap((a) => (a.userId ? [a.userId] : [])) ?? []),
      ),
    ];
    const emailTheoId = new Map(
      (idCanEmail.length
        ? await this.prisma.user.findMany({ where: { id: { in: idCanEmail } }, select: { id: true, email: true } })
        : []
      ).map((u) => [u.id, u.email]),
    );

    const out: Array<{ changedAt: Date; item: Record<string, unknown> }> = [];
    for (const r of rows) {
      const ban = banCua(r);
      const hienTai = new Map(r.authors.flatMap((a) => (a.userId ? [[a.userId, a] as const] : [])));
      const noiDung = ban
        ? { code: ban.code, title: ban.title, level: ban.level, decisionNo: ban.decisionNo, decisionDate: ban.decisionDate, category: ban.category }
        : { code: r.code, title: r.title, level: r.level, decisionNo: r.decisionNo, decisionDate: ngay(r.decisionDate), category: r.category };
      // Trạng thái xác nhận luôn lấy HIỆN TẠI nếu người đó còn dòng (rút tên là quyền của họ, không chờ duyệt).
      const ds = ban
        ? ban.authors.map((a) => ({
            userId: a.userId,
            claimStatus: (a.userId && hienTai.get(a.userId)?.claimStatus) || a.claimStatus,
            email: a.userId ? (hienTai.get(a.userId)?.user?.email ?? emailTheoId.get(a.userId) ?? null) : null,
          }))
        : r.authors.map((a) => ({ userId: a.userId, claimStatus: a.claimStatus, email: a.user?.email ?? null }));
      const tong = ds.length;
      ds.forEach((a, i) => {
        if (!a.userId) return;
        const daXacNhan = a.claimStatus === 'CONFIRMED';
        if (!since && !daXacNhan) return;
        const email = a.email?.toLowerCase() ?? null;
        if (loc.size && (!email || !loc.has(email))) return;
        out.push({
          changedAt: r.updatedAt,
          item: {
            initiativeId: r.id,
            ...noiDung,
            /** Chỉ APPROVED mới được đếm bên ACADsoom; PENDING / REJECTED để hiển thị. */
            reviewStatus: ban ? 'APPROVED' : r.reviewStatus,
            email,
            position: i + 1,
            totalAuthors: tong,
            removed: r.deletedAt !== null || !daXacNhan,
          },
        });
      });
    }

    if (!since) return { items: out.map((o) => o.item) };
    return pageBySince(out, query.limit);
  }
}
