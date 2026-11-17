import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { claimOncePer } from "@/lib/settings";
import { deadlines } from "@/lib/sla";
import { OPEN_STATUSES } from "@/lib/labels";

/**
 * THƯ TÓM TẮT MỖI SÁNG (ngày làm việc, từ 7:30) — để người xử lý biết việc
 * trong ngày mà KHÔNG phải mở trang, và quản lý nắm tình hình không cần hỏi.
 *
 *   thành viên nhóm   phiếu mình đang giữ, cái nào quá / sắp quá hạn
 *   trưởng nhóm       + phiếu của nhóm chưa ai nhận, quá hạn, chờ duyệt
 *   quản trị          toàn Khoa: mở, chưa ai nhận, quá hạn, chờ duyệt
 *   đầu mối đơn vị    yêu cầu cấp quyền đang chờ mình duyệt
 *   Ban Chủ nhiệm     THỨ HAI: tổng kết tuần trước
 *
 * Không có gì đáng báo thì KHÔNG gửi — thư rỗng mỗi sáng là cách nhanh nhất
 * dạy người ta bỏ qua mọi thư của hệ.
 */
const BASE = (process.env.TICKET_PUBLIC_URL || "https://phys.hcmus.edu.vn/ho-tro").replace(/\/$/, "");

function vnNow() {
  const d = new Date(Date.now() + 7 * 3_600_000);
  return {
    date: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export async function sweepDigest(): Promise<void> {
  const v = vnNow();
  const anytime = process.env.TICKET_DIGEST_ANYTIME === "1";
  if (!anytime && (v.weekday === 0 || v.weekday === 6 || v.minutes < 7 * 60 + 30)) return;
  // Mỗi ngày đúng một lần, kể cả khi nhiều tiến trình cùng chạy.
  if (!(await claimOncePer("digest:last", v.date))) return;

  const now = Date.now();
  const soon = now + 4 * 3_600_000;
  const open = await prisma.ticket.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: {
      id: true, code: true, title: true, team: true, status: true, priority: true, createdAt: true,
      approvedAt: true, firstResponseAt: true, escalation: true, assigneeUserId: true,
      approvalStatus: true, approvalUnitId: true,
    },
    take: 2000,
  });
  // Hạn kế tiếp: chưa phản hồi → hạn phản hồi, đã phản hồi → hạn xử lý.
  const dueOf = (t: (typeof open)[number]) => {
    const d = deadlines(t.approvedAt ?? t.createdAt, t.priority);
    return (t.firstResponseAt ? d.resolve : d.response).getTime();
  };
  const active = open.filter((t) => t.status !== "WAITING" && t.approvalStatus !== "PENDING");
  const overdue = (t: (typeof open)[number]) => active.includes(t) && dueOf(t) < now;
  const dueSoon = (t: (typeof open)[number]) => active.includes(t) && dueOf(t) >= now && dueOf(t) < soon;
  const line = (t: (typeof open)[number]) =>
    `• ${t.code} — ${t.title}${overdue(t) ? "  ⚠ QUÁ HẠN" : dueSoon(t) ? "  ⏳ sắp tới hạn" : ""}`;

  const [members, staff, roles] = await Promise.all([
    prisma.ticketTeamMember.findMany({ select: { email: true, role: true, team: { select: { name: true } } } }),
    prisma.ticketStaff.findMany({ select: { userId: true, email: true, cmsRole: true, unitId: true } }),
    prisma.ticketRole.findMany({ select: { email: true, role: true } }),
  ]);
  const userIdOf = new Map(staff.map((s) => [s.email.toLowerCase(), s.userId]));
  const out = new Map<string, string[]>(); // email → các đoạn thư
  const add = (email: string, block: string[]) => {
    if (!block.length) return;
    const e = email.toLowerCase();
    out.set(e, [...(out.get(e) ?? []), ...block, ""]);
  };

  // Thành viên: phiếu mình đang giữ.
  for (const email of new Set(members.map((m) => m.email.toLowerCase()))) {
    const uid = userIdOf.get(email);
    const mine = uid ? open.filter((t) => t.assigneeUserId === uid) : [];
    if (mine.length) add(email, [`PHIẾU THẦY/CÔ ĐANG GIỮ (${mine.length})`, ...mine.map(line)]);
  }
  // Trưởng nhóm: bức tranh của nhóm.
  for (const m of members.filter((x) => x.role === "LEAD")) {
    const team = open.filter((t) => t.team === m.team.name);
    const unassigned = team.filter((t) => !t.assigneeUserId && t.approvalStatus !== "PENDING");
    const late = team.filter(overdue);
    if (unassigned.length || late.length) {
      add(m.email, [
        `NHÓM ${m.team.name.toUpperCase()}: ${team.length} phiếu mở · ${unassigned.length} chưa ai nhận · ${late.length} quá hạn`,
        ...[...new Set([...late, ...unassigned])].slice(0, 15).map(line),
      ]);
    }
  }
  // Quản trị hệ thống: toàn Khoa.
  const admins = new Set([
    ...roles.filter((r) => r.role === "ADMIN").map((r) => r.email.toLowerCase()),
    ...staff.filter((s) => s.cmsRole === "SUPER_ADMIN").map((s) => s.email.toLowerCase()),
  ]);
  const allLate = open.filter(overdue);
  const allUnassigned = open.filter((t) => !t.assigneeUserId && t.approvalStatus !== "PENDING");
  const pending = open.filter((t) => t.approvalStatus === "PENDING");
  if (allLate.length || allUnassigned.length || pending.length) {
    for (const e of admins) {
      add(e, [
        `TOÀN KHOA: ${open.length} phiếu mở · ${allUnassigned.length} chưa ai nhận · ${allLate.length} quá hạn · ${pending.length} chờ duyệt`,
        ...allLate.slice(0, 10).map(line),
      ]);
    }
  }
  // Đầu mối đơn vị: yêu cầu chờ mình duyệt.
  for (const s of staff.filter((x) => x.cmsRole === "ADMIN" && x.unitId)) {
    const mine = pending.filter((t) => t.approvalUnitId === s.unitId);
    if (mine.length) add(s.email, [`YÊU CẦU CẤP QUYỀN CHỜ THẦY/CÔ DUYỆT (${mine.length})`, ...mine.map(line)]);
  }
  // Ban Chủ nhiệm: thứ Hai, tổng kết tuần trước.
  if (v.weekday === 1 || anytime) {
    const since = new Date(now - 7 * 86_400_000);
    const week = await prisma.ticket.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, rating: true, firstResponseAt: true, createdAt: true },
    });
    const done = week.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;
    const rated = week.map((t) => t.rating).filter((x): x is number => x != null);
    const fast = week.filter((t) => t.firstResponseAt && t.firstResponseAt.getTime() - t.createdAt.getTime() <= 86_400_000).length;
    const block = [
      "TỔNG KẾT 7 NGÀY QUA",
      `• ${week.length} phiếu mới, ${done} đã xong`,
      `• ${week.length ? Math.round((fast / week.length) * 100) : 0}% được phản hồi trong 24 giờ`,
      `• Hài lòng: ${rated.length ? `${(rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1)}/5 (${rated.length} lượt)` : "chưa có lượt chấm"}`,
      `• Hiện còn ${open.length} phiếu mở, ${allLate.length} quá hạn`,
    ];
    if (week.length || open.length) for (const r of roles.filter((x) => x.role === "BOARD")) add(r.email, block);
  }

  for (const [to, lines] of out) {
    sendMail({
      to,
      subject: `Physupport — việc hôm nay (${v.date.split("-").reverse().slice(0, 2).join(".")})`,
      lines: ["Chào thầy/cô, đây là tóm tắt phiếu hỗ trợ sáng nay:", "", ...lines],
      link: { href: `${BASE}/phieu`, label: "Mở hàng đợi" },
    });
  }
}
