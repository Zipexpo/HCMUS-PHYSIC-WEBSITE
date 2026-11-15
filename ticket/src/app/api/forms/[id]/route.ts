import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { canEditForms, leadOf } from "@/lib/access";
import { FormInput, clean, firstError } from "../schema";

/**
 * PUT /api/forms/:id — lưu mẫu biểu.
 *
 * Không có xoá: phiếu cũ tham chiếu tới mẫu, xoá đi là phiếu mất loại. Muốn
 * ngừng nhận thì tắt `isActive`. Mã loại (`key`) cũng không đổi được sau khi
 * tạo vì link /gui?loai=… đã gửi đi có thể đang nằm trong email của người ta.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    if (!canEditForms(user.access))
      return NextResponse.json({ message: "Không đủ quyền" }, { status: 403 });

    const { id } = await ctx.params;
    const existing = await prisma.ticketForm.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json({ message: "Không có mẫu này" }, { status: 404 });

    if (!leadOf(user.access, existing.defaultTeam))
      return NextResponse.json({ message: "Mẫu này thuộc nhóm khác" }, { status: 403 });

    const parsed = FormInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ message: firstError(parsed.error) }, { status: 400 });

    // Trưởng nhóm chỉ sửa mẫu của nhóm mình, và không đẩy mẫu sang nhóm khác.
    const nextTeam = parsed.data.defaultTeam || null;
    if (!leadOf(user.access, nextTeam))
      return NextResponse.json({ message: "Mẫu này thuộc nhóm khác" }, { status: 403 });

    const { key: _ignored, ...data } = clean(parsed.data);
    void _ignored;
    await prisma.ticketForm.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return e instanceof UnauthorizedError
      ? NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 })
      : NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });
  }
}
