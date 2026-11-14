import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

/**
 * Thoát rồi quay về trang đăng nhập.
 *
 * Trả về redirect chứ không phải JSON: nút Thoát là một form thường, trả JSON
 * thì người dùng nhìn thấy một trang trắng in `{"ok":true}`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  await clearSession();
  return NextResponse.redirect(new URL("/ho-tro/dang-nhap", req.url), 303);
}
