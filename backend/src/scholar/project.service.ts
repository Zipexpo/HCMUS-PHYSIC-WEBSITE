import { Injectable } from '@nestjs/common';
import { createReadStream } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { Prisma, ProjectEvidenceKind } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { laterOf, pageBySince } from './integration-cursor';
import { duocQuanLy, vaiTroLucTao, vaiTroSauKhiSua } from './project-roles';
import {
  EvidenceNotFoundException,
  LastLeadLeavingException,
  NotAProjectMemberException,
  NotProjectLeadException,
  ProjectDatesReversedException,
  ProjectNeedsAcceptanceException,
  ProjectNeedsLeadException,
  ProjectNotFoundException,
  ShareOverflowException,
  StagedDocNotFoundException,
} from './scholar.error';
import { ProjectDocOcrService, EVIDENCE_DIR } from './project-doc.service';
import { bocTachTruongDeTai, gopTruong } from './project-doc-parse';
import type {
  CreateProjectBodyType,
  IntegrationQueryType,
  ListProjectsQueryType,
  UpdateProjectBodyType,
} from './scholar.model';

/**
 * Tệp người dùng vừa tải lên — hình dạng đủ dùng cho service, khớp cấu trúc với
 * `Express.Multer.File` mà controller truyền vào (không phụ thuộc kiểu global).
 */
export type TepTaiLen = {
  originalname: string;
  filename: string;
  path: string;
  mimetype: string;
  size: number;
};

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
  const moc = soatMocDeTai(startYear, startMonth, endYear, endMonth);
  return moc.loai === 'du' ? moc.soThang : null;
}

/**
 * Bốn mốc của đề tài ở tình trạng nào — TÁCH "thiếu mốc" khỏi "ngày ngược".
 *
 * soThang() trả null cho CẢ HAI, và cả ba nơi dùng nó (tạo, sửa, kênh gửi
 * ACADsoom) đều hiểu null là "thiếu mốc, lấy số tháng nhập tay". Nên đề tài gõ
 * nhầm năm kết thúc lọt vào với số tháng người khai tự gõ: đo 14/9/2026 có 3 đề
 * tài như vậy, VL2020-18-02 (1/2020 → 1/2019) months=13, T2025-18 (12/2025 →
 * 12/2024) months=8 — hai mốc nói một đằng, số tháng nói một nẻo.
 *
 * Thiếu mốc thì còn nhập tay được; ngày ngược là dữ liệu SAI, phải sửa mốc.
 */
export type MocDeTai =
  | { loai: 'thieu' }
  | { loai: 'nguoc' }
  | { loai: 'du'; soThang: number };

export function soatMocDeTai(
  startYear?: number | null,
  startMonth?: number | null,
  endYear?: number | null,
  endMonth?: number | null,
): MocDeTai {
  if (!startYear || !startMonth || !endYear || !endMonth) {
    return { loai: 'thieu' };
  }
  const dau = startYear * 12 + (startMonth - 1);
  const cuoi = endYear * 12 + (endMonth - 1);
  if (cuoi < dau) return { loai: 'nguoc' };
  // HIỆU SỐ (span), KHÔNG cộng 1: 2/2025→2/2026 = 12 (đúng một năm), 1/2025→
  // 12/2025 = 11, cùng tháng = 0. Trước đây +1 (đếm cả hai đầu mút) nên 2/25→2/26
  // ra 13 — lệch dư một tháng.
  return { loai: 'du', soThang: cuoi - dau };
}

/**
 * Số tháng gửi ACADsoom: đủ mốc thì suy từ mốc; thiếu mốc mới dùng số đã lưu;
 * mốc NGƯỢC thì null — không gửi số người khai tự gõ đi tính giờ khi hai mốc
 * đang nói ngược với nó.
 */
export function thangGuiAcadsoom(p: {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  months: number | null;
}): number | null {
  const moc = soatMocDeTai(p.startYear, p.startMonth, p.endYear, p.endMonth);
  if (moc.loai === 'du') return moc.soThang;
  return moc.loai === 'thieu' ? p.months : null;
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
    private readonly ocr: ProjectDocOcrService,
  ) {}

  private get memberInclude() {
    return {
      members: {
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { role: 'asc' as const },
      },
      evidences: { orderBy: { createdAt: 'asc' as const } },
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
      // Ai bấm Sửa được — CÙNG hàm với chốt chặn ở update()/remove(), để nút
      // trên giao diện không nói khác máy chủ.
      canEdit: duocQuanLy(userId, row.createdBy, row.members),
      // Minh chứng đã gắn + cờ "đã có nghiệm thu" — điều kiện chuyển KẾT THÚC.
      evidences: (row.evidences ?? []).map((e: any) => ({
        id: e.id,
        kind: e.kind,
        originalName: e.originalName,
        mimeType: e.mimeType,
        size: e.size,
        uploadedBy: e.uploadedBy ?? null,
        createdAt: e.createdAt,
      })),
      coMinhChungNghiemThu: (row.evidences ?? []).some(
        (e: any) => e.kind === 'NGHIEM_THU',
      ),
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
    // Danh sách phải có CHỦ NHIỆM — xem project-roles.ts. Kiểm TRƯỚC khi ghi:
    // tạo xong mới báo thì đề tài thiếu chủ nhiệm đã nằm trong cơ sở dữ liệu.
    if (!vaiTroLucTao(userId, body).includes('LEAD')) {
      throw ProjectNeedsLeadException;
    }
    // Mốc NGƯỢC là dữ liệu sai chứ không phải thiếu mốc — chặn, và không bao giờ
    // lấy số tháng gõ tay thay cho hai mốc. Xem soatMocDeTai.
    const mocTao = soatMocDeTai(
      body.startYear,
      body.startMonth,
      body.endYear,
      body.endMonth,
    );
    if (mocTao.loai === 'nguoc') throw ProjectDatesReversedException;
    // Minh chứng đính kèm (tải qua parse-documents) — nạp trước để biết loại, và
    // để chốt chặn KẾT THÚC thấy được nghiệm thu ngay từ lúc tạo. Chỉ chặn khi
    // NGƯỜI DÙNG CHỦ ĐỘNG đặt COMPLETED, không truy hồi đề tài đã kết thúc từ trước.
    const dinhKem = await this.napStaged(userId, body.attachDocuments);
    if (body.status === 'COMPLETED' && !this.coNghiemThu(dinhKem)) {
      throw ProjectNeedsAcceptanceException;
    }
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
        months: mocTao.loai === 'du' ? mocTao.soThang : (body.months ?? null),
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
    await this.ganStaged(created.id, dinhKem);
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
    // Hai ngoại lệ:
    //   · `myShowOnWeb` — hiện đề tài trên trang nhân sự của CHÍNH MÌNH hay không
    //     là việc riêng của từng người, chủ nhiệm không quyết thay được.
    //   · NGƯỜI KHAI đề tài, khi đề tài chưa có chủ nhiệm nào có tài khoản đã
    //     xác nhận — không thì đề tài kẹt, không ai sửa được. Xem duocQuanLy.
    const chiDoiHienThi =
      body.myShowOnWeb !== undefined &&
      Object.keys(body).every((k) => k === 'myShowOnWeb');

    if (chiDoiHienThi) await this.assertMember(id, userId);
    else {
      const hienCo = await this.assertQuanLy(id, userId);
      // Sửa xong vẫn phải còn CHỦ NHIỆM — xem project-roles.ts. Tính trên danh
      // sách SAU khi áp lượt sửa này (tự hạ mình, đổi vai người khác, thay danh
      // sách người ngoài), và kiểm trước MỌI lệnh ghi bên dưới — không thì hỏng
      // giữa chừng.
      if (!vaiTroSauKhiSua(hienCo, userId, body).includes('LEAD')) {
        throw ProjectNeedsLeadException;
      }
    }
    const cur = await this.prisma.researchProject.findUnique({
      where: { id },
      select: {
        catalogCode: true,
        status: true,
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
    const mocSua = soatMocDeTai(
      moc.startYear,
      moc.startMonth,
      moc.endYear,
      moc.endMonth,
    );
    // Mốc sau khi sửa mà NGƯỢC thì chặn — kể cả khi lượt này không đụng tới mốc:
    // đề tài đang lưu ngày ngược phải được sửa mốc trước. Riêng bật/tắt hiện
    // trên trang là việc của từng thành viên, không bắt họ gánh dữ liệu chung.
    if (mocSua.loai === 'nguoc' && !chiDoiHienThi) {
      throw ProjectDatesReversedException;
    }
    const thangSuyRa = mocSua.loai === 'du' ? mocSua.soThang : null;

    // Minh chứng đính kèm ở lượt sửa này (nếu có), và chốt chặn KẾT THÚC: chỉ khi
    // NGƯỜI DÙNG chủ động đặt COMPLETED thì phải đã có — hoặc đang gắn — minh
    // chứng nghiệm thu. Hợp đồng + thuyết minh chỉ chứng cho đề tài đang thực hiện.
    const dinhKem = await this.napStaged(userId, body.attachDocuments);
    if (body.status === 'COMPLETED' && !this.coNghiemThu(dinhKem)) {
      const daCoNghiemThu = await this.prisma.projectEvidence.count({
        where: { projectId: id, kind: 'NGHIEM_THU' },
      });
      if (!daCoNghiemThu) throw ProjectNeedsAcceptanceException;
    }

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
      // Cộng cả người trong Khoa MỜI THÊM ở lượt này: họ chưa có dòng nên đi
      // `members` chứ không đi memberUpdates, nhưng vẫn là một phần của bánh.
      const tong = [...body.memberUpdates, ...(body.members ?? [])].reduce(
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
    await this.ganStaged(id, dinhKem);
    this.bus.emit('project.changed', { id, userIds: [userId] });
    return this.findOne(id, userId);
  }

  /** Gỡ tên mình; đề tài không còn ai xác nhận thì xoá mềm cả dòng. */
  async remove(userId: string, id: string) {
    await this.assertMember(id, userId);
    // Rút TÊN MÌNH ra thì ai cũng làm được. Nhưng xoá HẲN đề tài — trường hợp
    // không còn ai khác — là xoá dữ liệu chung, nên chỉ người quản lý đề tài:
    // chủ nhiệm, hoặc người khai khi chưa có chủ nhiệm nào xác nhận.
    const others = await this.prisma.projectMember.count({
      where: {
        projectId: id,
        claimStatus: 'CONFIRMED',
        userId: { not: userId },
      },
    });
    if (others > 0) {
      // Chủ nhiệm DUY NHẤT rút tên thì danh sách hết chủ nhiệm — trái luật lúc
      // khai (project-roles.ts).
      // Người KHÔNG phải chủ nhiệm thì rời lúc nào cũng được, kể cả khỏi đề tài
      // vốn đã thiếu chủ nhiệm: đó không phải lỗi của họ.
      const hienCo = await this.prisma.projectMember.findMany({
        where: { projectId: id },
        select: { userId: true, role: true, claimStatus: true },
      });
      const toiLaChuNhiem = hienCo.some(
        (m) => m.userId === userId && m.role === 'LEAD',
      );
      const conChuNhiemKhac = hienCo.some(
        (m) =>
          m.userId !== userId &&
          m.claimStatus !== 'REJECTED' &&
          m.role === 'LEAD',
      );
      if (toiLaChuNhiem && !conChuNhiemKhac) throw LastLeadLeavingException;
      await this.prisma.projectMember.updateMany({
        where: { projectId: id, userId },
        data: { claimStatus: 'REJECTED', respondedAt: new Date() },
      });
    } else {
      await this.assertQuanLy(id, userId);
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
      // Vai trò người khai đã gán. Thiếu nó thì ô chọn bên phys-profile không
      // biết mặc định là gì — và từng mặc định "Thành viên" (xem respond).
      role: r.role,
      invitedBy: r.invitedBy,
      invitedByName: r.invitedBy ? (nameOf.get(r.invitedBy) ?? null) : null,
    }));
  }

  /**
   * Trả lời lời mời vào đề tài — CHỈ khi đang chờ.
   *
   * `role` gửi kèm GHI ĐÈ vai trò người khai đã gán. Ô chọn bên phys-profile
   * từng mặc định "Thành viên", nên chủ nhiệm được gắn tên chỉ cần bấm xác nhận
   * là tự hạ mình xuống: đề tài hết chủ nhiệm, và hồi đó chỉ chủ nhiệm sửa được
   * nên không ai sửa, không ai xoá được nữa. Đo 13/9/2026: 8 đề tài không có
   * chủ nhiệm nào đã xác nhận, 6 trong số đó có chủ nhiệm đang chờ trả lời.
   *
   * Dòng ĐÃ trả lời mà vẫn gọi lại được đây thì thành viên nào cũng tự nâng mình
   * lên chủ nhiệm bằng một yêu cầu gõ tay — rồi sửa kinh phí, cấp đề tài, tức
   * mẫu số giờ của cả nhóm. Không màn hình nào gọi lại trên dòng đã trả lời, nên
   * trả nguyên trạng thay vì báo lỗi (bấm đúp không thành lỗi).
   */
  async respond(
    userId: string,
    projectId: string,
    accept: boolean,
    role?: 'LEAD' | 'SECRETARY' | 'MEMBER',
  ) {
    const row = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true, claimStatus: true },
    });
    if (!row) throw NotAProjectMemberException;
    if (row.claimStatus !== 'PENDING') return this.findOne(projectId, userId);
    await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: {
        claimStatus: accept ? 'CONFIRMED' : 'REJECTED',
        respondedAt: new Date(),
        role: accept ? (role ?? undefined) : undefined,
      },
    });
    // Báo ngay cho app ngoài. Xác nhận/từ chối là lúc giờ NCKH của người này
    // ĐỔI THẬT: trước khi trả lời họ chưa hưởng giờ nào của đề tài (xem
    // assertShareFits — chỉ cộng người đã xác nhận). Ba đường kia (create,
    // update, remove) đều đã phát; riêng đây bị sót, nên bên nhận phải chờ lượt
    // quét theo lịch mới thấy — đúng ô người dùng hỏi nhiều nhất.
    this.bus.emit('project.changed', { id: projectId, userIds: [userId] });
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

  // ── Minh chứng đề tài: tải lên → OCR điền sẵn → gắn khi lưu ────────────────

  /**
   * Đọc hợp đồng / thuyết minh, trả về các ô ĐIỀN SẴN (để người dùng SOÁT) và
   * token của tệp đã giữ tạm. Tệp chưa gắn vào đề tài nào — khi bấm Lưu,
   * create/update nhận lại token ở `attachDocuments` để biến thành minh chứng.
   *
   * Hợp đồng đứng TRƯỚC thuyết minh khi gộp: hợp đồng có mã + hai mốc + số quyết
   * định; thuyết minh bù tên/email/kinh phí khi hợp đồng thiếu (xem gopTruong).
   */
  async parseDocuments(
    userId: string,
    files: { hopDong?: TepTaiLen; deXuat?: TepTaiLen },
  ) {
    await this.donStagedQuaHan();
    const dau: Array<{ file: TepTaiLen; kind: ProjectEvidenceKind }> = [];
    if (files.hopDong) dau.push({ file: files.hopDong, kind: 'HOP_DONG' });
    if (files.deXuat) dau.push({ file: files.deXuat, kind: 'DE_XUAT' });

    const documents: Array<{
      token: string;
      kind: ProjectEvidenceKind;
      originalName: string;
      mimeType: string;
      size: number;
      source: 'text' | 'ocr';
    }> = [];
    const parsedList: Array<ReturnType<typeof bocTachTruongDeTai>> = [];

    for (const { file, kind } of dau) {
      const originalName = this.tenGoc(file.originalname);
      let source: 'text' | 'ocr' = 'ocr';
      let text = '';
      try {
        const doc = await this.ocr.docText(file.path, file.mimetype);
        source = doc.source;
        text = doc.text;
      } catch {
        // OCR hỏng (thiếu nhị phân, tệp lỗi) — vẫn giữ tệp để gắn, chỉ không điền sẵn.
        text = '';
      }
      const parsed = bocTachTruongDeTai(text, originalName);
      const staged = await this.prisma.stagedUpload.create({
        data: {
          kind,
          originalName,
          storedName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          uploadedBy: userId,
        },
        select: { id: true },
      });
      documents.push({
        token: staged.id,
        kind,
        originalName,
        mimeType: file.mimetype,
        size: file.size,
        source,
      });
      parsedList.push(parsed);
    }
    return { fields: gopTruong(parsedList), documents };
  }

  /** Nạp các dòng StagedUpload theo token — CHỈ của chính người này. */
  private async napStaged(
    userId: string,
    attach?: Array<{ token: string; kind?: ProjectEvidenceKind }>,
  ): Promise<
    Array<{
      staged: {
        id: string;
        originalName: string;
        storedName: string;
        mimeType: string;
        size: number;
        uploadedBy: string | null;
      };
      kind: ProjectEvidenceKind;
    }>
  > {
    if (!attach?.length) return [];
    const ids = attach.map((a) => a.token);
    const rows = await this.prisma.stagedUpload.findMany({
      where: { id: { in: ids }, uploadedBy: userId },
    });
    // Token nào không thấy / không phải của người này thì báo lỗi, không lặng lẽ bỏ.
    if (rows.length !== new Set(ids).size) throw StagedDocNotFoundException;
    const kindTheoToken = new Map(attach.map((a) => [a.token, a.kind]));
    return rows.map((r) => ({
      staged: r,
      kind: kindTheoToken.get(r.id) ?? r.kind,
    }));
  }

  private coNghiemThu(list: Array<{ kind: ProjectEvidenceKind }>): boolean {
    return list.some((x) => x.kind === 'NGHIEM_THU');
  }

  /** Biến tệp giữ tạm thành minh chứng của đề tài rồi xoá dòng tạm. */
  private async ganStaged(
    projectId: string,
    list: Array<{
      staged: {
        id: string;
        originalName: string;
        storedName: string;
        mimeType: string;
        size: number;
        uploadedBy: string | null;
      };
      kind: ProjectEvidenceKind;
    }>,
  ) {
    if (!list.length) return;
    await this.prisma.$transaction([
      this.prisma.projectEvidence.createMany({
        data: list.map((x) => ({
          projectId,
          kind: x.kind,
          originalName: x.staged.originalName,
          storedName: x.staged.storedName,
          mimeType: x.staged.mimeType,
          size: x.staged.size,
          uploadedBy: x.staged.uploadedBy,
        })),
      }),
      this.prisma.stagedUpload.deleteMany({
        where: { id: { in: list.map((x) => x.staged.id) } },
      }),
    ]);
  }

  /** Danh sách minh chứng của đề tài (thành viên xem được). */
  async listEvidence(userId: string, projectId: string) {
    await this.assertMember(projectId, userId);
    const rows = await this.prisma.projectEvidence.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      originalName: e.originalName,
      mimeType: e.mimeType,
      size: e.size,
      uploadedBy: e.uploadedBy,
      createdAt: e.createdAt,
    }));
  }

  /** Tệp minh chứng để tải về — trả luồng đọc + metadata. */
  async evidenceFile(userId: string, projectId: string, evidenceId: string) {
    await this.assertMember(projectId, userId);
    const e = await this.prisma.projectEvidence.findFirst({
      where: { id: evidenceId, projectId },
    });
    if (!e) throw EvidenceNotFoundException;
    return {
      stream: createReadStream(join(EVIDENCE_DIR, e.storedName)),
      mimeType: e.mimeType,
      originalName: e.originalName,
    };
  }

  /** Tải thẳng một minh chứng lên đề tài đã có (vd biên bản nghiệm thu). */
  async addEvidence(
    userId: string,
    projectId: string,
    file: TepTaiLen,
    kind: ProjectEvidenceKind,
  ) {
    await this.assertQuanLy(projectId, userId);
    await this.prisma.projectEvidence.create({
      data: {
        projectId,
        kind,
        originalName: this.tenGoc(file.originalname),
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: userId,
      },
    });
    this.bus.emit('project.changed', { id: projectId, userIds: [userId] });
    return this.findOne(projectId, userId);
  }

  /** Gỡ một minh chứng (chủ nhiệm / người khai). Xoá cả tệp trên đĩa. */
  async removeEvidence(userId: string, projectId: string, evidenceId: string) {
    await this.assertQuanLy(projectId, userId);
    const e = await this.prisma.projectEvidence.findFirst({
      where: { id: evidenceId, projectId },
    });
    if (!e) throw EvidenceNotFoundException;
    await this.prisma.projectEvidence.delete({ where: { id: e.id } });
    await rm(join(EVIDENCE_DIR, e.storedName), { force: true }).catch(() => {});
    this.bus.emit('project.changed', { id: projectId, userIds: [userId] });
    return this.findOne(projectId, userId);
  }

  /** multer để tên gốc ở latin1 — trả lại UTF-8 để tên tiếng Việt không loạn. */
  private tenGoc(name: string): string {
    return Buffer.from(name, 'latin1').toString('utf8');
  }

  /**
   * Dọn tệp giữ tạm quá 1 ngày mà chưa gắn: người dùng bỏ giữa chừng thì tệp
   * không nằm mãi trong `uploads/`. Gọi nhẹ mỗi lần parse, không cần cron.
   */
  private async donStagedQuaHan() {
    const nguong = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cu = await this.prisma.stagedUpload.findMany({
      where: { createdAt: { lt: nguong } },
      select: { id: true, storedName: true },
    });
    if (!cu.length) return;
    await this.prisma.stagedUpload.deleteMany({
      where: { id: { in: cu.map((s) => s.id) } },
    });
    for (const s of cu) {
      await rm(join(EVIDENCE_DIR, s.storedName), { force: true }).catch(
        () => {},
      );
    }
  }

  /**
   * Người quản lý đề tài (sửa, xoá hẳn) — xem duocQuanLy trong project-roles.ts.
   * Trả luôn danh sách thành viên để nơi gọi khỏi đọc lại lần nữa.
   */
  private async assertQuanLy(projectId: string, userId: string) {
    const p = await this.prisma.researchProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        createdBy: true,
        members: {
          select: { id: true, userId: true, role: true, claimStatus: true },
        },
      },
    });
    if (!p) throw ProjectNotFoundException;
    const toi = p.members.find((m) => m.userId === userId);
    if (!toi || toi.claimStatus !== 'CONFIRMED') {
      throw NotAProjectMemberException;
    }
    if (!duocQuanLy(userId, p.createdBy, p.members)) {
      throw NotProjectLeadException;
    }
    return p.members;
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
                      OR: [{ endYear: null }, { endYear: { gte: query.from } }],
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
          // năm học (nửa mở). Thiếu mốc thì mới lùi về số đã lưu / nhập tay;
          // mốc ngược thì null, không gửi số gõ tay — xem thangGuiAcadsoom.
          months: thangGuiAcadsoom(p),
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
