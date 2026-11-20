import { createReadStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROLES, RoleName } from '../shared/constants/role.constants';
import { EventBusService } from '../shared/services/event-bus.service';
import {
  nguoiKyHeThong,
  phuongAnChia,
  trangThaiSau,
  vanTay,
  vanTayTaiKhoan,
  type ChuKy,
  type DongChia,
  type TrangThaiDon,
  type TuChoiKy,
} from './thoa-thuan';

/** Bản quét đơn có chữ ký tay — cùng ổ `uploads` với minh chứng đề tài (được mount ra ngoài container). */
export const DON_DIR = join(process.cwd(), 'uploads', 'share-agreement');
try {
  mkdirSync(DON_DIR, { recursive: true });
} catch {
  // không tạo được thì lần tải lên sẽ báo lỗi rõ ràng
}

const KhongThayDonException = new NotFoundException([
  { field: 'id', error: 'Không tìm thấy đơn thoả thuận.' },
]);
const KhongCoQuyenException = new ForbiddenException([
  { field: 'id', error: 'Thầy/Cô không có tên trong đơn thoả thuận này.' },
]);
const DonDaChotException = new ConflictException([
  { field: 'id', error: 'Đơn này đã được Khoa duyệt hoặc đã hết hiệu lực (tỷ lệ đã đổi) — không ký / sửa được nữa.' },
]);
const LyDoTuChoiException = new UnprocessableEntityException([
  { field: 'reason', error: 'Không đồng ý thì ghi một câu lý do (ít nhất 10 ký tự) để đại diện nhóm biết mà sửa.' },
]);

type Don = Prisma.ShareAgreementGetPayload<object>;
type ChupTruoc = { vanTayTaiKhoan: string } | null;

/** Người sửa/khai vừa lưu — ai lập đơn nếu tỷ lệ đổi. */
type NgoaiGuiLen = { name?: string | null; sharePercent?: number | null }[] | undefined;

@Injectable()
export class ThoaThuanService {
  private readonly log = new Logger(ThoaThuanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
  ) {}

  // ── Lập / thay đơn khi tỷ lệ đổi ───────────────────────────────────────────
  private async taiKhoanCuaBai(publicationId: string) {
    const rows = await this.prisma.publicationAuthor.findMany({
      where: { publicationId, claimStatus: { not: 'REJECTED' } },
      select: {
        userId: true,
        authorIndex: true,
        sharePercent: true,
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      authorIndex: r.authorIndex,
      sharePercent: r.sharePercent,
      email: r.user?.email ?? null,
      ten: [r.user?.lastName, r.user?.firstName].filter(Boolean).join(' ') || r.user?.email || '',
    }));
  }

  /** Chụp phần tài khoản TRƯỚC khi lưu — so sau khi lưu để biết tỷ lệ có đổi không. */
  async chupTruoc(publicationId: string): Promise<ChupTruoc> {
    const bai = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { authorsRaw: true },
    });
    if (!bai) return null;
    const ds = phuongAnChia({ taiKhoan: await this.taiKhoanCuaBai(publicationId), raw: bai.authorsRaw });
    return { vanTayTaiKhoan: vanTayTaiKhoan(ds) };
  }

  /**
   * Gọi SAU mỗi lượt lưu có thể đổi tỷ lệ (khai mới, sửa, gắn tên vào bài có sẵn,
   * xác nhận lời mời). Tỷ lệ đổi → đơn cũ hết hiệu lực, lập đơn mới chờ ký; về
   * Cách 2 → đơn cũ hết hiệu lực; không đổi → không làm gì. Bài CHƯA TỪNG có đơn
   * mà phần tài khoản không đổi = bài cũ, giữ nguyên (Khoa chốt 20/11/2026).
   * Lỗi ở đây không được làm hỏng lượt lưu — chỉ ghi log.
   */
  async capNhatSauKhiLuu(
    publicationId: string,
    nguoiLuu: string,
    p: { truoc: ChupTruoc; ngoai: NgoaiGuiLen; baiMoi?: boolean },
  ) {
    try {
      const bai = await this.prisma.publication.findUnique({
        where: { id: publicationId },
        select: { authorsRaw: true },
      });
      if (!bai) return;
      const moiNhat = await this.donMoiNhat(publicationId);
      // Không gửi externalAuthors thì giữ phần người-không-tài-khoản của đơn đang có.
      const ngoai =
        p.ngoai ??
        ((moiNhat?.shares as unknown as DongChia[]) ?? [])
          .filter((d) => !d.userId)
          .map((d) => ({ name: d.ten, sharePercent: d.sharePercent }));
      const ds = phuongAnChia({
        taiKhoan: await this.taiKhoanCuaBai(publicationId),
        ngoai,
        raw: bai.authorsRaw,
      });
      const coCach1 = ds.some((d) => d.userId);

      if (!coCach1) {
        if (moiNhat) await this.hetHieuLuc(moiNhat.id, 'Nhóm chuyển về Cách 2');
        return;
      }
      const fp = vanTay(ds);
      if (moiNhat && moiNhat.fingerprint === fp) return;
      if (!moiNhat && !p.baiMoi && p.truoc && p.truoc.vanTayTaiKhoan === vanTayTaiKhoan(ds)) {
        return; // bài cũ, tỷ lệ không đổi → giữ nguyên Cách 1 như trước
      }

      if (moiNhat) await this.hetHieuLuc(moiNhat.id, 'Tỷ lệ đã đổi — thay bằng đơn mới');
      const nguoiKy = nguoiKyHeThong(ds);
      const lap = ds.find((d) => d.userId === nguoiLuu);
      const bayGio = new Date().toISOString();
      // Người lập đơn có tên trong phương án thì coi như đã ký lúc lưu — họ là
      // người đề xuất. Người khác phải tự bấm ký.
      const chuKy: ChuKy[] = lap && nguoiKy.includes(nguoiLuu) ? [{ userId: nguoiLuu, ten: lap.ten, at: bayGio }] : [];
      const status = trangThaiSau({ hienTai: 'CHO_KY', shares: ds, chuKy, tuChoi: [], coBanQuet: false });
      const don = await this.prisma.shareAgreement.create({
        data: {
          publicationId,
          shares: ds as unknown as Prisma.InputJsonValue,
          fingerprint: fp,
          signerIds: nguoiKy,
          createdBy: nguoiLuu,
          status,
          signatures: chuKy as unknown as Prisma.InputJsonValue,
          submittedAt: status === 'CHO_DUYET' ? new Date() : null,
        },
      });
      await this.nhatKy(nguoiLuu, publicationId, { viec: 'lap-don', donId: don.id, shares: ds });
      const canKy = ds.filter((d) => d.userId && d.userId !== nguoiLuu && nguoiKy.includes(d.userId) && d.email);
      if (canKy.length) {
        this.bus.emit('publication.agreement', {
          id: publicationId,
          key: 'ky',
          userIds: canKy.map((d) => d.userId as string),
          emails: canKy.map((d) => d.email as string),
          note: null,
          by: lap?.ten ?? null,
        });
      }
    } catch (e) {
      this.log.error(`Lập đơn thoả thuận cho bài ${publicationId} hỏng: ${(e as Error)?.message ?? e}`);
    }
  }

  private donMoiNhat(publicationId: string) {
    return this.prisma.shareAgreement.findFirst({
      where: { publicationId, status: { not: 'HET_HIEU_LUC' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async hetHieuLuc(id: string, lyDo: string) {
    await this.prisma.shareAgreement.update({
      where: { id },
      data: { status: 'HET_HIEU_LUC', decisionNote: lyDo },
    });
  }

  // ── Xem ────────────────────────────────────────────────────────────────────
  private async laQuanTri(userId: string, roleName: RoleName) {
    if (ADMIN_ROLES.includes(roleName)) return true;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { canViewStats: true, isActive: true },
    });
    return !!(u?.canViewStats && u.isActive);
  }

  private async taiDon(id: string) {
    const d = await this.prisma.shareAgreement.findUnique({ where: { id } });
    if (!d) throw KhongThayDonException;
    return d;
  }

  /** Ai xem được: người phải ký, người lập, tác giả đã xác nhận của bài, quản trị Khoa. */
  private async kiemXem(d: Don, userId: string, roleName: RoleName) {
    if (d.createdBy === userId || d.signerIds.includes(userId)) return;
    const laTacGia = await this.prisma.publicationAuthor.findFirst({
      where: { publicationId: d.publicationId, userId, claimStatus: 'CONFIRMED' },
      select: { id: true },
    });
    if (laTacGia) return;
    if (await this.laQuanTri(userId, roleName)) return;
    throw KhongCoQuyenException;
  }

  async mot(id: string, userId: string, roleName: RoleName) {
    const d = await this.taiDon(id);
    await this.kiemXem(d, userId, roleName);
    return this.dinhHinh(d, userId);
  }

  /** Đơn hiện hành của một bài (để trang bài báo dẫn sang). null = không có đơn (Cách 2, hoặc bài cũ). */
  async cuaBai(publicationId: string, userId: string, roleName: RoleName) {
    const d = await this.donMoiNhat(publicationId);
    if (!d) return { don: null };
    try {
      await this.kiemXem(d, userId, roleName);
    } catch {
      return { don: null };
    }
    return { don: await this.dinhHinh(d, userId) };
  }

  /** ky = đơn chờ tôi ký (hoặc tôi đã từ chối) · lap = đơn tôi lập. */
  async danhSach(userId: string, hop: 'ky' | 'lap', tatCa: boolean) {
    const where: Prisma.ShareAgreementWhereInput =
      hop === 'lap'
        ? { createdBy: userId, ...(tatCa ? {} : { status: { not: 'HET_HIEU_LUC' } }) }
        : {
            signerIds: { has: userId },
            ...(tatCa ? {} : { status: { in: ['CHO_KY', 'BI_TU_CHOI_KY'] } }),
          };
    const rows = await this.prisma.shareAgreement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const items = await Promise.all(rows.map((d) => this.dinhHinh(d, userId)));
    const choToiKy = await this.prisma.shareAgreement.count({
      where: { signerIds: { has: userId }, status: { in: ['CHO_KY', 'BI_TU_CHOI_KY'] } },
    });
    // Đơn chờ ký mà tôi đã ký rồi thì không còn là việc của tôi.
    const conPhaiKy = items.filter((x) => hop === 'ky' && x.toiPhaiKy).length;
    return { items, choToiKy: hop === 'ky' ? conPhaiKy : choToiKy };
  }

  private async dinhHinh(d: Don, userId: string) {
    const bai = await this.prisma.publication.findUnique({
      where: { id: d.publicationId },
      select: {
        id: true,
        title: true,
        containerTitle: true,
        doi: true,
        catalogCode: true,
        publishedYear: true,
        acceptedYear: true,
        totalAuthors: true,
        deletedAt: true,
      },
    });
    const lap = await this.prisma.user.findUnique({
      where: { id: d.createdBy },
      select: { firstName: true, lastName: true, email: true },
    });
    const chuKy = (d.signatures as unknown as ChuKy[]) ?? [];
    const tuChoi = (d.declines as unknown as TuChoiKy[]) ?? [];
    const daKy = new Set(chuKy.map((c) => c.userId));
    const moKy = d.status === 'CHO_KY' || d.status === 'BI_TU_CHOI_KY';
    return {
      id: d.id,
      publicationId: d.publicationId,
      bai: bai
        ? {
            title: bai.title,
            containerTitle: bai.containerTitle,
            doi: bai.doi,
            catalogCode: bai.catalogCode,
            year: bai.publishedYear ?? bai.acceptedYear,
            totalAuthors: bai.totalAuthors,
            daXoa: bai.deletedAt !== null,
          }
        : null,
      shares: (d.shares as unknown as DongChia[]) ?? [],
      status: d.status as TrangThaiDon,
      nguoiLap: lap
        ? { id: d.createdBy, ten: [lap.lastName, lap.firstName].filter(Boolean).join(' ') || lap.email, email: lap.email }
        : { id: d.createdBy, ten: '', email: '' },
      signatures: chuKy,
      declines: tuChoi,
      signerIds: d.signerIds,
      coBanQuet: !!d.scanStoredName,
      scanName: d.scanName,
      scanAt: d.scanAt,
      submittedAt: d.submittedAt,
      decidedAt: d.decidedAt,
      decidedBy: d.decidedBy,
      decisionNote: d.decisionNote,
      createdAt: d.createdAt,
      toiPhaiKy: moKy && d.signerIds.includes(userId) && !daKy.has(userId),
      toiLaNguoiLap: d.createdBy === userId,
    };
  }

  // ── Ký / không đồng ý / bản quét ───────────────────────────────────────────
  async ky(id: string, userId: string, roleName: RoleName) {
    const d = await this.taiDon(id);
    if (!d.signerIds.includes(userId)) throw KhongCoQuyenException;
    if (!['CHO_KY', 'BI_TU_CHOI_KY', 'CHO_DUYET', 'KHOA_TU_CHOI'].includes(d.status)) throw DonDaChotException;
    const ds = (d.shares as unknown as DongChia[]) ?? [];
    const toi = ds.find((x) => x.userId === userId);
    const chuKy = ((d.signatures as unknown as ChuKy[]) ?? []).filter((c) => c.userId !== userId);
    chuKy.push({ userId, ten: toi?.ten ?? '', at: new Date().toISOString() });
    const tuChoi = ((d.declines as unknown as TuChoiKy[]) ?? []).filter((c) => c.userId !== userId);
    await this.doi(d, { chuKy, tuChoi }, userId, 'ky');
    return this.mot(id, userId, roleName);
  }

  async khongDongY(id: string, userId: string, roleName: RoleName, lyDo: string) {
    const d = await this.taiDon(id);
    if (!d.signerIds.includes(userId)) throw KhongCoQuyenException;
    if (!['CHO_KY', 'BI_TU_CHOI_KY', 'CHO_DUYET', 'KHOA_TU_CHOI'].includes(d.status)) throw DonDaChotException;
    if ((lyDo ?? '').trim().length < 10) throw LyDoTuChoiException;
    const ds = (d.shares as unknown as DongChia[]) ?? [];
    const toi = ds.find((x) => x.userId === userId);
    const chuKy = ((d.signatures as unknown as ChuKy[]) ?? []).filter((c) => c.userId !== userId);
    const tuChoi = ((d.declines as unknown as TuChoiKy[]) ?? []).filter((c) => c.userId !== userId);
    tuChoi.push({ userId, ten: toi?.ten ?? '', at: new Date().toISOString(), lyDo: lyDo.trim() });
    await this.doi(d, { chuKy, tuChoi }, userId, 'khong-dong-y', lyDo.trim());
    // Báo người lập đơn (đại diện) để họ sửa tỷ lệ.
    const lap = await this.prisma.user.findUnique({ where: { id: d.createdBy }, select: { email: true } });
    if (lap?.email && d.createdBy !== userId) {
      this.bus.emit('publication.agreement', {
        id: d.publicationId,
        key: 'khong-dong-y',
        userIds: [d.createdBy],
        emails: [lap.email],
        note: lyDo.trim(),
        by: toi?.ten ?? null,
      });
    }
    return this.mot(id, userId, roleName);
  }

  /** Bản quét đơn có chữ ký tay — người lập đơn, hoặc bất kỳ ai phải ký, tải lên. */
  async taiBanQuet(id: string, userId: string, roleName: RoleName, file: Express.Multer.File) {
    const d = await this.taiDon(id);
    if (d.createdBy !== userId && !d.signerIds.includes(userId)) {
      await rm(file.path, { force: true }).catch(() => {});
      throw KhongCoQuyenException;
    }
    if (d.status === 'DA_DUYET' || d.status === 'HET_HIEU_LUC') {
      await rm(file.path, { force: true }).catch(() => {});
      throw DonDaChotException;
    }
    const cu = d.scanStoredName;
    await this.prisma.shareAgreement.update({
      where: { id },
      data: { scanStoredName: file.filename, scanName: file.originalname, scanMime: file.mimetype, scanAt: new Date() },
    });
    if (cu) await rm(join(DON_DIR, cu), { force: true }).catch(() => {});
    const moi = await this.taiDon(id);
    await this.doi(
      moi,
      {
        chuKy: (moi.signatures as unknown as ChuKy[]) ?? [],
        tuChoi: (moi.declines as unknown as TuChoiKy[]) ?? [],
        banQuetMoi: true,
      },
      userId,
      'tai-ban-quet',
    );
    return this.mot(id, userId, roleName);
  }

  async banQuet(id: string, userId?: string, roleName?: RoleName) {
    const d = await this.taiDon(id);
    if (userId && roleName) await this.kiemXem(d, userId, roleName);
    if (!d.scanStoredName) throw KhongThayDonException;
    return {
      stream: createReadStream(join(DON_DIR, d.scanStoredName)),
      mimeType: d.scanMime || 'application/octet-stream',
      originalName: d.scanName || 'don-thoa-thuan',
    };
  }

  /** Ghi chữ ký / từ chối mới + tính lại trạng thái + báo ACADsoom kéo lại bài. */
  private async doi(
    d: Don,
    p: { chuKy: ChuKy[]; tuChoi: TuChoiKy[]; banQuetMoi?: boolean },
    userId: string,
    viec: string,
    ghiChu?: string,
  ) {
    const status = trangThaiSau({
      hienTai: d.status as TrangThaiDon,
      shares: (d.shares as unknown as DongChia[]) ?? [],
      chuKy: p.chuKy,
      tuChoi: p.tuChoi,
      coBanQuet: !!d.scanStoredName,
      banQuetMoi: p.banQuetMoi,
    });
    await this.prisma.shareAgreement.update({
      where: { id: d.id },
      data: {
        signatures: p.chuKy as unknown as Prisma.InputJsonValue,
        declines: p.tuChoi as unknown as Prisma.InputJsonValue,
        status,
        submittedAt: status === 'CHO_DUYET' && d.status !== 'CHO_DUYET' ? new Date() : undefined,
      },
    });
    await this.nhatKy(userId, d.publicationId, { viec, donId: d.id, status, ...(ghiChu ? { ghiChu } : {}) });
    if (status !== d.status) await this.baoDoi(d.publicationId);
  }

  /** Chạm updatedAt của bài + phát publication.changed: ACADsoom kéo lại, hàng duyệt cập nhật. */
  private async baoDoi(publicationId: string) {
    await this.prisma.publication.update({ where: { id: publicationId }, data: { updatedAt: new Date() } });
    const tacGia = await this.prisma.publicationAuthor.findMany({
      where: { publicationId, claimStatus: 'CONFIRMED' },
      select: { userId: true },
    });
    this.bus.emit('publication.changed', { id: publicationId, userIds: tacGia.map((a) => a.userId) });
  }

  private async nhatKy(userId: string, publicationId: string, changes: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'publication.share-agreement',
        entityType: 'Publication',
        entityId: publicationId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }

  // ── Kênh tích hợp (ACADsoom) ──────────────────────────────────────────────
  /** Hàng duyệt của Khoa: đơn đủ chữ ký đang chờ (mặc định), hoặc theo trạng thái. */
  async tichHopDanhSach(status?: string) {
    const rows = await this.prisma.shareAgreement.findMany({
      where: { status: status || 'CHO_DUYET' },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
    return {
      items: await Promise.all(
        rows.map(async (d) => {
          const x = await this.dinhHinh(d, '');
          return { ...x, toiPhaiKy: undefined, toiLaNguoiLap: undefined };
        }),
      ),
    };
  }

  /** Khoa quyết từ ACADsoom. `by` = tên/email quản trị bấm (ACADsoom tự ghi nhật ký của mình). */
  async tichHopQuyet(id: string, p: { ok: boolean; note?: string | null; by: string }) {
    const d = await this.taiDon(id);
    if (d.status !== 'CHO_DUYET') throw DonDaChotException;
    if (!p.ok && !(p.note ?? '').trim()) {
      throw new UnprocessableEntityException([{ field: 'note', error: 'Từ chối thì ghi lý do để đại diện nhóm sửa.' }]);
    }
    const r = await this.prisma.shareAgreement.updateMany({
      where: { id, status: 'CHO_DUYET' },
      data: {
        status: p.ok ? 'DA_DUYET' : 'KHOA_TU_CHOI',
        decidedAt: new Date(),
        decidedBy: p.by,
        decisionNote: (p.note ?? '').trim() || null,
      },
    });
    if (!r.count) throw DonDaChotException;
    await this.prisma.auditLog.create({
      data: {
        userId: null,
        action: 'publication.share-agreement',
        entityType: 'Publication',
        entityId: d.publicationId,
        changes: { viec: p.ok ? 'khoa-duyet' : 'khoa-tu-choi', donId: id, by: p.by, note: p.note ?? null },
      },
    });
    await this.baoDoi(d.publicationId);
    const lap = await this.prisma.user.findUnique({ where: { id: d.createdBy }, select: { email: true } });
    if (lap?.email) {
      this.bus.emit('publication.agreement', {
        id: d.publicationId,
        key: p.ok ? 'DA_DUYET' : 'KHOA_TU_CHOI',
        userIds: [d.createdBy],
        emails: [lap.email],
        note: (p.note ?? '').trim() || null,
        by: p.by,
      });
    }
    return this.dinhHinh((await this.taiDon(id)) as Don, '');
  }

  /** Cho kênh tích hợp NCKH: đơn mới nhất của nhiều bài một lượt. */
  async donMoiNhatTheoBai(publicationIds: string[]) {
    if (!publicationIds.length) return new Map<string, { id: string; status: string }>();
    const rows = await this.prisma.shareAgreement.findMany({
      where: { publicationId: { in: publicationIds }, status: { not: 'HET_HIEU_LUC' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, publicationId: true },
    });
    const m = new Map<string, { id: string; status: string }>();
    for (const r of rows) if (!m.has(r.publicationId)) m.set(r.publicationId, { id: r.id, status: r.status });
    return m;
  }
}

