import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/labels";
import { sendMail, ticketUrl } from "@/lib/mail";
import { staffEmail } from "@/lib/staff";

/**
 * Phiếu "Đã xong" mà người gửi không xác nhận thì sau 7 ngày tự đóng — đúng
 * lời hứa trên giao diện. Không có cron trong hệ này, nên quét "lười": mỗi khi
 * có người vào trang, tối đa mỗi giờ một lần.
 */
export const AUTO_CLOSE_DAYS = 7;
let lastSweep = 0;

export async function sweepAutoClose(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 60 * 60 * 1000) return;
  lastSweep = now;
  try {
    const cutoff = new Date(now - AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
    const stale = await prisma.ticket.findMany({
      where: { status: "RESOLVED", resolvedAt: { lt: cutoff } },
      select: { id: true },
      take: 200,
    });
    for (const t of stale) {
      await prisma.$transaction([
        prisma.ticket.update({
          where: { id: t.id },
          data: { status: "CLOSED", closedAt: new Date() },
        }),
        prisma.ticketEvent.create({
          data: {
            ticketId: t.id,
            actorName: "Hệ thống",
            kind: "status",
            fromValue: STATUS_LABEL.RESOLVED,
            toValue: `${STATUS_LABEL.CLOSED} (tự đóng sau ${AUTO_CLOSE_DAYS} ngày)`,
          },
        }),
      ]);
    }
  } catch (e) {
    lastSweep = 0;
    console.warn("[auto-close]", e instanceof Error ? e.message : e);
  }
}

type T = {
  id: string;
  code: string;
  title: string;
  reporterEmail: string;
  notifyEmail: boolean;
  assigneeUserId: string | null;
};

/**
 * Người xử lý hay "trả lời rồi chuyển sang chờ bổ sung / đã xong" trong một lần
 * bấm — tức hai thao tác liền nhau. Nhớ lần báo trả lời gần nhất để khỏi bắn
 * thêm thư đổi trạng thái ngay sau đó: một việc, một thư.
 */
const lastReplyMail = new Map<string, number>();

/** Người xử lý trả lời công khai → báo người gửi. */
export function notifyReporterReply(t: T, author: string, body: string): void {
  if (!t.notifyEmail) return;
  lastReplyMail.set(t.id, Date.now());
  sendMail({
    to: t.reporterEmail,
    subject: `[${t.code}] ${author} đã trả lời phiếu của thầy/cô`,
    lines: [`Phiếu ${t.code} — ${t.title}`, `${author} viết:`, body],
    link: { href: ticketUrl(t.id), label: "Mở phiếu" },
  });
}

/** Phiếu đổi sang trạng thái người gửi cần biết. */
export function notifyReporterStatus(t: T, status: string): void {
  if (!t.notifyEmail) return;
  if (Date.now() - (lastReplyMail.get(t.id) ?? 0) < 2 * 60 * 1000) return;
  const msg: Record<string, string> = {
    WAITING: "Người xử lý cần thầy/cô bổ sung thông tin để làm tiếp.",
    RESOLVED: `Phiếu đã được xử lý xong. Thầy/cô kiểm tra giúp — còn lỗi thì bấm "Vẫn còn lỗi", ổn rồi thì đóng phiếu. Sau ${AUTO_CLOSE_DAYS} ngày phiếu tự đóng.`,
    REJECTED: "Phiếu không được xử lý. Lý do xem trong phiếu.",
  };
  if (!msg[status]) return;
  sendMail({
    to: t.reporterEmail,
    subject: `[${t.code}] ${STATUS_LABEL[status as keyof typeof STATUS_LABEL]}`,
    lines: [`Phiếu ${t.code} — ${t.title}`, msg[status]],
    link: { href: ticketUrl(t.id), label: "Mở phiếu" },
  });
}

/** Người gửi trả lời / mở lại → báo người đang nhận phiếu. */
export async function notifyAssignee(t: T, what: string): Promise<void> {
  if (!t.assigneeUserId) return;
  const to = await staffEmail(t.assigneeUserId).catch(() => null);
  if (!to) return;
  sendMail({
    to,
    subject: `[${t.code}] ${what}`,
    lines: [`Phiếu ${t.code} — ${t.title}`, what],
    link: { href: ticketUrl(t.id), label: "Mở phiếu" },
  });
}

/**
 * Ghi chú nội bộ có "@Tên Người" → email cho đúng những người xử lý được nhắc.
 * Khớp theo tên đầy đủ trong sổ người xử lý; không nhắc chính người viết.
 */
export async function notifyMentions(
  t: T,
  author: { id: string; name: string },
  body: string,
): Promise<void> {
  const staff = await prisma.ticketStaff
    .findMany({ select: { userId: true, name: true, email: true } })
    .catch(() => []);
  // Tên dài trước: "@Lê Quang Huy" không bị bắt nhầm thành "@Lê Quang".
  const hit = staff
    .filter((s) => s.userId !== author.id && body.includes(`@${s.name}`))
    .sort((a, b) => b.name.length - a.name.length);
  for (const s of hit) {
    sendMail({
      to: s.email,
      subject: `[${t.code}] ${author.name} nhắc thầy/cô trong ghi chú nội bộ`,
      lines: [`Phiếu ${t.code} — ${t.title}`, `${author.name} viết (nội bộ, người gửi không thấy):`, body],
      link: { href: ticketUrl(t.id), label: "Mở phiếu" },
    });
  }
}
