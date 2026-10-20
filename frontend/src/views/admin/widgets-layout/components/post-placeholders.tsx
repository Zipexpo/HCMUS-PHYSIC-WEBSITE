"use client";

import type { ComponentConfig } from "@puckeditor/core";
import Image from "next/image";
import NextLink from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveMediaUrl } from "@/lib/api";

// Ảnh thân bài di trú đi qua bộ tối ưu ảnh của Next: gốc PNG/JPEG hàng trăm KB
// được thu về kích thước hiển thị + WebP/AVIF, giảm hàng chục lần dung lượng tải.
// Tham số url do CHÍNH máy chủ Next fetch (không phải trình duyệt); trên host NAT
// không hairpin, container không tự với tới IP công khai của nó nên cho phép bake
// một origin nội bộ (vd http://backend:3001) riêng cho lượt fetch của bộ tối ưu.
const OPTIMIZER_FETCH_ORIGIN = process.env.NEXT_PUBLIC_IMAGE_FETCH_ORIGIN;
const PUBLIC_MEDIA_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const optimizedBodyImageUrl = (src: string): string => {
  const abs = resolveMediaUrl(src);
  if (!/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(src)) return abs;
  const fetchUrl =
    OPTIMIZER_FETCH_ORIGIN && abs.startsWith(PUBLIC_MEDIA_ORIGIN)
      ? OPTIMIZER_FETCH_ORIGIN + abs.slice(PUBLIC_MEDIA_ORIGIN.length)
      : abs;
  return `/_next/image?url=${encodeURIComponent(fetchUrl)}&w=1080&q=70`;
};

// Vài trang di trú nhúng công thức toán bằng ẢNH đặt trên máy chủ ngoài (các PNG
// phương trình của mathworks.com, chép lại từ tài liệu MATLAB). Máy chủ đó nay
// chặn hotlink (trả 403 cho mọi request ngoài trình duyệt của họ) nên ảnh luôn vỡ
// và KHÔNG thể mirror về. May là thuộc tính alt còn giữ nguyên LaTeX gốc
// ($d(n)$, $\widehat{d}(n)$…) — đủ để dựng lại công thức tại chỗ bằng chữ nghiêng
// + dấu phụ Unicode, không phải kéo thêm thư viện toán (KaTeX/MathJax) vào bundle.
const LATEX_ACCENTS: Record<string, string> = {
  widehat: "̂",
  hat: "̂",
  widetilde: "̃",
  tilde: "̃",
  overline: "̄",
  bar: "̄",
  vec: "⃗",
  dot: "̇",
};

const latexToPlainText = (tex: string): string =>
  tex
    .replace(/^\$+|\$+$/g, "")
    // \widehat{d} → d + dấu mũ tổ hợp (đặt SAU ký tự theo chuẩn Unicode)
    .replace(
      /\\(widehat|hat|widetilde|tilde|overline|bar|vec|dot)\s*\{([^{}]*)\}/g,
      (_m, accent: string, body: string) => body + LATEX_ACCENTS[accent],
    )
    // Lệnh LaTeX còn lại không dựng được bằng ký tự thường → bỏ, giữ phần chữ.
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .trim();

// Chỉ thay thế <img> vừa trỏ ra HOST NGOÀI vừa có alt là LaTeX ($…$) — ảnh nội
// bộ và ảnh ngoài bình thường giữ nguyên.
const replaceBrokenMathImages = (html: string): string =>
  html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (!/^https?:\/\//i.test(src)) return tag;
    const alt = (/\balt=["']([^"']*)["']/i.exec(tag)?.[1] ?? "").trim();
    if (!/^\$[\s\S]+\$$/.test(alt)) return tag;
    const text = latexToPlainText(alt);
    if (!text) return tag;
    // Chỉ thoát < và > — alt lấy thẳng từ HTML nguồn nên các thực thể (&amp;…)
    // đã được thoát sẵn, thoát & lần nữa sẽ hỏng.
    const safe = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span class="legacy-math">${safe}</span>`;
  });

// Nội dung Joomla/Word cũ thụt đầu dòng bằng CHUỖI `&nbsp;` ngay sau <p> (có khi
// nằm trong vài thẻ inline lồng nhau). Trình duyệt vẽ ra khoảng thụt, còn Tiptap
// gộp/bỏ khoảng trắng đầu khối nên trình soạn thảo hiện phẳng → web và editor lệch
// nhau, và chỉ cần biên tập viên mở trang bằng chế độ trực quan rồi lưu là các
// `&nbsp;` đó biến mất luôn. Bỏ chúng khi render để web khớp editor ngay.
// Lookahead loại đoạn RỖNG (`<p>&nbsp;</p>`) — đó là đoạn đệm cố ý, xoá đi sẽ
// làm mất khoảng cách dọc.
// Ô chỉ chứa MỘT dãy số (MSSV 7-8 chữ số, năm…) không nên bị bẻ giữa chừng: dưới
// table-layout:fixed + overflow-wrap:break-word, "1613081" rớt xuống 2 dòng rất
// khó đọc. Đánh dấu để CSS cho phép tràn nhẹ thay vì bẻ đôi con số; các ô chữ
// (tên đề tài, họ tên…) vẫn wrap như cũ.
const markNumericCells = (html: string): string =>
  html.replace(
    /<td\b([^>]*)>([\s\S]*?)<\/td>/gi,
    (whole: string, attrs: string, inner: string) => {
      const text = inner
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;|&#160;/gi, " ")
        .trim();
      return /^\d{4,12}$/.test(text)
        ? `<td${attrs} data-num>${inner}</td>`
        : whole;
    },
  );

// Bảng nhiều cột: chia lại bề rộng cột theo NỘI DUNG thay vì theo width gốc, để
// bảng vừa khung mà không phải cuộn ngang và tiêu đề không bị bẻ vụn. Cột chỉ
// chứa chữ ngắn (cột "Link", cột số) được thu hẹp, nhường chỗ cho cột chữ dài.
// Bề rộng tối thiểu của một cột phải chứa được TỪ DÀI NHẤT của nó (kể cả ở dòng
// tiêu đề) — nếu không thì đúng chỗ đó lại vỡ chữ.
const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    // Chữ tiếng Việt trong nội dung legacy được mã hoá theo MÃ SỐ ("H&#7885;c
    // k&#7923;" = "Học kỳ"). Không quy về một ký tự thì đo độ dài sai gấp ba, mà
    // mọi phép chia cột ở dưới đều dựa trên độ dài — cột nhiều dấu bị thổi phồng
    // còn cột ít dấu bị bóp lại.
    .replace(/&#x?[0-9a-f]+;/gi, "x")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const cellsOf = (r: string) =>
  r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
const spanOf = (cell: string, attr: "colspan" | "rowspan") => {
  const m = new RegExp(`${attr}=["']?(\\d+)`, "i").exec(cell);
  return Math.max(1, Number(m?.[1] ?? 1));
};
const colsIn = (row: string) =>
  cellsOf(row).reduce((sum, c) => sum + spanOf(c, "colspan"), 0);

const colgroup = (widths: number[]): string => {
  const total = widths.reduce((a, b) => a + b, 0);
  if (!total) return "";
  const cols = widths
    .map((w) => `<col style="width:${((w / total) * 100).toFixed(3)}%">`)
    .join("");
  return `<colgroup>${cols}</colgroup>`;
};

// Bề rộng do người soạn tự kéo trong trình soạn thảo: Tiptap ghi vào thuộc tính
// `colwidth` của ô, và kèm một <colgroup> của riêng nó. Có bề rộng thật thì tôn
// trọng, KHÔNG chia lại — người dùng đã quyết.
const COLGROUP_RE = /<colgroup\b[\s\S]*?<\/colgroup>/i;

const colgroupWidths = (inner: string): number[] | null => {
  const cg = COLGROUP_RE.exec(inner);
  if (!cg) return null;
  const widths = [...cg[0].matchAll(/<col\b[^>]*>/gi)].map((m) => {
    // Chỉ tính `width` thật; `min-width: 25px` là mặc định Tiptap ghi cho mọi
    // cột, không mang thông tin gì về tỉ lệ.
    const w = /(?:^|[^-])\bwidth:\s*([\d.]+)/i.exec(m[0]);
    return w ? Number(w[1]) : 0;
  });
  return widths.length >= 2 && widths.every((w) => w > 0) ? widths : null;
};

const authoredWidths = (rows: string[]): number[] | null => {
  for (const row of rows) {
    const cells = cellsOf(row);
    if (cells.some((c) => spanOf(c, "colspan") > 1)) continue;
    const widths = cells.map((c) => {
      const m = /colwidth=["']?([\d,]+)/i.exec(c);
      return m ? Number(m[1]?.split(",")[0] ?? 0) : 0;
    });
    if (widths.length >= 2 && widths.every((w) => w > 0)) return widths;
  }
  return null;
};

const balanceColumnWidths = (inner: string): string => {
  const rows = inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  if (rows.length < 2) return inner;

  // Bảng đã sửa trong trình soạn thảo mang sẵn <colgroup> của Tiptap. Phải THAY
  // nó chứ không thêm cái thứ hai: hai colgroup 8 cột nối nhau là khai báo 16
  // cột, trình duyệt chia bề rộng cho cả 16 nên mọi cột co lại và tiêu đề vẫn
  // rớt chữ — đúng triệu chứng còn sót trên trang công khai.
  const body = inner.replace(COLGROUP_RE, "");

  const authored = colgroupWidths(inner) ?? authoredWidths(rows);
  if (authored) return colgroup(authored) + body;

  // Số cột THẬT = tổng colspan lớn nhất qua các hàng. Trước đây chỉ đếm số ô của
  // hàng đầu, nên bảng có tiêu đề gộp (vd "Số tiết" trùm 3 cột Lý thuyết / Thực
  // hành / Bài tập) bị đếm thiếu cột và bề rộng gán lệch hẳn — đúng chỗ đó chữ
  // vỡ thành "Thự c hàn h".
  const nCols = rows.reduce((mx, r) => Math.max(mx, colsIn(r)), 0);
  if (nCols < 2) return inner;
  // Chỉ đo trên hàng KHÔNG có ô gộp, vì ô gộp không thuộc về một cột nào.
  const isPlain = rows.map(
    (r) =>
      cellsOf(r).length === nCols &&
      cellsOf(r).every((c) => spanOf(c, "colspan") === 1),
  );
  const plainRows = rows.filter((_r, i) => isPlain[i]);
  if (plainRows.length < 1) return inner;

  // Tiêu đề cột nằm ở đúng những hàng CÓ ô gộp (vd "Số tiết" trùm 3 cột), tức
  // những hàng vừa bị loại ở trên — nên phải dựng lưới có tính colspan/rowspan
  // mới biết chữ nào thuộc cột nào. Không làm bước này thì "Học kỳ" chỉ được
  // chia theo nội dung cột (toàn số 1 chữ) và bị bóp đến mức rớt chữ.
  const headerLen = new Array<number>(nCols).fill(0);
  const taken = new Set<string>();
  rows.forEach((row, rIdx) => {
    if (isPlain[rIdx]) return;
    let col = 0;
    for (const cell of cellsOf(row)) {
      while (taken.has(`${rIdx}:${col}`)) col += 1;
      const cs = spanOf(cell, "colspan");
      const rs = spanOf(cell, "rowspan");
      // Ô gộp: chữ của nó chia đều cho các cột nó trùm, không dồn cho một cột.
      const per = Math.ceil(stripTags(cell).length / cs);
      for (let c = col; c < Math.min(col + cs, nCols); c += 1) {
        headerLen[c] = Math.max(headerLen[c] ?? 0, per);
        for (let r = rIdx; r < rIdx + rs; r += 1) taken.add(`${r}:${c}`);
      }
      col += cs;
    }
  });

  const longestWord = (t: string) =>
    t.split(" ").reduce((mx, w) => Math.max(mx, w.length), 0);
  const bodyLen = new Array<number>(nCols).fill(0);
  const wordLen = new Array<number>(nCols).fill(0);
  for (const [rowIdx, row] of plainRows.entries()) {
    cellsOf(row).forEach((cell, i) => {
      const text = stripTags(cell);
      wordLen[i] = Math.max(wordLen[i] ?? 0, longestWord(text));
      // dòng tiêu đề không tính vào độ dài nội dung, chỉ tính từ dài nhất
      if (rowIdx > 0) bodyLen[i] = Math.max(bodyLen[i] ?? 0, text.length);
    });
  }
  // Tiêu đề ngắn ("Học kỳ", "Bài tập") phải đủ chỗ nằm TRỌN MỘT DÒNG — rớt chữ ở
  // dòng tiêu đề trông hỏng hẳn, trong khi nội dung bên dưới xuống dòng thì bình
  // thường. Chặn trên HEADER_CAP để một tiêu đề dài bất thường không nuốt bảng.
  const HEADER_CAP = 14;
  for (let i = 0; i < nCols; i += 1) {
    wordLen[i] = Math.max(wordLen[i] ?? 0, Math.min(headerLen[i] ?? 0, HEADER_CAP));
  }

  // Chia hai bước. Bước 1 dành sẵn RESERVED% chia theo TỪ DÀI NHẤT của mỗi cột —
  // đây là bề rộng tối thiểu để từ đó không bị bẻ. Bước 2 chia phần còn lại theo
  // độ dài nội dung (căn bậc hai để một cột rất dài không nuốt hết phần của cột
  // khác). Nếu gộp chung một công thức thì cột chữ dài sẽ bóp các cột tiêu đề
  // xuống dưới mức tối thiểu và chữ lại tràn.
  // 75% chia theo từ dài nhất (đo thực tế: tổng bề rộng tối thiểu của bảng ngành
  // chỉ ~621px trong 792px nên hoàn toàn đủ chỗ, vấn đề nằm ở cách chia).
  const RESERVED = 75;
  const wordTotal = wordLen.reduce((a, b) => a + b, 0);
  const contentW = bodyLen.map((len) =>
    Math.sqrt(Math.min(Math.max(len, 3), 200)),
  );
  const contentTotal = contentW.reduce((a, b) => a + b, 0);
  if (!wordTotal || !contentTotal) return inner;
  const weights = wordLen.map(
    (w, i) =>
      (w / wordTotal) * RESERVED +
      ((contentW[i] ?? 0) / contentTotal) * (100 - RESERVED),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return inner;

  // Ghi bề rộng vào <colgroup> chứ không vào hàng đầu: dưới table-layout:fixed
  // chỉ hàng ĐẦU quyết định bề rộng, mà hàng đầu lại chính là chỗ hay có ô gộp.
  // colgroup gán thẳng theo cột nên không phụ thuộc cấu trúc hàng tiêu đề.
  return colgroup(weights) + body;
};

const INLINE_TAGS = "span|strong|em|b|i|u|font";
// Khoảng trắng ĐẦU đoạn: (1) thẻ mở, (2) dãy khoảng trắng, (3) phần đuôi khi đoạn CHỈ có khoảng trắng.
//
// Dãy (2) khớp NGUYÊN KHỐI bằng lookahead + backreference (JS không có atomic group). Bản cũ viết
// `(?:&nbsp;|&#160;|\u00a0|\s)+(?!…)`: \u00a0 vốn nằm trong \s nên mỗi NBSP có HAI cách khớp, và khi
// lookahead phía sau thất bại thì máy regex thử hết 2^n cách — 30 ký tự trắng là cả tỷ bước. Đo
// 19/10/2026: 44 bài tin cũ có ≥30 ký tự trắng liền nhau; mở một bài là trang công khai đứng 100% CPU
// hàng phút, watchdog phải khởi động lại 5–36 lần mỗi ngày suốt tháng 10.
const LEADING_NBSP_RE = new RegExp(
  `(<p\\b[^>]*>(?:\\s*<(?:${INLINE_TAGS})\\b[^>]*>)*)` +
    `(?=((?:&nbsp;|&#160;|\\s)+))\\2` +
    `((?:<\\/(?:${INLINE_TAGS})>|\\s)*<\\/p>)?`,
  "gi",
);
// Giữ đúng kết quả của bản cũ: có chữ phía sau → bỏ hết khoảng trắng đầu đoạn; đoạn CHỈ có khoảng
// trắng → giữ từ thực thể &nbsp;/&#160; cuối cùng trở đi (bản cũ quay lui đúng tới chỗ đó).
const stripLeadingNbsp = (
  _m: string,
  open: string,
  run: string,
  tail?: string,
): string => {
  if (tail === undefined) return open;
  const lower = run.toLowerCase();
  const last = Math.max(lower.lastIndexOf("&nbsp;"), lower.lastIndexOf("&#160;"));
  return open + (last >= 0 ? run.slice(last) : run) + tail;
};

import { DynamicIcon } from "@/components/admin/icons";
import { type LocalizedString, t } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import {
  localizedTextareaField,
  localizedTextField,
} from "../fields/localized-text-field";
import { mediaPickerField } from "../fields/media-picker-field";

const formatDate = (
  value: string | null | undefined,
  locale: string,
): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const lang = locale === "en" ? "en-GB" : "vi-VN";
  return date.toLocaleString(lang, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatPublishedHeader = (
  value: string | null | undefined,
  locale: string,
): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const lang = locale === "en" ? "en-GB" : "vi-VN";
  const datePart = date.toLocaleDateString(lang, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(lang, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const offsetH = Math.floor(Math.abs(offsetMin) / 60);
  return `${datePart} ${timePart} GMT${sign}${offsetH}`;
};

const CATEGORY_LABEL_FALLBACK: Record<string, LocalizedString> = {
  EDUCATIONAL_NEWS: { vi: "Tin học vụ", en: "Education" },
  SCIENTIFIC_INFORMATION: { vi: "Thông tin khoa học", en: "Science" },
  RECRUITMENT: { vi: "Tuyển dụng", en: "Recruitment" },
  EVENT: { vi: "Sự kiện", en: "Event" },
  SCHOLARSHIP: { vi: "Học bổng", en: "Scholarship" },
};

const autoLabel = (label: string) =>
  ({ type: "text", label: `${label} (auto)` }) as const;

const autoTextarea = (label: string) =>
  ({ type: "textarea", label: `${label} (auto)` }) as const;

const POST_LABELS = {
  titleFallback: { vi: "Tiêu đề bài đăng", en: "Post title" },
  coverHint: {
    vi: "Ảnh bìa sẽ hiển thị tại đây",
    en: "Cover image will appear here",
  },
  start: { vi: "Bắt đầu", en: "Start" },
  end: { vi: "Kết thúc", en: "End" },
  location: { vi: "Địa điểm", en: "Location" },
};

export const PostTitle: ComponentConfig<{
  // `text` là giá trị NHÉT khi publish: chuỗi cũ hoặc {vi,en} mới (backend nhét
  // object; type để `string` cho khớp field auto, render dùng t() lo cả hai).
  text: string;
  defaultText: LocalizedString;
  alignment: string;
}> = {
  label: "Post Title",
  defaultProps: {
    text: "",
    defaultText: { vi: "Tiêu đề bài đăng", en: "Post title" },
    alignment: "left",
  },
  fields: {
    defaultText: localizedTextField("Placeholder text (template)"),
    text: autoLabel("Injected title"),
    alignment: {
      type: "select",
      label: "Alignment",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
  },
  render: ({ text, defaultText, alignment }) => (
    <PostTitleRender
      text={text}
      defaultText={defaultText}
      alignment={alignment}
    />
  ),
};

function PostTitleRender({
  text,
  defaultText,
  alignment,
}: {
  text: string;
  defaultText: LocalizedString;
  alignment: string;
}) {
  const { locale } = useLocale();
  const placeholder =
    t(defaultText, locale) || t(POST_LABELS.titleFallback, locale);
  // Bài publish "nhét" tiêu đề dạng {vi,en}; bài cũ có thể còn là chuỗi đơn ngữ —
  // t() xử lý cả hai (chuỗi trả nguyên, object chọn theo locale).
  const content = t(text, locale) || placeholder;
  return (
    <h1
      data-post-body
      className="text-4xl font-bold text-content-1000 dark:text-slate-100 scroll-mt-20 my-4"
      style={{ textAlign: alignment as any }}
    >
      {content}
    </h1>
  );
}

export const PostBody: ComponentConfig<{
  // Xem ghi chú ở PostTitle: `markdown` nhét là chuỗi cũ hoặc {vi,en} mới.
  markdown: string;
  defaultMarkdown: LocalizedString;
  injected?: boolean;
}> = {
  label: "Post Body",
  defaultProps: {
    markdown: "",
    defaultMarkdown: {
      vi: "## Nội dung bài đăng\n\nPlaceholder — nội dung thực tế sẽ được điền từ trang tạo post.",
      en: "## Post content\n\nPlaceholder — actual content will be filled in from the post editor.",
    },
  },
  fields: {
    defaultMarkdown: localizedTextareaField("Placeholder markdown (template)"),
    markdown: autoTextarea("Injected markdown"),
  },
  render: ({ markdown, defaultMarkdown, injected }) => (
    <PostBodyRender
      markdown={markdown}
      defaultMarkdown={defaultMarkdown}
      injected={!!injected}
    />
  ),
};

function PostBodyRender({
  markdown,
  defaultMarkdown,
  injected,
}: {
  markdown: string;
  defaultMarkdown: LocalizedString;
  injected: boolean;
}) {
  const { locale } = useLocale();
  // Nội dung nhét dạng {vi,en} (bài cũ có thể còn chuỗi đơn ngữ); t() chọn đúng
  // ngôn ngữ, thiếu bản EN thì tự lùi về VI.
  const injectedSource = t(markdown, locale);
  if (injected && !injectedSource) {
    // Bài di trú không có nội dung nguồn: không để trang trống trơn.
    return (
      <p className="text-slate-500 dark:text-slate-400 italic py-8 text-center">
        {locale === "en"
          ? "This article's content is being updated."
          : "Nội dung bài viết đang được cập nhật."}
      </p>
    );
  }
  const rawSource = injectedSource || t(defaultMarkdown, locale) || "";
  const source = markNumericCells(replaceBrokenMathImages(rawSource))
    .replace(/(?:<p>(?:&nbsp;|&#160;|\s)*<\/p>\s*){2,}/gi, "<p>&nbsp;</p>")
    .replace(LEADING_NBSP_RE, stripLeadingNbsp)
    .replace(
      /<iframe[^>]*src=["']https?:\/\/phys\.hcmus\.edu\.vn[^"']*["'][^>]*><\/iframe>/gi,
      "",
    )
    // Relative /uploads/* srcs (migrated legacy media) must point at the API
    // host, same as cover images — otherwise body <img>/<iframe> 404 against the
    // public origin. Mirrors resolveMediaUrl used for PostCoverImage.
    .replace(
      /(<(?:img|iframe)[^>]+src=["'])(\/uploads\/[^"']+)(["'])/gi,
      (_m, pre: string, src: string, post: string) =>
        `${pre}${pre.startsWith("<img") ? optimizedBodyImageUrl(src) : resolveMediaUrl(src)}${post}`,
    )
    .replace(
      /<img(?![^>]*\bloading=)/gi,
      (() => {
        let imgIdx = 0;
        return () =>
          ++imgIdx <= 1
            ? '<img decoding="async" '
            : '<img loading="lazy" decoding="async" ';
      })(),
    )
    // Đánh dấu BẢNG DỮ LIỆU (có viền / border-color trên ô / MsoTableGrid) bằng
    // data-grid để CSS ép table-layout:fixed;width:100% CHỈ cho các bảng này —
    // bảng bố cục không viền (vd ảnh + chú thích cạnh nhau) giữ nguyên auto. Mục
    // đích: bảng dữ liệu luôn CO VỪA cột, không tràn → không mất đường kẻ/nội dung
    // ở màn hình hẹp hay khi zoom (100%/150%). Non-greedy: bảng lồng nhau hiếm gặp.
    .replace(
      /<table\b([^>]*)>([\s\S]*?)<\/table>/gi,
      (m: string, attrs: string, inner: string) => {
        // Bảng DỮ LIỆU: có viền / border-color / MsoTableGrid, HOẶC bảng không
        // viền nhưng rõ ràng là bảng dữ liệu (≥2 hàng, ≥3 cột, không chứa ảnh) →
        // các bảng danh sách (khóa luận, du học, chương trình đào tạo…) cũng được
        // chuẩn hoá đường kẻ + co vừa cột. Bảng bố cục (ảnh+chú thích) bị loại vì
        // có <img> hoặc chỉ 1-2 cột.
        const gridRows = inner.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
        const gridCols = gridRows.reduce(
          (mx, r) => Math.max(mx, (r.match(/<t[dh]\b/gi) || []).length),
          0,
        );
        const isGrid =
          /\bborder\s*=/.test(attrs) ||
          /MsoTableGrid/.test(attrs) ||
          /border-color/i.test(inner) ||
          (gridRows.length >= 2 && gridCols >= 3 && !/<img/i.test(inner));
        if (!isGrid) return m;
        // Bảng ảnh (nhân sự): table-layout:fixed để ảnh co vừa cột.
        if (/<img/i.test(inner))
          return `<table${attrs} data-grid="img">${inner}</table>`;
        // Bảng QUÁ NHIỀU CỘT (vd bảng ngành tuyển sinh: 10 cột): ép fixed+100% thì
        // mỗi cột chỉ còn ~10% bề rộng nên tiêu đề bị bẻ GIỮA TỪ ("CHƯƠ NG TRÌN H").
        // Giữ bề rộng gốc, cho cuộn ngang như site cũ và không bẻ giữa từ.
        if (gridCols >= 7)
          return `<table${attrs} data-grid="text" data-wide>${balanceColumnWidths(inner)}</table>`;
        // Bảng chữ (tuyển sinh…): quy đổi width px của HÀNG ĐẦU sang % rồi dùng
        // fixed+100% → bảng LUÔN co vừa cột mà GIỮ TỈ LỆ cột gốc (không về đều
        // nhau, không tràn 1-vài px làm mất viền/nội dung khi zoom). Chỉ quy đổi
        // khi mọi ô hàng đầu đều có width; nếu không, giữ nguyên (auto-layout).
        let processed = inner;
        const trM = inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/i);
        if (trM) {
          const firstTr = trM[0];
          const cells = firstTr.match(/<t[dh]\b[^>]*>/gi) || [];
          const widths = cells.map((cel) => {
            const s =
              /width:\s*(\d+(?:\.\d+)?)px/i.exec(cel) ||
              /\bwidth=["']?(\d+)/i.exec(cel);
            return s ? Number.parseFloat(s[1]) : 0;
          });
          const total = widths.reduce((a, b) => a + b, 0);
          if (cells.length > 1 && total > 0 && widths.every((w) => w > 0)) {
            let i = 0;
            const newTr = firstTr.replace(/<t[dh]\b[^>]*>/gi, (cel) => {
              const pct = ((widths[i] / total) * 100).toFixed(3);
              i += 1;
              const noW = cel
                .replace(/width:\s*\d+(?:\.\d+)?px;?/i, "")
                .replace(/\swidth=["']?\d+["']?/i, "");
              return /style="/i.test(noW)
                ? noW.replace(/style="/i, `style="width:${pct}%;`)
                : noW.replace(/<(t[dh])\b/i, `<$1 style="width:${pct}%"`);
            });
            processed = inner.replace(firstTr, newTr);
          } else {
            // Hàng đầu KHÔNG quy đổi được (vd 1 ô colspan có width:1000px như header
            // bảng "THÔNG TIN HỘI NGHỊ") → table-layout:fixed sẽ kế thừa 1000px làm
            // bảng rộng quá → tràn/cắt. Bỏ width px của hàng đầu để fixed về cột đều
            // theo width:100% (vừa cột).
            const newTr = firstTr
              .replace(/width:\s*\d+(?:\.\d+)?px;?/gi, "")
              .replace(/\swidth=["']?\d+["']?/gi, "");
            if (newTr !== firstTr) processed = inner.replace(firstTr, newTr);
          }
        }
        return `<table${attrs} data-grid="text">${processed}</table>`;
      },
    );
  const looksLikeHtml = /<\w+[^>]*>/.test(source.trim());
  if (looksLikeHtml) {
    return (
      <>
        <style>{`
          [data-post-body],
          [data-post-body] *:not(a):not(a *) {
            font-family: inherit !important;
            background: transparent !important;
            line-height: inherit;
          }
          /* Màu chữ: KHÔNG ép !important để màu inline do người dùng chọn
             (<span style="color:…"> từ trình soạn thảo) hiển thị đúng. Chỉ đặt
             mặc định kế thừa cho phần tử KHÔNG có màu inline; thẻ <font color>
             (định dạng cũ, độ ưu tiên thấp) vẫn bị chuẩn hoá về màu chủ đề. */
          [data-post-body],
          [data-post-body] *:not(a):not(a *) {
            color: inherit;
          }
          /* Normalise font-size on EVERY non-heading element (incl. <b>/<strong>/
             <font>/<small> that legacy Word-export markup uses) so quoted/bold text
             doesn't render tiny and inconsistent — especially on mobile. */
          [data-post-body] *:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6) {
            font-size: inherit !important;
          }
          /* Chặn tràn ngang: nội dung dán từ Word thường có <span> định dạng cứng
             (Verdana/line-height:115%…) rộng quá khổ và là inline nên max-width
             không ghì được → cả trang cuộn ngang / thu nhỏ, ảnh trông "co lại".
             Clip trong khung bài + ngắt từ dài để khoá bề rộng theo cột. */
          [data-post-body] {
            overflow-x: clip;
            overflow-wrap: break-word;
            word-break: break-word;
            /* Ảnh chèn từ trình soạn thảo nằm trong <div style="float:left"> bọc bởi
               <div style="display:inline">: phần tử float không cộng chiều cao cho
               cha, mà cha inline lại không tạo ngữ cảnh định dạng khối, nên khung
               thân bài co lại chỉ còn dòng chữ và ẢNH TRÀN ĐÈ LÊN FOOTER.
               flow-root tạo ngữ cảnh khối để bao trọn float. */
            display: flow-root;
          }
          [data-post-body] iframe,
          [data-post-body] embed,
          [data-post-body] object {
            display: block;
            width: 100%;
            max-width: 100%;
            min-height: 600px;
            border: 0;
          }
          /* Video/PDF chèn qua nút "Chèn video/PDF": khung giữ TỈ LỆ (padding-bottom)
             nên iframe phải lấp đầy khung, KHÔNG dính min-height 600px ở trên. */
          [data-post-body] .embed-responsive {
            max-width: 100%;
          }
          [data-post-body] .embed-responsive iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            min-height: 0;
          }
          [data-post-body] img {
            max-width: 100% !important;
            /* KHÔNG ép width:auto — giữ thuộc tính width/height của ảnh để trình
               duyệt tính aspect-ratio và giữ chỗ trước khi ảnh tải xong (tránh CLS
               khi tải nguội). max-width:100% vẫn co ảnh vừa cột trên mobile. */
            height: auto !important;
            display: inline-block;
          }
          /* Bảng NHIỀU CỘT: giữ bề rộng cột gốc + cuộn ngang, không bẻ giữa từ
             (xem chú thích ở khối .legacy-content). */
          [data-post-body] table[data-wide] td,
          [data-post-body] table[data-wide] th,
          [data-post-body] table[data-wide] td *,
          [data-post-body] table[data-wide] th * {
            overflow-wrap: normal;
            word-break: normal;
          }
          /* Ngoại lệ: ô CHỈ chứa dãy số (MSSV) — thà tràn nhẹ còn hơn bẻ đôi con số. */
          [data-post-body] td[data-num],
          [data-post-body] td[data-num] * {
            overflow-wrap: normal;
            word-break: normal;
          }
          /* Công thức toán dựng thay cho ảnh phương trình ngoài đã chết
             (xem replaceBrokenMathImages). */
          [data-post-body] .legacy-math {
            font-style: italic;
            font-family: "Cambria Math", "Latin Modern Math", "Times New Roman", serif;
            white-space: nowrap;
          }
          [data-post-body] table {
            display: block;
            overflow-x: auto;
            max-width: 100%;
            /* overflow-x:auto cũng cắt 1px theo chiều dọc → đường kẻ dưới cùng
               của hàng cuối bị mất. Chừa 1px để gridline không bị khung cuộn cắt. */
            padding-bottom: 1px;
          }
          @media (max-width: 768px) {
            [data-post-body] p,
            [data-post-body] li {
              text-align: left !important;
              text-indent: 0 !important;
              word-break: break-word;
            }
          }
        `}</style>
        <article
          data-post-body
          className="prose prose-slate dark:prose-invert max-w-none leading-relaxed my-4 prose-table:border prose-th:border prose-td:border prose-th:px-2 prose-td:px-2 prose-th:py-1 prose-td:py-1"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-authored rich text
          dangerouslySetInnerHTML={{ __html: source }}
        />
      </>
    );
  }
  return (
    <article
      data-post-body
      className="prose prose-slate max-w-none text-content-1000 dark:text-slate-100 leading-relaxed my-4"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </article>
  );
}

// ── LegacyHtml ────────────────────────────────────────────────────────────────
// Faithful renderer for migrated legacy page bodies (TinyMCE HTML). Unlike
// PostBody it does NOT normalise away the original styling — it preserves inline
// colors, backgrounds, fonts, table borders and layout so migrated pages mimic
// the legacy site 1-to-1. It only: resolves /uploads/* media to the API host,
// makes media responsive, and restores list markers + bordered-table gridlines
// that Tailwind's preflight strips.
export function LegacyHtmlRender({
  html,
  injected,
}: {
  html: LocalizedString;
  injected: boolean;
}) {
  const { locale } = useLocale();
  const raw = t(html, locale) || "";
  if (injected && !raw.trim()) return null;
  const source = markNumericCells(replaceBrokenMathImages(raw))
    // Gộp CHUỖI đoạn rỗng "<p>&nbsp;</p>" (rác Word/Joomla) — nhiều trang legacy
    // có 20-30 đoạn nbsp liên tiếp giữa 2 bảng → khoảng trống khổng lồ. Gộp về 1.
    .replace(/(?:<p>(?:&nbsp;|&#160;|\s)*<\/p>\s*){2,}/gi, "<p>&nbsp;</p>")
    .replace(LEADING_NBSP_RE, stripLeadingNbsp)
    .replace(
      /(<(?:img|iframe)[^>]+src=["'])(\/uploads\/[^"']+)(["'])/gi,
      (_m, pre: string, src: string, post: string) =>
        `${pre}${pre.startsWith("<img") ? optimizedBodyImageUrl(src) : resolveMediaUrl(src)}${post}`,
    )
    .replace(
      /<img(?![^>]*\bloading=)/gi,
      (() => {
        let imgIdx = 0;
        return () =>
          ++imgIdx <= 1
            ? '<img decoding="async" '
            : '<img loading="lazy" decoding="async" ';
      })(),
    )
    // Đánh dấu BẢNG DỮ LIỆU (có viền / border-color trên ô / MsoTableGrid) bằng
    // data-grid để CSS ép table-layout:fixed;width:100% CHỈ cho các bảng này —
    // bảng bố cục không viền (vd ảnh + chú thích cạnh nhau) giữ nguyên auto. Mục
    // đích: bảng dữ liệu luôn CO VỪA cột, không tràn → không mất đường kẻ/nội dung
    // ở màn hình hẹp hay khi zoom (100%/150%). Non-greedy: bảng lồng nhau hiếm gặp.
    .replace(
      /<table\b([^>]*)>([\s\S]*?)<\/table>/gi,
      (m: string, attrs: string, inner: string) => {
        // Bảng DỮ LIỆU: có viền / border-color / MsoTableGrid, HOẶC bảng không
        // viền nhưng rõ ràng là bảng dữ liệu (≥2 hàng, ≥3 cột, không chứa ảnh) →
        // các bảng danh sách (khóa luận, du học, chương trình đào tạo…) cũng được
        // chuẩn hoá đường kẻ + co vừa cột. Bảng bố cục (ảnh+chú thích) bị loại vì
        // có <img> hoặc chỉ 1-2 cột.
        const gridRows = inner.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
        const gridCols = gridRows.reduce(
          (mx, r) => Math.max(mx, (r.match(/<t[dh]\b/gi) || []).length),
          0,
        );
        const isGrid =
          /\bborder\s*=/.test(attrs) ||
          /MsoTableGrid/.test(attrs) ||
          /border-color/i.test(inner) ||
          (gridRows.length >= 2 && gridCols >= 3 && !/<img/i.test(inner));
        if (!isGrid) return m;
        // Bảng ảnh (nhân sự): table-layout:fixed để ảnh co vừa cột.
        if (/<img/i.test(inner))
          return `<table${attrs} data-grid="img">${inner}</table>`;
        // Bảng QUÁ NHIỀU CỘT (vd bảng ngành tuyển sinh: 10 cột): ép fixed+100% thì
        // mỗi cột chỉ còn ~10% bề rộng nên tiêu đề bị bẻ GIỮA TỪ ("CHƯƠ NG TRÌN H").
        // Giữ bề rộng gốc, cho cuộn ngang như site cũ và không bẻ giữa từ.
        if (gridCols >= 7)
          return `<table${attrs} data-grid="text" data-wide>${balanceColumnWidths(inner)}</table>`;
        // Bảng chữ (tuyển sinh…): quy đổi width px của HÀNG ĐẦU sang % rồi dùng
        // fixed+100% → bảng LUÔN co vừa cột mà GIỮ TỈ LỆ cột gốc (không về đều
        // nhau, không tràn 1-vài px làm mất viền/nội dung khi zoom). Chỉ quy đổi
        // khi mọi ô hàng đầu đều có width; nếu không, giữ nguyên (auto-layout).
        let processed = inner;
        const trM = inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/i);
        if (trM) {
          const firstTr = trM[0];
          const cells = firstTr.match(/<t[dh]\b[^>]*>/gi) || [];
          const widths = cells.map((cel) => {
            const s =
              /width:\s*(\d+(?:\.\d+)?)px/i.exec(cel) ||
              /\bwidth=["']?(\d+)/i.exec(cel);
            return s ? Number.parseFloat(s[1]) : 0;
          });
          const total = widths.reduce((a, b) => a + b, 0);
          if (cells.length > 1 && total > 0 && widths.every((w) => w > 0)) {
            let i = 0;
            const newTr = firstTr.replace(/<t[dh]\b[^>]*>/gi, (cel) => {
              const pct = ((widths[i] / total) * 100).toFixed(3);
              i += 1;
              const noW = cel
                .replace(/width:\s*\d+(?:\.\d+)?px;?/i, "")
                .replace(/\swidth=["']?\d+["']?/i, "");
              return /style="/i.test(noW)
                ? noW.replace(/style="/i, `style="width:${pct}%;`)
                : noW.replace(/<(t[dh])\b/i, `<$1 style="width:${pct}%"`);
            });
            processed = inner.replace(firstTr, newTr);
          } else {
            // Hàng đầu KHÔNG quy đổi được (vd 1 ô colspan có width:1000px như header
            // bảng "THÔNG TIN HỘI NGHỊ") → table-layout:fixed sẽ kế thừa 1000px làm
            // bảng rộng quá → tràn/cắt. Bỏ width px của hàng đầu để fixed về cột đều
            // theo width:100% (vừa cột).
            const newTr = firstTr
              .replace(/width:\s*\d+(?:\.\d+)?px;?/gi, "")
              .replace(/\swidth=["']?\d+["']?/gi, "");
            if (newTr !== firstTr) processed = inner.replace(firstTr, newTr);
          }
        }
        return `<table${attrs} data-grid="text">${processed}</table>`;
      },
    );
  return (
    <div className="legacy-content my-4">
      <style>{`
        .legacy-content { max-width: 100%; overflow-wrap: break-word; line-height: 1.65; color: #1f2937;
          /* Bao trọn ảnh float (xem chú thích ở [data-post-body]). */
          display: flow-root;
          /* Làm container query: cỡ chữ tiêu đề bảng phải bám BỀ RỘNG KHUNG
             chứa, không phải bề rộng màn hình — cùng một màn 1024px, có
             sidebar thì bảng chỉ còn 616px, xếp dọc thì được 844px. */
          container-type: inline-size; }
        /* height:auto !important ĐÈ chiều cao cố định trong inline style (vd ảnh
           nhân sự "width:120px;height:150px"): khi ô bảng co hẹp lúc zoom 125/200%,
           max-width kéo bề rộng nhỏ lại — nếu chiều cao vẫn cố định thì ảnh bị
           DÃN DỌC. Ép height:auto để luôn giữ đúng tỉ lệ. */
        .legacy-content img { max-width: 100%; height: auto !important; }
        /* Công thức toán dựng thay cho ảnh phương trình ngoài đã chết (xem
           replaceBrokenMathImages): chữ nghiêng kiểu toán, không xuống dòng giữa
           công thức. */
        .legacy-content .legacy-math {
          font-style: italic;
          font-family: "Cambria Math", "Latin Modern Math", "Times New Roman", serif;
          white-space: nowrap;
        }
        /* Ảnh legacy có margin-left/right cứng (vd width:800px + margin 50px = 900px)
           vượt cột → tràn + thanh cuộn ngang + lệch. Ảnh CÓ margin inline: chuyển
           block + margin auto (căn giữa, bỏ margin cứng) → vừa cột, không tràn. */
        .legacy-content img[style*="margin-left"],
        .legacy-content img[style*="margin-right"] {
          display: block;
          margin-left: auto !important;
          margin-right: auto !important;
        }
        /* Ảnh chèn từ editor bọc trong <div><div><img></div></div>. Editor giờ để
           ảnh BLOCK (xếp dọc); ép wrapper block ở cả web để đồng nhất editor↔web
           kể cả ảnh cũ lưu display:inline-block. */
        .legacy-content div:has(> div > img),
        [data-post-body] div:has(> div > img) { display: block !important; }
        .legacy-content iframe, .legacy-content embed, .legacy-content object {
          max-width: 100%; width: 100%; min-height: 500px; border: 0;
        }
        .legacy-content table { max-width: 100%; border-collapse: collapse; }
        /* Viền cả trên phần tử <table> để đường kẻ ngoài cùng (dòng/cột cuối)
           không bị cắt khi bảng nằm trong khung cuộn ngang (overflow). */
        .legacy-content table[border], .legacy-content table.MsoTableGrid {
          border: 1px solid #111827;
        }
        .legacy-content table[border] td, .legacy-content table[border] th,
        .legacy-content table.MsoTableGrid td, .legacy-content table.MsoTableGrid th {
          border: 1px solid #111827; padding: 6px 10px;
        }
        /* Bảng Joomla/TinyMCE (vd trang tuyển sinh) đặt inline chỉ "border-color"
           trên ô mà KHÔNG có border-style/width — dựa vào CSS "td{border:1px solid}"
           của site cũ. Thiếu nó thì ô không có viền thật: các "đường kẻ" chỉ là khe
           cellspacing nên đường kẻ DƯỚI CÙNG (không có khe bên dưới) biến mất. Cấp
           lại width+style, GIỮ màu inline (dùng border-width/style, không dùng
           shorthand để không ghi đè border-color inline). */
        .legacy-content td[style*="border-color"],
        .legacy-content th[style*="border-color"] {
          border-width: 1px; border-style: solid; padding: 6px 10px;
        }
        /* Trên màn hình hẹp (laptop, hoặc khi zoom trình duyệt) cột nội dung co lại;
           nếu min-content của bảng > bề rộng cột, bảng KHÔNG co được → tràn ra ngoài
           và khung cuộn ngang cắt mất viền/đường kẻ ngoài cùng bên phải. Cho phép ô
           ngắt từ khi cần (overflow-wrap:anywhere) để min-content nhỏ lại, bảng co
           vừa cột → không tràn, không cuộn, mọi đường kẻ (kể cả cột cuối) đều hiện. */
        /* Bảng CHỮ dùng auto-layout (mặc định): width px trên ô chỉ là "ưu tiên",
           overflow-wrap cho phép cột co dưới mức đó khi cột hẹp → bảng co vừa cột
           mà GIỮ tỉ lệ cột gốc (không về đều nhau). break-word (không "anywhere")
           để chỉ ngắt khi TỪ dài hơn cột, tránh vỡ chữ kiểu "VID EO CLI P". */
        .legacy-content td, .legacy-content th { overflow-wrap: break-word; }
        /* Bảng dữ liệu (ảnh nhân sự & bảng chữ đã quy width→%): fixed + 100% để
           LUÔN co vừa cột (ảnh theo max-width, chữ theo % cột) → không tràn/cắt
           viền hay nội dung ở mọi mức zoom, vẫn giữ tỉ lệ cột gốc. */
        .legacy-content table[data-grid="img"],
        .legacy-content table[data-grid="text"] { table-layout: fixed; width: 100%; }
        /* Đường kẻ MẶC ĐỊNH cho mọi bảng dữ liệu chữ — kể cả bảng KHÔNG VIỀN (danh
           sách khóa luận / du học / chương trình đào tạo) hay bảng thiếu vài ô kẻ ở
           header. Ô có border-color inline vẫn giữ màu riêng (inline thắng màu). */
        /* float:none — bảng legacy hay dính inline float:left (từ Word) làm tiêu đề
           bảng SAU "bay" lên cạnh bảng trước. Bỏ float + ép margin nhỏ (ghi đè
           margin cứng khổng lồ từ Word tạo khoảng trống lớn giữa các bảng). */
        .legacy-content table[data-grid] {
          float: none !important; clear: both;
          margin: 0.75rem 0 !important;
        }
        /* Đường kẻ ĐỒNG MÀU, ĐẬM VỪA (xám slate #94a3b8 — rõ khi zoom xa) cho toàn
           bộ bảng chữ; !important để ghi đè border-color inline lẫn lộn. */
        .legacy-content table[data-grid="text"] { border: 1px solid #94a3b8 !important; }
        .legacy-content table[data-grid="text"] td,
        .legacy-content table[data-grid="text"] th {
          border: 1px solid #94a3b8 !important; padding: 6px 10px;
        }
        /* Trên màn hình HẸP (mobile/zoom cao) ép bảng dữ liệu có min-width để CỘT
           đủ rộng đọc được → khung <main> cuộn ngang thay vì bẻ chữ nát (vd
           "A00:2/6.75"). Desktop rộng hơn min-width nên vẫn vừa khít, không cuộn. */
        @media (max-width: 680px) {
          .legacy-content table[data-grid="img"],
          .legacy-content table[data-grid="text"] { min-width: 560px; }
        }
        /* MỌI ô bảng dữ liệu (chữ & ảnh) + con của nó: BỎ white-space:nowrap (từ
           Word/Joomla) và cho xuống dòng. Nếu không, dưới table-layout:fixed nội
           dung (tên đề tài, HỌ TÊN in hoa, email…) KHÔNG wrap → tràn/ĐÈ sang cột
           kế bên. break-word: chỉ bẻ trong từ khi từ dài hơn cột (nhẹ, không nát). */
        .legacy-content table[data-grid] td,
        .legacy-content table[data-grid] th,
        .legacy-content table[data-grid] td *,
        .legacy-content table[data-grid] th * {
          white-space: normal !important;
          overflow-wrap: break-word;
        }
        /* Bảng NHIỀU CỘT (data-wide) vẫn vừa khung (fixed + 100%, KHÔNG cuộn ngang):
           bề rộng từng cột đã được chia lại theo nội dung ở balanceColumnWidths, nên
           chỉ cần chặn bẻ giữa từ là tiêu đề hết vỡ. */
        /* KHÔNG bao giờ để chữ tràn đè sang ô bên cạnh: giữ bẻ-khi-quá-dài làm
           lưới an toàn. word-break:normal nên chỉ từ DÀI HƠN CẢ CỘT mới bị bẻ,
           không bẻ vụn mọi từ như trước. */
        .legacy-content table[data-grid][data-wide] td,
        .legacy-content table[data-grid][data-wide] th,
        .legacy-content table[data-grid][data-wide] td *,
        .legacy-content table[data-grid][data-wide] th * {
          overflow-wrap: break-word;
          word-break: normal;
        }
        /* Đệm ô 10px mỗi bên ăn mất 20px/cột — với 9 cột là 180px trong tổng 792px,
           đủ để đẩy "CHƯƠNG" (58px) ra khỏi cột 67px chỉ còn 47px dùng được. Bảng
           nhiều cột thì thu đệm lại để trả chỗ cho chữ. */
        .legacy-content table[data-grid][data-wide] td,
        .legacy-content table[data-grid][data-wide] th {
          padding: 6px 4px !important;
        }
        /* Tiêu đề bảng nhiều cột thường là chữ hoa cỡ 13pt in đậm (CHƯƠNG TRÌNH
           ĐÀO TẠO…) — quá to so với cột hẹp. Ép về cỡ vừa phải để cả từ lọt vào
           cột, khỏi phải bẻ. */
        .legacy-content table[data-grid][data-wide] tr:first-child td,
        .legacy-content table[data-grid][data-wide] tr:first-child th,
        .legacy-content table[data-grid][data-wide] tr:first-child td *,
        .legacy-content table[data-grid][data-wide] tr:first-child th * {
          /* Bề rộng mỗi cột là PHẦN TRĂM bề rộng bảng, nên muốn từ dài nhất luôn
             lọt vào cột thì cỡ chữ phải tỉ lệ với chính bề rộng đó. 1.5cqi cho
             13px khi bảng rộng 792px và tự nhỏ lại khi bảng hẹp (616px → 9,9px),
             đúng ngưỡng đo được là ≤10,5px. Dòng 13px phía trên là bản dự phòng
             cho trình duyệt chưa hỗ trợ container query. */
          font-size: 13px !important;
          font-size: clamp(9px, 1.5cqi, 13px) !important;
          line-height: 1.35 !important;
        }
        /* Ngoại lệ: ô CHỈ chứa dãy số (MSSV) — thà tràn nhẹ còn hơn bẻ đôi con số. */
        .legacy-content table[data-grid] td[data-num],
        .legacy-content table[data-grid] td[data-num] * {
          overflow-wrap: normal;
          word-break: normal;
        }
        /* Bảng ẢNH (nhân sự): căn TRÁI để ảnh sát mép trái; email/link dài bẻ mạnh
           hơn (anywhere) để không tràn khi zoom. */
        .legacy-content table[data-grid="img"] td,
        .legacy-content table[data-grid="img"] th { text-align: left; }
        .legacy-content table[data-grid="img"] a,
        .legacy-content table[data-grid="img"] td *,
        .legacy-content table[data-grid="img"] th * { overflow-wrap: anywhere; }
        /* Ảnh nhân sự có inline min-width:120px (đè max-width:100% → TRÀN ra khỏi ô
           khi zoom) và float:right (đẩy ảnh sang phải). Ép: bỏ min-width, cap theo
           ô, bỏ float + block để ảnh SÁT MÉP TRÁI và luôn co vừa ô (không tràn). */
        .legacy-content table[data-grid="img"] img {
          min-width: 0 !important;
          max-width: 100% !important;
          /* width theo % ô (không cố định 120px) để ảnh CO CÙNG cột chữ ở mọi mức
             zoom → tỉ lệ ảnh/chữ luôn cân xứng (100/150/175/200%), không lệch. */
          width: 100% !important;
          float: none !important;
          display: block;
          margin: 0 !important;
        }
        /* Trang cần ảnh CĂN GIỮA ô (vd cơ hữu) → đánh dấu data-photo="center" trên
           thẻ <table> trong puckData; override lại margin để ảnh nằm giữa. */
        .legacy-content table[data-grid="img"][data-photo="center"] img {
          margin-left: auto !important;
          margin-right: auto !important;
        }
        /* ul/ol: xem khối "Danh sách trong nội dung soạn thảo" ở shared.css —
           dùng chung với trình soạn thảo và thân bài đăng. */
        .legacy-content li { margin: 0.25rem 0; }
        .legacy-content p { margin: 0.6rem 0; }
        .legacy-content a { color: #1d4ed8; text-decoration: underline; }
        .legacy-content h1, .legacy-content h2, .legacy-content h3,
        .legacy-content h4, .legacy-content h5 { font-weight: 700; margin: 1rem 0 0.5rem; line-height: 1.3; }
        .legacy-content > * { max-width: 100%; }
        /* KHÔNG dùng display:block cho bảng ở mobile — nó tách border-collapse làm
           mất đường kẻ ngoài. Bảng rộng đã được cuộn ngang bởi khung <main
           overflow-x-auto> bao ngoài, nên chỉ cần cho phép tràn để cuộn. */
        @media (max-width: 768px) {
          .legacy-content table { white-space: nowrap; }
        }
      `}</style>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: migrated legacy rich text */}
      <div dangerouslySetInnerHTML={{ __html: source }} />
    </div>
  );
}

export const LegacyHtml: ComponentConfig<{
  html: LocalizedString;
  injected?: boolean;
}> = {
  label: "Legacy HTML",
  defaultProps: { html: { vi: "", en: "" }, injected: false },
  fields: {
    html: localizedTextareaField("Legacy HTML"),
    injected: {
      type: "radio",
      label: "Injected",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
  },
  render: ({ html, injected }) => (
    <LegacyHtmlRender html={html} injected={!!injected} />
  ),
};

export const PostCoverImage: ComponentConfig<{
  src: string;
  alt: string;
  defaultSrc: string;
  defaultAlt: LocalizedString;
  aspectRatio: string;
  injected?: boolean;
}> = {
  label: "Post Cover Image",
  defaultProps: {
    src: "",
    alt: "",
    defaultSrc: "",
    defaultAlt: { vi: "Ảnh bìa bài đăng", en: "Post cover image" },
    aspectRatio: "21/9",
  },
  fields: {
    defaultSrc: mediaPickerField("Placeholder cover (template)"),
    defaultAlt: localizedTextField("Placeholder alt"),
    src: autoLabel("Injected cover URL"),
    alt: autoLabel("Injected alt"),
    aspectRatio: {
      type: "select",
      label: "Aspect ratio",
      options: [
        { label: "21:9", value: "21/9" },
        { label: "16:9", value: "16/9" },
        { label: "4:3", value: "4/3" },
        { label: "1:1", value: "1/1" },
      ],
    },
  },
  render: ({ src, alt, defaultSrc, defaultAlt, aspectRatio, injected }) => (
    <PostCoverImageRender
      src={src}
      alt={alt}
      defaultSrc={defaultSrc}
      defaultAlt={defaultAlt}
      aspectRatio={aspectRatio}
      injected={!!injected}
    />
  ),
};

function PostCoverImageRender({
  src,
  alt,
  defaultSrc,
  defaultAlt,
  aspectRatio,
  injected,
}: {
  src: string;
  alt: string;
  defaultSrc: string;
  defaultAlt: LocalizedString;
  aspectRatio: string;
  injected: boolean;
}) {
  const { locale } = useLocale();
  // Trang chi tiết bài (injected=true) KHÔNG hiển thị ảnh bìa nữa: ảnh bìa chỉ
  // dùng làm thumbnail (trang chủ/danh sách) + og:image khi share, tránh lặp lại
  // to đùng ở đầu bài. Editor template (injected=false) vẫn hiện placeholder để
  // người soạn thấy bố cục.
  if (injected) return null;
  // Ảnh bìa cũng qua bộ tối ưu: gốc legacy có thể là PNG hàng trăm KB và
  // chính nó là ứng viên LCP nên hưởng lợi nhiều nhất từ WebP thu gọn.
  const finalSrc = optimizedBodyImageUrl(src || defaultSrc);
  const finalAlt = alt || t(defaultAlt, locale) || "";
  if (!finalSrc) {
    return (
      <div
        className="w-full rounded-lg bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-sm my-4"
        style={{ aspectRatio }}
      >
        {t(POST_LABELS.coverHint, locale)}
      </div>
    );
  }
  return (
    <div
      className="w-full rounded-lg overflow-hidden my-4 bg-slate-50 dark:bg-[#121a2b] flex items-center justify-center"
      style={{ aspectRatio: aspectRatio || "16/9" }}
    >
      {/** biome-ignore lint/performance/noImgElement: needs natural aspect, not fill */}
      {/* Ảnh bìa là ứng viên LCP đầu trang: nạp sớm + giữ chỗ theo tỷ lệ để không gây CLS. */}
      <img
        src={finalSrc}
        alt={finalAlt}
        decoding="async"
        fetchPriority="high"
        className="max-w-full max-h-full w-auto h-auto object-contain"
      />
    </div>
  );
}

type TagChip = { slug: string; name: LocalizedString; icon?: string | null };

const tagArrayField = {
  type: "array",
  label: "Placeholder tags (template)",
  arrayFields: {
    slug: { type: "text", label: "Slug" },
    name: localizedTextField("Name"),
    icon: { type: "text", label: "Icon (image URL or Material Symbol)" },
  },
  getItemSummary: (item: { slug: string; name: LocalizedString }) => {
    if (typeof item.name === "string") return item.name || item.slug || "Tag";
    const first = item.name?.vi || item.name?.en;
    return first || item.slug || "Tag";
  },
} as const;

export const PostTagList: ComponentConfig<{
  tags: TagChip[];
  defaultTags: TagChip[];
  injected?: boolean;
  iconSize?: number;
}> = {
  label: "Post Tags",
  defaultProps: {
    tags: [],
    iconSize: 50,
    defaultTags: [
      { slug: "tag-mau", name: { vi: "Tag mẫu", en: "Sample tag" } },
      { slug: "thong-bao", name: { vi: "Thông báo", en: "Notice" } },
    ],
  },
  fields: {
    iconSize: {
      type: "number",
      label: "Kích thước icon (px)",
      min: 16,
      max: 240,
    },
    defaultTags: tagArrayField,
    tags: { ...tagArrayField, label: "Injected tags (auto)" },
  },
  render: ({ tags, defaultTags, injected, iconSize }) => (
    <PostTagListRender
      tags={tags}
      defaultTags={defaultTags}
      injected={injected}
      iconSize={iconSize}
    />
  ),
};

function PostTagListRender({
  tags,
  defaultTags,
  injected,
  iconSize,
}: {
  tags: TagChip[];
  defaultTags: TagChip[];
  injected?: boolean;
  iconSize?: number;
}) {
  const { locale } = useLocale();
  const size = iconSize && iconSize > 0 ? iconSize : 50;
  // Once a post is injected, trust its tags verbatim — even an empty array
  // (post had its tags removed) must render nothing, not fall back to the
  // template's sample tags. defaultTags are only for the un-injected preview.
  const list = injected
    ? tags || []
    : tags && tags.length
      ? tags
      : defaultTags || [];
  if (!list.length) {
    return <div className="hidden" aria-hidden="true" />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 my-3">
      {list.map((tag) => {
        const tagName = t(tag.name, locale) || tag.slug;
        const icon = tag.icon;
        const isImg = icon ? /^(https?:|\/uploads)/.test(icon) : false;
        // Image-icon tags (e.g. SDG badges) render as the image alone — no pill,
        // no "#name" — small and inline, like the faculty site presents them.
        if (isImg && icon) {
          return (
            // biome-ignore lint/performance/noImgElement: external tag badge, not a Next asset
            <img
              key={tag.slug}
              src={resolveMediaUrl(icon)}
              alt={tagName}
              title={tagName}
              className="object-contain rounded-sm"
              style={{
                height: `${size}px`,
                width: "auto",
                maxWidth: `${size}px`,
              }}
            />
          );
        }
        return (
          <span
            key={tag.slug}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium"
          >
            {icon && <DynamicIcon name={icon} className="w-3.5 h-3.5" />}#
            {tagName}
          </span>
        );
      })}
    </div>
  );
}

export const PostEventInfo: ComponentConfig<{
  startAt: string;
  endAt: string;
  location: string;
  defaultStart: string;
  defaultEnd: string;
  defaultLocation: LocalizedString;
}> = {
  label: "Post Event Info",
  defaultProps: {
    startAt: "",
    endAt: "",
    location: "",
    defaultStart: "",
    defaultEnd: "",
    defaultLocation: { vi: "Địa điểm sự kiện", en: "Event location" },
  },
  fields: {
    defaultStart: { type: "text", label: "Placeholder start (ISO)" },
    defaultEnd: { type: "text", label: "Placeholder end (ISO)" },
    defaultLocation: localizedTextField("Placeholder location"),
    startAt: autoLabel("Injected start"),
    endAt: autoLabel("Injected end"),
    location: autoLabel("Injected location"),
  },
  render: ({
    startAt,
    endAt,
    location,
    defaultStart,
    defaultEnd,
    defaultLocation,
  }) => (
    <PostEventInfoRender
      startAt={startAt}
      endAt={endAt}
      location={location}
      defaultStart={defaultStart}
      defaultEnd={defaultEnd}
      defaultLocation={defaultLocation}
    />
  ),
};

function PostEventInfoRender({
  startAt,
  endAt,
  location,
  defaultStart,
  defaultEnd,
  defaultLocation,
}: {
  startAt: string;
  endAt: string;
  location: string;
  defaultStart: string;
  defaultEnd: string;
  defaultLocation: LocalizedString;
}) {
  const { locale } = useLocale();
  const start = formatDate(startAt || defaultStart, locale);
  const end = formatDate(endAt || defaultEnd, locale);
  const place = location || t(defaultLocation, locale);
  if (!start && !end && !place) {
    return <div className="hidden" aria-hidden="true" />;
  }
  return (
    <div
      data-post-body
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 my-4 space-y-2 text-sm text-content-1000 dark:text-slate-100"
    >
      {start ? (
        <div>
          <span className="font-semibold">{t(POST_LABELS.start, locale)}:</span>{" "}
          {start}
        </div>
      ) : null}
      {end ? (
        <div>
          <span className="font-semibold">{t(POST_LABELS.end, locale)}:</span>{" "}
          {end}
        </div>
      ) : null}
      {place ? (
        <div>
          <span className="font-semibold">
            {t(POST_LABELS.location, locale)}:
          </span>{" "}
          {place}
        </div>
      ) : null}
    </div>
  );
}

export const PostHeader: ComponentConfig<{
  // `text`/`categoryLabel` nhét là chuỗi cũ hoặc {vi,en} mới — render dùng t().
  text: string;
  defaultText: LocalizedString;
  categoryLabel: string;
  categorySlug: string;
  defaultCategoryLabel: LocalizedString;
  publishedAt: string;
}> = {
  label: "Post Header",
  defaultProps: {
    text: "",
    defaultText: { vi: "Tiêu đề bài đăng", en: "Post title" },
    categoryLabel: "",
    categorySlug: "",
    defaultCategoryLabel: { vi: "Chuyên mục", en: "Category" },
    publishedAt: "",
  },
  fields: {
    defaultText: localizedTextField("Placeholder title (template)"),
    defaultCategoryLabel: localizedTextField("Placeholder category (template)"),
    text: autoLabel("Injected title"),
    categoryLabel: autoLabel("Injected category label"),
    categorySlug: autoLabel("Injected category slug"),
    publishedAt: autoLabel("Injected publishedAt (ISO)"),
  },
  render: ({
    text,
    defaultText,
    categoryLabel,
    categorySlug,
    defaultCategoryLabel,
    publishedAt,
  }) => (
    <PostHeaderRender
      text={text}
      defaultText={defaultText}
      categoryLabel={categoryLabel}
      categorySlug={categorySlug}
      defaultCategoryLabel={defaultCategoryLabel}
      publishedAt={publishedAt}
    />
  ),
};

function PostHeaderRender({
  text,
  defaultText,
  categoryLabel,
  categorySlug,
  defaultCategoryLabel,
  publishedAt,
}: {
  text: string;
  defaultText: LocalizedString;
  categoryLabel: string;
  categorySlug: string;
  defaultCategoryLabel: LocalizedString;
  publishedAt: string;
}) {
  const { locale } = useLocale();
  const title = t(text, locale) || t(defaultText, locale);
  const cat = t(categoryLabel, locale) || t(defaultCategoryLabel, locale);
  const dateLine = formatPublishedHeader(publishedAt, locale);
  const homeLabel = locale === "en" ? "Home" : "Trang chủ";
  const newsLabel = locale === "en" ? "News" : "Tin tức";
  const sep = (
    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
      /
    </span>
  );
  return (
    <header
      data-post-body
      className="border-b border-slate-200 dark:border-slate-800 pb-5 mb-6"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <nav
          aria-label="Breadcrumb"
          // Single scrollable line (no flex-wrap): giữ chiều cao cố định ~1 dòng nên
          // dù render sau hydration cũng không đẩy tiêu đề xuống (tránh CLS) và gọn
          // hơn trên mobile thay vì xuống 5–6 dòng.
          className="flex items-center gap-x-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 min-w-0 overflow-x-auto whitespace-nowrap [&>*]:shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <NextLink
            href={`/${locale}`}
            className="text-blue-700 dark:text-blue-300 underline underline-offset-2 decoration-blue-300 dark:decoration-blue-700 hover:decoration-blue-600 dark:hover:decoration-blue-200"
          >
            {homeLabel}
          </NextLink>
          {sep}
          <NextLink
            href={`/${locale}/tin-tuc`}
            className="text-blue-700 dark:text-blue-300 underline underline-offset-2 decoration-blue-300 dark:decoration-blue-700 hover:decoration-blue-600 dark:hover:decoration-blue-200"
          >
            {newsLabel}
          </NextLink>
          {cat ? (
            <>
              {sep}
              <NextLink
                href={
                  categorySlug
                    ? `/${locale}/tin-tuc?category=${categorySlug}`
                    : `/${locale}/tin-tuc`
                }
                className="text-blue-700 dark:text-blue-300 underline underline-offset-2 decoration-blue-300 dark:decoration-blue-700 hover:decoration-blue-600 dark:hover:decoration-blue-200"
              >
                {cat}
              </NextLink>
            </>
          ) : null}
        </nav>
        {dateLine ? (
          <time className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap mt-0.5">
            {dateLine}
          </time>
        ) : null}
      </div>
      <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-content-1000 dark:text-slate-100 leading-snug break-words">
        {title}
      </h1>
    </header>
  );
}

const FONT_SIZE_KEY = "postReaderFontSize";
const FONT_SIZE_LEVELS = [
  { level: 0, scale: 0.4 },
  { level: 1, scale: 0.5 },
  { level: 2, scale: 0.6 },
  { level: 3, scale: 0.7 },
  { level: 4, scale: 0.8 },
  { level: 5, scale: 0.9 },
  { level: 6, scale: 1 },
  { level: 7, scale: 1.2 },
  { level: 8, scale: 1.4 },
  { level: 9, scale: 1.6 },
  { level: 10, scale: 1.8 },
  { level: 11, scale: 2 },
  { level: 12, scale: 2.2 },
];
const DEFAULT_FONT_LEVEL = 8;

const scaleForLevel = (level: number) =>
  (
    FONT_SIZE_LEVELS.find((l) => l.level === level) ??
    FONT_SIZE_LEVELS[DEFAULT_FONT_LEVEL]
  ).scale;

const TOOL_LABELS = {
  decrease: { vi: "Giảm cỡ chữ", en: "Decrease font" },
  increase: { vi: "Tăng cỡ chữ", en: "Increase font" },
  copyLink: { vi: "Sao chép liên kết", en: "Copy link" },
  copied: { vi: "Đã sao chép!", en: "Copied!" },
  shareFb: { vi: "Chia sẻ Facebook", en: "Share on Facebook" },
};

type GapSize = "none" | "sm" | "md" | "lg" | "xl";
type StickyTop = "sm" | "md" | "lg";

const GAP_TO_PX: Record<GapSize, number> = {
  none: -8,
  sm: 8,
  md: 24,
  lg: 48,
  xl: 80,
};

const STICKY_TOP_TO_PX: Record<StickyTop, number> = {
  sm: 64,
  md: 96,
  lg: 128,
};

export const PostReaderTools: ComponentConfig<{
  enabled: boolean;
  gap: GapSize;
  stickyTop: StickyTop;
}> = {
  label: "Post Reader Tools (sidebar)",
  defaultProps: {
    enabled: true,
    gap: "md",
    stickyTop: "md",
  },
  fields: {
    enabled: {
      type: "radio",
      label: "Hiển thị",
      options: [
        { label: "Có", value: true },
        { label: "Không", value: false },
      ],
    },
    gap: {
      type: "select",
      label: "Khoảng cách với bài viết",
      options: [
        { label: "Không có", value: "none" },
        { label: "Nhỏ", value: "sm" },
        { label: "Vừa (mặc định)", value: "md" },
        { label: "Lớn", value: "lg" },
        { label: "Rất lớn", value: "xl" },
      ],
    },
    stickyTop: {
      type: "select",
      label: "Vị trí tính từ trên",
      options: [
        { label: "Sát đỉnh", value: "sm" },
        { label: "Vừa (mặc định)", value: "md" },
        { label: "Cách xa đỉnh", value: "lg" },
      ],
    },
  },
  render: ({ enabled, gap, stickyTop }) =>
    enabled ? (
      <PostReaderToolsRender gap={gap} stickyTop={stickyTop} />
    ) : (
      <span aria-hidden="true" />
    ),
};

function PostReaderToolsRender({
  gap,
  stickyTop,
}: {
  gap: GapSize;
  stickyTop: StickyTop;
}) {
  const { locale } = useLocale();
  const [level, setLevel] = useState<number>(DEFAULT_FONT_LEVEL);
  const [copied, setCopied] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [leftPx, setLeftPx] = useState<number | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(FONT_SIZE_KEY);
    const initial = saved ? Number.parseInt(saved, 10) : DEFAULT_FONT_LEVEL;
    const safe = Number.isFinite(initial) ? initial : DEFAULT_FONT_LEVEL;
    // Thẻ <style> zoom đã được render sẵn ở SSR theo mức mặc định, nên chỉ cập nhật
    // khi người dùng có mức lưu khác mặc định — trường hợp phổ biến không đổi gì,
    // tránh reflow toàn bài sau hydrate (nguyên nhân CLS trên bài nhiều ảnh).
    if (safe !== DEFAULT_FONT_LEVEL) setLevel(safe);
  }, []);

  useEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = rect.left - 48 - GAP_TO_PX[gap];
      setLeftPx(Math.max(8, next));
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [gap]);

  const changeLevel = (next: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZE_LEVELS.length - 1, next));
    setLevel(clamped);
    // Zoom áp qua thẻ <style> render theo `level` bên dưới (phản ứng theo state),
    // không thao tác DOM trực tiếp nữa.
    window.localStorage.setItem(FONT_SIZE_KEY, String(clamped));
  };

  const onCopyLink = async () => {
    const url = window.location.href;
    let ok = false;
    // navigator.clipboard chỉ tồn tại trong secure context (HTTPS/localhost) —
    // bản triển khai HTTP theo IP phải rơi về execCommand qua textarea ẩn.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
        /* thử fallback bên dưới */
      }
    }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const onShareFacebook = () => {
    // Chia sẻ qua hộp thoại chính thức của Facebook: mở popup, người dùng bấm "Đăng"
    // trong UI của FB → tạo bài thật trên tường/nhóm/Trang họ chọn. Đây là cách DUY
    // NHẤT được phép đăng lên tường cá nhân (Meta bỏ publish_actions từ 2018 nên
    // KHÔNG thể tự đăng bằng token). Preview (ảnh/tiêu đề) lấy từ thẻ Open Graph —
    // chỉ hiện khi site chạy trên domain công khai + HTTPS (FB crawler không đọc IP).
    //
    // Ưu tiên og:url/canonical (dùng domain thật khi đã cấu hình NEXT_PUBLIC_SITE_URL)
    // thay vì window.location.href thô theo IP sandbox.
    const canonical =
      document
        .querySelector('meta[property="og:url"]')
        ?.getAttribute("content") ||
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
      window.location.href;
    // Dòng trạng thái (caption) MẶC ĐỊNH khi chia sẻ: tiêu đề bài + tên Khoa, kèm
    // một hashtag thương hiệu. `quote`/`hashtag` chỉ điền sẵn CHẮC CHẮN khi share qua
    // Share Dialog kèm app-id (đặt NEXT_PUBLIC_FB_APP_ID); với sharer.php thì Meta có
    // thể bỏ qua (không chính thức) — nhưng vẫn gửi để "được thì tốt".
    const pageTitle =
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content") || document.title;
    const quote = encodeURIComponent(
      `«${pageTitle}» — Khoa Vật lý – Vật lý Kỹ thuật, Trường ĐH KHTN (ĐHQG-HCM)`,
    );
    const hashtag = encodeURIComponent("#KhoaVatLyVatLyKyThuat");
    // Có app-id → dùng /dialog/share (đẹp hơn, hỗ trợ quote/hashtag); không có →
    // rơi về /sharer/sharer.php (không cần app-id). Cả hai chỉ là popup tới facebook.com.
    const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
    const href = encodeURIComponent(canonical);
    const shareUrl = appId
      ? `https://www.facebook.com/dialog/share?app_id=${appId}&display=popup&href=${href}&quote=${quote}&hashtag=${hashtag}`
      : `https://www.facebook.com/sharer/sharer.php?u=${href}&quote=${quote}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer,width=600,height=650");
  };

  return (
    <>
      {/* Render thẳng ở SSR: mức phóng mặc định có mặt ngay lần vẽ đầu tiên nên
          không còn cú nhảy zoom sau hydrate (nguồn gốc CLS ~0.4 trên bài nhiều ảnh). */}
      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static, không có dữ liệu người dùng
        dangerouslySetInnerHTML={{
          __html: `[data-post-body]{zoom:${scaleForLevel(level)};}`,
        }}
      />
      <div ref={anchorRef} aria-hidden="true" className="h-0 w-0" />
      <aside
        aria-label="Reader tools"
        style={{
          top: `${STICKY_TOP_TO_PX[stickyTop]}px`,
          left: leftPx ?? -9999,
        }}
        className="hidden lg:flex flex-col items-center gap-3 fixed z-30 w-12"
      >
        <div className="flex flex-col items-center bg-white dark:bg-[#1a2436] border border-slate-200 dark:border-slate-800 rounded-full shadow-sm py-1.5">
          <button
            type="button"
            onClick={() => changeLevel(level + 1)}
            aria-label={t(TOOL_LABELS.increase, locale)}
            className="w-9 h-9 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 disabled:opacity-30"
            disabled={level >= FONT_SIZE_LEVELS.length - 1}
          >
            <span className="text-lg leading-none">+</span>
          </button>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold py-1 select-none">
            aA
          </span>
          <button
            type="button"
            onClick={() => changeLevel(level - 1)}
            aria-label={t(TOOL_LABELS.decrease, locale)}
            className="w-9 h-9 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 disabled:opacity-30"
            disabled={level <= 0}
          >
            <span className="text-lg leading-none">−</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onCopyLink}
          aria-label={t(TOOL_LABELS.copyLink, locale)}
          title={
            copied
              ? t(TOOL_LABELS.copied, locale)
              : t(TOOL_LABELS.copyLink, locale)
          }
          className="w-10 h-10 rounded-full bg-white dark:bg-[#1a2436] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07l-1 1" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07l1-1" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onShareFacebook}
          aria-label={t(TOOL_LABELS.shareFb, locale)}
          title={t(TOOL_LABELS.shareFb, locale)}
          className="w-10 h-10 rounded-full bg-[#1877F2] text-white shadow-sm flex items-center justify-center hover:opacity-90"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.84c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.45 2.91h-2.33V22c4.78-.79 8.43-4.94 8.43-9.94z" />
          </svg>
        </button>

        {copied ? (
          <div
            role="status"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm shadow-lg z-50"
          >
            {t(TOOL_LABELS.copied, locale)}
          </div>
        ) : null}
      </aside>
    </>
  );
}
