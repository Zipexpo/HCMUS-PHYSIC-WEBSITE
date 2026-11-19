import { cookies } from "next/headers";
import { sweepAutoClose } from "@/lib/lifecycle";
import { rememberStaff } from "@/lib/staff";
import { type Access, isHandler, loadAccess } from "@/lib/access";

/**
 * Đăng nhập dùng lại TÀI KHOẢN CMS.
 *
 * Hệ ticket cố ý KHÔNG có bảng người dùng riêng: thầy cô đã có tài khoản trên
 * trang quản trị web Khoa, bắt nhớ thêm một mật khẩu nữa là cách chắc chắn
 * khiến không ai dùng. Ở đây chỉ gọi sang backend CMS để xác thực, rồi giữ
 * token trong cookie HttpOnly.
 *
 * Token nằm trong cookie HttpOnly chứ không phải localStorage như trang quản
 * trị, vì hệ này render ở máy chủ — và cookie HttpOnly thì JavaScript trên
 * trang không đọc được, nên an toàn hơn trước XSS.
 */

const API = process.env.CMS_API_URL ?? "http://backend:3001";
const COOKIE = "ticket_session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  unit: string | null;
  /** Mã đơn vị bên CMS (Department.id). */
  unitId: string | null;
  /** Người xử lý (quản trị hoặc thành viên nhóm) — xem lib/access.ts. */
  isStaff: boolean;
  access: Access;
};

type CmsProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  department: { id: string; name: string } | null;
};

const fullName = (p: CmsProfile): string =>
  `${p.lastName ?? ""} ${p.firstName ?? ""}`.trim() || p.email;

/** Không nối được hệ thống tài khoản — khác hẳn với sai mật khẩu. */
export class CmsUnreachableError extends Error {
  constructor() {
    super("Không kết nối được hệ thống tài khoản");
    this.name = "CmsUnreachableError";
  }
}

/**
 * Gọi CMS xác thực. Trả về token khi đúng, null khi SAI mật khẩu.
 *
 * Ném CmsUnreachableError khi không gọi được backend — phải tách khỏi "sai mật
 * khẩu", vì backend CMS khởi động lại mỗi lần deploy và lúc đó người dùng sẽ
 * loay hoay gõ lại mật khẩu đúng mà vẫn không vào được.
 */
export async function loginWithCms(
  email: string,
  password: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CmsUnreachableError();
  }
  // 5xx = backend hỏng, không phải người dùng gõ sai.
  if (res.status >= 500) throw new CmsUnreachableError();
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { accessToken?: string };
  return data.accessToken ?? null;
}

/**
 * Xin mã đăng nhập gửi qua email.
 *
 * Trả về true nếu backend nhận yêu cầu. Email không tồn tại thì backend trả 4xx,
 * ta trả về false — nhưng phía trên CỐ Ý không nói ra sự khác biệt đó, để người
 * lạ không dò được email nào có tài khoản.
 */
export async function requestOtpCode(email: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "LOGIN" }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CmsUnreachableError();
  }
  if (res.status >= 500) throw new CmsUnreachableError();
  return res.ok;
}

/** Đổi mã 6 chữ số lấy access token. Mã sai/hết hạn → null. */
export async function loginWithOtpCode(
  email: string,
  code: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/login-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CmsUnreachableError();
  }
  if (res.status >= 500) throw new CmsUnreachableError();
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { accessToken?: string };
  return data.accessToken ?? null;
}

/** Đổi token lấy hồ sơ người dùng. Token hỏng/hết hạn → null. */
export async function profileFromToken(
  token: string,
): Promise<SessionUser | null> {
  let res: Response;
  try {
    // /auth/me mở cho cả cán bộ; /auth/profile chỉ cho admin (trang quản trị
    // dựa vào đó để chặn cán bộ). Backend cũ chưa có /auth/me → 404 → lùi về
    // /auth/profile, để deploy ticket trước hay backend trước đều không gãy.
    const get = (path: string) =>
      fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    res = await get("/auth/me");
    if (res.status === 404) res = await get("/auth/profile");
  } catch {
    // Backend tạm thời không gọi được: coi như chưa đăng nhập thay vì làm sập
    // cả trang. Người dùng tải lại là vào được khi backend lên.
    return null;
  }
  if (!res.ok) return null;
  const p = (await res.json()) as CmsProfile;
  const unitId = p.department?.id ?? null;
  // Quyền KHÔNG suy ra từ vai trò CMS nữa mà từ nhóm / vai trò gán trong hệ
  // hỗ trợ — xem lib/access.ts.
  const access = await loadAccess({ email: p.email, cmsRole: p.role, unitId });
  return {
    id: p.id,
    email: p.email,
    name: fullName(p),
    role: p.role,
    unit: p.department?.name ?? null,
    unitId,
    isStaff: isHandler(access),
    access,
  };
}

export async function setSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Người đang đăng nhập, hoặc null. Dùng trong mọi route cần xác thực. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const u = await profileFromToken(token);
  if (u) {
    // Việc phụ, có giới hạn tần suất bên trong; không chờ, không để hỏng trang.
    void rememberStaff(u);
    void sweepAutoClose();
  }
  return u;
}

/** Như currentUser nhưng ném lỗi — dùng trong API route. */
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new UnauthorizedError();
  return u;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Chưa đăng nhập");
    this.name = "UnauthorizedError";
  }
}

export type DirectoryPerson = { email: string; name: string; department: string | null };

/**
 * Tra người trong Khoa từ CMS (GET /admins/directory) bằng CHÍNH phiên của người
 * đang dùng — hệ hỗ trợ không giữ khoá quản trị nào của CMS. Backend chưa có
 * route này / người dùng không đủ quyền bên CMS → trả mảng rỗng, nơi gọi tự
 * dùng nguồn dự phòng.
 */
export async function searchCmsDirectory(search: string): Promise<DirectoryPerson[]> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return [];
  try {
    const res = await fetch(`${API}/admins/directory?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { items?: { email: string; name: string; department: string | null }[] };
    return (d.items ?? []).map((x) => ({ email: x.email.toLowerCase(), name: x.name, department: x.department }));
  } catch {
    return [];
  }
}
