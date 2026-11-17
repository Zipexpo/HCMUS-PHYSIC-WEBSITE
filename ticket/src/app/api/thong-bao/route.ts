import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { setNotice } from "@/lib/settings";

const Body = z.object({
  /** null hoặc chuỗi rỗng = gỡ thông báo. */
  message: z.string().trim().max(300).nullable(),
  level: z.enum(["warn", "info"]).default("warn"),
});

/** POST /api/thong-bao — đặt / gỡ thông báo sự cố chung. Quản trị hệ thống và trưởng nhóm. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const a = user.access;
    if (!a.sysAdmin && !a.teams.some((t) => t.lead)) {
      return NextResponse.json({ message: "Chỉ quản trị hoặc trưởng nhóm mới đặt thông báo" }, { status: 403 });
    }
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "Dữ liệu không hợp lệ" }, { status: 400 });
    const { message, level } = parsed.data;
    await setNotice(message ? { message, level, byName: user.name, at: new Date().toISOString() } : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return e instanceof UnauthorizedError
      ? NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 })
      : NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });
  }
}
