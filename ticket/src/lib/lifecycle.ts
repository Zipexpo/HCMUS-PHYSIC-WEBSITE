import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/labels";
import { sendMail, ticketUrl } from "@/lib/mail";
import { staffEmail } from "@/lib/staff";
import { SLA_HOURS, deadlines, slaText, type Priority } from "@/lib/sla";
import { sweepDigest } from "@/lib/digest";
import { statusEvents } from "@/lib/clock";

/**
 * Phiếu "Đã xong" mà người gửi không xác nhận thì sau 7 ngày tự đóng — đúng
 * lời hứa trên giao diện. Không có cron trong hệ này, nên quét "lười": mỗi khi
 * có người vào trang, tối đa mỗi giờ một lần.
 */
export const AUTO_CLOSE_DAYS = 7;
let lastSweep = 0;

export async function sweepAutoClose(): Promise<void> {
  const now = Date.now();
  // Mỗi 10 phút: leo thang cần đúng giờ hơn tự đóng phiếu. Bộ kiểm thử đặt
  // TICKET_SWEEP_GAP_MS=0 để quét ngay mỗi lần có người vào trang.
  const gap = Number(process.env.TICKET_SWEEP_GAP_MS ?? 10 * 60 * 1000);
  if (now - lastSweep < gap) return;
  lastSweep = now;
  try {
    const cutoff = new Date(now - AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
    const stale = await prisma.ticket.findMany({
      where: { status: "RESOLVED", resolvedAt: { lt: cutoff } },
      select: { id: true },
      take: 200,
    });
    void sweepEscalation().catch((e: unknown) =>
      console.warn("[escalate]", e instanceof Error ? e.message : e),
    );
    void sweepDigest().catch((e: unknown) =>
      console.warn("[digest]", e instanceof Error ? e.message : e),
    );
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
  t: T & { team: string | null },
  author: { id: string; name: string },
  body: string,
): Promise<void> {
  // CHỈ những người đọc được ghi chú nội bộ của phiếu này: thành viên nhóm phụ
  // trách + quản trị hệ thống. Sổ người dùng có cả giảng viên — nhắc nhầm tên
  // một giảng viên mà gửi thư là lộ nội dung nội bộ ra ngoài.
  const allowed = new Set([...(await teamEmails(t.team)), ...(await sysAdminEmails())]);
  const staff = (
    await prisma.ticketStaff.findMany({ select: { userId: true, name: true, email: true } }).catch(() => [])
  ).filter((s) => allowed.has(s.email.toLowerCase()));
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


// ═══════════════════════════ NGƯỜI NHẬN THƯ ════════════════════════════════

const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toLowerCase()))];

/** Thành viên một nhóm (chỉ trưởng nhóm nếu `leadsOnly`). */
export async function teamEmails(team: string | null, leadsOnly = false): Promise<string[]> {
  if (!team) return [];
  const rows = await prisma.ticketTeamMember
    .findMany({ where: { team: { name: team }, ...(leadsOnly ? { role: "LEAD" } : {}) }, select: { email: true } })
    .catch(() => []);
  return uniq(rows.map((r) => r.email));
}

/** Quản trị hệ thống: vai trò ADMIN gán ở đây + SUPER_ADMIN bên CMS đã từng vào. */
export async function sysAdminEmails(): Promise<string[]> {
  const [roles, supers] = await Promise.all([
    prisma.ticketRole.findMany({ where: { role: "ADMIN" }, select: { email: true } }).catch(() => []),
    prisma.ticketStaff.findMany({ where: { cmsRole: "SUPER_ADMIN" }, select: { email: true } }).catch(() => []),
  ]);
  return uniq([...roles.map((r) => r.email), ...supers.map((r) => r.email)]);
}

export async function boardEmails(): Promise<string[]> {
  const rows = await prisma.ticketRole.findMany({ where: { role: "BOARD" }, select: { email: true } }).catch(() => []);
  return uniq(rows.map((r) => r.email));
}

/** Đầu mối của một đơn vị — những ADMIN bên CMS thuộc đơn vị đó đã từng vào hệ. */
export async function liaisonEmails(unitId: string | null): Promise<string[]> {
  if (!unitId) return [];
  const rows = await prisma.ticketStaff
    .findMany({ where: { unitId, cmsRole: "ADMIN" }, select: { email: true } })
    .catch(() => []);
  return uniq(rows.map((r) => r.email));
}

function mailMany(to: string[], subject: string, lines: string[], t: { id: string }) {
  for (const e of to) sendMail({ to: e, subject, lines, link: { href: ticketUrl(t.id), label: "Mở phiếu" } });
}

// ═══════════════════════ PHIẾU MỚI / DUYỆT XONG ═════════════════════════════

type NewT = {
  id: string;
  code: string;
  title: string;
  team: string | null;
  priority: Priority;
  reporterName: string;
  reporterUnit: string | null;
  reporterUnitId: string | null;
  unitRoute: boolean;
  approvalStatus: string | null;
  approvalUnitId: string | null;
};

/**
 * Phiếu vừa gửi (hoặc vừa được duyệt) → báo ĐÚNG người phải làm tiếp:
 *   chờ duyệt          → đầu mối đơn vị (không có đầu mối → quản trị hệ thống)
 *   chuyển qua đơn vị  → đầu mối đơn vị (không có → nhóm phụ trách)
 *   còn lại            → cả nhóm phụ trách (nhóm trống → quản trị hệ thống)
 */
export async function notifyNewTicket(t: NewT, justApproved = false): Promise<void> {
  const head = `Phiếu ${t.code} — ${t.title}`;
  const from = `Người gửi: ${t.reporterName}${t.reporterUnit ? ` (${t.reporterUnit})` : ""}`;
  if (t.approvalStatus === "PENDING") {
    const to = t.approvalUnitId ? await liaisonEmails(t.approvalUnitId) : [];
    const fallback = to.length ? to : await sysAdminEmails();
    mailMany(
      fallback,
      `[${t.code}] Cần duyệt: yêu cầu cấp quyền`,
      [
        head,
        from,
        to.length
          ? "Đây là yêu cầu cấp tài khoản / thêm quyền. Thầy/cô là đầu mối của đơn vị, vui lòng duyệt hoặc từ chối trước khi nhóm Tài khoản & Quyền thực hiện."
          : !t.approvalUnitId && t.reporterUnitId
            ? "Đầu mối đơn vị xin quyền cho chính mình — không tự duyệt được, nên quản trị hệ thống duyệt."
            : "Đơn vị của người gửi chưa có đầu mối trên hệ hỗ trợ, nên quản trị hệ thống duyệt thay.",
      ],
      t,
    );
    return;
  }
  const sla = SLA_HOURS[t.priority];
  const note = `Thời hạn: phản hồi trong ${slaText(sla.response)}, xử lý xong trong ${slaText(sla.resolve)}.`;
  if (t.unitRoute) {
    const to = await liaisonEmails(t.reporterUnitId);
    if (to.length) {
      mailMany(to, `[${t.code}] Phiếu mới cho đơn vị: ${t.title}`, [
        head,
        from,
        "Phiếu sửa nội dung trên trang của đơn vị — đầu mối đơn vị xử lý trước. Quá hạn phản hồi thì nhóm Biên tập nội dung của Khoa nhận thay.",
        note,
      ], t);
      return;
    }
  }
  const team = await teamEmails(t.team);
  const to = team.length ? team : await sysAdminEmails();
  mailMany(to, `[${t.code}] ${justApproved ? "Đã duyệt, cần xử lý" : "Phiếu mới"}: ${t.title}`, [
    head,
    from,
    `Nhóm phụ trách: ${t.team ?? "(chưa có)"}${team.length ? "" : " — nhóm chưa có thành viên, gửi quản trị hệ thống"}.`,
    note,
  ], t);
}

// ═══════════════════════════ LEO THANG ═════════════════════════════════════

/**
 * Quá hạn → báo người có trách nhiệm cao hơn, mỗi mức một lần:
 *   mức 1  quá hạn PHẢN HỒI  → trưởng nhóm (phiếu qua đơn vị: cả nhóm Biên tập)
 *   mức 2  quá hạn XỬ LÝ     → trưởng nhóm + quản trị hệ thống;
 *                              phiếu Khẩn → thêm Ban Chủ nhiệm
 * Phiếu "chờ người gửi bổ sung" và "chờ duyệt" không tính: bóng không ở phía
 * người xử lý.
 */
async function sweepEscalation(): Promise<void> {
  const now = new Date();
  const open = await prisma.ticket.findMany({
    where: {
      status: { in: ["NEW", "ACKNOWLEDGED", "IN_PROGRESS"] },
      escalation: { lt: 2 },
      // KHÔNG viết NOT { approvalStatus: "PENDING" }: trong SQL, NULL <> 'PENDING'
      // là NULL chứ không phải true, nên mọi phiếu không cần duyệt bị loại mất.
      OR: [{ approvalStatus: null }, { approvalStatus: { not: "PENDING" } }],
    },
    select: {
      id: true, code: true, title: true, team: true, priority: true, createdAt: true,
      firstResponseAt: true, escalation: true, unitRoute: true, approvedAt: true,
    },
    take: 500,
  });
  const hist = await statusEvents(open.map((t) => t.id));
  for (const t of open) {
    // Phiếu phải duyệt: đồng hồ chạy từ lúc được duyệt; trừ thời gian chờ người
    // gửi bổ sung; mở lại thì chạy lại từ đầu.
    const d = deadlines(t.approvedAt ?? t.createdAt, t.priority, hist.get(t.id));
    let level = t.escalation;
    let to: string[] = [];
    let what = "";
    if (now > d.resolve) {
      level = 2;
      to = uniq([...(await teamEmails(t.team, true)), ...(await sysAdminEmails())]);
      if (t.priority === "URGENT") to = uniq([...to, ...(await boardEmails())]);
      what = `QUÁ HẠN XỬ LÝ (hạn ${slaText(SLA_HOURS[t.priority].resolve)})`;
    } else if (level < 1 && !t.firstResponseAt && now > d.response) {
      level = 1;
      to = await teamEmails(t.team, true);
      if (t.unitRoute) to = uniq([...to, ...(await teamEmails("Biên tập nội dung"))]);
      if (!to.length) to = await sysAdminEmails();
      what = `CHƯA AI PHẢN HỒI (hạn ${slaText(SLA_HOURS[t.priority].response)})`;
    }
    if (level === t.escalation) continue;
    await prisma.$transaction([
      prisma.ticket.update({
        where: { id: t.id },
        data: { escalation: level, ...(level === 2 && t.priority === "URGENT" ? { boardEscalated: true } : {}) },
      }),
      prisma.ticketEvent.create({
        data: { ticketId: t.id, actorName: "Hệ thống", kind: "escalate", toValue: what },
      }),
    ]);
    mailMany(to, `[${t.code}] ${what}`, [`Phiếu ${t.code} — ${t.title}`, `Nhóm: ${t.team ?? "(chưa có)"}`, what], t);
  }
}
