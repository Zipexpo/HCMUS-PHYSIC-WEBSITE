import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CmsUnreachableError,
  loginWithOtpCode,
  profileFromToken,
  requestOtpCode,
  setSession,
} from "@/lib/auth";

const Send = z.object({ email: z.email("Email không hợp lệ") });
const Verify = z.object({
  email: z.email("Email không hợp lệ"),
  code: z.string().trim().length(6, "Mã gồm 6 chữ số"),
});

const busy = () =>
  NextResponse.json(
    { message: "Hệ thống tài khoản đang bận, thầy/cô thử lại sau ít phút." },
    { status: 503 },
  );

/** POST /api/auth/otp — xin mã, hoặc đổi mã lấy phiên đăng nhập. */
export async function POST(req: Request): Promise<NextResponse> {
  const raw = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  // Có `code` nghĩa là bước xác nhận; không có thì là bước xin mã.
  if (raw && typeof raw.code === "string" && raw.code.trim()) {
    const parsed = Verify.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
        { status: 400 },
      );
    }
    let token: string | null;
    try {
      token = await loginWithOtpCode(parsed.data.email, parsed.data.code);
    } catch (e) {
      if (e instanceof CmsUnreachableError) return busy();
      throw e;
    }
    if (!token) {
      return NextResponse.json(
        { message: "Mã không đúng hoặc đã hết hạn" },
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

  const parsed = Send.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  let ok: boolean;
  try {
    ok = await requestOtpCode(parsed.data.email);
  } catch (e) {
    if (e instanceof CmsUnreachableError) return busy();
    throw e;
  }
  // Cố ý TRẢ VỀ GIỐNG NHAU dù email có tồn tại hay không: khác nhau là cho
  // người lạ dò ra email nào có tài khoản trong hệ thống.
  void ok;
  return NextResponse.json({
    message: "Nếu email có trong hệ thống, mã đã được gửi tới hộp thư.",
  });
}
