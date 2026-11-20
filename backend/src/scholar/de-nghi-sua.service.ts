import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROLES, RoleName } from '../shared/constants/role.constants';
import { EventBusService } from '../shared/services/event-bus.service';
import {
  DeNghiThayDoiSchema,
  NGAY_CHO_NGUOI_KHAI,
  TRUONG_DE_NGHI,
  type DeNghiResType,
  type DeNghiTrangThai,
  type ListDeNghiQueryType,
  type TaoDeNghiBodyType,
} from './de-nghi-sua.model';
import { PublicationNotFoundException } from './scholar.error';
import { ScholarService } from './scholar.service';

/**
 * Đề nghị chỉnh sửa công trình đã khai — luật Khoa chốt 20/11/2026, xem
 * de-nghi-sua.model.ts. Vòng đời:
 *
 *   PENDING ──người khai chấp nhận──▶ ACCEPTED (tự áp `changes`)
 *      │    ──người khai từ chối────▶ REJECTED ──bên đề nghị chuyển Khoa──▶ ESCALATED
 *      │    ──quá 7 ngày: bên đề nghị chuyển, hoặc Khoa quyết thẳng──────▶ (Khoa quyết)
 *      └──bên đề nghị rút──▶ WITHDRAWN
 *   ESCALATED ──quản trị Khoa──▶ ACCEPTED / REJECTED (chốt, không chuyển tiếp nữa)
 *
 * Không có người khai hợp lệ (người khai đã rời bài / tài khoản khoá) → tạo thẳng
 * ESCALATED. Không xoá dòng nào; `history` + AuditLog là hồ sơ tranh chấp.
 */

const MO = ['PENDING', 'ESCALATED'] as const;
const NGAY_MS = 24 * 60 * 60 * 1000;

type Dong = Prisma.PublicationEditRequestGetPayload<{
  include: { publication: { select: { title: true; doi: true } } };
}>;
type Buoc = { at: string; by: string | null; viec: string; ghiChu: string | null };

const KhongCoQuyenException = new ForbiddenException([
  { field: 'id', error: 'Thầy/Cô không có quyền quyết đề nghị này.' },
]);
const DeNghiKhongThayException = new NotFoundException([
  { field: 'id', error: 'Không tìm thấy đề nghị chỉnh sửa.' },
]);
const LaNguoiKhaiException = new UnprocessableEntityException([
  {
    field: 'publicationId',
    error: 'Thầy/Cô là người khai bài này — sửa thẳng ở "Công bố của tôi", không cần gửi đề nghị.',
  },
]);
const DangCoDeNghiException = new ConflictException([
  {
    field: 'publicationId',
    error: 'Thầy/Cô đang có một đề nghị chờ xử lý cho bài này. Rút đề nghị đó rồi gửi lại nếu muốn đổi nội dung.',
  },
]);
const DaXuLyException = new ConflictException([
  { field: 'id', error: 'Đề nghị này vừa được xử lý ở nơi khác — tải lại để xem kết quả.' },
]);
const KhongChuyenDuocException = new UnprocessableEntityException([
  {
    field: 'id',
    error: `Chỉ chuyển Khoa được khi người khai đã từ chối, hoặc sau ${NGAY_CHO_NGUOI_KHAI} ngày người khai chưa trả lời.`,
  },
]);

/** So hai giá trị trường đơn (chuỗi / số / bool / null). */
const bang = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

@Injectable()
export class DeNghiSuaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
    private readonly scholar: ScholarService,
  ) {}

  /** Quản trị Khoa: vai trò admin, hoặc tài khoản được bật quyền xem thống kê (như XemThongKeGuard). */
  async laQuanTri(userId: string, roleName: RoleName) {
    if (ADMIN_ROLES.includes(roleName)) return true;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { canViewStats: true, isActive: true },
    });
    return !!(u?.canViewStats && u.isActive);
  }

  /** Người khai còn hợp lệ: chính người tạo bài, còn đứng tên đã xác nhận và tài khoản còn hoạt động. */
  private async nguoiKhaiHopLe(publicationId: string, createdBy: string | null) {
    if (!createdBy) return null;
    const dong = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId, userId: createdBy } },
      select: { claimStatus: true, user: { select: { isActive: true } } },
    });
    return dong?.claimStatus === 'CONFIRMED' && dong.user.isActive ? createdBy : null;
  }

  private quaHan(d: { status: string; createdAt: Date }, bayGio = Date.now()) {
    return d.status === 'PENDING' && bayGio - d.createdAt.getTime() >= NGAY_CHO_NGUOI_KHAI * NGAY_MS;
  }

  /** Khoa quyết được: đã chuyển Khoa, không có người khai, hoặc người khai im lặng quá hạn. */
  private khoaQuyetDuoc(d: { status: string; ownerId: string | null; createdAt: Date }) {
    return d.status === 'ESCALATED' || (d.status === 'PENDING' && (!d.ownerId || this.quaHan(d)));
  }

  private coQuyenQuyet(d: Dong, userId: string, laQT: boolean) {
    return (d.status === 'PENDING' && d.ownerId === userId) || (laQT && this.khoaQuyetDuoc(d));
  }

  private chuyenKhoaDuoc(d: Dong, userId: string) {
    if (d.requesterId !== userId) return false;
    const nguoiKhaiTuChoi = d.status === 'REJECTED' && !!d.ownerId && d.decidedBy === d.ownerId;
    return nguoiKhaiTuChoi || this.quaHan(d);
  }

  // ── Gửi ────────────────────────────────────────────────────────────────────
  async tao(userId: string, roleName: RoleName, publicationId: string, body: TaoDeNghiBodyType) {
    const bai = await this.prisma.publication.findFirst({
      where: { id: publicationId, deletedAt: null },
    });
    if (!bai) throw PublicationNotFoundException;
    const owner = await this.nguoiKhaiHopLe(publicationId, bai.createdBy);
    if (owner === userId) throw LaNguoiKhaiException;

    const dangMo = await this.prisma.publicationEditRequest.findFirst({
      where: { publicationId, requesterId: userId, status: { in: [...MO] } },
      select: { id: true },
    });
    if (dangMo) throw DangCoDeNghiException;

    // Chỉ giữ trường THẬT SỰ khác giá trị đang lưu — ghi lại cả giá trị lúc gửi để
    // người quyết thấy "từ → sang", và để biết nếu bài đã bị sửa khác đi trong lúc chờ.
    const hienTai = bai as unknown as Record<string, unknown>;
    const changes: Record<string, { tu: unknown; sang: unknown }> = {};
    for (const k of TRUONG_DE_NGHI) {
      const sang = body.changes[k];
      if (sang === undefined) continue;
      const tu = hienTai[k] ?? null;
      if (!bang(tu, sang)) changes[k] = { tu, sang: sang ?? null };
    }

    const bayGio = new Date();
    const lichSu: Buoc[] = [{ at: bayGio.toISOString(), by: userId, viec: 'gui', ghiChu: null }];
    if (!owner) {
      lichSu.push({
        at: bayGio.toISOString(),
        by: null,
        viec: 'chuyen-khoa',
        ghiChu: 'Bài không còn người khai hợp lệ — chuyển thẳng Khoa.',
      });
    }
    const dong = await this.prisma.publicationEditRequest.create({
      data: {
        publicationId,
        requesterId: userId,
        ownerId: owner,
        reason: body.reason,
        changes: changes as Prisma.InputJsonValue,
        status: owner ? 'PENDING' : 'ESCALATED',
        escalatedAt: owner ? null : bayGio,
        history: lichSu as unknown as Prisma.InputJsonValue,
      },
    });
    await this.nhatKy(userId, publicationId, { viec: 'gui', requestId: dong.id, reason: body.reason, changes });

    if (owner) {
      const [nguoiKhai, nguoiGui] = await this.nguoi([owner, userId]);
      if (nguoiKhai?.email) {
        this.bus.emit('publication.edit-requested', {
          id: publicationId,
          key: dong.id,
          userIds: [owner],
          emails: [nguoiKhai.email],
          note: body.reason,
          by: nguoiGui?.ten ?? null,
        });
      }
    }
    return this.mot(dong.id, userId, roleName);
  }

  // ── Xem ────────────────────────────────────────────────────────────────────
  async danhSach(userId: string, roleName: RoleName, q: ListDeNghiQueryType) {
    const laQT = await this.laQuanTri(userId, roleName);
    const moc = new Date(Date.now() - NGAY_CHO_NGUOI_KHAI * NGAY_MS);
    const choKhoa: Prisma.PublicationEditRequestWhereInput = {
      OR: [
        { status: 'ESCALATED' },
        { status: 'PENDING', ownerId: null },
        { status: 'PENDING', createdAt: { lte: moc } },
      ],
    };
    let where: Prisma.PublicationEditRequestWhereInput;
    if (q.hop === 'di') {
      where = { requesterId: userId, ...(q.tatCa ? {} : { status: { in: [...MO] } }) };
    } else if (q.hop === 'khoa') {
      if (!laQT) throw KhongCoQuyenException;
      where = q.tatCa ? { OR: [...(choKhoa.OR ?? []), { escalatedAt: { not: null } }] } : choKhoa;
    } else {
      where = { ownerId: userId, ...(q.tatCa ? {} : { status: 'PENDING' }) };
    }
    const [rows, choToi, choKhoaSo] = await Promise.all([
      this.prisma.publicationEditRequest.findMany({
        where,
        include: { publication: { select: { title: true, doi: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.publicationEditRequest.count({ where: { ownerId: userId, status: 'PENDING' } }),
      laQT ? this.prisma.publicationEditRequest.count({ where: choKhoa }) : Promise.resolve(0),
    ]);
    return {
      items: await this.dinhHinh(rows, userId, laQT),
      choToi: choToi + choKhoaSo,
      laQuanTri: laQT,
    };
  }

  /** Đề nghị của MỘT bài — người gửi, người khai, tác giả đã xác nhận và quản trị xem được. */
  async theoBai(userId: string, roleName: RoleName, publicationId: string) {
    const laQT = await this.laQuanTri(userId, roleName);
    const laTacGia = await this.prisma.publicationAuthor.findFirst({
      where: { publicationId, userId, claimStatus: 'CONFIRMED' },
      select: { id: true },
    });
    const rows = await this.prisma.publicationEditRequest.findMany({
      where: {
        publicationId,
        ...(laQT || laTacGia ? {} : { OR: [{ requesterId: userId }, { ownerId: userId }] }),
      },
      include: { publication: { select: { title: true, doi: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { items: await this.dinhHinh(rows, userId, laQT), choToi: 0, laQuanTri: laQT };
  }

  async mot(id: string, userId: string, roleName: RoleName): Promise<DeNghiResType> {
    const laQT = await this.laQuanTri(userId, roleName);
    const d = await this.taiDong(id);
    const [kq] = await this.dinhHinh([d], userId, laQT);
    return kq;
  }

  // ── Quyết ─────────────────────────────────────────────────────────────────
  async chapNhan(userId: string, roleName: RoleName, id: string, response?: string) {
    const laQT = await this.laQuanTri(userId, roleName);
    const d = await this.taiDong(id);
    if (!this.coQuyenQuyet(d, userId, laQT)) throw KhongCoQuyenException;

    // Chụp trạng thái TRƯỚC khi đổi — để trả lại y nguyên nếu áp hỏng.
    const truoc = {
      status: d.status,
      response: d.response,
      decidedBy: d.decidedBy,
      decidedAt: d.decidedAt,
      history: structuredClone(d.history) as Prisma.InputJsonValue,
    };
    // Giành lượt NGUYÊN TỬ trước khi áp: hai người bấm cùng lúc thì chỉ một người áp.
    await this.doiTrangThai(d, 'ACCEPTED', userId, 'chap-nhan', response ?? null);
    const changes = (d.changes ?? {}) as Record<string, { sang: unknown }>;
    const data = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v?.sang]));
    try {
      if (Object.keys(data).length) {
        await this.scholar.apDeNghiSua(d.publicationId, userId, DeNghiThayDoiSchema.parse(data));
      }
    } catch (e) {
      // Áp hỏng → trả đề nghị về trạng thái cũ, đừng để "đã chấp nhận" mà bài không đổi.
      await this.prisma.publicationEditRequest.update({ where: { id }, data: truoc });
      throw e;
    }
    await this.nhatKy(userId, d.publicationId, { viec: 'chap-nhan', requestId: id, changes, response: response ?? null, laKhoa: d.ownerId !== userId });
    await this.baoKetQua(d, userId, 'ACCEPTED', response ?? null);
    return this.mot(id, userId, roleName);
  }

  async tuChoi(userId: string, roleName: RoleName, id: string, response: string) {
    const laQT = await this.laQuanTri(userId, roleName);
    const d = await this.taiDong(id);
    if (!this.coQuyenQuyet(d, userId, laQT)) throw KhongCoQuyenException;
    await this.doiTrangThai(d, 'REJECTED', userId, 'tu-choi', response);
    await this.nhatKy(userId, d.publicationId, { viec: 'tu-choi', requestId: id, response, laKhoa: d.ownerId !== userId });
    await this.baoKetQua(d, userId, 'REJECTED', response);
    return this.mot(id, userId, roleName);
  }

  async chuyenKhoa(userId: string, roleName: RoleName, id: string, note?: string) {
    const d = await this.taiDong(id);
    if (d.requesterId !== userId) throw KhongCoQuyenException;
    if (!this.chuyenKhoaDuoc(d, userId)) throw KhongChuyenDuocException;
    await this.doiTrangThai(d, 'ESCALATED', userId, 'chuyen-khoa', note ?? null, { escalatedAt: new Date() });
    await this.nhatKy(userId, d.publicationId, { viec: 'chuyen-khoa', requestId: id, note: note ?? null });
    return this.mot(id, userId, roleName);
  }

  async rut(userId: string, roleName: RoleName, id: string) {
    const d = await this.taiDong(id);
    if (d.requesterId !== userId || !MO.includes(d.status as (typeof MO)[number])) {
      throw KhongCoQuyenException;
    }
    await this.doiTrangThai(d, 'WITHDRAWN', userId, 'rut', null);
    await this.nhatKy(userId, d.publicationId, { viec: 'rut', requestId: id });
    return this.mot(id, userId, roleName);
  }

  // ── Nội bộ ────────────────────────────────────────────────────────────────
  private async taiDong(id: string): Promise<Dong> {
    const d = await this.prisma.publicationEditRequest.findUnique({
      where: { id },
      include: { publication: { select: { title: true, doi: true } } },
    });
    if (!d) throw DeNghiKhongThayException;
    return d;
  }

  /** Đổi trạng thái có điều kiện "vẫn đang ở trạng thái mình đã đọc" — chặn hai người quyết cùng lúc. */
  private async doiTrangThai(
    d: Dong,
    moi: DeNghiTrangThai,
    userId: string,
    viec: string,
    ghiChu: string | null,
    them: Prisma.PublicationEditRequestUpdateManyMutationInput = {},
  ) {
    const lichSu = [
      ...((d.history as unknown as Buoc[]) ?? []),
      { at: new Date().toISOString(), by: userId, viec, ghiChu },
    ];
    const laQuyet = moi === 'ACCEPTED' || moi === 'REJECTED';
    const r = await this.prisma.publicationEditRequest.updateMany({
      where: { id: d.id, status: d.status },
      data: {
        status: moi,
        ...(laQuyet ? { response: ghiChu, decidedBy: userId, decidedAt: new Date() } : {}),
        history: lichSu as unknown as Prisma.InputJsonValue,
        ...them,
      },
    });
    if (!r.count) throw DaXuLyException;
  }

  private async nhatKy(userId: string, publicationId: string, changes: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'publication.edit-request',
        entityType: 'Publication',
        entityId: publicationId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }

  private async baoKetQua(d: Dong, userId: string, ketQua: 'ACCEPTED' | 'REJECTED', response: string | null) {
    try {
      const [nguoiGui, nguoiQuyet] = await this.nguoi([d.requesterId, userId]);
      if (!nguoiGui?.email || d.requesterId === userId) return;
      this.bus.emit('publication.edit-request-decided', {
        id: d.publicationId,
        key: ketQua,
        userIds: [d.requesterId],
        emails: [nguoiGui.email],
        note: response,
        by: nguoiQuyet?.ten ?? null,
      });
    } catch {
      // báo tin là phụ — kết quả đã lưu
    }
  }

  /** Tên + email theo đúng thứ tự id truyền vào (null nếu không thấy). */
  private async nguoi(ids: (string | null | undefined)[]) {
    const co = [...new Set(ids.filter((x): x is string => !!x))];
    const ds = co.length
      ? await this.prisma.user.findMany({
          where: { id: { in: co } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const theoId = new Map(
      ds.map((u) => [
        u.id,
        { id: u.id, email: u.email, ten: [u.lastName, u.firstName].filter(Boolean).join(' ') || u.email },
      ]),
    );
    return ids.map((x) => (x ? (theoId.get(x) ?? null) : null));
  }

  private async dinhHinh(rows: Dong[], userId: string, laQT: boolean): Promise<DeNghiResType[]> {
    const ids = rows.flatMap((d) => [d.requesterId, d.ownerId, d.decidedBy]);
    const ten = new Map(
      (await this.nguoi(ids)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => [x.id, x]),
    );
    const lay = (id: string | null) => (id ? (ten.get(id) ?? null) : null);
    return rows.map((d) => ({
      id: d.id,
      publicationId: d.publicationId,
      baiTen: d.publication.title,
      baiDoi: d.publication.doi,
      nguoiGui: lay(d.requesterId),
      nguoiKhai: lay(d.ownerId),
      reason: d.reason,
      changes: (d.changes ?? {}) as Record<string, { tu: unknown; sang: unknown }>,
      status: d.status as DeNghiTrangThai,
      response: d.response,
      nguoiQuyet: lay(d.decidedBy),
      decidedAt: d.decidedAt,
      escalatedAt: d.escalatedAt,
      createdAt: d.createdAt,
      quaHan: this.quaHan(d),
      quyen: {
        quyet: this.coQuyenQuyet(d, userId, laQT),
        rut: d.requesterId === userId && MO.includes(d.status as (typeof MO)[number]),
        chuyenKhoa: this.chuyenKhoaDuoc(d, userId),
      },
      history: ((d.history as unknown as Buoc[]) ?? []).map((b) => ({
        at: b.at,
        by: b.by ? (lay(b.by)?.ten ?? null) : null,
        viec: b.viec,
        ghiChu: b.ghiChu ?? null,
      })),
    }));
  }
}
