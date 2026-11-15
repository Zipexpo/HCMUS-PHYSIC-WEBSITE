import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { canEditForms, leadOf } from "@/lib/access";
import { FormInput, clean, firstError } from "./schema";

/** POST /api/forms — tạo loại yêu cầu mới (chỉ quản trị viên). */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    // Thêm LOẠI yêu cầu mới là quyết định cấp Khoa → chỉ quản trị hệ thống.
    if (!user.access.sysAdmin)
      return NextResponse.json({ message: "Chỉ quản trị hệ thống mới tạo loại yêu cầu mới" }, { status: 403 });

    const parsed = FormInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ message: firstError(parsed.error) }, { status: 400 });

    const data = clean(parsed.data);
    if (await prisma.ticketForm.findUnique({ where: { key: data.key } }))
      return NextResponse.json({ message: `Mã loại "${data.key}" đã có` }, { status: 409 });

    const form = await prisma.ticketForm.create({ data });
    return NextResponse.json({ id: form.id });
  } catch (e) {
    return e instanceof UnauthorizedError
      ? NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 })
      : NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });
  }
}
