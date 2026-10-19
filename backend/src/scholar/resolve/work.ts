/**
 * Dạng dữ liệu chung của MỘT công trình sau khi tra được — dù nguồn là Crossref,
 * OpenAlex, arXiv, hay file .bib / .ris người dùng tải từ Mendeley, Zotero,
 * EndNote. Mọi bộ đọc đều đổ về đây, nên phần lưu và phần giao diện chỉ phải
 * biết một hình dạng duy nhất.
 *
 * Đây là dữ kiện THÔ. Việc xếp bài vào mã Phụ lục 2 do tác giả tự làm ở bước
 * sau — không nguồn nào ở đây nói được bài thuộc Q mấy.
 */

export type ResolvedAuthor = {
  family?: string | null;
  given?: string | null;
  /** Dùng khi nguồn chỉ cho một chuỗi tên liền, không tách được họ/tên. */
  name?: string | null;
  orcid?: string | null;
  /** Crossref đánh dấu tác giả đứng đầu; các nguồn khác thường không có. */
  sequence?: 'first' | 'additional' | null;
  /** MỌI địa chỉ của tác giả trên bài, nối bằng "; " (trước 5/10/2026 chỉ lấy cái đầu). */
  affiliation?: string | null;
  /**
   * Tác giả liên hệ theo OpenAlex — CHỈ đặt khi OpenAlex đánh dấu ĐÚNG MỘT người
   * (nguồn này hay đánh dấu cả nhóm; Crossref không có thông tin này).
   */
  isCorresponding?: boolean | null;
};

export type ResolvedWork = {
  doi?: string | null;
  arxivId?: string | null;
  isbn?: string | null;
  issn?: string | null;
  /** journal-article · proceedings-article · book-chapter · book · patent … */
  type: string;
  title: string;
  containerTitle?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  url?: string | null;
  publishedYear?: number | null;
  publishedMonth?: number | null;
  acceptedYear?: number | null;
  acceptedMonth?: number | null;
  authors: ResolvedAuthor[];
  /** crossref · openalex · arxiv · datacite · bibtex · ris · csl-json · manual */
  source: string;
  raw?: unknown;
};

/**
 * Khoá so TÊN công trình: bỏ dấu, chữ thường, bỏ mọi ký tự không phải chữ/số.
 * "Room-Temperature Ferromagnetism…" và "Room temperature ferromagnetism…" cùng khoá.
 */
export function khoaTieuDe(title?: string | null): string {
  return String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Bản thảo (preprint) — Phụ lục 2 KHÔNG tính. Ca thật 4/10/2026: một bài đã đăng
 * ApJS (Q1) nhưng web Khoa chỉ giữ bản arXiv (DOI 10.48550 của DataCite).
 */
export function laBanThao(w: {
  doi?: string | null;
  type?: string | null;
  source?: string | null;
  containerTitle?: string | null;
  publisher?: string | null;
}): boolean {
  const doi = String(w.doi ?? '').toLowerCase();
  return (
    /^(posted-content|preprint)$/i.test(w.type ?? '') ||
    doi.startsWith('10.48550/') ||
    w.source === 'arxiv' ||
    /\b(arxiv|research ?square|biorxiv|medrxiv|chemrxiv|ssrn|techrxiv|preprints\.org)\b/i.test(
      `${w.containerTitle ?? ''} ${w.publisher ?? ''}`,
    )
  );
}

/** DOI về dạng chuẩn: bỏ tiền tố URL, bỏ khoảng trắng, hạ chữ thường. */
export function normalizeDoi(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : null;
}

/** arXiv ID từ link hoặc chuỗi trần: "arXiv:2401.01234v2" → "2401.01234". */
export function normalizeArxiv(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m =
    s.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i) ??
    s.match(/^ar[Xx]iv:\s*(\S+)/) ??
    s.match(/^(\d{4}\.\d{4,5}(v\d+)?)$/);
  if (!m) return null;
  return m[1].replace(/v\d+$/, '').replace(/\.pdf$/i, '');
}

export function normalizeIssn(input?: string | null): string | null {
  if (!input) return null;
  const m = String(input).match(/(\d{4})-?(\d{3}[\dxX])/);
  return m ? `${m[1]}-${m[2].toUpperCase()}` : null;
}

export function normalizeIsbn(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).replace(/[^0-9xX]/g, '');
  return s.length === 10 || s.length === 13 ? s.toUpperCase() : null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "jan" · "January" · "3" · "03" → 1..12, sai định dạng thì null. */
export function parseMonth(input?: string | number | null): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    return input >= 1 && input <= 12 ? Math.trunc(input) : null;
  }
  const s = String(input).trim().toLowerCase();
  const num = Number(s);
  if (Number.isFinite(num))
    return num >= 1 && num <= 12 ? Math.trunc(num) : null;
  const key = s.slice(0, 3);
  return MONTHS[key] ?? null;
}

export function parseYear(input?: string | number | null): number | null {
  if (input === null || input === undefined || input === '') return null;
  const m = String(input).match(/(1[89]\d{2}|20\d{2}|21\d{2})/);
  return m ? Number(m[1]) : null;
}

/**
 * Năm dùng để tính KPI: lấy năm công bố, chưa in thì lấy năm được chấp nhận.
 * Suy ra ở tầng ghi để lọc theo năm là truy vấn có index, không phải tính lại
 * mỗi lần đọc.
 */
export function resolveCountYear(w: {
  publishedYear?: number | null;
  acceptedYear?: number | null;
}): number | null {
  return w.publishedYear ?? w.acceptedYear ?? null;
}

// ── Bóc JSON lạ một cách có kiểm tra ────────────────────────────────────────
// Dữ liệu từ API ngoài và từ file người dùng tải lên không có gì bảo đảm về hình
// dạng. Ép kiểu `any` rồi đọc thẳng thì một trường đổi kiểu là ném lỗi giữa
// chừng; các hàm dưới đây luôn trả về giá trị dùng được, trường thiếu thành null.
export type Json = Record<string, unknown>;

export const asObj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const asStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim()
    ? v
    : typeof v === 'number'
      ? String(v)
      : null;

/** Trường vừa có thể là chuỗi vừa có thể là mảng chuỗi (Crossref hay như vậy). */
export const firstStr = (v: unknown): string | null =>
  Array.isArray(v) ? asStr(v[0]) : asStr(v);

/** Lấy `obj.a.b.c` mà không nổ khi khúc giữa vắng mặt. */
export const dig = (root: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => asObj(acc)[key], root);

/** Ngày kiểu Crossref / CSL-JSON: { "date-parts": [[2024, 5, 1]] }. */
export const dateParts = (v: unknown): unknown[] =>
  asArr(asArr(dig(v, 'date-parts'))[0]);
