import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import type { Access } from "@/lib/access";

/**
 * Sổ người xử lý — nguồn cho ô "Giao cho".
 *
 * CMS chỉ cho Super Admin liệt kê tài khoản, nên hệ ticket tự ghi nhớ mỗi người
 * xử lý khi họ vào. Ghi tối đa mỗi 10 phút một lần cho mỗi người: không có giới
 * hạn này thì mỗi lần tải trang của quản trị viên là một lần ghi CSDL.
 */
const lastWrite = new Map<string, number>();
const GAP_MS = 10 * 60 * 1000;

export async function rememberStaff(u: SessionUser): Promise<void> {
  // Ghi sổ MỌI người đã đăng nhập (kèm đơn vị, vai trò CMS): sổ này cho biết
  // đơn vị nào có đầu mối, ai giao việc được, và để quản trị thêm người vào
  // nhóm / Ban Chủ nhiệm chỉ bằng email mà không phải gõ lại họ tên.
  const now = Date.now();
  if (now - (lastWrite.get(u.id) ?? 0) < GAP_MS) return;
  lastWrite.set(u.id, now);
  try {
    await prisma.ticketStaff.upsert({
      where: { userId: u.id },
      create: { userId: u.id, name: u.name, email: u.email, unit: u.unit, unitId: u.unitId, cmsRole: u.role },
      update: {
        name: u.name,
        email: u.email,
        unit: u.unit,
        unitId: u.unitId,
        cmsRole: u.role,
        lastSeenAt: new Date(),
      },
    });
  } catch {
    // Ghi sổ hỏng không được làm hỏng trang đang mở. Lần sau ghi lại.
    lastWrite.delete(u.id);
  }
}

export type StaffOption = { userId: string; name: string; unit: string | null };

export async function listStaff(): Promise<StaffOption[]> {
  return prisma.ticketStaff.findMany({
    orderBy: { name: "asc" },
    select: { userId: true, name: true, unit: true },
  });
}

/** Email người xử lý, để báo khi người gửi trả lời phiếu họ đang nhận. */
export async function staffEmail(userId: string): Promise<string | null> {
  const s = await prisma.ticketStaff.findUnique({
    where: { userId },
    select: { email: true },
  });
  return s?.email ?? null;
}

/**
 * Người có thể được GIAO phiếu: thành viên nhóm đã từng đăng nhập (cần userId).
 *   quản trị     → thành viên mọi nhóm + quản trị khác
 *   trưởng nhóm  → thành viên nhóm mình
 *   thành viên   → chỉ mình (tự nhận)
 * `team` giới hạn thêm theo nhóm của một phiếu cụ thể.
 */
export async function assignableStaff(
  a: Access,
  team?: string | null,
): Promise<StaffOption[]> {
  const leadTeams = a.teams.filter((t) => t.lead).map((t) => t.name);
  const teams = team !== undefined ? (team ? [team] : []) : a.sysAdmin ? undefined : leadTeams;
  const members = await prisma.ticketTeamMember.findMany({
    where: teams ? { team: { name: { in: teams } } } : {},
    select: { email: true },
  });
  const emails = [...new Set(members.map((m) => m.email.toLowerCase()))];
  const rows = await prisma.ticketStaff.findMany({
    where: {
      OR: [
        { email: { in: emails, mode: "insensitive" } },
        ...(a.sysAdmin ? [{ cmsRole: "SUPER_ADMIN" }] : []),
      ],
    },
    orderBy: { name: "asc" },
    select: { userId: true, name: true, unit: true },
  });
  return rows;
}
