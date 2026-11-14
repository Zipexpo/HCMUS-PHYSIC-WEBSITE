import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

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
  if (!u.isStaff) return;
  const now = Date.now();
  if (now - (lastWrite.get(u.id) ?? 0) < GAP_MS) return;
  lastWrite.set(u.id, now);
  try {
    await prisma.ticketStaff.upsert({
      where: { userId: u.id },
      create: { userId: u.id, name: u.name, email: u.email, unit: u.unit },
      update: {
        name: u.name,
        email: u.email,
        unit: u.unit,
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
