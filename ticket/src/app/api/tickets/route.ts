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
    if (!user.isStaff || mine) where.reporterUserId = user.id;
    if (status) where.status = status as TicketStatus;
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
      ];
    }

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
          // Phiếu tới thẳng nhóm phụ trách của loại yêu cầu này.
          team: form.defaultTeam,
          notifyEmail: body.notifyEmail,
        },
        select: { id: true, code: true },
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

    return NextResponse.json(ticket, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
