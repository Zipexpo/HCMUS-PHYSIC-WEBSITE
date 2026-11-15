import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { notifyAssignee, notifyMentions, notifyReporterReply } from "@/lib/lifecycle";
import { canAct, canSee } from "@/lib/access";

const Body = z.object({
  body: z.string().trim().min(1, "Chưa nhập nội dung").max(5000),
  isInternal: z.boolean().default(false),
  /** Tệp đã tải lên trước (POST …/attachments), gắn vào lời trả lời này. */
  attachmentIds: z.array(z.string().max(40)).max(10).default([]),
});

/** POST /api/tickets/:id/comments — trả lời trong phiếu. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        title: true,
        reporterUserId: true,
        reporterEmail: true,
        notifyEmail: true,
        assigneeUserId: true,
        status: true,
        team: true,
        reporterUnitId: true,
        unitRoute: true,
        approvalStatus: true,
        approvalUnitId: true,
        boardEscalated: true,
        firstResponseAt: true,
      },
    });
    if (!ticket) {
      return NextResponse.json({ message: "Không có phiếu này" }, { status: 404 });
    }
    const acting = canAct(user, ticket);
    // Viết vào phiếu: người gửi hoặc người xử lý. Đầu mối chỉ-xem và Ban Chủ
    // nhiệm đọc được nhưng không viết — tránh nhiều người cùng trả lời một phiếu.
    if (!canSee(user, ticket) || (!acting && ticket.reporterUserId !== user.id)) {
      return NextResponse.json({ message: "Không đủ quyền" }, { status: 403 });
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
        { status: 400 },
      );
    }
    // Ghi chú nội bộ là đặc quyền của người xử lý. Không chặn ở đây thì người
    // gửi có thể tự đặt cờ rồi viết ghi chú mà chính họ không đọc lại được.
    const isInternal = acting && parsed.data.isInternal;

    await prisma.$transaction(async (tx) => {
      const c = await tx.ticketComment.create({
        data: {
          ticketId: id,
          authorUserId: user.id,
          authorName: user.name,
          body: parsed.data.body,
          isInternal,
        },
        select: { id: true },
      });
      if (parsed.data.attachmentIds.length) {
        // Chỉ gắn tệp của CHÍNH phiếu này, do chính người này tải, chưa gắn đâu.
        await tx.ticketAttachment.updateMany({
          where: {
            id: { in: parsed.data.attachmentIds },
            ticketId: id,
            uploadedByUserId: user.id,
            commentId: null,
          },
          data: { commentId: c.id },
        });
      }
      // Người gửi trả lời khi phiếu đang "chờ bổ sung" => đẩy lại vào hàng xử
      // lý, nếu không phiếu sẽ nằm im dù người ta đã bổ sung thông tin.
      if (ticket.status === "WAITING" && ticket.reporterUserId === user.id) {
        await tx.ticket.update({
          where: { id },
          data: { status: "IN_PROGRESS" },
        });
        await tx.ticketEvent.create({
          data: {
            ticketId: id,
            actorUserId: user.id,
            actorName: user.name,
            kind: "status",
            fromValue: "Chờ bổ sung",
            toValue: "Đang xử lý",
          },
        });
      } else {
        await tx.ticket.update({
          where: { id },
          data: {
            updatedAt: new Date(),
            // Trả lời công khai đầu tiên của bên xử lý = mốc phản hồi đầu.
            ...(acting && !isInternal && ticket.reporterUserId !== user.id && !ticket.firstResponseAt
              ? { firstResponseAt: new Date() }
              : {}),
          },
        });
      }
    });

    if (isInternal && parsed.data.body.includes("@")) {
      void notifyMentions(ticket, user, parsed.data.body);
    }
    if (acting && !isInternal && ticket.reporterUserId !== user.id) {
      notifyReporterReply(ticket, user.name, parsed.data.body);
    }
    if (ticket.reporterUserId === user.id && ticket.assigneeUserId !== user.id) {
      void notifyAssignee(ticket, `${user.name} vừa trả lời: ${parsed.data.body.slice(0, 300)}`);
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return e instanceof UnauthorizedError
      ? NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 })
      : NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });
  }
}
