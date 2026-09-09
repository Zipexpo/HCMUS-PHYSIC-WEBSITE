"use client";

import type { ComponentConfig } from "@puckeditor/core";
import { resolveMediaUrl } from "@/lib/api";
import { type LocalizedString, t } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { localizedSummary } from "../fields/item-summary";
import { localizedTextField } from "../fields/localized-text-field";
import { localizedRichTextField } from "../fields/localized-rich-text-field";
import { mediaPickerField } from "../fields/media-picker-field";
import { LegacyHtmlRender } from "./post-placeholders";

// ── StaffProfileEditorial ───────────────────────────────────────────────────
// Hồ sơ giảng viên kiểu tạp chí: nửa trên nền đen, nửa dưới nền trắng ngà, chữ
// tên dùng `mix-blend-difference` nên tự đảo màu khi vắt ngang ranh giới hai
// nền. Tiêu đề dùng Playfair Display — font ĐÃ self-host sẵn trong dự án
// (--font-playfair), không import Google Fonts để khỏi phụ thuộc mạng lúc build.
//
// Mọi mục đều tự ẩn khi bỏ trống, nên trang mới chuyển sang (chỉ có ảnh + nội
// dung cũ) vẫn hiện gọn; biên tập viên điền dần thì trang tự đầy lên.

const INK = "#111111";
const PAPER = "#F9F9F6";

/** INK dạng rgba — phủ màn tối lên ảnh nền hero để chữ blend vẫn đọc được. */
const inkVeil = (alpha: number) => {
  const h = INK.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type Entry = { title: LocalizedString; desc: LocalizedString };
/** Mục tự đặt tên (Học vấn, Major, Giải thưởng…) — gom theo `section`. */
type Extra = {
  section: LocalizedString;
  title: LocalizedString;
  desc: LocalizedString;
};
type Project = {
  category: LocalizedString;
  title: LocalizedString;
  desc: LocalizedString;
};
type Publication = {
  year: string;
  title: LocalizedString;
  meta: LocalizedString;
  url: string;
};

type Props = {
  photo: string;
  photoFilter: boolean;
  // Ảnh nền hero — non-optional như `photo` để khớp CustomField của mediaPickerField.
  heroBg: string;
  eyebrow: LocalizedString;
  name: LocalizedString;
  nameLines?: { text: LocalizedString }[];
  intro: LocalizedString;
  orcid?: string;
  scopus?: string;
  googleScholar?: string;
  researcherId?: string;
  email?: string;
  /** 'compact' (mặc định): ảnh nhỏ, hero gọn trên điện thoại. 'full': ảnh lớn như cũ. */
  heroLayout?: "compact" | "full";
  researchTitle: LocalizedString;
  research?: Entry[];
  teachingTitle: LocalizedString;
  teaching?: Entry[];
  extras?: Extra[];
  projectsTitle: LocalizedString;
  projects?: Project[];
  pubsTitle: LocalizedString;
  publications?: Publication[];
  pubsMoreUrl: string;
  pubsMoreLabel: LocalizedString;
  contentTitle: LocalizedString;
  html: LocalizedString;
};

/** Tiêu đề mục: chữ serif hoa + đường kẻ chạy hết phần còn lại. */
function RuleHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-5 mb-2">
      <h2
        className="text-2xl md:text-3xl text-gray-900 uppercase tracking-wider"
        style={{ fontFamily: "var(--font-playfair)" }}
      >
        {children}
      </h2>
      <div className="h-px bg-gray-300 flex-grow" />
    </div>
  );
}

function EntryList({ items, tx }: { items: Entry[]; tx: (v: LocalizedString) => string }) {
  return (
    <ul className="space-y-2.5 font-light text-gray-600">
      {items.map((it, i) => (
        <li key={`${tx(it.title)}-${i}`} className="flex flex-col">
          <span className="text-gray-900 text-lg font-medium mb-1.5">
            {tx(it.title)}
          </span>
          {tx(it.desc) ? (
            <span className="leading-relaxed">{tx(it.desc)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// Tách học vị (ThS/TS/PGS.TS/GS.TS/GS/PGS/CN) ra khỏi tên: học vị hiển thị ở phần
// đệm (eyebrow), tên chỉ còn đúng tên người → gọn 1 hàng. Dữ liệu cũ dính "THS. …"
// vào tên; chuẩn hoá lúc HIỂN THỊ nên không phải chạy lại migration cho 135 trang.
const HOC_VI_RE = /^(gs\s*\.?\s*ts|pgs\s*\.?\s*ts|gs|pgs|ts|ths|cn)\s*\.?\s+/i;
const HOC_VI_DAY: Record<string, string> = {
  gsts: "Giáo sư, Tiến sĩ",
  pgsts: "Phó Giáo sư, Tiến sĩ",
  gs: "Giáo sư",
  pgs: "Phó Giáo sư",
  ts: "Tiến sĩ",
  ths: "Thạc sĩ",
  cn: "Cử nhân",
};
function tachHocVi(lines: string[]): { ten: string; hocVi: string } {
  const full = lines.join(" ").replace(/\s+/g, " ").trim();
  const m = full.match(HOC_VI_RE);
  if (!m) return { ten: full, hocVi: "" };
  const key = m[1].toLowerCase().replace(/[.\s]/g, "");
  return { ten: full.slice(m[0].length).trim(), hocVi: HOC_VI_DAY[key] ?? "" };
}

// Mục nào là "quá trình đào tạo" (để tự kéo lên hero khi trống giới thiệu). Khớp
// nhãn `section` mà biên tập viên đặt: Học vấn / Quá trình đào tạo / Education…
const DAO_TAO_RE =
  /học vấn|học vị|quá trình đào tạo|đào tạo|education|academic|qualification/i;

function StaffProfileEditorialRender(props: Props) {
  const { locale } = useLocale();
  const tx = (v: LocalizedString) => t(v, locale) || "";

  const photo = resolveMediaUrl(props.photo || "");

  // Hai chế độ hero — khác nhau CHỈ ở cỡ ẢNH trên điện thoại (desktop như nhau,
  // vì than phiền "ảnh quá to" nằm ở điện thoại). `compact` (mặc định) thu ảnh
  // ~9rem cho hero gọn còn ~nửa màn; `full` giữ ảnh lớn ~15rem như cũ. Giữ NGUYÊN
  // bố cục xếp dọc + nội dung tràn hết bề ngang bên dưới, nên trang nào có đoạn
  // giới thiệu/học vấn DÀI vẫn đọc thoải mái (không bị bó vào cột hẹp).
  const compact = (props.heroLayout ?? "compact") !== "full";
  const heroWrapCls = compact
    ? "max-w-7xl mx-auto px-6 sm:px-12 pt-10 md:pt-16 pb-12 md:pb-24 flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-12"
    : "max-w-7xl mx-auto px-6 sm:px-12 pt-12 md:pt-16 pb-16 md:pb-24 flex flex-col md:flex-row items-start gap-10 md:gap-12";
  const photoWrapCls = compact
    ? "w-full max-w-[9rem] sm:max-w-[11rem] mx-auto md:mx-0 md:max-w-none md:w-4/12 shrink-0 z-10"
    : "w-full max-w-[15rem] sm:max-w-xs mx-auto md:max-w-none md:w-4/12 shrink-0 z-10";
  const nameCls = "text-4xl md:text-5xl uppercase leading-tight mb-5";

  const lines = (props.nameLines ?? [])
    .map((l) => tx(l.text))
    .filter((s) => s.trim());
  const nameLines = lines.length ? lines : [tx(props.name)].filter(Boolean);
  const { ten: tenHienThi, hocVi: hocViDem } = tachHocVi(nameLines);

  const research = (props.research ?? []).filter((e) => tx(e.title).trim());
  const teaching = (props.teaching ?? []).filter((e) => tx(e.title).trim());

  // Nghiên cứu / Giảng dạy / các mục tự đặt tên đều đổ chung vào một lưới, mục
  // nào trống thì không sinh cột. Mục tự đặt gom theo tên `section`, giữ thứ tự
  // xuất hiện lần đầu.
  const groups = new Map<string, Entry[]>();
  for (const e of props.extras ?? []) {
    const sec = tx(e.section).trim();
    if (!sec || !tx(e.title).trim()) continue;
    groups.set(sec, [...(groups.get(sec) ?? []), { title: e.title, desc: e.desc }]);
  }

  // Quá trình đào tạo: khi KHÔNG có đoạn giới thiệu, kéo mục "Học vấn" lên lấp
  // khoảng trống bên phải ảnh ở hero (thay vì để trống), rồi bỏ khỏi lưới cột
  // để không lặp. Có giới thiệu thì để nguyên như cũ (đào tạo nằm dưới lưới cột).
  const coGioiThieu = !!tx(props.intro).trim();
  let heroDaoTaoTitle = "";
  const heroDaoTao: Entry[] = [];
  if (!coGioiThieu) {
    for (const key of [...groups.keys()]) {
      if (DAO_TAO_RE.test(key)) {
        heroDaoTaoTitle ||= key;
        heroDaoTao.push(...(groups.get(key) ?? []));
        groups.delete(key);
      }
    }
  }

  const columns: { title: string; items: Entry[] }[] = [
    ...(research.length
      ? [
          {
            title:
              tx(props.researchTitle) ||
              (locale === "en" ? "Research" : "Nghiên cứu"),
            items: research,
          },
        ]
      : []),
    ...(teaching.length
      ? [
          {
            title:
              tx(props.teachingTitle) ||
              (locale === "en" ? "Teaching" : "Giảng dạy"),
            items: teaching,
          },
        ]
      : []),
    ...[...groups.entries()].map(([title, items]) => ({ title, items })),
  ];
  const projects = (props.projects ?? []).filter((p) => tx(p.title).trim());
  const pubs = (props.publications ?? []).filter((p) => tx(p.title).trim());
  const hasBody = tx(props.html).trim().length > 0;

  // Nền hero: có ảnh nền thì phủ màn INK mờ (0.72) lên ảnh để chữ blend vẫn đọc
  // được; không có ảnh thì giữ nguyên nền INK đặc như cũ (byte-for-byte).
  const heroBg = resolveMediaUrl(props.heroBg || "");
  const heroVeil = inkVeil(0.72);
  // Nền tối phủ ĐÚNG vùng hero, và vùng hero cao bao nhiêu thì nó cao bấy nhiêu.
  //
  // Bản trước cắt nền bằng một con số cố định — 560px trên mobile, 52vh trên
  // desktop — vẽ lên CẢ TRANG rồi lấy một lớp gradient PAPER đè lên phần dưới để
  // giấu ảnh đi. Cách đó chỉ đúng khi hero tình cờ cao đúng bằng con số ấy.
  //
  // `52vh` là chiều cao KHUNG NHÌN, còn hero cao bao nhiêu thì do NỘI DUNG và
  // CHIỀU RỘNG quyết định: quanh 1200px cột chữ hẹp lại, dòng "Học vấn" xuống
  // thêm dòng, hero vượt quá 52vh — nền tối hết trước khi hero hết, nên chữ
  // `blend` của khối dưới rơi trúng phần nền tối còn sót và thành đen trên đen.
  // Đổi màn hình, đổi cỡ chữ, hay thêm một dòng học vấn là ngưỡng lại sai chỗ
  // khác; không có con số nào đúng cho mọi trường hợp.
  //
  // Nên bỏ hẳn ngưỡng: đặt nền lên CHÍNH khối hero. Hero cao bao nhiêu thì nền
  // đúng bấy nhiêu, ở mọi chiều rộng, mọi độ dài nội dung.
  const heroBgCss = heroBg
    ? `background-color: ${INK};
          background-image: linear-gradient(${heroVeil}, ${heroVeil}), url("${heroBg}");
          background-size: auto, cover;
          background-position: center, center top;
          background-repeat: no-repeat, no-repeat;`
    : `background-color: ${INK};`;

  // Hồ sơ học thuật: mỗi ID có giá trị thì hiện một icon-link màu thương hiệu.
  // Đặt NGOÀI vùng `blend` để logo giữ đúng màu, không bị phép trừ màu đảo.
  const scholarLinks = [
    props.orcid?.trim()
      ? {
          key: "orcid",
          href: `https://orcid.org/${encodeURIComponent(props.orcid.trim())}`,
          label: "ORCID iD",
          icon: (
            <svg width="22" height="22" viewBox="0 0 256 256" role="img" aria-hidden="true">
              <path fill="#A6CE39" d="M256 128c0 70.7-57.3 128-128 128S0 198.7 0 128 57.3 0 128 0s128 57.3 128 128z" />
              <path fill="#FFF" d="M86.3 186.2H70.9V79.1h15.4v107.1z" />
              <path fill="#FFF" d="M108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7 0-21.5-13.7-39.7-43.7-39.7h-23.7v79.4z" />
              <path fill="#FFF" d="M88.7 56.8c0 5.5-4.5 10.1-10.1 10.1-5.6 0-10.1-4.6-10.1-10.1 0-5.6 4.5-10.1 10.1-10.1 5.6 0 10.1 4.6 10.1 10.1z" />
            </svg>
          ),
        }
      : null,
    props.googleScholar?.trim()
      ? {
          key: "scholar",
          href: `https://scholar.google.com/citations?user=${encodeURIComponent(props.googleScholar.trim())}`,
          label: "Google Scholar",
          icon: (
            <svg width="22" height="22" viewBox="0 0 512 512" role="img" aria-hidden="true">
              <path fill="#4285F4" d="M256 411.12L0 202.667 256 0z" />
              <path fill="#356AC3" d="M256 411.12l256-208.453L256 0z" />
              <circle fill="#A0C3FF" cx="256" cy="362.667" r="149.333" />
              <path fill="#76A7FA" d="M121.037 298.667c23.968-50.453 75.392-85.334 134.963-85.334s110.995 34.881 134.963 85.334H121.037z" />
            </svg>
          ),
        }
      : null,
    props.scopus?.trim()
      ? {
          key: "scopus",
          href: `https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(props.scopus.trim())}`,
          label: "Scopus Author ID",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" role="img" aria-hidden="true">
              <circle cx="12" cy="12" r="12" fill="#E9711C" />
              <text
                x="12"
                y="16.5"
                textAnchor="middle"
                fontFamily="Georgia, 'Times New Roman', serif"
                fontSize="15"
                fontWeight="700"
                fill="#FFF"
              >
                S
              </text>
            </svg>
          ),
        }
      : null,
    props.researcherId?.trim()
      ? {
          key: "wos",
          href: `https://www.webofscience.com/wos/author/record/${encodeURIComponent(props.researcherId.trim())}`,
          label: "ResearcherID (Web of Science)",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" role="img" aria-hidden="true">
              <g stroke="#8C52FF" strokeWidth="1.4" strokeLinecap="round">
                <line x1="12" y1="12" x2="5.5" y2="6" />
                <line x1="12" y1="12" x2="18.5" y2="7" />
                <line x1="12" y1="12" x2="7" y2="18.5" />
                <line x1="12" y1="12" x2="17" y2="18" />
              </g>
              <g fill="#8C52FF">
                <circle cx="12" cy="12" r="2.4" />
                <circle cx="5.5" cy="6" r="1.7" />
                <circle cx="18.5" cy="7" r="1.7" />
                <circle cx="7" cy="18.5" r="1.7" />
                <circle cx="17" cy="18" r="1.7" />
              </g>
            </svg>
          ),
        }
      : null,
  ].filter(Boolean) as {
    key: string;
    href: string;
    label: string;
    icon: React.ReactNode;
  }[];

  return (
    <div className="staff-editorial w-full antialiased">
      {/* Nền: khối hero tối, phần thân trắng ngà — ranh giới là ĐÁY CỦA HERO,
          không phải một ngưỡng px/vh đoán trước. Dùng <style> vì ảnh nền là dữ
          liệu người dùng nhập, không viết cứng vào class được. */}
      <style>{`
        .staff-editorial { background-color: ${PAPER}; }
        .staff-editorial .staff-hero { ${heroBgCss} }
        /* Chữ trắng + phép trừ màu: trên nền đen ra trắng, trên nền giấy ra đen. */
        .staff-editorial .blend { mix-blend-mode: difference; }
        @media (prefers-reduced-transparency: reduce) {
          .staff-editorial .blend { mix-blend-mode: normal; }
        }
      `}</style>

      {/* ── Hero ── Khối ngoài full-bleed CHỈ để mang nền: khối trong bị
          `max-w-7xl` bó lại nên đặt nền lên đó thì hai bên trống. */}
      <div className="staff-hero">
      <div className={heroWrapCls}>
        <div className={photoWrapCls}>
          <div className="aspect-[3/4] w-full shadow-2xl overflow-hidden rounded-tl-[5rem] rounded-bl-[5rem] rounded-tr-xl rounded-br-xl bg-gray-200">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt={nameLines.join(" ")}
                className={
                  "w-full h-full object-cover " +
                  (props.photoFilter ? "contrast-125 saturate-50" : "")
                }
                loading="eager"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="w-full md:w-7/12 flex flex-col justify-center">
          <div className="text-white blend">
            {tx(props.eyebrow) || hocViDem ? (
              <p className="text-xs md:text-sm tracking-[0.3em] mb-4 font-medium uppercase">
                {tx(props.eyebrow) || hocViDem}
              </p>
            ) : null}
            {tenHienThi ? (
              <h1
                className={nameCls}
                style={{ fontFamily: "var(--font-playfair)" }}
              >
                {tenHienThi}
              </h1>
            ) : null}
            {tx(props.intro) ? (
              <p className="text-base md:text-lg max-w-xl font-light leading-relaxed">
                {tx(props.intro)}
              </p>
            ) : heroDaoTao.length ? (
              <div className="max-w-xl">
                <p className="text-xs md:text-sm tracking-[0.25em] mb-3 font-semibold uppercase">
                  {heroDaoTaoTitle ||
                    (locale === "en" ? "Education" : "Quá trình đào tạo")}
                </p>
                <ul className="space-y-2 text-sm md:text-base font-light leading-relaxed">
                  {heroDaoTao.map((e, i) => (
                    <li key={`${tx(e.title)}-${i}`}>
                      <span className="font-medium">{tx(e.title)}</span>
                      {tx(e.desc) ? <span> — {tx(e.desc)}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {scholarLinks.length || props.email?.trim() ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              {scholarLinks.length ? (
                <div className="flex items-center gap-3">
                  {scholarLinks.map((l) => (
                    <a
                      key={l.key}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={l.label}
                      aria-label={l.label}
                      className="inline-flex hover:opacity-70 transition-opacity"
                    >
                      {l.icon}
                    </a>
                  ))}
                </div>
              ) : null}
              {props.email?.trim() ? (
                <a
                  href={`mailto:${props.email.trim()}`}
                  title={props.email.trim()}
                  className="inline-flex items-center gap-1.5 text-xs md:text-sm text-white/90 hover:text-white break-all"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                  <span>{props.email.trim()}</span>
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      </div>

      {/* ── Nghiên cứu / Giảng dạy ── */}
      {columns.length ? (
        <div className="max-w-7xl mx-auto px-6 sm:px-12 pb-10 text-gray-900">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 border-t border-gray-300 pt-8">
            {columns.map((col) => (
              <div key={col.title}>
                <h2
                  className="text-2xl md:text-3xl mb-4 uppercase tracking-wide text-gray-800"
                  style={{ fontFamily: "var(--font-playfair)" }}
                >
                  {col.title}
                </h2>
                <EntryList items={col.items} tx={tx} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Dự án ứng dụng ── */}
      {projects.length ? (
        <div className="max-w-7xl mx-auto px-6 sm:px-12 pb-12">
          <RuleHeading>
            {tx(props.projectsTitle) ||
              (locale === "en" ? "Projects" : "Dự án ứng dụng")}
          </RuleHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {projects.map((p, i) => (
              <div
                key={`${tx(p.title)}-${i}`}
                className="border border-gray-200 p-8 hover:bg-white hover:shadow-md transition-all duration-300 bg-transparent rounded-sm"
              >
                {tx(p.category) ? (
                  <span className="text-xs tracking-widest text-gray-500 uppercase mb-4 block">
                    {tx(p.category)}
                  </span>
                ) : null}
                <h3
                  className="text-2xl text-gray-900 mb-4"
                  style={{ fontFamily: "var(--font-playfair)" }}
                >
                  {tx(p.title)}
                </h3>
                {tx(p.desc) ? (
                  <p className="font-light text-gray-600 text-sm leading-relaxed">
                    {tx(p.desc)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Xuất bản khoa học ── */}
      {pubs.length ? (
        <div className="max-w-7xl mx-auto px-6 sm:px-12 pb-12">
          <RuleHeading>
            {tx(props.pubsTitle) ||
              (locale === "en" ? "Publications" : "Xuất bản khoa học")}
          </RuleHeading>
          <div className="space-y-3 md:space-y-4">
            {pubs.map((p, i) => (
              <div
                key={`${tx(p.title)}-${i}`}
                className="flex flex-col md:flex-row md:gap-8 border-b border-gray-200 pb-4 group"
              >
                <div className="md:w-32 shrink-0 text-gray-400 font-medium mb-2 md:mb-0">
                  {p.year}
                </div>
                <div className="flex-1">
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base md:text-lg font-medium text-gray-800 group-hover:text-blue-700 transition-colors"
                    >
                      {tx(p.title)}
                    </a>
                  ) : (
                    <h3 className="text-base md:text-lg font-medium text-gray-800">
                      {tx(p.title)}
                    </h3>
                  )}
                  {tx(p.meta) ? (
                    <p className="text-sm text-gray-500 mt-2 font-light leading-relaxed">
                      {tx(p.meta)}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {props.pubsMoreUrl ? (
            <div className="mt-12 text-center md:text-left">
              <a
                href={props.pubsMoreUrl}
                className="inline-block border-b border-gray-900 pb-1 text-sm font-medium text-gray-900 uppercase tracking-widest hover:text-blue-700 hover:border-blue-700 transition-colors"
              >
                {tx(props.pubsMoreLabel) ||
                  (locale === "en"
                    ? "See all publications →"
                    : "Xem toàn bộ danh sách bài báo →")}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Nội dung hồ sơ cũ — giữ mọi thứ chưa kịp tách ra ô riêng ── */}
      {hasBody ? (
        <div className="max-w-7xl mx-auto px-6 sm:px-12 pb-12 text-gray-900">
          <RuleHeading>
            {tx(props.contentTitle) ||
              (locale === "en" ? "Details" : "Thông tin chi tiết")}
          </RuleHeading>
          <div className="overflow-x-auto">
            <LegacyHtmlRender html={props.html} injected={false} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const StaffProfileEditorial: ComponentConfig<Props> = {
  label: "Staff Profile (Editorial)",
  defaultProps: {
    photo: "",
    photoFilter: true,
    heroBg: "",
    eyebrow: { vi: "", en: "" },
    name: { vi: "", en: "" },
    nameLines: [],
    intro: { vi: "", en: "" },
    orcid: "",
    scopus: "",
    googleScholar: "",
    researcherId: "",
    email: "",
    heroLayout: "compact",
    researchTitle: { vi: "Nghiên cứu", en: "Research" },
    research: [],
    teachingTitle: { vi: "Giảng dạy", en: "Teaching" },
    teaching: [],
    extras: [],
    projectsTitle: { vi: "Dự án ứng dụng", en: "Projects" },
    projects: [],
    pubsTitle: { vi: "Xuất bản khoa học", en: "Publications" },
    publications: [],
    pubsMoreUrl: "",
    pubsMoreLabel: {
      vi: "Xem toàn bộ danh sách bài báo →",
      en: "See all publications →",
    },
    contentTitle: { vi: "", en: "" },
    html: { vi: "", en: "" },
  },
  fields: {
    photo: mediaPickerField("Ảnh chân dung"),
    photoFilter: {
      type: "radio",
      label: "Lọc ảnh nghệ thuật (tăng tương phản, giảm bão hoà)",
      options: [
        { label: "Có", value: true },
        { label: "Không (ảnh màu thật)", value: false },
      ],
    },
    heroBg: mediaPickerField("Ảnh nền hero (thay nền tối)"),
    eyebrow: localizedTextField("Dòng nhỏ trên tên (vd: Thạc sĩ • Giảng viên)"),
    name: localizedTextField("Họ tên (dùng khi không tách dòng)"),
    nameLines: {
      type: "array",
      label: "Tên tách theo dòng (để tên xuống hàng như thiết kế)",
      getItemSummary: (item, i) =>
        localizedSummary(item?.text, `Dòng ${(i ?? 0) + 1}`),
      arrayFields: { text: localizedTextField("Chữ trên dòng này") },
    },
    intro: localizedTextField("Đoạn giới thiệu"),
    orcid: { type: "text", label: "ORCID iD" },
    scopus: { type: "text", label: "Scopus Author ID" },
    googleScholar: { type: "text", label: "Google Scholar ID" },
    researcherId: { type: "text", label: "ResearcherID (Web of Science)" },
    email: { type: "text", label: "Email (hiện cạnh icon học thuật)" },
    heroLayout: {
      type: "radio",
      label: "Kiểu hero trên điện thoại",
      options: [
        { label: "Gọn (ảnh nhỏ)", value: "compact" },
        { label: "Lớn (ảnh to)", value: "full" },
      ],
    },
    researchTitle: localizedTextField("Tiêu đề cột nghiên cứu"),
    research: {
      type: "array",
      label: "Hướng nghiên cứu (bỏ trống thì ẩn)",
      getItemSummary: (item, i) =>
        localizedSummary(item?.title, `Mục ${(i ?? 0) + 1}`),
      arrayFields: {
        title: localizedTextField("Tên hướng"),
        desc: localizedTextField("Mô tả"),
      },
    },
    teachingTitle: localizedTextField("Tiêu đề cột giảng dạy"),
    teaching: {
      type: "array",
      label: "Mảng giảng dạy (bỏ trống thì ẩn)",
      getItemSummary: (item, i) =>
        localizedSummary(item?.title, `Mục ${(i ?? 0) + 1}`),
      arrayFields: {
        title: localizedTextField("Tên mảng"),
        desc: localizedTextField("Mô tả"),
      },
    },
    extras: {
      type: "array",
      label: "Mục tự đặt tên (Học vấn, Major, Giải thưởng… — cùng tên mục thì gom chung)",
      getItemSummary: (item, i) =>
        `${localizedSummary(item?.section, "Mục")} — ${localizedSummary(item?.title, `Dòng ${(i ?? 0) + 1}`)}`,
      arrayFields: {
        section: localizedTextField("Tên mục (vd: Học vấn)"),
        title: localizedTextField("Tiêu đề dòng"),
        desc: localizedTextField("Mô tả"),
      },
    },
    projectsTitle: localizedTextField("Tiêu đề mục dự án"),
    projects: {
      type: "array",
      label: "Dự án (bỏ trống thì ẩn)",
      getItemSummary: (item, i) =>
        localizedSummary(item?.title, `Dự án ${(i ?? 0) + 1}`),
      arrayFields: {
        category: localizedTextField("Nhãn phân loại (chữ nhỏ phía trên)"),
        title: localizedTextField("Tên dự án"),
        desc: localizedTextField("Mô tả"),
      },
    },
    pubsTitle: localizedTextField("Tiêu đề mục xuất bản"),
    publications: {
      type: "array",
      label: "Bài báo (bỏ trống thì ẩn)",
      getItemSummary: (item, i) =>
        localizedSummary(item?.title, `Bài ${(i ?? 0) + 1}`),
      arrayFields: {
        year: { type: "text", label: "Năm" },
        title: localizedTextField("Tên bài"),
        meta: localizedTextField("Hội nghị / tạp chí, đồng tác giả"),
        url: { type: "text", label: "Link DOI / bài báo" },
      },
    },
    pubsMoreUrl: { type: "text", label: "Link 'Xem toàn bộ' (trống thì ẩn)" },
    pubsMoreLabel: localizedTextField("Chữ của link 'Xem toàn bộ'"),
    contentTitle: localizedTextField("Tiêu đề ô nội dung cũ"),
    html: localizedRichTextField("Nội dung hồ sơ (phần chưa tách ra ô riêng)"),
  },
  render: (props) => <StaffProfileEditorialRender {...props} />,
};
