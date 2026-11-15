import type { Metadata } from "next";
import { IBM_Plex_Mono, Lexend } from "next/font/google";
import Link from "next/link";
import { type SessionUser, currentUser } from "@/lib/auth";
import { canEditForms, canOpenQueue, canSeeReport, isHandler, roleLabel } from "@/lib/access";
import { NavLinks, type NavItem } from "./nav-links";

/**
 * Danh mục theo vai trò:
 *   người xử lý       Hàng đợi · Mẫu biểu* · Báo cáo · Nhóm · Gửi yêu cầu
 *   đầu mối / BCN     Tổng quan · Gửi yêu cầu · Phiếu của tôi · Phiếu đơn vị|Leo thang · Báo cáo
 *   người gửi         Tổng quan · Gửi yêu cầu · Phiếu của tôi
 */
function navFor(u: SessionUser): NavItem[] {
  const a = u.access;
  if (isHandler(a)) {
    return [
      { href: "/phieu", label: "Hàng đợi" },
      ...(canEditForms(a) ? [{ href: "/mau-bieu", label: "Mẫu biểu" }] : []),
      { href: "/bao-cao", label: "Báo cáo" },
      { href: "/nhom", label: "Nhóm" },
      { href: "/gui", label: "Gửi yêu cầu" },
    ];
  }
  const items: NavItem[] = [
    { href: "/", label: "Tổng quan" },
    { href: "/gui", label: "Gửi yêu cầu" },
    { href: "/phieu", label: "Phiếu của tôi" },
  ];
  if (canOpenQueue(a)) items.push({ href: "/don-vi", label: a.liaisonUnitId ? "Phiếu đơn vị" : "Leo thang" });
  if (canSeeReport(a)) items.push({ href: "/bao-cao", label: "Báo cáo" });
  return items;
}
import "./globals.css";

// Font theo bản thiết kế. next/font tải tệp LÚC BUILD rồi tự phục vụ dưới
// /_next/static — trình duyệt người dùng không gọi Google, và đường dẫn tự có
// basePath /ho-tro (khác với url() viết tay trong CSS, vốn phải tự thêm).
const lexend = Lexend({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hỗ trợ kỹ thuật — Khoa Vật lý – Vật lý Kỹ thuật",
  description:
    "Gửi và theo dõi phiếu hỗ trợ kỹ thuật của Khoa Vật lý – Vật lý Kỹ thuật, Trường Đại học Khoa học Tự nhiên, ĐHQG-HCM.",
};

const chuCaiDau = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();

  return (
    <html lang="vi" className={`${lexend.variable} ${plexMono.variable}`}>
      <body className="min-h-screen text-[15px] leading-[1.55] sm:p-5">
        <div className="shell mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1400px] flex-col shadow-[0_30px_80px_rgba(40,36,30,.22)]">
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-[26px] sm:py-[22px]">
            <Link
              href={user ? (user.isStaff ? "/phieu" : "/") : "/dang-nhap"}
              className="raise tap inline-flex h-[54px] items-center gap-3 rounded-full pl-2 pr-[22px] font-medium"
            >
              <span
                aria-hidden
                className="raise-d flex h-10 w-10 items-center justify-center rounded-full font-mono"
              >
                λ
              </span>
              <span className="truncate">
                Hỗ trợ kỹ thuật
                {user ? null : (
                  <span className="hidden sm:inline">
                    {" "}
                    · Khoa Vật lý – Vật lý Kỹ thuật
                  </span>
                )}
              </span>
            </Link>

            {user ? (
              <>
                <NavLinks items={navFor(user)} />
                <div className="raise inline-flex h-[54px] items-center gap-3 rounded-full pl-5 pr-2">
                  <span className="hidden flex-col leading-tight sm:flex">
                    <span className="text-sm font-medium">{user.name}</span>
                    <span className="muted text-xs">
                      {roleLabel(user.access, user.unit)}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="raise-d flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-semibold"
                  >
                    {chuCaiDau(user.name)}
                  </span>
                  <form action="/ho-tro/api/auth/logout" method="post">
                    <button
                      type="submit"
                      className="press tap h-10 rounded-full px-3 text-xs"
                    >
                      Thoát
                    </button>
                  </form>
                </div>
              </>
            ) : null}
          </header>

          <main className="flex flex-1 flex-col">{children}</main>

          <footer className="muted px-5 py-6 text-xs sm:px-[34px]">
            Dùng chung tài khoản với web Khoa. Gặp trục trặc khi đăng nhập, liên
            hệ quản trị viên.
          </footer>
        </div>
      </body>
    </html>
  );
}
