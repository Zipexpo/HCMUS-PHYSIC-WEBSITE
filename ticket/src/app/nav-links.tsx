"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Điều hướng chính, đúng thiết kế: RÃNH lõm xuống, mục đang mở NỔI lên.
 *
 * Danh mục tính ở máy chủ theo vai trò (layout.tsx) — xem lib/access.ts.
 */
export type NavItem = { href: string; label: string };

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname() ?? "";
  const on = (href: string) => {
    const h = href.split("?")[0];
    return h === "/" ? path === "/" : path === h || path.startsWith(h + "/");
  };

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
