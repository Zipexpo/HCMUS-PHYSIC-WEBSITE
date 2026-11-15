import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * PHÂN QUYỀN hệ hỗ trợ — mọi câu hỏi "ai được làm gì" trả lời ở MỘT chỗ này.
 *
 * Sáu vai trò:
 *   Người gửi          mọi tài khoản đăng nhập được — phiếu của chính mình
 *   Đầu mối đơn vị     ADMIN bên CMS có gắn đơn vị (bộ môn, VP Khoa, Đoàn–Hội,
 *                      CLB): XEM phiếu người đơn vị mình gửi, DUYỆT xin cấp
 *                      quyền, XỬ LÝ phiếu "chuyển qua đơn vị" (sửa nội dung)
 *   Người xử lý        thành viên một nhóm hỗ trợ: phiếu của nhóm mình
 *   Trưởng nhóm        + giao việc cho người khác, sửa mẫu biểu của nhóm,
 *                      nhận cảnh báo quá hạn
 *   Quản trị hệ thống  SUPER_ADMIN bên CMS, hoặc được gán vai trò ADMIN ở đây:
 *                      toàn quyền
 *   Ban Chủ nhiệm      gán vai trò BOARD: xem Báo cáo + phiếu bị leo thang,
 *                      KHÔNG đọc ghi chú nội bộ
 *
 * Cố ý: làm ADMIN bên CMS KHÔNG còn tự động là người xử lý. Trước đây mọi admin
 * (kể cả admin một CLB) đọc được phiếu của cả Khoa, kể cả phiếu xin cấp quyền.
 */
export type Access = {
  sysAdmin: boolean;
  board: boolean;
  /** Các nhóm người này thuộc về. */
  teams: { name: string; lead: boolean }[];
  /** Đầu mối của đơn vị nào (null = không phải đầu mối). */
  liaisonUnitId: string | null;
};

export type Who = {
  id: string;
  email: string;
  name: string;
  unitId: string | null;
  access: Access;
};

export async function loadAccess(u: {
  email: string;
  cmsRole: string;
  unitId: string | null;
}): Promise<Access> {
  const email = u.email.toLowerCase();
  const [members, role] = await Promise.all([
    prisma.ticketTeamMember
      .findMany({ where: { email }, select: { role: true, team: { select: { name: true } } } })
      .catch(() => []),
    prisma.ticketRole.findUnique({ where: { email } }).catch(() => null),
  ]);
  return {
    sysAdmin: u.cmsRole === "SUPER_ADMIN" || role?.role === "ADMIN",
    board: role?.role === "BOARD",
    teams: members.map((m) => ({ name: m.team.name, lead: m.role === "LEAD" })),
    liaisonUnitId: u.cmsRole === "ADMIN" && u.unitId ? u.unitId : null,
  };
}

// ── Câu hỏi về vai trò (không phụ thuộc phiếu) ───────────────────────────────

/** Người làm việc trên hàng đợi: quản trị hoặc thuộc ít nhất một nhóm. */
export const isHandler = (a: Access) => a.sysAdmin || a.teams.length > 0;
export const isLead = (a: Access) => a.sysAdmin || a.teams.some((t) => t.lead);
/** Mở được trang hàng đợi (dù chỉ để xem): người xử lý, đầu mối, Ban Chủ nhiệm. */
export const canOpenQueue = (a: Access) => isHandler(a) || !!a.liaisonUnitId || a.board;
export const canSeeReport = (a: Access) => a.sysAdmin || a.board || isLead(a) || !!a.liaisonUnitId;
export const canEditForms = (a: Access) => isLead(a);
export const teamNames = (a: Access) => a.teams.map((t) => t.name);
export const leadOf = (a: Access, team: string | null) =>
  a.sysAdmin || (!!team && a.teams.some((t) => t.name === team && t.lead));

// ── Câu hỏi về một phiếu ─────────────────────────────────────────────────────

export type TicketLike = {
  reporterUserId: string;
  team: string | null;
  reporterUnitId: string | null;
  unitRoute: boolean;
  approvalStatus: string | null;
  approvalUnitId: string | null;
  boardEscalated: boolean;
};

const inTeam = (a: Access, t: TicketLike) => !!t.team && a.teams.some((x) => x.name === t.team);
const ownUnit = (a: Access, t: TicketLike) =>
  !!a.liaisonUnitId && a.liaisonUnitId === t.reporterUnitId;

/** Đọc được phiếu (không tính ghi chú nội bộ). */
export function canSee(w: Who, t: TicketLike): boolean {
  const a = w.access;
  return (
    t.reporterUserId === w.id ||
    a.sysAdmin ||
    inTeam(a, t) ||
    ownUnit(a, t) ||
    (!!a.liaisonUnitId && a.liaisonUnitId === t.approvalUnitId) ||
    (a.board && t.boardEscalated)
  );
}

/** Được xử lý: đổi trạng thái, mức độ, nhận phiếu, viết ghi chú nội bộ. */
export function canAct(w: Who, t: TicketLike): boolean {
  const a = w.access;
  return a.sysAdmin || inTeam(a, t) || (t.unitRoute && ownUnit(a, t));
}

/** Ghi chú nội bộ là chuyện của người xử lý — đầu mối chỉ-xem và Ban Chủ nhiệm không đọc. */
export const canSeeInternal = canAct;

/** Giao phiếu cho NGƯỜI KHÁC, đổi nhóm: trưởng nhóm của phiếu hoặc quản trị. */
export const canAssignOthers = (w: Who, t: TicketLike) => leadOf(w.access, t.team);

/** Duyệt yêu cầu cấp quyền đang chờ. */
export function canApprove(w: Who, t: TicketLike): boolean {
  if (t.approvalStatus !== "PENDING") return false;
  const a = w.access;
  // Đơn vị không có mã (người gửi không thuộc đơn vị nào) → quản trị duyệt thay.
  if (!t.approvalUnitId) return a.sysAdmin;
  return a.sysAdmin || a.liaisonUnitId === t.approvalUnitId;
}

/**
 * Điều kiện Prisma: những phiếu người này được thấy trên hàng đợi / báo cáo
 * (KHÔNG gồm phiếu của chính họ — cái đó ở "Phiếu của tôi").
 * Trả về null = thấy tất cả.
 */
export function queueScope(a: Access): Prisma.TicketWhereInput | null {
  if (a.sysAdmin) return null;
  const or: Prisma.TicketWhereInput[] = [];
  if (a.teams.length) or.push({ team: { in: teamNames(a) } });
  if (a.liaisonUnitId) {
    or.push({ reporterUnitId: a.liaisonUnitId });
    or.push({ approvalUnitId: a.liaisonUnitId });
  }
  if (a.board) or.push({ boardEscalated: true });
  // Không có quyền nào: điều kiện không bao giờ đúng.
  return or.length ? { OR: or } : { id: "__none__" };
}

/** Tên vai trò để hiện cạnh tên người dùng ở thanh trên. */
export function roleLabel(a: Access, unit: string | null): string {
  if (a.sysAdmin) return "Quản trị hệ thống";
  const lead = a.teams.find((t) => t.lead);
  if (lead) return `Trưởng nhóm · ${lead.name}`;
  if (a.teams.length) return a.teams[0].name;
  if (a.board) return "Ban Chủ nhiệm Khoa";
  if (a.liaisonUnitId) return `Đầu mối · ${unit ?? "đơn vị"}`;
  return unit ?? "Cán bộ";
}
