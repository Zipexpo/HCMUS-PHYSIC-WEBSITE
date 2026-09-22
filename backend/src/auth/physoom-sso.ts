import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Xác minh token SSO do PHYsoom ký — HS256, tự viết, không kéo thư viện JWT.
 *
 * Đây là ĐÚNG hợp đồng ACADsoom và Offisoom đang dùng (src/lib/ssoToken.js bên
 * ACADsoom), nên PHYsoom chỉ phải biết một định dạng token cho cả ba app. Hai
 * codebase không chia sẻ gì ngoài một chuỗi bí mật.
 *
 * Luồng:
 *   1. App đẩy trình duyệt sang
 *      PHYSOOM/api/sso/authorize?client=phys-profile&redirect_uri=…&state=…
 *   2. PHYsoom xác thực người dùng rồi trả về redirect_uri?token=…&state=…
 *   3. App gửi token đó lên đây; backend đổi lấy access token của web Khoa
 *
 * Chuỗi bí mật CHỈ nằm ở backend. App không bao giờ thấy nó, nên viết lại app
 * hay đổi stack cũng không phải đụng tới bí mật nào.
 */

export type PhysoomSsoPayload = {
  email: string;
  name?: string;
  /** MSCB — PHYsoom đặt tên trường theo kiểu snake_case. */
  teacher_id?: string;
  /** App mà PHYsoom đúc token cho. Có thì phải khớp, để token của app anh em
   *  không dùng lại được ở đây. */
  aud?: string;
  iat?: number;
  exp?: number;
};

export class SsoTokenError extends Error {}

function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * Trả payload nếu token hợp lệ, ném SsoTokenError nếu không.
 * `audience` bỏ trống thì không kiểm — nhưng nên luôn truyền vào.
 */
export function verifyPhysoomToken(
  token: string,
  secret: string,
  audience?: string,
): PhysoomSsoPayload {
  if (!secret) throw new SsoTokenError('Chưa cấu hình PHYSOOM_SSO_SECRET');

  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new SsoTokenError('Token sai định dạng');
  const [header, body, signature] = parts;

  const expected = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // So sánh không phụ thuộc thời gian; khác độ dài thì chặn luôn vì
  // timingSafeEqual ném lỗi khi hai buffer lệch nhau.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SsoTokenError('Chữ ký không hợp lệ');
  }

  let payload: PhysoomSsoPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as PhysoomSsoPayload;
  } catch {
    throw new SsoTokenError('Không đọc được nội dung token');
  }

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new SsoTokenError('Token đã hết hạn');
  }
  // Token đời cũ không có `aud` — chấp nhận, để đợt chuyển đổi không khoá người
  // dùng ở ngoài. Có `aud` mà lệch thì chặn.
  if (audience && payload.aud && payload.aud !== audience) {
    throw new SsoTokenError('Token được cấp cho ứng dụng khác');
  }
  if (!payload.email) throw new SsoTokenError('Token thiếu email');

  return { ...payload, email: String(payload.email).toLowerCase() };
}

/**
 * Email SINH VIÊN — không bao giờ là cán bộ (role LECTURER).
 *
 * Trước 22/9/2026 mọi lượt đăng nhập qua PHYsoom đều được tạo LECTURER, kể cả
 * `…@student.hcmus.edu.vn`. Tài khoản đó rồi hiện trong danh bạ cán bộ, lọt sang
 * ACADsoom thành ngạch GV (vào bảng điểm cả Khoa), và có thể được tự dựng trang
 * nhân sự khi gán đơn vị.
 */
export function laEmailSinhVien(email: string | null | undefined): boolean {
  return /@student\.hcmus\.edu\.vn$/i.test(String(email ?? '').trim());
}

/** Tách tên tiếng Việt: từ cuối là tên gọi, phần còn lại là họ + đệm. */
export function splitVietnameseName(full: string): {
  firstName: string;
  lastName: string;
} {
  const parts = String(full ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[parts.length - 1],
    lastName: parts.slice(0, -1).join(' '),
  };
}
