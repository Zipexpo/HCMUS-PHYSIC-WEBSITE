"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { refreshOnce } from "@/lib/api";

function getTokenPayload(token: string) {
  try {
    const base64 = token.split(".")[1];
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function AuthGuard({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: string[];
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Cổng này chạy TRƯỚC mọi lời gọi API, nên nó mới là chỗ quyết định người
    // dùng có bị đá về trang đăng nhập hay không.
    //
    // Trước đây: thấy access token quá hạn là xoá CẢ token gia hạn rồi đá ra
    // login. Access token chỉ sống 1 giờ, còn token gia hạn sống 7 ngày — nên
    // cứ sau một tiếng là ai cũng bị đăng xuất, và vì token gia hạn đã bị xoá
    // nên phần tự gia hạn ở apiFetch không bao giờ có cơ hội chạy.
    //
    // Giờ: quá hạn thì THỬ GIA HẠN trước; hỏng mới đăng xuất.
    const signOut = () => {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      router.replace("/login");
    };

    const check = async () => {
      let token = localStorage.getItem("accessToken");
      if (!token) {
        router.replace("/login");
        return;
      }

      let payload = getTokenPayload(token);
      if (!payload || payload.exp * 1000 < Date.now()) {
        const fresh = await refreshOnce();
        if (!fresh) {
          signOut();
          return;
        }
        token = fresh;
        payload = getTokenPayload(fresh);
        if (!payload) {
          signOut();
          return;
        }
      }

      // Sai vai trò thì đăng xuất thật — gia hạn cũng không đổi được vai trò.
      if (roles && !roles.includes(payload.roleName)) {
        signOut();
        return;
      }
      setAuthorized(true);
    };

    void check();
  }, [router, roles]);

  if (!authorized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      </div>
    );
  }

  return <>{children}</>;
}
