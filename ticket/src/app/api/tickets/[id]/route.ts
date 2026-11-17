import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/ticket";
import { notifyAssignee, notifyNewTicket, notifyReporterStatus } from "@/lib/lifecycle";
import { canAct, canApprove, canAssignOthers, type Who } from "@/lib/access";
import { sendMail, ticketUrl } from "@/lib/mail";

const Patch = z.object({
  status: z
    .enum([
      "NEW",
      "ACKNOWLEDGED",
      "IN_PROGRESS",
      "WAITING",
      "RESOLVED",
      "CLOSED",
      "REJECTED",
    ])
    .optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  /** "me" = tự nhận phiếu, "" = bỏ người xử lý, còn lại = userId người xử lý khác. */
  assign: z.string().max(100).optional(),
  team: z.string().trim().max(80).optional(),
  notifyEmail: z.boolean().optional(),
  /** Đầu mối đơn vị duyệt / từ chối yêu cầu cấp quyền. */
  approval: z.enum(["APPROVE", "REJECT"]).optional(),
  approvalNote: z.string().trim().max(1000).optional(),
  /** Người gửi chấm điểm hỗ trợ (1–5) khi phiếu đã xong / lúc đóng. */
  rating: z.number().int().min(1).max(5).optional(),
  ratingNote: z.string().trim().max(1000).optional(),
});

const deny = (message: string, status = 403) =>
  NextResponse.json({ message }, { status });

/** PATCH /api/tickets/:id — đổi trạng thái / độ ưu tiên / người xử lý / nhóm. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return deny("Không có phiếu này", 404);

    const parsed = Patch.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return deny("Dữ liệu không hợp lệ", 400);
    const body = parsed.data;
    const isOwner = ticket.reporterUserId === user.id;

    const who: Who = user;

    // ── Duyệt cấp quyền: xử lý riêng, không trộn với các thay đổi khác ──────
    if (body.approval) {
      if (!canApprove(who, ticket)) return deny("Thầy/cô không phải người duyệt phiếu này");
      const ok = body.approval === "APPROVE";
      if (!ok && !body.approvalNote) return deny("Từ chối thì cần ghi lý do cho người gửi", 400);
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.ticket.update({
          where: { id },
          data: {
            approvalStatus: ok ? "APPROVED" : "REJECTED",
            approvedByName: user.name,
            approvedAt: new Date(),
            approvalNote: body.approvalNote || null,
            ...(ok ? {} : { status: "REJECTED", closedAt: new Date() }),
          },
        });
        await tx.ticketEvent.create({
          data: {
            ticketId: id,
            actorUserId: user.id,
            actorName: user.name,
            kind: "approval",
            toValue: ok ? "Đơn vị đã duyệt" : `Đơn vị từ chối: ${body.approvalNote}`,
          },
        });
        return u;
      });
      if (ok) void notifyNewTicket(updated, true).catch(() => undefined);
      if (ticket.notifyEmail) {
        sendMail({
          to: ticket.reporterEmail,
          subject: `[${ticket.code}] ${ok ? "Đã được đơn vị duyệt" : "Đơn vị không duyệt yêu cầu"}`,
          lines: [
            `Phiếu ${ticket.code} — ${ticket.title}`,
            ok
              ? `${user.name} đã duyệt. Phiếu chuyển sang nhóm ${ticket.team ?? "phụ trách"} để thực hiện.`
              : `${user.name} không duyệt. Lý do: ${body.approvalNote}`,
          ],
          link: { href: ticketUrl(id), label: "Mở phiếu" },
        });
      }
      return NextResponse.json({ ok: true });
    }

    const acting = canAct(who, ticket);
    // Phiếu xin quyền chưa duyệt: chỉ được đóng / từ chối, chưa được bắt tay làm.
    if (
      acting &&
      ticket.approvalStatus === "PENDING" &&
      (body.assign !== undefined || (body.status && !["REJECTED", "CLOSED"].includes(body.status)))
    ) {
      return deny("Phiếu đang chờ đơn vị duyệt — chưa thể xử lý", 409);
    }
    // Giao cho NGƯỜI KHÁC hay đổi nhóm: trưởng nhóm / quản trị. Thành viên chỉ tự nhận / bỏ nhận.
    if (acting && !canAssignOthers(who, ticket)) {
      if (body.team !== undefined) return deny("Chỉ trưởng nhóm mới chuyển nhóm được");
      if (body.assign && body.assign !== "me" && body.assign !== user.id) {
        return deny("Chỉ trưởng nhóm mới giao phiếu cho người khác");
      }
    }

    // Người gửi chỉ được: ĐÓNG phiếu của mình, MỞ LẠI phiếu "đã xong" khi vẫn
    // còn lỗi, và bật/tắt email báo tin. Mọi thay đổi khác dành cho người xử
    // lý — nếu không, phiếu sẽ bị tự đẩy sang "đã xong" mà chưa ai làm gì.
    if (!acting) {
      if (!isOwner) return deny("Không đủ quyền đổi phiếu này");
      if (body.priority !== undefined || body.assign !== undefined || body.team !== undefined) {
        return deny("Không đủ quyền đổi phiếu này");
      }
      if (body.status !== undefined) {
        const closing = body.status === "CLOSED";
        const reopening = body.status === "IN_PROGRESS" && ticket.status === "RESOLVED";
        if (!closing && !reopening) return deny("Không đủ quyền đổi phiếu này");
      }
    }
    // Bật/tắt email là lựa chọn riêng của người gửi.
    if (body.notifyEmail !== undefined && !isOwner) {
      return deny("Chỉ người gửi mới đổi được việc nhận email");
    }

    const data: Record<string, unknown> = {};
    const events: Array<{ kind: string; from?: string; to?: string }> = [];
    const reopened =
      body.status === "IN_PROGRESS" && ticket.status === "RESOLVED" && isOwner;

    if (body.status && body.status !== ticket.status) {
      data.status = body.status;
      if (body.status === "RESOLVED") data.resolvedAt = new Date();
      if (body.status === "CLOSED" || body.status === "REJECTED") {
        data.closedAt = new Date();
      }
      if (reopened) data.resolvedAt = null;
      events.push({
        kind: "status",
        from: STATUS_LABEL[ticket.status],
        to: reopened ? `${STATUS_LABEL.IN_PROGRESS} (mở lại: vẫn còn lỗi)` : STATUS_LABEL[body.status],
      });
    }
    if (body.priority && body.priority !== ticket.priority) {
      data.priority = body.priority;
      events.push({ kind: "priority", from: ticket.priority, to: body.priority });
    }
    if (body.team !== undefined && (body.team || null) !== ticket.team) {
      data.team = body.team || null;
      events.push({ kind: "team", from: ticket.team ?? "(chưa có)", to: body.team || "(chưa có)" });
    }
    if (body.assign !== undefined) {
      let toId: string | null = null;
      let toName: string | null = null;
      if (body.assign === "me") {
        toId = user.id;
        toName = user.name;
      } else if (body.assign) {
        // Chỉ giao cho người đã vào hệ VÀ thuộc nhóm của phiếu (quản trị: mọi
        // thành viên nhóm nào cũng được) — không gán một id bất kỳ.
        const s = await prisma.ticketStaff.findUnique({ where: { userId: body.assign } });
        if (!s) return deny("Người này chưa đăng nhập hệ hỗ trợ lần nào", 400);
        const member = await prisma.ticketTeamMember.findFirst({
          where: {
            email: s.email.toLowerCase(),
            ...(user.access.sysAdmin ? {} : { team: { name: ticket.team ?? "" } }),
          },
        });
        const targetIsAdmin = s.cmsRole === "SUPER_ADMIN";
        if (!member && !targetIsAdmin) return deny("Người này không thuộc nhóm phụ trách phiếu", 400);
        toId = s.userId;
        toName = s.name;
      }
      if (toId !== ticket.assigneeUserId) {
        data.assigneeUserId = toId;
        data.assigneeName = toName;
        events.push({
          kind: "assign",
          from: ticket.assigneeName ?? "(chưa ai)",
          to: toName ?? "(chưa ai)",
        });
      }
    }
    if (body.rating !== undefined) {
      if (!isOwner) return deny("Chỉ người gửi mới chấm điểm được");
      if (ticket.rating != null) return deny("Phiếu này đã được chấm điểm", 409);
      const done = ["RESOLVED", "CLOSED"].includes(ticket.status) || body.status === "CLOSED";
      if (!done) return deny("Phiếu chưa xong, chưa chấm điểm được", 400);
      data.rating = body.rating;
      data.ratingNote = body.ratingNote || null;
      data.ratedAt = new Date();
      events.push({ kind: "rating", to: `${body.rating}/5${body.ratingNote ? ` — ${body.ratingNote}` : ""}` });
    }
    if (body.notifyEmail !== undefined && body.notifyEmail !== ticket.notifyEmail) {
      data.notifyEmail = body.notifyEmail;
    }

    // Mốc phản hồi đầu: lần đầu bên xử lý động tới phiếu.
    if (acting && !isOwner && !ticket.firstResponseAt && (data.status || data.assigneeUserId)) {
      data.firstResponseAt = new Date();
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data });
      for (const e of events) {
        await tx.ticketEvent.create({
          data: {
            ticketId: id,
            actorUserId: user.id,
            actorName: user.name,
            kind: e.kind,
            fromValue: e.from ?? null,
            toValue: e.to ?? null,
          },
        });
      }
    });

    // Báo tin sau khi đã ghi xong — gửi thư hỏng không được làm hỏng thao tác.
    if (data.status && !isOwner) notifyReporterStatus(ticket, String(data.status));
    if (typeof data.assigneeUserId === "string" && data.assigneeUserId !== user.id) {
      void notifyAssignee(
        { ...ticket, assigneeUserId: data.assigneeUserId },
        `${user.name} giao phiếu này cho thầy/cô`,
      );
    }
    if (reopened) void notifyAssignee(ticket, `${user.name} mở lại phiếu: vẫn còn lỗi`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return e instanceof UnauthorizedError
      ? NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 })
      : NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });
  }
}
