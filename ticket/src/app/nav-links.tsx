"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Điều hướng chính, đúng thiết kế: RÃNH lõm xuống, mục đang mở NỔI lên.
 *
 * Người gửi:   Tổng quan · Gửi yêu cầu · Phiếu của tôi
 * Quản trị:    Hàng đợi · Mẫu biểu · Báo cáo · Gửi yêu cầu
 */
export function NavLinks({ isStaff }: { isStaff: boolean }) {
  const path = usePathname() ?? "";
  const on = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");

  const items = isStaff
    ? [
        { href: "/phieu", label: "Hàng đợi" },
        { href: "/mau-bieu", label: "Mẫu biểu" },
        { href: "/bao-cao", label: "Báo cáo" },
        { href: "/gui", label: "Gửi yêu cầu" },
      ]
    : [
        { href: "/", label: "Tổng quan" },
        { href: "/gui", label: "Gửi yêu cầu" },
        { href: "/phieu", label: "Phiếu của tôi" },
      ];

  return (
    <nav
      aria-label="Điều hướng chính"
      className="track order-last flex w-full flex-wrap gap-1 rounded-full p-[5px] md:order-none md:w-auto"
    >
      {items.map((it) => {
        const active = on(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={
              "tap inline-flex h-11 flex-1 items-center justify-center rounded-full px-5 text-sm transition-colors md:flex-none " +
              (active
                ? "raise font-medium text-[var(--text)]"
                : "text-[#4a4d4b] hover:text-[var(--text)] dark:text-[var(--muted)]")
            }
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
