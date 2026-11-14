import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CmsUnreachableError,
  loginWithCms,
  profileFromToken,
  setSession,
} from "@/lib/auth";

const Body = z.object({
  email: z.string().trim().email("Email không hợp lệ"),
  password: z.string().min(1, "Chưa nhập mật khẩu"),
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  let token: string | null;
  try {
    token = await loginWithCms(parsed.data.email, parsed.data.password);
  } catch (e) {
    // Nói rõ là lỗi hệ thống, đừng để người dùng tưởng mình gõ sai mật khẩu.
    if (e instanceof CmsUnreachableError) {
      return NextResponse.json(
        { message: "Hệ thống tài khoản đang bận, thầy/cô thử lại sau ít phút." },
        { status: 503 },
      );
    }
    throw e;
  }
  // Cố ý KHÔNG nói rõ sai email hay sai mật khẩu: nói rõ là chỉ cho người lạ
  // biết email nào có thật trong hệ thống.
  if (!token) {
    return NextResponse.json(
      { message: "Email hoặc mật khẩu không đúng" },
      { status: 401 },
    );
  }

  const user = await profileFromToken(token);
  if (!user) {
    return NextResponse.json(
      { message: "Không đọc được hồ sơ tài khoản" },
      { status: 401 },
    );
  }

  await setSession(token);
  return NextResponse.json({ user });
}
