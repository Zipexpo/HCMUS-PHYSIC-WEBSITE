import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import {
  CreateTicketSchema,
  nextTicketCode,
  parseFields,
  validateAnswers,
} from "@/lib/ticket";
import type { Prisma, TicketStatus } from "@/generated/prisma/client";
import { queueScope } from "@/lib/access";
import { notifyNewTicket } from "@/lib/lifecycle";
import { z } from "zod";

/** Luật duyệt của mẫu: câu trả lời ô `field` thuộc `values` → cần duyệt. */
const ApprovalRule = z.object({ field: z.string(), values: z.array(z.string()) });

const fail = (e: unknown) =>
  e instanceof UnauthorizedError
    ? NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 })
    : NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });

/** GET /api/tickets — danh sách phiếu. */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const mine = url.searchParams.get("mine") === "1";
    const q = (url.searchParams.get("q") ?? "").trim();

    const where: Prisma.TicketWhereInput = {};
    // Người gửi thường CHỈ thấy phiếu của chính mình. Phiếu có thể chứa thông
    // tin nội bộ, nên mặc định là đóng, mở rộng theo vai trò.
    // Ghép các điều kiện bằng AND — KHÔNG gán thẳng where.OR: phạm vi quyền
    // (queueScope) cũng là một OR, gán đè là người tìm kiếm thấy phiếu mọi nhóm.
    const scope = queueScope(user.access);
    const and: Prisma.TicketWhereInput[] = [];
    if (!user.isStaff || mine) and.push({ reporterUserId: user.id });
    else if (scope) and.push(scope);
    if (status) and.push({ status: status as TicketStatus });
    if (q) {
      and.push({
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const items = await prisma.ticket.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        priority: true,
        systemName: true,
        reporterName: true,
        assigneeName: true,
        createdAt: true,
        updatedAt: true,
        form: { select: { key: true, name: true, icon: true } },
        _count: { select: { comments: true } },
      },
    });
    return NextResponse.json({ items, canSeeAll: user.isStaff });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/tickets — gửi phiếu mới. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const parsed = CreateTicketSchema.safeParse(
      await req.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const form = await prisma.ticketForm.findUnique({
      where: { key: body.formKey },
    });
    if (!form || !form.isActive) {
      return NextResponse.json(
        { message: "Loại yêu cầu không còn dùng" },
        { status: 400 },
      );
    }

    const errs = validateAnswers(parseFields(form.fields), body.answers);
    if (errs.length) {
      return NextResponse.json({ message: errs.join(" · ") }, { status: 400 });
    }

    // ── Duyệt cấp quyền ────────────────────────────────────────────────────
    const rule = ApprovalRule.safeParse(form.approval);
    const needsApproval =
      rule.success && rule.data.values.includes(String(body.answers[rule.data.field] ?? ""));
    // Đầu mối đơn vị xin cho NGƯỜI KHÁC trong đơn vị mình → chính họ là người
    // duyệt, coi như đã duyệt. Xin cho CHÍNH MÌNH (không ghi email ai khác) thì
    // không tự duyệt được: chuyển quản trị hệ thống duyệt.
    const myEmail = user.email.toLowerCase();
    const forOthers = Object.values(body.answers).some((v) =>
      String(v ?? "")
        .toLowerCase()
        .match(/[^\s,;<>()]+@[^\s,;<>()]+\.[a-z]{2,}/g)
        ?.some((e) => e !== myEmail),
    );
    const isLiaison = !!user.unitId && user.access.liaisonUnitId === user.unitId;
    const selfApproved = needsApproval && isLiaison && forOthers;
    const selfRequest = needsApproval && isLiaison && !forOthers;
    const approval = !needsApproval
      ? {}
      : selfApproved
        ? {
            approvalStatus: "APPROVED",
            approvalUnitId: user.unitId,
            approvalUnitName: user.unit,
            approvedByName: user.name,
            approvedAt: new Date(),
            approvalNote: "Đầu mối đơn vị tự gửi",
          }
        : selfRequest
          ? // approvalUnitId trống = quản trị hệ thống duyệt (lib/access.ts canApprove).
            { approvalStatus: "PENDING", approvalUnitId: null, approvalUnitName: null }
          : { approvalStatus: "PENDING", approvalUnitId: user.unitId, approvalUnitName: user.unit };

    // Mã phiếu và phiếu phải sinh trong CÙNG một giao dịch, nếu không hai người
    // bấm gửi cùng lúc sẽ nhận cùng một mã.
    const ticket = await prisma.$transaction(async (tx) => {
      const code = await nextTicketCode(tx);
      const t = await tx.ticket.create({
        data: {
          code,
          formId: form.id,
          title: body.title,
          description: body.description,
          priority: body.priority,
          systemName: body.systemName || null,
          answers: body.answers as Prisma.InputJsonValue,
          reporterUserId: user.id,
          reporterName: user.name,
          reporterEmail: user.email,
          reporterUnit: user.unit,
          reporterUnitId: user.unitId,
          // Sửa nội dung trang đơn vị: qua đầu mối đơn vị trước (nếu người gửi có đơn vị).
          unitRoute: form.unitRoute && !!user.unitId,
          ...approval,
          // Phiếu tới thẳng nhóm phụ trách của loại yêu cầu này.
          team: form.defaultTeam,
          notifyEmail: body.notifyEmail,
        },
        select: {
          id: true, code: true, title: true, team: true, priority: true, reporterName: true,
          reporterUnit: true, reporterUnitId: true, unitRoute: true, approvalStatus: true, approvalUnitId: true,
        },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: t.id,
          actorUserId: user.id,
          actorName: user.name,
          kind: "created",
          toValue: "NEW",
        },
      });
      return t;
    });

    void notifyNewTicket(ticket).catch(() => undefined);
    return NextResponse.json({ id: ticket.id, code: ticket.code }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
