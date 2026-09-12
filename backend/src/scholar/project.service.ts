import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { laterOf, pageBySince } from './integration-cursor';
import {
  NotAProjectMemberException,
  NotProjectLeadException,
  ProjectNotFoundException,
  ShareOverflowException,
} from './scholar.error';
import type {
  CreateProjectBodyType,
  IntegrationQueryType,
  ListProjectsQueryType,
  UpdateProjectBodyType,
} from './scholar.model';

/**
 * Đề tài, dự án NCKH — Bảng 2 của Phụ lục 2.
 *
 * Cùng ba nguyên tắc như phần công bố, và vì cùng lý do:
 *
 *   · Một đề tài là MỘT dòng dùng chung cho cả nhóm. Để mỗi người khai một bản
 *     thì thống kê Khoa đếm nhiều lần.
 *   · Chủ nhiệm gắn tên thành viên vào, thành viên phải TỰ xác nhận — giờ NCKH
 *     là quyền lợi của từng người.
 *   · Web Khoa chỉ giữ DỮ KIỆN (cấp đề tài, kinh phí, số tháng, vai trò). Việc
 *     nhân ra giờ theo công thức `base + rate × kinh phí / per` rồi chia đều cho
 *     từng tháng là của ACADsoom.
 *
 * Mã Bảng 2 do CHỦ NHIỆM tự chọn. Hệ thống không suy cấp đề tài từ kinh phí:
 * cùng một mức tiền có thể là ĐHQG loại B, cấp Bộ, hay quỹ tài trợ — đoán sai là
 * lệch hàng nghìn giờ.
 */
/**
 * Số tháng thực hiện, suy từ hai mốc — bao gồm cả tháng đầu và tháng cuối.
 *
 * Phụ lục 2 tr. 2.7 chia đều giờ của đề tài cho TỪNG THÁNG thực hiện, nên con số
 * này là mẫu số của mọi phép chia theo năm học. Để người dùng gõ tay một ô riêng
 * bên cạnh ngày bắt đầu và ngày kết thúc là mời sai lệch: sửa ngày kết thúc mà
 * quên sửa số tháng thì giờ của mọi thành viên, mọi năm đều lệch mà không ai
 * thấy. Có đủ hai mốc thì suy ra; thiếu mốc mới dùng giá trị nhập tay.
 */
export function soThang(
  startYear?: number | null,
  startMonth?: number | null,
  endYear?: number | null,
  endMonth?: number | null,
): number | null {
  if (!startYear || !startMonth || !endYear || !endMonth) return null;
  const dau = startYear * 12 + (startMonth - 1);
  const cuoi = endYear * 12 + (endMonth - 1);
  if (cuoi < dau) return null;
  // HIỆU SỐ (span), KHÔNG cộng 1: 2/2025→2/2026 = 12 (đúng một năm), 1/2025→
  // 12/2025 = 11, cùng tháng = 0. Trước đây +1 (đếm cả hai đầu mút) nên 2/25→2/26
  // ra 13 — lệch dư một tháng.
  return cuoi - dau;
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
  ) {}

  private get memberInclude() {
    return {
      members: {
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { role: 'asc' as const },
      },
    };
  }

  /** BigInt không đi qua JSON được — đổi sang số ngay ở tầng này. */
  private shape(row: any, userId: string) {
    const mine = row.members.find((m: any) => m.userId === userId);
    return {
      ...row,
      budget: row.budget === null ? null : Number(row.budget),
      isClassified: Boolean(row.catalogCode),
      myRole: mine?.role ?? null,
      myClaimStatus: mine?.claimStatus ?? null,
      mySharePercent: mine?.sharePercent ?? null,
      myShowOnWeb: mine?.showOnWeb ?? true,
      members: row.members.map((m: any) => ({
        id: m.id,
        userId: m.userId,
        displayName:
          [m.user?.lastName, m.user?.firstName].filter(Boolean).join(' ') ||
          m.externalName ||
          '(chưa rõ tên)',
        email: m.user?.email ?? '',
        externalOrg: m.externalOrg ?? null,
        role: m.role,
        sharePercent: m.sharePercent,
        // GHI NHẬN diện học viên — không tham gia bất kỳ phép tính giờ nào.
        studentType: m.studentType ?? null,
        claimStatus: m.claimStatus,
        invitedBy: m.invitedBy,
        respondedAt: m.respondedAt,
      })),
    };
  }

  async list(userId: string, query: ListProjectsQueryType) {
    const where: Prisma.ResearchProjectWhereInput = {
      deletedAt: null,
      members: {
        some: {
          userId,
          claimStatus:
            query.filter === 'pending'
              ? 'PENDING'
              : { in: ['CONFIRMED', 'PENDING'] },
        },
      },
      ...(query.status ? { status: query.status } : {}),
      ...(query.filter === 'unclassified' ? { catalogCode: null } : {}),
    };

    const [rows, total, unclassified] = await Promise.all([
      this.prisma.researchProject.findMany({
        where,
        include: this.memberInclude,
        orderBy: [{ startYear: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.researchProject.count({ where }),
      this.prisma.researchProject.count({
        where: {
          deletedAt: null,
          catalogCode: null,
          members: { some: { userId, claimStatus: 'CONFIRMED' } },
        },
      }),
    ]);
    return {
      items: rows.map((r) => this.shape(r, userId)),
      total,
      unclassified,
    };
  }

  async findOne(id: string, userId: string) {
    const row = await this.prisma.researchProject.findFirst({
      where: { id, deletedAt: null },
      include: this.memberInclude,
    });
    if (!row) throw ProjectNotFoundException;
    return this.shape(row, userId);
  }

  async create(userId: string, body: CreateProjectBodyType) {
    const created = await this.prisma.researchProject.create({
      data: {
        code: body.code ?? null,
        decisionNo: body.decisionNo ?? null,
        title: body.title,
        catalogCode: body.catalogCode ?? null,
        funder: body.funder ?? null,
        budget:
          body.budget === undefined || body.budget === null
            ? null
            : BigInt(Math.round(body.budget)),
        status: body.status ?? 'ONGOING',
        startYear: body.startYear ?? null,
        startMonth: body.startMonth ?? null,
        endYear: body.endYear ?? null,
        endMonth: body.endMonth ?? null,
        months:
          soThang(
            body.startYear,
            body.startMonth,
            body.endYear,
            body.endMonth,
          ) ??
          body.months ??
          null,
        note: body.note ?? null,
        createdBy: userId,
        members: {
          create: {
            userId,
            // Người khai mặc định là chủ nhiệm; đổi được nếu họ chỉ là thành viên.
            role: body.myRole ?? 'LEAD',
            sharePercent: body.mySharePercent ?? null,
            showOnWeb: body.myShowOnWeb ?? true,
            claimStatus: 'CONFIRMED',
            respondedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    await this.invite(created.id, userId, body.members ?? []);
    await this.addExternals(created.id, body.externalMembers ?? []);
    this.bus.emit('project.changed', {
      id: created.id,
      userIds: [userId, ...(body.members ?? []).map((m) => m.userId)],
    });
    return this.findOne(created.id, userId);
  }

  /**
   * Thêm thành viên KHÔNG có tài khoản — cộng sự ngoài Khoa hoặc ngoài Trường.
   *
   * Đánh CONFIRMED ngay, khác hẳn người trong hệ thống: họ không đăng nhập được
   * nên không bao giờ tự xác nhận, mà để PENDING thì phần của họ rơi khỏi phép
   * kiểm tổng và người trong Khoa lại chia nhau đủ 100% — đúng cái sai mà việc
   * ghi nhận họ sinh ra để tránh.
   */
  private async addExternals(
    projectId: string,
    people: Array<{
      name: string;
      org?: string | null;
      role?: 'LEAD' | 'SECRETARY' | 'MEMBER';
      sharePercent?: number | null;
      studentType?: 'sinh_vien' | 'cao_hoc' | 'ncs' | null;
    }>,
  ) {
    const sach = people.filter((p) => p.name.trim());
    if (!sach.length) return;
    await this.prisma.projectMember.createMany({
      data: sach.map((p) => ({
        projectId,
        userId: null,
        externalName: p.name.trim(),
        externalOrg: p.org?.trim() || null,
        sharePercent: p.sharePercent ?? null,
        // GHI NHẬN diện học viên — không tính giờ.
        studentType: p.studentType ?? null,
        role: p.role ?? ('MEMBER' as const),
        claimStatus: 'CONFIRMED' as const,
        respondedAt: new Date(),
      })),
    });
  }

  /** Gắn tên đồng nghiệp → họ ở PENDING cho tới khi chính họ đồng ý. */
  private async invite(
    projectId: string,
    invitedBy: string,
    people: Array<{
      userId: string;
      role?: 'LEAD' | 'SECRETARY' | 'MEMBER';
      sharePercent?: number | null;
      studentType?: 'sinh_vien' | 'cao_hoc' | 'ncs' | null;
    }>,
  ) {
    // Khử trùng theo userId: gắn tên một người hai lần là lỗi của người khai,
    // không phải lý do để dựng hai dòng.
    const theoId = new Map(
      people
        .filter((p) => p.userId && p.userId !== invitedBy)
        .map((p) => [p.userId, p]),
    );
    if (!theoId.size) return;

    await this.prisma.projectMember.createMany({
      // Vai trò và tỷ lệ ghi NGAY từ lúc gắn tên. Chúng là phương án của chủ
      // nhiệm (tr. 2.8), không phải thứ người được gắn tự khai — nên không có
      // lý do gì phải đợi họ xác nhận rồi mới ghi được.
      data: [...theoId.values()].map((p) => ({
        projectId,
        userId: p.userId,
        role: p.role ?? ('MEMBER' as const),
        sharePercent: p.sharePercent ?? null,
        // GHI NHẬN diện học viên — không tính giờ.
        studentType: p.studentType ?? null,
        invitedBy,
        claimStatus: 'PENDING' as const,
      })),
      skipDuplicates: true,
    });
  }

  async update(userId: string, id: string, body: UpdateProjectBodyType) {
    // CHỦ NHIỆM mới được sửa dữ liệu của đề tài. Phụ lục 2 tr. 2.8 đặt trách
    // nhiệm ở đó: "chủ nhiệm đề tài cung cấp cho Trường phương án để chia số giờ
    // quy đổi của nhiệm vụ cho từng thành viên". Để mọi thành viên sửa được kinh
    // phí hay thời gian là để mỗi người tự đổi mẫu số giờ của cả nhóm.
    //
    // Ngoại lệ DUY NHẤT: `myShowOnWeb` — hiện đề tài trên trang nhân sự của
    // CHÍNH MÌNH hay không là việc riêng của từng người, chủ nhiệm không quyết
    // thay được.
    const chiDoiHienThi =
      body.myShowOnWeb !== undefined &&
      Object.keys(body).every((k) => k === 'myShowOnWeb');

    if (chiDoiHienThi) await this.assertMember(id, userId);
    else await this.assertLead(id, userId);
    const cur = await this.prisma.researchProject.findUnique({
      where: { id },
      select: {
        catalogCode: true,
        startYear: true,
        startMonth: true,
        endYear: true,
        endMonth: true,
      },
    });
    if (!cur) throw ProjectNotFoundException;

    // Suy số tháng theo mốc SAU khi cập nhật, không phải theo mốc gửi lên: người
    // dùng có thể chỉ sửa ngày kết thúc, và mốc bắt đầu vẫn phải lấy từ bản ghi.
    const moc = {
      startYear: body.startYear === undefined ? cur.startYear : body.startYear,
      startMonth:
        body.startMonth === undefined ? cur.startMonth : body.startMonth,
      endYear: body.endYear === undefined ? cur.endYear : body.endYear,
      endMonth: body.endMonth === undefined ? cur.endMonth : body.endMonth,
    };
    const thangSuyRa = soThang(
      moc.startYear,
      moc.startMonth,
      moc.endYear,
      moc.endMonth,
    );

    await this.prisma.researchProject.update({
      where: { id },
      data: {
        code: body.code === undefined ? undefined : body.code,
        decisionNo: body.decisionNo === undefined ? undefined : body.decisionNo,
        title: body.title ?? undefined,
        catalogCode:
          body.catalogCode === undefined ? undefined : body.catalogCode,
        funder: body.funder === undefined ? undefined : body.funder,
        budget:
          body.budget === undefined
            ? undefined
            : body.budget === null
              ? null
              : BigInt(Math.round(body.budget)),
        status: body.status ?? undefined,
        startYear: body.startYear === undefined ? undefined : body.startYear,
        startMonth: body.startMonth === undefined ? undefined : body.startMonth,
        endYear: body.endYear === undefined ? undefined : body.endYear,
        endMonth: body.endMonth === undefined ? undefined : body.endMonth,
        months:
          thangSuyRa ?? (body.months === undefined ? undefined : body.months),
        note: body.note === undefined ? undefined : body.note,
      },
    });

    // Vai trò và phương án chia của CẢ NHÓM, do chủ nhiệm nộp (tr. 2.8). Kiểm
    // tổng ở đây chứ không kiểm từng dòng: chia một chiếc bánh thì phải nhìn cả
    // chiếc — và chiếc bánh gồm CẢ người ngoài hệ thống.
    if (body.memberUpdates?.length) {
      const tong = body.memberUpdates.reduce(
        (t, m) => t + (m.sharePercent ?? 0),
        0,
      );
      if (tong > 100) throw ShareOverflowException(0, tong);
      for (const m of body.memberUpdates) {
        await this.prisma.projectMember.updateMany({
          // Khoá theo id DÒNG, không theo userId: người ngoài không có userId.
          // Vẫn kèm projectId để không sửa được dòng của đề tài khác.
          where: { id: m.memberId, projectId: id },
          data: {
            ...(m.role ? { role: m.role } : {}),
            ...(m.sharePercent === undefined
              ? {}
              : { sharePercent: m.sharePercent ?? null }),
            // GHI NHẬN diện học viên — không tính giờ. Gửi lên mới đụng.
            ...(m.studentType === undefined
              ? {}
              : { studentType: m.studentType ?? null }),
          },
        });
      }
    }

    if (body.externalMembers !== undefined) {
      // THAY TOÀN BỘ thành viên ngoài theo danh sách gửi lên — không chỉ thêm.
      //
      // `addExternals` (dùng lúc TẠO) chỉ createMany. Gọi nó ở bước CẬP NHẬT thì
      // mỗi lần lưu lại nhân đôi người cũ: giao diện gửi lại cả danh sách (kể cả
      // người đã có) nên lần lưu thứ n để lại n bản của mỗi người — thổi phồng
      // mẫu số chia giờ NCKH mà không ai thấy. Người ngoài không có tài khoản
      // (userId = null) nên không có công bố/giờ riêng, chỉ là đầu người để chia
      // phần; xoá rồi tạo lại là an toàn, và nhờ vậy còn SỬA được tên/đơn vị lẫn
      // XOÁ bớt người — thứ mà kiểu chỉ-thêm không làm được.
      const externs = body.externalMembers.filter((p) => p.name?.trim());
      await this.prisma.$transaction([
        this.prisma.projectMember.deleteMany({
          where: { projectId: id, userId: null },
        }),
        ...(externs.length
          ? [
              this.prisma.projectMember.createMany({
                data: externs.map((p) => ({
                  projectId: id,
                  userId: null,
                  externalName: p.name.trim(),
                  externalOrg: p.org?.trim() || null,
                  sharePercent: p.sharePercent ?? null,
                  studentType: p.studentType ?? null,
                  role: p.role ?? ('MEMBER' as const),
                  claimStatus: 'CONFIRMED' as const,
                  respondedAt: new Date(),
                })),
              }),
            ]
          : []),
      ]);
    }

    if (body.mySharePercent !== undefined && body.mySharePercent !== null) {
      await this.assertShareFits(id, userId, body.mySharePercent);
    }

    if (
      body.myRole ||
      body.mySharePercent !== undefined ||
      body.myShowOnWeb !== undefined
    ) {
      await this.prisma.projectMember.update({
        where: { projectId_userId: { projectId: id, userId } },
        data: {
          role: body.myRole ?? undefined,
          sharePercent:
            body.mySharePercent === undefined ? undefined : body.mySharePercent,
          showOnWeb: body.myShowOnWeb ?? undefined,
        },
      });
    }
    if (body.members) await this.invite(id, userId, body.members);
    this.bus.emit('project.changed', { id, userIds: [userId] });
    return this.findOne(id, userId);
  }

  /** Gỡ tên mình; đề tài không còn ai xác nhận thì xoá mềm cả dòng. */
  async remove(userId: string, id: string) {
    await this.assertMember(id, userId);
    // Rút TÊN MÌNH ra thì ai cũng làm được. Nhưng xoá HẲN đề tài — trường hợp
    // không còn ai khác — là xoá dữ liệu chung, nên chỉ chủ nhiệm.
    const others = await this.prisma.projectMember.count({
      where: {
        projectId: id,
        claimStatus: 'CONFIRMED',
        userId: { not: userId },
      },
    });
    if (others > 0) {
      await this.prisma.projectMember.updateMany({
        where: { projectId: id, userId },
        data: { claimStatus: 'REJECTED', respondedAt: new Date() },
      });
    } else {
      await this.assertLead(id, userId);
      await this.prisma.researchProject.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }
    this.bus.emit('project.changed', { id, userIds: [userId] });
    return { removed: true, sharedWithOthers: others > 0 };
  }

  async pending(userId: string) {
    const rows = await this.prisma.projectMember.findMany({
      where: { userId, claimStatus: 'PENDING', project: { deletedAt: null } },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            code: true,
            funder: true,
            startYear: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const inviterIds = [
      ...new Set(rows.map((r) => r.invitedBy).filter(Boolean)),
    ];
    const inviters = await this.prisma.user.findMany({
      where: { id: { in: inviterIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(
      inviters.map((u) => [
        u.id,
        [u.lastName, u.firstName].filter(Boolean).join(' '),
      ]),
    );
    return rows.map((r) => ({
      projectId: r.project.id,
      title: r.project.title,
      code: r.project.code,
      funder: r.project.funder,
      year: r.project.startYear,
      invitedBy: r.invitedBy,
      invitedByName: r.invitedBy ? (nameOf.get(r.invitedBy) ?? null) : null,
    }));
  }

  async respond(
    userId: string,
    projectId: string,
    accept: boolean,
    role?: 'LEAD' | 'SECRETARY' | 'MEMBER',
  ) {
    const row = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    if (!row) throw NotAProjectMemberException;
    await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: {
        claimStatus: accept ? 'CONFIRMED' : 'REJECTED',
        respondedAt: new Date(),
        role: accept ? (role ?? undefined) : undefined,
      },
    });
    return this.findOne(projectId, userId);
  }

  /**
   * Tổng tỷ lệ chia của các thành viên ĐÃ XÁC NHẬN không được vượt 100%.
   *
   * Phụ lục 2 tr. 2.8: chủ nhiệm nộp một phương án chia số giờ quy đổi CỦA NHIỆM
   * VỤ cho từng thành viên — một chiếc bánh, chia một lần. Không có ràng buộc này
   * thì ba người cùng khai 50% và hệ thống nhận hết, thành 150% giờ của đề tài
   * mà không ai thấy cho tới lúc đối chiếu tổng.
   *
   * Chỉ đếm người đã xác nhận: người còn đang chờ chưa hưởng giờ nào, giữ chỗ cho
   * họ sẽ chặn oan người đang khai thật.
   */
  private async assertShareFits(
    projectId: string,
    userId: string,
    share: number,
  ) {
    const others = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        claimStatus: 'CONFIRMED',
        sharePercent: { not: null },
        // `{ not: userId }` một mình sẽ LOẠI luôn các dòng userId NULL, vì trong
        // SQL `NULL <> 'x'` cho ra NULL chứ không phải true. Mà dòng NULL chính
        // là người ngoài hệ thống — bỏ họ ra là đếm thiếu đúng phần cần đếm.
        OR: [{ userId: null }, { userId: { not: userId } }],
      },
      select: { sharePercent: true },
    });
    const daChia = others.reduce((s, m) => s + (m.sharePercent ?? 0), 0);
    if (daChia + share > 100) throw ShareOverflowException(daChia, share);
  }

  private async assertLead(projectId: string, userId: string) {
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { claimStatus: true, role: true },
    });
    if (!m || m.claimStatus !== 'CONFIRMED') throw NotAProjectMemberException;
    if (m.role !== 'LEAD') throw NotProjectLeadException;
  }

  private async assertMember(projectId: string, userId: string) {
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { claimStatus: true },
    });
    if (!m || m.claimStatus !== 'CONFIRMED') throw NotAProjectMemberException;
  }

  // ── API tích hợp cho ACADsoom ─────────────────────────────────────────────
  /**
   * Chỉ trả đề tài ĐÃ CHỌN MÃ và thành viên ĐÃ XÁC NHẬN. Không trả giờ — hệ số
   * `base + rate × kinh phí / per` và việc chia đều theo tháng là của ACADsoom.
   */
  /** Xem chú thích ở `ScholarService.integrationList` — cùng một giao kèo. */
  async integrationList(query: IntegrationQueryType) {
    const { since } = query;
    // ĐỀ TÀI GIAO NHAU với khoảng năm, không phải đề tài BẮT ĐẦU trong khoảng.
    //
    // Trước đây lọc `startYear` nằm trong [from, to]. Công bố thì đúng — nó là
    // một mốc. Đề tài thì KHÔNG: nó là một quãng, và Phụ lục 2 tr. 2.7 chia giờ
    // theo SỐ THÁNG THỰC HIỆN TRONG TỪNG NĂM HỌC. Đề tài 12/2025 → 12/2026 phải
    // có mặt ở cả năm học 2025–2026 lẫn 2026–2027; lọc theo năm bắt đầu thì năm
    // thứ hai không thấy đề tài đâu và giảng viên mất trắng phần giờ của 5 tháng
    // còn lại. Đã gặp thật: hỏi from=2026&to=2027 trả về 0 đề tài.
    //
    // `endYear` trống = chưa biết kết thúc → coi như còn chạy, vẫn giao nhau.
    // Phải hỏi `null` TƯỜNG MINH: trong SQL `NULL >= 2026` ra NULL chứ không ra
    // true, nên `{ gte: from }` một mình sẽ lặng lẽ loại hết đề tài chưa có ngày
    // kết thúc.
    //
    // `startYear` trống thì vẫn bị loại như trước — không biết bắt đầu khi nào
    // thì cũng không tính được tháng trong năm học, mà cho lọt thì nó xuất hiện
    // ở MỌI năm và cộng giờ nhiều lần.
    const years =
      query.from || query.to
        ? {
            AND: [
              ...(query.to ? [{ startYear: { lte: query.to } }] : []),
              ...(query.from
                ? [
                    {
                      OR: [
                        { endYear: null },
                        { endYear: { gte: query.from } },
                      ],
                    },
                  ]
                : []),
            ],
          }
        : {};

    const rows = await this.prisma.projectMember.findMany({
      where: {
        // Người ngoài hệ thống không có định mức NCKH ở Trường — họ chỉ tồn tại
        // để chiếm phần trong phương án chia. Không gửi sang ACADsoom.
        userId: { not: null },
        ...(query.email ? { user: { email: query.email.toLowerCase() } } : {}),
        ...(since
          ? {
              OR: [
                { updatedAt: { gte: since } },
                { project: { updatedAt: { gte: since } } },
              ],
              project: years,
            }
          : {
              claimStatus: 'CONFIRMED',
              project: {
                deletedAt: null,
                catalogCode: { not: null },
                ...years,
              },
            }),
      },
      include: {
        project: {
          include: {
            // MẪU SỐ chia giờ — xem `memberCount` ở dưới.
            //
            // Phải nạp thêm thật: `sharePercent` và `isLead` lấy từ chính dòng
            // thành viên đang duyệt (`r`), nên bản ghi đề tài KHÔNG hề có sẵn
            // danh sách nhóm để đếm. Prisma gộp phần này thành một lượt truy vấn
            // cho cả trang, không phải mỗi dòng một lượt.
            //
            // Cố ý KHÔNG kèm `userId: { not: null }` như bộ lọc ở trên: chỗ đó
            // quyết định dòng nào được GỬI, còn đây là đếm ai được CHIA.
            members: {
              where: { claimStatus: 'CONFIRMED' },
              select: { id: true },
            },
          },
        },
        user: { select: { email: true } },
      },
    });

    const mapped = rows.map((r) => {
      const p = r.project;
      return {
        changedAt: laterOf(r.updatedAt, p.updatedAt),
        item: {
          projectId: p.id,
          code: p.code,
          decisionNo: p.decisionNo,
          title: p.title,
          catalogCode: p.catalogCode,
          funder: p.funder,
          budget: p.budget === null ? null : Number(p.budget),
          status: p.status,
          startYear: p.startYear,
          startMonth: p.startMonth,
          endYear: p.endYear,
          endMonth: p.endMonth,
          // Suy lại số tháng từ mốc ngay lúc gửi, không tin giá trị đã lưu: đề
          // tài tạo trước khi đổi sang quy ước SPAN còn giữ `months` kiểu cũ
          // (cộng cả hai đầu, dư một tháng) trong CSDL. Suy lại thì đề tài cũ
          // lẫn mới đều gửi cùng một thước, khớp cách ACADsoom cắt tháng theo
          // năm học (nửa mở). Thiếu mốc thì mới lùi về số đã lưu / nhập tay.
          months:
            soThang(p.startYear, p.startMonth, p.endYear, p.endMonth) ??
            p.months,
          role: r.role,
          isLead: r.role === 'LEAD',
          sharePercent: r.sharePercent,
          // Tối thiểu 1: đề tài một mình chủ nhiệm vẫn là một mẫu số hợp lệ, và
          // 0 lọt sang bên kia thành phép chia cho không.
          memberCount: Math.max(1, p.members.length),
          email: r.user?.email ?? null,
          removed:
            p.deletedAt !== null ||
            p.catalogCode === null ||
            r.claimStatus !== 'CONFIRMED',
        },
      };
    });

    if (!since) return { items: mapped.map((m) => m.item) };
    return pageBySince(mapped, query.limit);
  }
}
