import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/ticket";
import { notifyAssignee, notifyReporterStatus } from "@/lib/lifecycle";

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

    // Người gửi chỉ được: ĐÓNG phiếu của mình, MỞ LẠI phiếu "đã xong" khi vẫn
    // còn lỗi, và bật/tắt email báo tin. Mọi thay đổi khác dành cho người xử
    // lý — nếu không, phiếu sẽ bị tự đẩy sang "đã xong" mà chưa ai làm gì.
    if (!user.isStaff) {
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
        // Chỉ giao cho người xử lý đã có trong sổ — không cho gán một id bất kỳ.
        const s = await prisma.ticketStaff.findUnique({ where: { userId: body.assign } });
        if (!s) return deny("Người này chưa vào hệ thống hỗ trợ", 400);
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
    if (body.notifyEmail !== undefined && body.notifyEmail !== ticket.notifyEmail) {
      data.notifyEmail = body.notifyEmail;
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
