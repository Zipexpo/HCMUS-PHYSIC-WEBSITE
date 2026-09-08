"use client";

import type { ComponentConfig } from "@puckeditor/core";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
  Menu,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DynamicIcon } from "@/components/admin/icons";
import { LOCALE_LABELS, LOCALES, type LocalizedString, t } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { colorField } from "../fields/color-field";
import { NotificationBell } from "./notification-bell";
import {
  localizedTextareaField,
  localizedTextField,
} from "../fields/localized-text-field";
import { mediaPickerField } from "../fields/media-picker-field";
import { resolveMediaSrc } from "./media-src";

// Giữ nguyên locale đang xem khi điều hướng: URL menu lưu dạng /duong-dan không tiền tố,
// proxy của trang public sẽ ép về locale mặc định (vi) nếu thiếu — nên gắn tiền tố tại đây.
const MEDIA_API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const withLocale = (url: string | null | undefined, locale: string): string => {
  if (!url) return "#";
  if (/^(?:https?:|mailto:|tel:|#)/.test(url)) return url;
  if (/^\/(?:vi|en)(?:\/|$)/.test(url)) return url;
  if (url === "/") return `/${locale}`;
  return `/${locale}${url.startsWith("/") ? url : `/${url}`}`;
};

// Link RA NGOÀI (app khác: physoom, phys-profile…) mở ở TAB MỚI để không rời
// trang Khoa. Đường nội bộ (/duong-dan) thì điều hướng cùng tab như thường.
const isExternal = (url: string | null | undefined): boolean =>
  !!url && /^https?:\/\//i.test(url.trim());

// Hiển thị nhãn của mục trong thanh array của Puck thay vì "item #0".
const labelItemSummary = (
  item: { label?: LocalizedString | string; url?: string },
  index?: number,
): string => {
  const l = item?.label;
  const text = typeof l === "string" ? l : l?.vi || l?.en;
  return text || item?.url || `Mục ${(index ?? 0) + 1}`;
};

type NavbarSubItem = {
  label: LocalizedString;
  url: string;
};

type NavbarMenuChild = {
  label: LocalizedString;
  url: string;
  subChildren: NavbarSubItem[];
};

type NavbarMenuItem = {
  label: LocalizedString;
  url: string;
  children: NavbarMenuChild[];
};

type NavbarSuggestion = { label: LocalizedString; url: string };

function NavbarMenuButton({
  item,
  locale,
  textColor,
  hoverLineColor,
  hoverTextColor,
  isEditing,
}: {
  item: NavbarMenuItem;
  locale: string;
  textColor: string;
  hoverLineColor: string;
  hoverTextColor: string;
  isEditing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = (item.children || []).length > 0;
  const lineColor = hoverLineColor || "#2563eb";
  const onTextHover = hoverTextColor || textColor || "#1e293b";

  // Menu con canh trái mục cha, nên mục nằm gần mép phải (Tiện ích, Cựu sinh
  // viên…) đẩy bảng 220px tràn ra khỏi màn hình — nhìn như bị dán vào mép. Đo
  // sau khi mở rồi lật sang canh phải nếu vượt khung; đo lại từ đầu ở lần mở
  // sau nên đổi cỡ cửa sổ vẫn đúng.
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  useEffect(() => {
    if (!open) {
      setAlignRight(false);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const { right } = el.getBoundingClientRect();
    if (right > window.innerWidth - 8) setAlignRight(true);
  }, [open]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <a
        href={isEditing ? "#" : withLocale(item.url, locale)}
        tabIndex={isEditing ? -1 : undefined}
        onClick={(e) => {
          if (isEditing) e.preventDefault();
        }}
        className="navbar-menu-link relative px-3 py-2 text-sm font-medium inline-block transition-colors"
        style={
          {
            color: textColor || "#1e293b",
            ["--nav-hover" as string]: onTextHover,
            ["--nav-line" as string]: lineColor,
          } as React.CSSProperties
        }
      >
        <span className="relative">
          {t(item.label, locale)}
          <span
            aria-hidden="true"
            className="absolute left-0 right-0 -bottom-1 h-[2px]"
            style={{
              backgroundColor: lineColor,
              transform: open ? "scaleX(1)" : "scaleX(0)",
              transformOrigin: "left",
              transition: "transform 300ms ease-out",
            }}
          />
        </span>
      </a>
      {hasChildren && open && (
        <div
          ref={panelRef}
          className={`absolute ${alignRight ? "right-0" : "left-0"} top-full pt-2 z-50`}
        >
          <div className="min-w-[220px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] shadow-lg overflow-visible">
            <ul role="menu" className="py-1">
              {item.children.map((child, j) => (
                <NavbarChildItem
                  key={j}
                  child={child}
                  locale={locale}
                  hoverLineColor={lineColor}
                  hoverTextColor={onTextHover}
                  isEditing={isEditing}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
      <style>{`
        .navbar-menu-link:hover {
          color: var(--nav-hover);
        }
      `}</style>
    </div>
  );
}

function NavbarChildItem({
  child,
  locale,
  hoverLineColor,
  hoverTextColor,
  isEditing,
}: {
  child: NavbarMenuChild;
  locale: string;
  hoverLineColor: string;
  hoverTextColor: string;
  isEditing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasSubs = (child.subChildren || []).length > 0;

  return (
    <li
      role="none"
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <a
        role="menuitem"
        href={isEditing ? "#" : withLocale(child.url, locale)}
        tabIndex={isEditing ? -1 : undefined}
        target={!isEditing && isExternal(child.url) ? "_blank" : undefined}
        rel={!isEditing && isExternal(child.url) ? "noopener noreferrer" : undefined}
        onClick={(e) => {
          if (isEditing) e.preventDefault();
        }}
        className="navbar-child-link flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-[#202c44]"
        style={
          {
            color: "#1e293b",
            ["--nav-hover" as string]: hoverTextColor,
          } as React.CSSProperties
        }
      >
        <span>{t(child.label, locale)}</span>
        {hasSubs && <ChevronRight className="w-4 h-4 opacity-50" />}
      </a>
      {hasSubs && open && (
        <div className="absolute left-full top-0 pl-1 z-50">
          <div className="min-w-[200px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] shadow-lg">
            <ul role="menu" className="py-1">
              {child.subChildren.map((sub, k) => (
                <li key={k} role="none">
                  <a
                    role="menuitem"
                    href={isEditing ? "#" : withLocale(sub.url, locale)}
                    tabIndex={isEditing ? -1 : undefined}
                    target={!isEditing && isExternal(sub.url) ? "_blank" : undefined}
                    rel={!isEditing && isExternal(sub.url) ? "noopener noreferrer" : undefined}
                    onClick={(e) => {
                      if (isEditing) e.preventDefault();
                    }}
                    className="navbar-child-link block px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-[#202c44] transition-colors"
                    style={
                      {
                        color: "#1e293b",
                        ["--nav-hover" as string]: hoverTextColor,
                      } as React.CSSProperties
                    }
                  >
                    {t(sub.label, locale)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <style>{`
        .navbar-child-link:hover {
          color: var(--nav-hover);
        }
      `}</style>
    </li>
  );
}

function NavbarClient({
  logoSrc,
  logoAlt,
  logoAbbr,
  logoName,
  menuItems,
  bgColor,
  textColor,
  hoverLineColor,
  hoverTextColor,
  showSearch,
  searchPlaceholder,
  searchSuggestions,
  showLanguageSwitcher,
  showNotificationBell,
  isEditing,
}: {
  logoSrc: string;
  logoAlt: string;
  logoAbbr: string;
  logoName: LocalizedString;
  menuItems: NavbarMenuItem[];
  bgColor: string;
  textColor: string;
  hoverLineColor: string;
  hoverTextColor: string;
  showSearch: boolean;
  searchPlaceholder: LocalizedString;
  searchSuggestions: NavbarSuggestion[];
  showLanguageSwitcher: boolean;
  showNotificationBell: boolean;
  isEditing: boolean;
}) {
  const { locale } = useLocale();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Tìm kiếm thật: gõ >=2 ký tự -> gọi API bài viết công khai (debounce 300ms).
  type LiveResult = {
    slug: string;
    title: LocalizedString;
    layoutSlug: string | null;
    publishedAt: string | null;
  };
  const [results, setResults] = useState<LiveResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = window.setTimeout(() => {
      // pageSize lớn: trả HẾT bài khớp (không giới hạn 6); danh sách kết quả có
      // cuộn dọc riêng. Sắp xếp theo ngày đăng mới nhất trước.
      fetch(
        `${MEDIA_API_URL}/posts/public/list?page=1&pageSize=100&search=${encodeURIComponent(q)}`,
      )
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => {
          const items: LiveResult[] = (d.items || []).map(
            (p: {
              slug: string;
              title: LocalizedString;
              publishedAt?: string | null;
              layouts?: { slug: string; isPublished: boolean }[];
            }) => ({
              slug: p.slug,
              title: p.title,
              layoutSlug: p.layouts?.find((l) => l.isPublished)?.slug ?? null,
              publishedAt: p.publishedAt ?? null,
            }),
          );
          items.sort((a, b) =>
            (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
          );
          setResults(items);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(id);
  }, [query]);
  // Tìm kiếm gần đây: lưu localStorage, hiện khi ô tìm kiếm còn trống.
  const RECENT_KEY = "phys-search-recent";
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw) as string[]);
    } catch {
      // ignore malformed storage
    }
  }, []);
  const saveRecent = (q: string) => {
    const term = q.trim();
    if (term.length < 2) return;
    setRecent((prev) => {
      const next = [term, ...prev.filter((x) => x !== term)].slice(0, 6);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore quota / privacy-mode errors
      }
      return next;
    });
  };
  const clearRecent = () => {
    setRecent([]);
    try {
      window.localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
  };
  const [langOpen, setLangOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<Record<number, boolean>>(
    {},
  );

  const swapLocale = (next: string) => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 0 && LOCALES.includes(parts[0] as never))
      parts[0] = next;
    else parts.unshift(next);
    window.location.href = `/${parts.join("/")}${window.location.search}`;
  };

  // Shared language dropdown — rendered under BOTH the mobile and desktop globe
  // buttons (previously only the desktop one had it, so tapping the globe on mobile
  // did nothing).
  const langMenu = langOpen ? (
    <>
      <button
        type="button"
        onClick={() => setLangOpen(false)}
        className="fixed inset-0 z-40 cursor-default"
        aria-label="Close language menu"
      />
      <div className="absolute top-full right-0 mt-1 z-50 min-w-[160px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] shadow-lg overflow-hidden">
        <ul role="menu">
          {LOCALES.map((code) => {
            const isActive = code === locale;
            const itemClass = isActive
              ? "w-full flex items-center gap-2 px-3 py-2 text-sm text-left bg-blue-50 text-blue-700 font-semibold"
              : "w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-slate-50";
            return (
              <li key={code} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLangOpen(false);
                    if (!isEditing && code !== locale) swapLocale(code);
                  }}
                  className={itemClass}
                >
                  <span className="font-mono text-[10px] uppercase opacity-60 w-6 shrink-0">
                    {code}
                  </span>
                  <span>{LOCALE_LABELS[code] || code}</span>
                  {isActive && <Check className="w-4 h-4 ml-auto" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  ) : null;

  return (
    <>
      <nav
        className="flex items-center justify-between px-6 py-3 shadow-sm sticky top-0 z-50"
        style={{ backgroundColor: bgColor || "#ffffff" }}
      >
        <Link
          href={`/${locale}`}
          aria-label="Trang chủ"
          className="flex items-center gap-3 hover:opacity-90 transition-opacity"
        >
          {logoAbbr ? (
            <span className="flex items-baseline gap-2 leading-none">
              <span className="text-3xl md:text-4xl font-black tracking-tight text-[#1e3a8a]">
                {logoAbbr}
              </span>
              {t(logoName, locale) ? (
                <span className="text-base md:text-xl font-bold text-slate-500">
                  {t(logoName, locale)}
                </span>
              ) : null}
            </span>
          ) : logoSrc ? (
            <img
              src={resolveMediaSrc(logoSrc)}
              alt={logoAlt || "Logo"}
              className="h-10 object-contain"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="h-10 w-10 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
          )}
        </Link>
        <div className="flex items-center gap-1">
          <div className="hidden lg:flex items-center gap-1">
            {(menuItems || []).map((item: NavbarMenuItem, i: number) => (
              <NavbarMenuButton
                key={i}
                item={item}
                locale={locale}
                textColor={textColor}
                hoverLineColor={hoverLineColor}
                hoverTextColor={hoverTextColor}
                isEditing={isEditing}
              />
            ))}
          </div>
          <div
            className={`lg:hidden order-3 flex items-center gap-1 transition-[max-width,opacity,margin] duration-300 ease-out ${
              mobileMenuOpen
                ? // đang thu gọn theo nút hamburger: cắt phần tràn cho gọn
                  "max-w-0 opacity-0 ml-0 pointer-events-none overflow-hidden"
                : // trạng thái thường: overflow-visible để dropdown globe/chuông KHÔNG
                  // bị cắt. KHÔNG dùng translate-x-* (Tailwind v4 phát ra thuộc tính
                  // `translate:` tạo containing-block khiến panel `fixed` của chuông
                  // neo nhầm vào hàng icon thay vì viewport).
                  "max-w-[120px] opacity-100 overflow-visible"
            }`}
          >
            {showSearch && (
              <button
                type="button"
                onClick={() => !isEditing && setSearchOpen(true)}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-[#202c44] transition-colors"
                style={{ color: textColor || "#1e293b" }}
                aria-label="Search"
                tabIndex={mobileMenuOpen ? -1 : undefined}
              >
                <Search className="w-5 h-5" />
              </button>
            )}
            {showNotificationBell && !isEditing && (
              <NotificationBell color={textColor || "#1e293b"} />
            )}
            {showLanguageSwitcher && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => !isEditing && setLangOpen((p) => !p)}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-[#202c44] transition-colors"
                  style={{ color: textColor || "#1e293b" }}
                  aria-haspopup="menu"
                  aria-expanded={langOpen}
                  aria-label="Language"
                  tabIndex={mobileMenuOpen ? -1 : undefined}
                >
                  <Globe className="w-5 h-5" />
                </button>
                {langMenu}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => !isEditing && setMobileMenuOpen((p) => !p)}
            className="lg:hidden order-4 ml-1 w-9 h-9 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-[#202c44] transition-all duration-300"
            style={{ color: textColor || "#1e293b" }}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            <span className="relative w-6 h-6 block">
              <Menu
                className={`absolute inset-0 w-6 h-6 transition-all duration-300 ${
                  mobileMenuOpen
                    ? "opacity-0 rotate-90 scale-75"
                    : "opacity-100 rotate-0 scale-100"
                }`}
              />
              <X
                className={`absolute inset-0 w-6 h-6 transition-all duration-300 ${
                  mobileMenuOpen
                    ? "opacity-100 rotate-0 scale-100"
                    : "opacity-0 -rotate-90 scale-75"
                }`}
              />
            </span>
          </button>
          {showSearch && (
            <button
              type="button"
              onClick={() => !isEditing && setSearchOpen(true)}
              className="hidden lg:flex ml-2 w-9 h-9 rounded-full items-center justify-center hover:bg-slate-100 dark:hover:bg-[#202c44] transition-colors"
              style={{ color: textColor || "#1e293b" }}
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
          {showNotificationBell && !isEditing && (
            <div className="hidden lg:block ml-1">
              <NotificationBell color={textColor || "#1e293b"} />
            </div>
          )}
          {showLanguageSwitcher && (
            <div className="relative hidden lg:block">
              <button
                type="button"
                onClick={() => !isEditing && setLangOpen((p) => !p)}
                className="ml-1 w-9 h-9 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-[#202c44] transition-colors"
                style={{ color: textColor || "#1e293b" }}
                aria-haspopup="menu"
                aria-expanded={langOpen}
                aria-label="Language"
              >
                <Globe className="w-5 h-5" />
              </button>
              {langMenu}
            </div>
          )}
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 top-[60px] z-40">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 bg-black/0"
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div className="absolute top-0 left-0 h-full w-full bg-white dark:bg-[#1a2436] shadow-xl flex flex-col overflow-y-auto animate-[slideDown_0.25s_ease]">
            <nav className="flex flex-col px-5 py-2">
              {(menuItems || []).map((item: NavbarMenuItem, i: number) => {
                const hasChildren =
                  Array.isArray(item.children) && item.children.length > 0;
                const expanded = !!mobileExpanded[i];
                if (hasChildren) {
                  return (
                    <div key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          setMobileExpanded((m) => ({ ...m, [i]: !m[i] }))
                        }
                        className="w-full flex items-center justify-between py-5 text-left text-[17px] font-medium text-slate-800 dark:text-slate-100"
                      >
                        <span>{t(item.label as never, locale)}</span>
                        <ChevronRight
                          className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                        />
                      </button>
                      {expanded ? (
                        <div className="pb-3 pl-3 flex flex-col">
                          {item.children.map(
                            (child: NavbarMenuChild, ci: number) => (
                              <a
                                key={ci}
                                href={withLocale(child.url, locale)}
                                target={isExternal(child.url) ? "_blank" : undefined}
                                rel={isExternal(child.url) ? "noopener noreferrer" : undefined}
                                onClick={() => setMobileMenuOpen(false)}
                                className="py-2 text-[15px] text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300"
                              >
                                {t(child.label as never, locale)}
                              </a>
                            ),
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <a
                    key={i}
                    href={withLocale(item.url, locale)}
                    onClick={() => setMobileMenuOpen(false)}
                    className="py-5 text-[17px] font-medium text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    {t(item.label as never, locale)}
                  </a>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {searchOpen && (
        <div
          className="fixed inset-0 z-[9999] animate-[fadeIn_0.25s_ease]"
          style={{ backgroundColor: "#0c2340f2" }}
        >
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-8 h-8" />
          </button>
          <div className="flex flex-col items-center justify-start pt-[18vh] px-6 animate-[slideUp_0.35s_ease]">
            <p className="text-white/50 text-xs uppercase tracking-[0.25em] mb-6">
              Tìm kiếm
            </p>
            <div className="w-full max-w-2xl relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRecent(query);
                }}
                placeholder={t(searchPlaceholder, locale) || "Nhập từ khóa..."}
                // Ô nhập dạng hộp sáng rõ (nền trắng mờ + viền rõ + placeholder sáng)
                // để dễ nhìn khi gõ trên nền navy tối, thay cho gạch chân mờ.
                className="w-full bg-white/10 rounded-2xl border-2 border-white/40 focus:border-white focus:bg-white/15 text-white text-2xl md:text-3xl px-6 py-4 pr-16 outline-none placeholder:text-white/60 transition-colors"
              />
              <Search className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 text-white/60 pointer-events-none" />
            </div>
            {query.trim().length >= 2 && (
              <div className="mt-8 w-full max-w-2xl">
                <p className="text-white/40 text-xs uppercase tracking-[0.2em] mb-4">
                  {searching
                    ? locale === "en"
                      ? "Searching…"
                      : "Đang tìm…"
                    : locale === "en"
                      ? `Results (${results.length})`
                      : `Kết quả (${results.length})`}
                </p>
                <ul className="divide-y divide-white/10 max-h-[50vh] overflow-y-auto pr-1">
                  {results.map((r) => (
                    <li key={r.slug}>
                      <a
                        href={`/${locale}/${r.layoutSlug ?? `tin-tuc/${r.slug}`}`}
                        onClick={() => saveRecent(query)}
                        className="block py-3 text-white/80 hover:text-white transition-colors"
                      >
                        {t(r.title, locale)}
                      </a>
                    </li>
                  ))}
                  {!searching && results.length === 0 && (
                    <li className="py-3 text-white/40 text-sm">
                      {locale === "en"
                        ? "No matching articles."
                        : "Không tìm thấy bài viết phù hợp."}
                    </li>
                  )}
                </ul>
              </div>
            )}
            {query.trim().length < 2 && recent.length > 0 && (
              <div className="mt-10 w-full max-w-2xl">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-white/40 text-xs uppercase tracking-[0.2em]">
                    {locale === "en" ? "Recent searches" : "Tìm kiếm gần đây"}
                  </p>
                  <button
                    type="button"
                    onClick={clearRecent}
                    className="text-white/40 hover:text-white/80 text-xs"
                  >
                    {locale === "en" ? "Clear" : "Xóa"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {recent.map((term, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setQuery(term)}
                      className="px-5 py-2.5 rounded-full border border-white/20 text-white/70 hover:text-white hover:border-white/50 hover:bg-white/5 transition-all text-sm"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {query.trim().length < 2 && searchSuggestions?.length > 0 && (
              <div className="mt-10 w-full max-w-2xl">
                <p className="text-white/40 text-xs uppercase tracking-[0.2em] mb-4">
                  {locale === "en" ? "Suggestions" : "Gợi ý"}
                </p>
                <div className="flex flex-wrap gap-3">
                  {searchSuggestions.map((s: NavbarSuggestion, i: number) => (
                    <a
                      key={i}
                      href={withLocale(s.url, locale)}
                      className="px-5 py-2.5 rounded-full border border-white/20 text-white/70 hover:text-white hover:border-white/50 hover:bg-white/5 transition-all text-sm"
                    >
                      {t(s.label, locale)}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export const Navbar: ComponentConfig<{
  logoSrc: string;
  logoAlt: string;
  logoAbbr: string;
  logoName: LocalizedString;
  menuItems: NavbarMenuItem[];
  bgColor: string;
  textColor: string;
  hoverLineColor: string;
  hoverTextColor: string;
  showSearch: boolean;
  searchPlaceholder: LocalizedString;
  searchSuggestions: NavbarSuggestion[];
  showLanguageSwitcher: boolean;
  showNotificationBell: boolean;
}> = {
  label: "Navbar",
  defaultProps: {
    logoSrc: "",
    logoAlt: "Logo",
    logoAbbr: "",
    logoName: { vi: "", en: "" },
    showLanguageSwitcher: true,
    menuItems: [
      {
        label: { vi: "Giới thiệu", en: "About" },
        url: "/gioi-thieu",
        children: [],
      },
      {
        label: { vi: "Đào tạo", en: "Programs" },
        url: "/dao-tao",
        children: [
          {
            label: { vi: "Đại học", en: "Undergraduate" },
            url: "/dao-tao/dai-hoc",
            subChildren: [],
          },
          {
            label: { vi: "Sau đại học", en: "Graduate" },
            url: "/dao-tao/sau-dai-hoc",
            subChildren: [],
          },
          {
            label: { vi: "Quy chế", en: "Regulations" },
            url: "/dao-tao/quy-che",
            subChildren: [],
          },
        ],
      },
      {
        label: { vi: "Nghiên cứu", en: "Research" },
        url: "/nghien-cuu",
        children: [],
      },
      {
        label: { vi: "Liên hệ", en: "Contact" },
        url: "/lien-he",
        children: [],
      },
    ],
    bgColor: "#ffffff",
    textColor: "#1e293b",
    hoverLineColor: "#2563eb",
    hoverTextColor: "#2563eb",
    showSearch: true,
    showNotificationBell: true,
    searchPlaceholder: { vi: "Nhập từ khóa...", en: "Enter keyword..." },
    searchSuggestions: [
      {
        label: { vi: "Tuyển sinh", en: "Admissions" },
        url: "/tuyen-sinh",
      },
      {
        label: { vi: "Chương trình đào tạo", en: "Programs" },
        url: "/dao-tao",
      },
      { label: { vi: "Nghiên cứu", en: "Research" }, url: "/nghien-cuu" },
      { label: { vi: "Liên hệ", en: "Contact" }, url: "/lien-he" },
    ],
  },
  fields: {
    logoSrc: mediaPickerField("Logo"),
    logoAlt: { type: "text", label: "Logo Alt" },
    logoAbbr: {
      type: "text",
      label: "Logo abbreviation (e.g. VLTH) — overrides the image logo",
    },
    logoName: localizedTextField("Logo name (shown beside the abbreviation)"),
    menuItems: {
      type: "array",
      label: "Menu Items",
      getItemSummary: labelItemSummary,
      arrayFields: {
        label: localizedTextField("Label"),
        url: { type: "text", label: "URL" },
        children: {
          type: "array",
          label: "Dropdown (level 2)",
          getItemSummary: labelItemSummary,
          arrayFields: {
            label: localizedTextField("Label"),
            url: { type: "text", label: "URL" },
            subChildren: {
              type: "array",
              label: "Sub-dropdown (level 3)",
              getItemSummary: labelItemSummary,
              arrayFields: {
                label: localizedTextField("Label"),
                url: { type: "text", label: "URL" },
              },
            },
          },
        },
      },
    },
    bgColor: colorField("Background Color"),
    textColor: colorField("Text Color"),
    hoverLineColor: colorField("Hover Line Color"),
    hoverTextColor: colorField("Hover Text Color"),
    showSearch: {
      type: "radio",
      label: "Show Search",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
    searchPlaceholder: localizedTextField("Search Placeholder"),
    searchSuggestions: {
      type: "array",
      label: "Search Suggestions",
      getItemSummary: labelItemSummary,
      arrayFields: {
        label: localizedTextField("Label"),
        url: { type: "text", label: "URL" },
      },
    },
    showLanguageSwitcher: {
      type: "radio",
      label: "Show Language Switcher",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
    showNotificationBell: {
      type: "radio",
      label: "Show Notification Bell",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
  },
  render: ({
    logoSrc,
    logoAlt,
    logoAbbr,
    logoName,
    menuItems,
    bgColor,
    textColor,
    hoverLineColor,
    hoverTextColor,
    showSearch,
    searchPlaceholder,
    searchSuggestions,
    showLanguageSwitcher,
    showNotificationBell,
    puck,
  }) => (
    <NavbarClient
      logoSrc={logoSrc}
      logoAlt={logoAlt}
      logoAbbr={logoAbbr}
      logoName={logoName}
      menuItems={menuItems}
      bgColor={bgColor}
      textColor={textColor}
      hoverLineColor={hoverLineColor}
      hoverTextColor={hoverTextColor}
      showSearch={showSearch}
      searchPlaceholder={searchPlaceholder}
      searchSuggestions={searchSuggestions}
      showLanguageSwitcher={showLanguageSwitcher}
      showNotificationBell={showNotificationBell ?? true}
      isEditing={!!puck?.isEditing}
    />
  ),
};

export const NavLinks: ComponentConfig<{
  links: { label: LocalizedString; url: string }[];
  direction: string;
  showArrow: boolean;
  fontSize: string;
  color: string;
  hoverColor: string;
}> = {
  label: "Nav Links",
  defaultProps: {
    links: [
      { label: { vi: "Liên kết 1", en: "Link 1" }, url: "#" },
      { label: { vi: "Liên kết 2", en: "Link 2" }, url: "#" },
      { label: { vi: "Liên kết 3", en: "Link 3" }, url: "#" },
    ],
    direction: "vertical",
    showArrow: true,
    fontSize: "base",
    color: "#374151",
    hoverColor: "#2563eb",
  },
  fields: {
    links: {
      type: "array",
      label: "Links",
      getItemSummary: labelItemSummary,
      arrayFields: {
        label: localizedTextField("Label"),
        url: { type: "text", label: "URL" },
      },
    },
    direction: {
      type: "select",
      label: "Direction",
      options: [
        { label: "Vertical", value: "vertical" },
        { label: "Horizontal", value: "horizontal" },
      ],
    },
    showArrow: {
      type: "radio",
      label: "Show Arrow",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
    fontSize: {
      type: "select",
      label: "Font Size",
      options: [
        { label: "Small", value: "sm" },
        { label: "Base", value: "base" },
        { label: "Large", value: "lg" },
      ],
    },
    color: colorField("Text Color"),
    hoverColor: colorField("Hover Text Color"),
  },
  render: ({
    links,
    direction,
    showArrow,
    fontSize,
    color,
    hoverColor,
    puck,
  }) => (
    <NavLinksRender
      links={links || []}
      direction={direction}
      showArrow={showArrow}
      fontSize={fontSize}
      color={color}
      hoverColor={hoverColor}
      isEditing={!!puck?.isEditing}
    />
  ),
};

function NavLinksRender({
  links,
  direction,
  showArrow,
  fontSize,
  color,
  hoverColor,
  isEditing,
}: {
  links: { label: LocalizedString; url: string }[];
  direction: string;
  showArrow: boolean;
  fontSize: string;
  color: string;
  hoverColor: string;
  isEditing: boolean;
}) {
  const { locale } = useLocale();
  const isVertical = direction !== "horizontal";
  const sizes: Record<string, string> = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
  };
  return (
    <div className={isVertical ? "space-y-1" : "flex flex-wrap gap-4"}>
      {links.map((link, i) => (
        <a
          key={i}
          href={isEditing ? "#" : withLocale(link.url, locale)}
          tabIndex={isEditing ? -1 : undefined}
          className={`navlink-row flex items-center justify-between py-2 ${sizes[fontSize] || "text-base"} font-medium transition-colors`}
          style={
            {
              color: color || "#374151",
              ["--navlink-hover" as string]: hoverColor || "#2563eb",
            } as React.CSSProperties
          }
        >
          <span>{t(link.label, locale)}</span>
          {showArrow !== false && (
            <span className="text-slate-400 dark:text-slate-500 ml-2">
              &raquo;
            </span>
          )}
        </a>
      ))}
      <style>{`
        .navlink-row:hover {
          color: var(--navlink-hover);
        }
      `}</style>
    </div>
  );
}

export const QuickLinks: ComponentConfig<{
  links: {
    icon: string;
    label: LocalizedString;
    url: string;
    color: string;
  }[];
  columns: string;
}> = {
  label: "Quick Links",
  defaultProps: {
    links: [
      {
        icon: "language",
        label: { vi: "Cổng thông tin", en: "Portal" },
        url: "#",
        color: "#2563eb",
      },
      {
        icon: "local_library",
        label: { vi: "Thư viện", en: "Library" },
        url: "#",
        color: "#7c3aed",
      },
      {
        icon: "mail",
        label: { vi: "Email", en: "Email" },
        url: "#",
        color: "#dc2626",
      },
      {
        icon: "school",
        label: { vi: "E-Learning", en: "E-Learning" },
        url: "#",
        color: "#059669",
      },
      {
        icon: "event",
        label: { vi: "Lịch học", en: "Schedule" },
        url: "#",
        color: "#d97706",
      },
      {
        icon: "support_agent",
        label: { vi: "Hỗ trợ", en: "Support" },
        url: "#",
        color: "#0891b2",
      },
    ],
    columns: "6",
  },
  fields: {
    links: {
      type: "array",
      label: "Links",
      getItemSummary: labelItemSummary,
      arrayFields: {
        icon: { type: "text", label: "Icon (Material Symbol)" },
        label: localizedTextField("Label"),
        url: { type: "text", label: "URL" },
        color: colorField("Color"),
      },
    },
    columns: {
      type: "select",
      label: "Columns",
      options: [
        { label: "3", value: "3" },
        { label: "4", value: "4" },
        { label: "5", value: "5" },
        { label: "6", value: "6" },
      ],
    },
  },
  render: ({ links, columns, puck }) => (
    <QuickLinksRender
      links={links || []}
      columns={columns}
      isEditing={!!puck?.isEditing}
    />
  ),
};

function QuickLinksRender({
  links,
  columns,
  isEditing,
}: {
  links: {
    icon: string;
    label: LocalizedString;
    url: string;
    color: string;
  }[];
  columns: string;
  isEditing: boolean;
}) {
  const { locale } = useLocale();
  const cols = parseInt(columns, 10) || 6;
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {links.map((link, i) => (
        <a
          key={i}
          href={isEditing ? "#" : withLocale(link.url, locale)}
          tabIndex={isEditing ? -1 : undefined}
          className="flex flex-col items-center gap-2 py-4 rounded-lg hover:bg-slate-50 dark:hover:bg-[#202c44] transition-colors"
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white"
            style={{ backgroundColor: link.color || "#3b82f6" }}
          >
            <DynamicIcon name={link.icon || "link"} className="w-5 h-5" />
          </div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300 text-center">
            {t(link.label, locale)}
          </span>
        </a>
      ))}
    </div>
  );
}

export const SocialIcons: ComponentConfig<{
  icons: { icon: string; url: string; color: string; visible?: boolean }[];
  size: string;
  gap: string;
  alignment: string;
  variant: string;
}> = {
  label: "Social Icons",
  defaultProps: {
    icons: [
      { icon: "facebook", url: "#", color: "#1877f2", visible: true },
      { icon: "youtube", url: "#", color: "#ff0000", visible: true },
      { icon: "tiktok", url: "#", color: "#010101", visible: true },
      { icon: "instagram", url: "#", color: "#e4405f", visible: false },
      { icon: "mail", url: "#", color: "#ea4335", visible: true },
    ],
    size: "md",
    gap: "sm",
    alignment: "left",
    variant: "filled",
  },
  fields: {
    icons: {
      type: "array",
      label: "Icons",
      getItemSummary: (item: { icon?: string }) => item?.icon || "icon",
      arrayFields: {
        icon: {
          type: "text",
          label:
            "Icon (facebook / youtube / tiktok / instagram / twitter, tên Material Symbol, hoặc URL ảnh)",
        },
        url: { type: "text", label: "URL" },
        color: colorField("Color"),
        visible: {
          type: "radio",
          label: "Hiển thị",
          options: [
            { label: "Hiện", value: true },
            { label: "Ẩn", value: false },
          ],
        },
      },
    },
    size: {
      type: "select",
      label: "Size",
      options: [
        { label: "Small", value: "sm" },
        { label: "Medium", value: "md" },
        { label: "Large", value: "lg" },
      ],
    },
    gap: {
      type: "select",
      label: "Gap",
      options: [
        { label: "Small", value: "sm" },
        { label: "Medium", value: "md" },
        { label: "Large", value: "lg" },
      ],
    },
    alignment: {
      type: "select",
      label: "Alignment",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
    variant: {
      type: "select",
      label: "Variant",
      options: [
        { label: "Filled (color bg)", value: "filled" },
        { label: "Flat (icon only)", value: "flat" },
      ],
    },
  },
  render: ({ icons, size, gap, alignment, variant, puck }) => {
    const sizes: Record<string, { btn: string; icon: string; px: number }> = {
      sm: { btn: "w-8 h-8", icon: "text-base", px: 20 },
      md: { btn: "w-11 h-11", icon: "text-xl", px: 24 },
      lg: { btn: "w-12 h-12", icon: "text-2xl", px: 28 },
    };
    const gaps: Record<string, string> = {
      sm: "gap-2",
      md: "gap-3",
      lg: "gap-4",
    };
    const aligns: Record<string, string> = {
      left: "justify-start",
      center: "justify-center",
      right: "justify-end",
    };
    const s = sizes[size] || sizes.md;
    const isFlat = variant === "flat";

    const renderIcon = (icon: string, fillColor: string) => {
      const svgProps = {
        "aria-hidden": true as const,
        viewBox: "0 0 30 30",
        fill: fillColor,
        width: s.px,
        height: s.px,
      };
      if (icon === "facebook") {
        return (
          <svg {...svgProps} role="img" aria-label="Facebook">
            <title>Facebook</title>
            <path d="M25.81.5H3.689A3.7 3.7 0 0 0 0 4.183v22.125a3.7 3.7 0 0 0 3.688 3.688h11.187V19.42h-3.531v-4.608h3.531v-2.31c0-3.56 2.629-6.346 5.982-6.346h3.257v5.203H21.2c-.762 0-.99.435-.99 1.04v2.413h3.903v4.608h-3.902v10.575h5.599a3.7 3.7 0 0 0 3.687-3.688V4.183A3.699 3.699 0 0 0 25.81.5" />
          </svg>
        );
      }
      if (icon === "youtube") {
        return (
          <svg
            {...svgProps}
            viewBox="0 0 24 24"
            role="img"
            aria-label="YouTube"
          >
            <title>YouTube</title>
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
          </svg>
        );
      }
      if (icon === "twitter") {
        return (
          <svg
            {...svgProps}
            viewBox="0 0 24 24"
            role="img"
            aria-label="Twitter"
          >
            <title>Twitter</title>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        );
      }
      if (icon === "tiktok") {
        return (
          <svg {...svgProps} viewBox="0 0 24 24" role="img" aria-label="TikTok">
            <title>TikTok</title>
            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
          </svg>
        );
      }
      if (icon === "instagram") {
        return (
          <svg
            {...svgProps}
            viewBox="0 0 24 24"
            role="img"
            aria-label="Instagram"
          >
            <title>Instagram</title>
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
          </svg>
        );
      }
      if (/^(https?:|\/uploads)/.test(icon || "")) {
        return (
          <img
            src={resolveMediaSrc(icon)}
            alt=""
            style={{ width: s.px, height: s.px, objectFit: "contain" }}
          />
        );
      }
      return (
        <DynamicIcon
          name={icon || "link"}
          style={{ width: s.px, height: s.px, color: fillColor }}
        />
      );
    };

    return (
      <div
        className={`flex items-center ${gaps[gap] || "gap-3"} ${aligns[alignment] || "justify-start"}`}
      >
        {(icons || [])
          .filter((item) => item.visible !== false)
          .map(
          (
            item: {
              icon: string;
              url: string;
              color: string;
              visible?: boolean;
            },
            i: number,
          ) =>
            isFlat ? (
              <a
                key={i}
                href={puck?.isEditing ? "#" : item.url || "#"}
                tabIndex={puck?.isEditing ? -1 : undefined}
                aria-label={`Liên kết ${item.icon || "mạng xã hội"}`}
                className="hover:opacity-70 transition-opacity"
              >
                {renderIcon(item.icon, item.color || "#ffffff")}
              </a>
            ) : (
              <a
                key={i}
                href={puck?.isEditing ? "#" : item.url || "#"}
                tabIndex={puck?.isEditing ? -1 : undefined}
                aria-label={`Liên kết ${item.icon || "mạng xã hội"}`}
                className={`${s.btn} rounded-full flex items-center justify-center text-white hover:opacity-80 transition-opacity`}
                style={{ backgroundColor: item.color || "#3b82f6" }}
              >
                {renderIcon(item.icon, "#ffffff")}
              </a>
            ),
        )}
      </div>
    );
  },
};

export const LanguageSwitcher: ComponentConfig<{
  variant: string;
  textColor: string;
}> = {
  label: "Language Switcher",
  defaultProps: {
    variant: "globe",
    textColor: "#0c2340",
  },
  fields: {
    variant: {
      type: "select",
      label: "Variant",
      options: [
        { label: "Globe + label", value: "globe" },
        { label: "Compact code", value: "compact" },
      ],
    },
    textColor: colorField("Text Color"),
  },
  render: ({ variant, textColor, puck }) => (
    <LanguageSwitcherClient
      variant={variant}
      textColor={textColor}
      isEditing={!!puck?.isEditing}
    />
  ),
};

function LanguageSwitcherClient({
  variant,
  textColor,
  isEditing,
}: {
  variant: string;
  textColor: string;
  isEditing: boolean;
}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);

  const swapLocale = (next: string) => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 0) parts[0] = next;
    else parts.push(next);
    const search = window.location.search;
    window.location.href = `/${parts.join("/")}${search}`;
  };

  const localeLabel =
    variant === "compact"
      ? locale.toUpperCase()
      : LOCALE_LABELS[locale] || locale.toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !isEditing && setOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md hover:bg-slate-100 dark:hover:bg-[#202c44] transition-colors"
        style={{ color: textColor || "#0c2340" }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Globe className="w-[18px] h-[18px]" />
        {variant !== "compact" && <span>{localeLabel}</span>}
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 opacity-60" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close"
          />
          <div className="absolute top-full right-0 mt-1 z-50 min-w-[160px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] shadow-lg overflow-hidden">
            <ul role="menu">
              {LOCALE_OPTIONS.map((opt) => (
                <li key={opt.code} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      if (opt.code !== locale) swapLocale(opt.code);
                    }}
                    className={
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors " +
                      (opt.code === locale
                        ? "bg-blue-50 text-blue-700 font-semibold"
                        : "text-slate-700 hover:bg-slate-50")
                    }
                  >
                    <span className="font-mono text-[10px] uppercase opacity-60 w-6 shrink-0">
                      {opt.code}
                    </span>
                    <span>{opt.label}</span>
                    {opt.code === locale && (
                      <Check className="w-4 h-4 ml-auto" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

const LOCALE_OPTIONS = [
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
];
